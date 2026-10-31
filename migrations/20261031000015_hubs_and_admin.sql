-- Each hub works on its own. Staff see only their hub. Students see only their hub's surveys and
-- messages. Admins see everything and are the only ones who can add staff and choose their hub.

-- Bright Moyo's story is replaced by the marketplace profile on Home.
delete from public.graduate_stories where lower(name) = 'bright moyo';

-- Students belong to the hub they were accepted at.
update public.profiles p set hub_id = a.hub_id
from public.applications a
where a.applicant_id = p.id and a.decision = 'accepted' and a.hub_id is not null
  and p.role in ('student', 'graduate');

-- ---------- Helpers used by the rules below ----------
create or replace function public.my_hub()
returns uuid language sql stable security definer set search_path = public as $$
  select hub_id from profiles where id = auth.uid() and role = 'staff';
$$;

create or replace function public.can_see_hub(p_hub uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (p_hub is not null and p_hub = public.my_hub());
$$;

create or replace function public.can_see_application(p_application uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from applications a where a.id = p_application and public.can_see_hub(a.hub_id));
$$;

-- Text, because storage folders are named after the person's id.
create or replace function public.can_see_person(p_person text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.my_hub() is not null and (
    exists (select 1 from profiles p where p.id::text = p_person and p.hub_id = public.my_hub())
    or exists (select 1 from applications a where a.applicant_id::text = p_person and a.hub_id = public.my_hub())
  ));
$$;

alter table public.surveys add column hub_id uuid references public.hubs (id) default public.my_hub();

-- An old survey or one from an admin has no hub, and goes to every hub.
create or replace function public.can_read_survey(p_survey uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from surveys s where s.id = p_survey and (
      public.can_see_hub(s.hub_id)
      or (s.hub_id is null and public.is_staff())
      or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'student' and (s.hub_id is null or s.hub_id = p.hub_id))
    )
  );
$$;

create or replace function public.can_manage_survey(p_survey uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from surveys s where s.id = p_survey and public.can_see_hub(s.hub_id));
$$;

-- ---------- Only an admin or the system can move staff and students to another hub ----------
create or replace function public.guard_profile_hub()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.hub_id is distinct from old.hub_id and old.role <> 'applicant'
     and auth.uid() = old.id and not public.is_admin() then
    new.hub_id := old.hub_id;
  end if;
  return new;
end;
$$;

create trigger guard_profile_hub before update on public.profiles
  for each row execute function public.guard_profile_hub();

