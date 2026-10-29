-- People can clear (delete) their own notifications.
create policy "delete own notifications" on public.notifications for delete using (user_id = auth.uid());
