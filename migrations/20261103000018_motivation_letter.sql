-- Applicants upload a motivation letter as well as their CV.
alter table public.applications add column if not exists letter_path text;
alter table public.applications add column if not exists letter_name text;

-- The letter is locked once the application is sent, like the CV.
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
       or new.cv_path is distinct from old.cv_path or new.letter_path is distinct from old.letter_path
       or new.about_text is distinct from old.about_text) then
    raise exception 'This application has been sent and can no longer be changed';
  end if;
  if new.place_confirmed_at is distinct from old.place_confirmed_at and old.decision is distinct from 'accepted' then
    raise exception 'Only accepted applicants can confirm a place';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