-- ---------- Adding staff: the admin types their email and chooses their hub ----------
create table public.staff_invites (
  email text primary key,
  hub_id uuid not null references public.hubs (id),
  invited_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.staff_invites enable row level security;
create policy "admin manages staff invites" on public.staff_invites for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare invite public.staff_invites;
begin
  select * into invite from staff_invites where email = lower(coalesce(new.email, ''));
  insert into profiles (id, email, first_names, surname, phone, role, hub_id)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_names', ''),
    coalesce(new.raw_user_meta_data ->> 'surname', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case when invite.email is null then 'applicant'::public.user_role else 'staff'::public.user_role end,
    invite.hub_id
  );
  if invite.email is not null then
    delete from staff_invites where email = invite.email;
  end if;
  return new;
end;
$$;

create or replace function public.admin_set_staff(p_email text, p_hub uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  clean text := lower(trim(p_email));
  person public.profiles;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if clean not like '%_@_%' then raise exception 'Please type a valid email.'; end if;
  if not exists (select 1 from hubs where id = p_hub) then raise exception 'Please choose a hub.'; end if;
  select * into person from profiles where lower(email) = clean;
  if person.id is null then
    insert into staff_invites (email, hub_id, invited_by) values (clean, p_hub, auth.uid())
    on conflict (email) do update set hub_id = excluded.hub_id, invited_by = excluded.invited_by;
    return 'invited';
  end if;
  if person.role = 'admin' then raise exception 'This person is an admin and already sees every hub.'; end if;
  update profiles set role = 'staff', hub_id = p_hub, updated_at = now() where id = person.id;
  return 'added';
end;
$$;

create or replace function public.admin_remove_staff(p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update profiles set role = 'applicant', hub_id = null, updated_at = now() where id = p_person and role = 'staff';
end;
$$;

-- ---------- Rules: staff only reach their own hub ----------
drop policy "staff manage hubs" on public.hubs;
create policy "admin manages hubs" on public.hubs for all using (public.is_admin()) with check (public.is_admin());
drop policy "staff manage intakes" on public.intakes;
create policy "admin manages intakes" on public.intakes for all using (public.is_admin()) with check (public.is_admin());

drop policy "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (id = auth.uid() or public.can_see_person(id::text));

drop policy "applicant reads own application" on public.applications;
create policy "applicant reads own application" on public.applications for select
  using (applicant_id = auth.uid() or public.can_see_hub(hub_id));
drop policy "applicant updates own application" on public.applications;
create policy "applicant updates own application" on public.applications for update
  using (applicant_id = auth.uid() or public.can_see_hub(hub_id))
  with check (applicant_id = auth.uid() or public.can_see_hub(hub_id));

drop policy "answers owner or staff read" on public.application_answers;
create policy "answers owner or staff read" on public.application_answers for select
  using (public.can_see_application(application_id) or exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid()));
drop policy "interview answers owner or staff read" on public.interview_answers;
create policy "interview answers owner or staff read" on public.interview_answers for select
  using (public.can_see_application(application_id) or exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid()));

drop policy "read own or shared interview questions" on public.interview_questions;
create policy "read own or shared interview questions" on public.interview_questions for select using (
  (application_id is null and auth.uid() is not null)
  or public.can_see_application(application_id)
  or exists (select 1 from public.applications a where a.id = application_id and a.applicant_id = auth.uid())
);
drop policy "staff manage interview questions" on public.interview_questions;
create policy "admin manages interview questions" on public.interview_questions for all using (public.is_admin()) with check (public.is_admin());

drop policy "staff notes" on public.staff_notes;
create policy "staff notes" on public.staff_notes for all
  using (public.can_see_application(application_id))
  with check (public.can_see_application(application_id) and author_id = auth.uid());
drop policy "staff read decision log" on public.decision_log;
create policy "staff read decision log" on public.decision_log for select using (public.can_see_application(application_id));
drop policy "staff job outcomes" on public.job_outcomes;
create policy "staff job outcomes" on public.job_outcomes for all
  using (public.can_see_person(student_id::text))
  with check (public.can_see_person(student_id::text) and recorded_by = auth.uid());
drop policy "own coach sessions" on public.coach_sessions;
create policy "own coach sessions" on public.coach_sessions for select using (student_id = auth.uid() or public.can_see_person(student_id::text));

drop policy "students and staff read surveys" on public.surveys;
create policy "students and staff read surveys" on public.surveys for select using (public.can_read_survey(id));
drop policy "staff manage surveys" on public.surveys;
create policy "staff manage surveys" on public.surveys for all
  using (public.can_see_hub(hub_id))
  with check (public.is_admin() or (hub_id is not null and hub_id = public.my_hub()));
drop policy "students and staff read survey questions" on public.survey_questions;
create policy "students and staff read survey questions" on public.survey_questions for select using (public.can_read_survey(survey_id));
drop policy "staff manage survey questions" on public.survey_questions;
create policy "staff manage survey questions" on public.survey_questions for all
  using (public.can_manage_survey(survey_id)) with check (public.can_manage_survey(survey_id));
drop policy "student reads own responses" on public.survey_responses;
create policy "student reads own responses" on public.survey_responses for select
  using (student_id = auth.uid() or public.can_manage_survey(survey_id));
drop policy "student answers open survey" on public.survey_responses;
create policy "student answers open survey" on public.survey_responses for insert
  with check (student_id = auth.uid() and public.can_read_survey(survey_id)
    and exists (select 1 from public.surveys s where s.id = survey_id and s.is_open));
drop policy "staff read themes" on public.survey_themes;
create policy "staff read themes" on public.survey_themes for select using (public.can_manage_survey(survey_id));

drop policy "staff read applicant files" on storage.objects;
create policy "staff read applicant files" on storage.objects for select to authenticated
  using (bucket_id in ('letters', 'interview-media') and public.can_see_person((storage.foldername(name))[1]));
drop policy "staff read application cvs" on storage.objects;
create policy "staff read application cvs" on storage.objects for select to authenticated
  using (bucket_id = 'application-cvs' and public.can_see_person((storage.foldername(name))[1]));
drop policy "staff read avatars" on storage.objects;
create policy "staff read avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.can_see_person((storage.foldername(name))[1]));

-- ---------- Staff numbers: an admin gets every hub, staff get their own ----------
create or replace function public.staff_overview(p_intake uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare result json;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  with visible as (
    select * from applications where intake_id = p_intake and public.can_see_hub(hub_id)
  )
  select json_build_object(
    'applied', (select count(*) from visible where submitted_at is not null),
    'interviewed', (select count(*) from visible where interview_sent_at is not null),
    'accepted', (select count(*) from visible where decision = 'accepted'),
    'confirmed', (select count(*) from visible where place_confirmed_at is not null),
    -- Places are set for the whole intake, not per hub.
    'places_total', case when public.is_admin() then (select places_total from intakes where id = p_intake) end,
    'by_hub', coalesce((
      select json_agg(json_build_object('hub', coalesce(h.name, 'No hub chosen'), 'count', c.n) order by c.n desc)
      from (select hub_id, count(*) n from visible where submitted_at is not null group by hub_id) c
      left join hubs h on h.id = c.hub_id
    ), '[]'::json),
    'job_outcomes', (select count(*) from job_outcomes j where public.can_see_person(j.student_id::text))
  ) into result;
  return result;
end;
$$;
