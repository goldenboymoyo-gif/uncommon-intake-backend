-- Photos for 2026 graduate stories. Stories are public (shown before sign in, with consent),
-- so their photos are in a public bucket. Only staff can add, change or remove them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-photos', 'story-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff upload story photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'story-photos' and public.is_staff());
create policy "staff update story photos" on storage.objects for update to authenticated
  using (bucket_id = 'story-photos' and public.is_staff());
create policy "staff delete story photos" on storage.objects for delete to authenticated
  using (bucket_id = 'story-photos' and public.is_staff());
