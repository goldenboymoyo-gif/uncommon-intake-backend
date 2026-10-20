-- Uncommon Intake: core schema.
-- Every table has Row Level Security on. Nothing here inserts people, numbers or stories.

create extension if not exists pgcrypto;

-- ---------- Types ----------
create type public.user_role as enum ('applicant', 'student', 'staff', 'admin');
create type public.review_status as enum (
  'not_started', 'in_progress', 'all_answered', 'ready_to_review',
  'in_review', 'needs_help', 'accepted', 'waitlisted', 'not_accepted'
);
create type public.decision as enum ('accepted', 'waitlisted', 'not_accepted');
create type public.answer_format as enum ('text', 'audio', 'video');
create type public.upload_state as enum ('pending', 'uploaded', 'transcribed', 'summarised', 'failed');

-- ---------- Reference tables (filled by staff, never seeded with invented data) ----------
create table public.hubs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.intakes (
  id uuid primary key default gen_random_uuid(),
  year int not null unique,
  title text not null,
  opens_at date,
  closes_at date,
  places_total int check (places_total >= 0),
  is_open boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- People ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'applicant',
  first_names text not null default '',
  surname text not null default '',
  phone text not null default '',
  email text not null default '',
  hub_id uuid references public.hubs (id),
  terms_accepted_at timestamptz,
  push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Helper used by policies. security definer so it can read profiles without recursion.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role in ('staff', 'admin'));
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- New auth user -> profile. Role is ALWAYS applicant here; staff are promoted by an admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, first_names, surname, phone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_names', ''),
    coalesce(new.raw_user_meta_data ->> 'surname', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Application form ----------
-- Steps 2 to 7 come from this table. Staff add the real questions; the app never guesses them.
create table public.form_questions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes (id) on delete cascade,
  step int not null check (step between 2 and 7),
  position int not null default 0,
  label text not null,
  help_text text,
  kind text not null check (kind in ('short_text', 'long_text', 'single_choice', 'multi_choice', 'date', 'number', 'yes_no', 'letter_upload')),
  options jsonb not null default '[]'::jsonb,
  required boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.form_questions (intake_id, step, position);

-- Step titles, also from staff.
create table public.form_steps (
  intake_id uuid not null references public.intakes (id) on delete cascade,
  step int not null check (step between 2 and 7),
  title text not null,
  primary key (intake_id, step)
);

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.profiles (id) on delete cascade,
  intake_id uuid not null references public.intakes (id),
  hub_id uuid references public.hubs (id),
  -- Step 1
  first_names text not null default '',
  surname text not null default '',
  gender text,
  date_of_birth date,
  phone text not null default '',
  email text not null default '',
  -- Progress
  current_step int not null default 1,
  letter_path text,
  letter_name text,
  ai_notice_seen_at timestamptz,
  submitted_at timestamptz,
  -- Interview
  interview_format public.answer_format,
  recording_consent_at timestamptz,
  low_data boolean not null default false,
  interview_sent_at timestamptz,
  -- Review (staff only; see trigger below)
  review_status public.review_status not null default 'not_started',
  needs_help boolean not null default false,
  reviewer_id uuid references public.profiles (id),
  decision public.decision,
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  place_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (applicant_id, intake_id)
);

-- Applicants may edit their own row, but never the review or decision fields.
create or replace function public.guard_application_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() or auth.role() = 'service_role' then
    return new;
  end if;
  if new.review_status is distinct from old.review_status
     or new.needs_help is distinct from old.needs_help
     or new.reviewer_id is distinct from old.reviewer_id
     or new.decision is distinct from old.decision
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.applicant_id is distinct from old.applicant_id then
    raise exception 'You cannot change review fields';
  end if;
  -- Once submitted, the form answers are locked.
  if old.submitted_at is not null and (
       new.first_names is distinct from old.first_names or new.surname is distinct from old.surname
       or new.gender is distinct from old.gender or new.date_of_birth is distinct from old.date_of_birth
       or new.letter_path is distinct from old.letter_path) then
    raise exception 'This application has been sent and can no longer be changed';
  end if;
  -- Only accepted applicants can confirm a place.
  if new.place_confirmed_at is distinct from old.place_confirmed_at and old.decision is distinct from 'accepted' then
    raise exception 'Only accepted applicants can confirm a place';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger applications_guard
  before update on public.applications
  for each row execute function public.guard_application_update();

