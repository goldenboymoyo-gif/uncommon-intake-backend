-- New intake flow: details form (name, email, phone, location, hub) -> CV upload -> 5 interview
-- questions that AI writes from that applicant's CV. The motivational letter step is removed.

-- ---------- Applications: location, CV (or a short "about you" if there is no CV) ----------
alter table public.applications add column location text not null default '';
alter table public.applications rename column letter_path to cv_path;
alter table public.applications rename column letter_name to cv_name;
alter table public.applications add column about_text text;
alter table public.applications add column questions_ready_at timestamptz;

drop table public.letter_feedback;

-- The guard trigger referred to the old column names.
create or replace function public.guard_application_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_staff() or auth.role() = 'service_role'
     or current_setting('app.system_update', true) = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if new.review_status is distinct from old.review_status
     or new.needs_help is distinct from old.needs_help
     or new.reviewer_id is distinct from old.reviewer_id
     or new.decision is distinct from old.decision
     or new.decided_by is distinct from old.decided_by
     or new.decided_at is distinct from old.decided_at
     or new.applicant_id is distinct from old.applicant_id
     or new.questions_ready_at is distinct from old.questions_ready_at then
    raise exception 'You cannot change review fields';
  end if;
  if old.submitted_at is not null and (
       new.first_names is distinct from old.first_names or new.surname is distinct from old.surname
       or new.location is distinct from old.location or new.hub_id is distinct from old.hub_id
       or new.cv_path is distinct from old.cv_path or new.about_text is distinct from old.about_text) then
    raise exception 'This application has been sent and can no longer be changed';
  end if;
  if new.place_confirmed_at is distinct from old.place_confirmed_at and old.decision is distinct from 'accepted' then
    raise exception 'Only accepted applicants can confirm a place';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Interview questions are now written per applicant ----------
alter table public.interview_questions drop constraint interview_questions_intake_id_position_key;
alter table public.interview_questions
  add column application_id uuid references public.applications (id) on delete cascade,
  add column ai_generated boolean not null default false,
  -- Which part of the CV the question is about, so staff can see why it was asked.
  add column based_on text,
  add column model text;
create unique index interview_questions_app_position on public.interview_questions (application_id, position)
  where application_id is not null;
create unique index interview_questions_intake_position on public.interview_questions (intake_id, position)
  where application_id is null;

-- Applicants may only see their own questions (or shared intake questions). Staff see all.
drop policy "signed in reads interview questions" on public.interview_questions;
create policy "read own or shared interview questions" on public.interview_questions for select using (
  public.is_staff()
  or (application_id is null and auth.uid() is not null)
  or exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid())
);

-- Count this applicant's own questions when working out the review status.
create or replace function public.sync_review_status(p_application uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  answered int;
  summarised int;
  total int;
  current public.review_status;
  next_status public.review_status;
begin
  select review_status into current from applications where id = p_application;
  if current in ('in_review', 'needs_help', 'accepted', 'waitlisted', 'not_accepted') then
    return;
  end if;

  select count(*) into total from interview_questions where application_id = p_application;
  if total = 0 then
    select count(*) into total from interview_questions q
      join applications a on a.intake_id = q.intake_id
      where a.id = p_application and q.application_id is null;
  end if;
  select count(*), count(*) filter (where state = 'summarised')
    into answered, summarised from interview_answers where application_id = p_application;

  next_status := case
    when answered = 0 then 'not_started'
    when total = 0 or answered < total then 'in_progress'
    when summarised >= total then 'ready_to_review'
    else 'all_answered'
  end;

  if next_status is distinct from current then
    perform set_config('app.system_update', 'on', true);
    update applications set review_status = next_status where id = p_application;
    perform set_config('app.system_update', 'off', true);
  end if;
end;
$$;

-- ---------- Private bucket for CVs ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-cvs', 'application-cvs', false, 5242880, array[
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy "owner uploads own cv" on storage.objects for insert to authenticated
  with check (bucket_id = 'application-cvs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner updates own cv" on storage.objects for update to authenticated
  using (bucket_id = 'application-cvs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner reads own cv" on storage.objects for select to authenticated
  using (bucket_id = 'application-cvs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "staff read application cvs" on storage.objects for select to authenticated
  using (bucket_id = 'application-cvs' and public.is_staff());
