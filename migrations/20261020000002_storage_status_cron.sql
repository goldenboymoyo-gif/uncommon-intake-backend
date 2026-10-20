-- Private storage, automatic review status, and the 90 day media clean up.

-- ---------- Storage (all private; files are read through short-lived signed URLs) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('letters', 'letters', false, 5242880, array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('interview-media', 'interview-media', false, 52428800, array[
    'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm',
    'video/mp4', 'video/quicktime']),
  ('coach-files', 'coach-files', false, 5242880, array[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Files live at <bucket>/<user id>/<file>. Owners write and read their own folder. Staff read all.
create policy "owner uploads own files" on storage.objects for insert to authenticated
  with check (bucket_id in ('letters', 'interview-media', 'coach-files') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner updates own files" on storage.objects for update to authenticated
  using (bucket_id in ('letters', 'interview-media', 'coach-files') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner reads own files" on storage.objects for select to authenticated
  using (bucket_id in ('letters', 'interview-media', 'coach-files') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner deletes own files" on storage.objects for delete to authenticated
  using (bucket_id in ('letters', 'interview-media', 'coach-files') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "staff read applicant files" on storage.objects for select to authenticated
  using (bucket_id in ('letters', 'interview-media') and public.is_staff());

-- ---------- Allow trusted database functions to update review fields ----------
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
     or new.applicant_id is distinct from old.applicant_id then
    raise exception 'You cannot change review fields';
  end if;
  if old.submitted_at is not null and (
       new.first_names is distinct from old.first_names or new.surname is distinct from old.surname
       or new.gender is distinct from old.gender or new.date_of_birth is distinct from old.date_of_birth
       or new.letter_path is distinct from old.letter_path) then
    raise exception 'This application has been sent and can no longer be changed';
  end if;
  if new.place_confirmed_at is distinct from old.place_confirmed_at and old.decision is distinct from 'accepted' then
    raise exception 'Only accepted applicants can confirm a place';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- Review status follows the interview answers ----------
-- Staff-set states (in review, needs help, decided) are never overwritten.
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

  select count(*) into total from interview_questions q
    join applications a on a.intake_id = q.intake_id where a.id = p_application;
  select count(*), count(*) filter (where state = 'summarised' or (format = 'text' and ai_summary is not null))
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

create or replace function public.on_interview_answer_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_review_status(coalesce(new.application_id, old.application_id));
  return coalesce(new, old);
end;
$$;

create trigger interview_answers_status
  after insert or update or delete on public.interview_answers
  for each row execute function public.on_interview_answer_change();

-- Media is kept for about 90 days from upload, then removed.
create or replace function public.set_media_expiry()
returns trigger language plpgsql as $$
begin
  if new.media_path is not null and new.media_delete_after is null then
    new.media_delete_after := now() + interval '90 days';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger interview_answers_expiry
  before insert or update on public.interview_answers
  for each row execute function public.set_media_expiry();

-- ---------- Scheduled clean up ----------
-- Calls the purge-media Edge Function once a day. Storage files must be deleted through the
-- Storage API, so the function does the work. Set these two secrets once in the SQL editor:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<a long random string, same as CRON_SECRET>', 'cron_secret');
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'purge-expired-interview-media',
  '15 2 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/purge-media',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