create table public.application_answers (
  application_id uuid not null references public.applications (id) on delete cascade,
  question_id uuid not null references public.form_questions (id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (application_id, question_id)
);

-- AI suggestions for the motivational letter. Suggestions only, never a rewritten letter.
create table public.letter_feedback (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  suggestions jsonb not null,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);

-- ---------- Interview ----------
create table public.interview_questions (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes (id) on delete cascade,
  position int not null check (position between 1 and 5),
  prompt text not null,
  unique (intake_id, position)
);

-- What staff look for. The AI summary is written against this list.
create table public.review_checklist (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes (id) on delete cascade,
  position int not null default 0,
  item text not null
);

create table public.interview_answers (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  question_id uuid not null references public.interview_questions (id) on delete cascade,
  format public.answer_format not null,
  text_answer text,
  media_path text,
  duration_seconds int,
  state public.upload_state not null default 'pending',
  transcript text,
  ai_summary jsonb,
  ai_model text,
  media_delete_after timestamptz,
  media_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, question_id)
);

-- Notes written by people. Kept apart from AI text.
create table public.staff_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  author_id uuid not null references public.profiles (id),
  note text not null,
  created_at timestamptz not null default now()
);

-- Every decision is logged with the person who made it.
create table public.decision_log (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications (id) on delete cascade,
  decision public.decision not null,
  decided_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------- Notifications ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('decision', 'reminder', 'survey', 'general')),
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Graduates and outcomes ----------
create table public.graduate_stories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  employer text not null,
  story text not null,
  photo_path text,
  graduation_year int not null default 2026,
  consent_given boolean not null default false,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.job_outcomes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  employer text not null,
  role text not null,
  started_on date,
  recorded_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ---------- Career coach ----------
create table public.coach_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('cv', 'cover_letter', 'interview_practice')),
  title text not null default '',
  input_text text,
  file_path text,
  feedback jsonb,
  model text,
  created_at timestamptz not null default now()
);

-- ---------- Surveys ----------
create table public.surveys (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_by uuid not null references public.profiles (id),
  due_at timestamptz,
  is_open boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  position int not null default 0,
  prompt text not null,
  kind text not null check (kind in ('text', 'scale', 'single_choice')),
  options jsonb not null default '[]'::jsonb
);

create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  question_id uuid not null references public.survey_questions (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  value jsonb not null,
  created_at timestamptz not null default now(),
  unique (question_id, student_id)
);

-- AI themes. Each theme keeps the ids of the raw answers it came from.
create table public.survey_themes (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null references public.surveys (id) on delete cascade,
  question_id uuid references public.survey_questions (id) on delete cascade,
  theme text not null,
  response_ids uuid[] not null default '{}',
  model text not null,
  created_at timestamptz not null default now()
);

-- ---------- Row Level Security ----------
alter table public.hubs enable row level security;
alter table public.intakes enable row level security;
alter table public.profiles enable row level security;
alter table public.form_questions enable row level security;
alter table public.form_steps enable row level security;
alter table public.applications enable row level security;
alter table public.application_answers enable row level security;
alter table public.letter_feedback enable row level security;
alter table public.interview_questions enable row level security;
alter table public.review_checklist enable row level security;
alter table public.interview_answers enable row level security;
alter table public.staff_notes enable row level security;
alter table public.decision_log enable row level security;
alter table public.notifications enable row level security;
alter table public.graduate_stories enable row level security;
alter table public.job_outcomes enable row level security;
alter table public.coach_sessions enable row level security;
alter table public.surveys enable row level security;
alter table public.survey_questions enable row level security;
alter table public.survey_responses enable row level security;
alter table public.survey_themes enable row level security;

-- Public reference data (the Home screen works before sign in).
create policy "anyone reads hubs" on public.hubs for select using (true);
create policy "staff manage hubs" on public.hubs for all using (public.is_staff()) with check (public.is_staff());
create policy "anyone reads intakes" on public.intakes for select using (true);
create policy "staff manage intakes" on public.intakes for all using (public.is_staff()) with check (public.is_staff());

-- Only consented AND staff-approved stories are visible to the public.
create policy "public reads approved stories" on public.graduate_stories for select
  using (consent_given and approved_by is not null);
create policy "staff manage stories" on public.graduate_stories for all using (public.is_staff()) with check (public.is_staff());

-- Profiles
create policy "read own profile" on public.profiles for select using (id = auth.uid() or public.is_staff());
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admin manages profiles" on public.profiles for all using (public.is_admin()) with check (public.is_admin());
-- Users can only change these columns on their own row. Role changes go through an admin.
revoke update on public.profiles from authenticated;
grant update (first_names, surname, phone, hub_id, terms_accepted_at, push_token, updated_at) on public.profiles to authenticated;

