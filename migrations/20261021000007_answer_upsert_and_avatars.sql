-- 1. Saving an interview answer uses "insert or update". The update part also writes
--    application_id and question_id, so applicants need update rights on those two columns.
--    Row Level Security still limits the row to the applicant's own, unsent application.
grant update (application_id, question_id) on public.interview_answers to authenticated;

-- 2. Profile photos, in a private bucket. Staff can see them; the public cannot.
alter table public.profiles add column avatar_path text;
grant update (avatar_path) on public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "owner uploads own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner updates own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "owner reads own avatar" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "staff read avatars" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_staff());