-- Form setup: signed-in users read, staff write.
create policy "signed in reads questions" on public.form_questions for select using (auth.uid() is not null);
create policy "staff manage questions" on public.form_questions for all using (public.is_staff()) with check (public.is_staff());
create policy "signed in reads steps" on public.form_steps for select using (auth.uid() is not null);
create policy "staff manage steps" on public.form_steps for all using (public.is_staff()) with check (public.is_staff());
create policy "signed in reads interview questions" on public.interview_questions for select using (auth.uid() is not null);
create policy "staff manage interview questions" on public.interview_questions for all using (public.is_staff()) with check (public.is_staff());
create policy "staff read checklist" on public.review_checklist for select using (public.is_staff());
create policy "staff manage checklist" on public.review_checklist for all using (public.is_staff()) with check (public.is_staff());

-- Applications
create policy "applicant reads own application" on public.applications for select
  using (applicant_id = auth.uid() or public.is_staff());
create policy "applicant creates own application" on public.applications for insert
  with check (applicant_id = auth.uid() and review_status = 'not_started' and decision is null);
create policy "applicant updates own application" on public.applications for update
  using (applicant_id = auth.uid() or public.is_staff())
  with check (applicant_id = auth.uid() or public.is_staff());

create policy "answers owner or staff read" on public.application_answers for select
  using (public.is_staff() or exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid()));
create policy "answers owner writes before submit" on public.application_answers for all
  using (exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid() and a.submitted_at is null))
  with check (exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid() and a.submitted_at is null));

-- Letter feedback is written by the Edge Function (service role) and read by the owner.
create policy "letter feedback owner read" on public.letter_feedback for select
  using (exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid()) or public.is_staff());

-- Interview answers
create policy "interview answers owner or staff read" on public.interview_answers for select
  using (public.is_staff() or exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid()));
create policy "interview answers owner insert" on public.interview_answers for insert
  with check (exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid() and a.interview_sent_at is null));
create policy "interview answers owner update" on public.interview_answers for update
  using (exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid() and a.interview_sent_at is null));

-- Staff only
create policy "staff notes" on public.staff_notes for all using (public.is_staff()) with check (public.is_staff() and author_id = auth.uid());
create policy "staff read decision log" on public.decision_log for select using (public.is_staff());
create policy "staff job outcomes" on public.job_outcomes for all using (public.is_staff()) with check (public.is_staff() and recorded_by = auth.uid());

-- Notifications: owner reads and marks read. Created by Edge Functions.
create policy "own notifications" on public.notifications for select using (user_id = auth.uid());
create policy "mark own notifications read" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Coach: students only, own rows.
create policy "own coach sessions" on public.coach_sessions for select using (student_id = auth.uid() or public.is_staff());
create policy "student creates coach session" on public.coach_sessions for insert
  with check (student_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student'));

-- Surveys
create policy "students and staff read surveys" on public.surveys for select
  using (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student'));
create policy "staff manage surveys" on public.surveys for all using (public.is_staff()) with check (public.is_staff());
create policy "students and staff read survey questions" on public.survey_questions for select
  using (public.is_staff() or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student'));
create policy "staff manage survey questions" on public.survey_questions for all using (public.is_staff()) with check (public.is_staff());
create policy "student reads own responses" on public.survey_responses for select using (student_id = auth.uid() or public.is_staff());
create policy "student answers open survey" on public.survey_responses for insert
  with check (student_id = auth.uid() and exists (select 1 from public.surveys s where s.id = survey_id and s.is_open));
create policy "staff read themes" on public.survey_themes for select using (public.is_staff());

-- ---------- Staff overview: counts from real rows only ----------
create or replace function public.staff_overview(p_intake uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare result json;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select json_build_object(
    'applied', (select count(*) from applications where intake_id = p_intake and submitted_at is not null),
    'interviewed', (select count(*) from applications where intake_id = p_intake and interview_sent_at is not null),
    'accepted', (select count(*) from applications where intake_id = p_intake and decision = 'accepted'),
    'confirmed', (select count(*) from applications where intake_id = p_intake and place_confirmed_at is not null),
    'places_total', (select places_total from intakes where id = p_intake),
    'by_hub', coalesce((
      select json_agg(json_build_object('hub', coalesce(h.name, 'No hub chosen'), 'count', c.n) order by c.n desc)
      from (select hub_id, count(*) n from applications where intake_id = p_intake and submitted_at is not null group by hub_id) c
      left join hubs h on h.id = c.hub_id
    ), '[]'::json),
    'job_outcomes', (select count(*) from job_outcomes)
  ) into result;
  return result;
end;
$$;
