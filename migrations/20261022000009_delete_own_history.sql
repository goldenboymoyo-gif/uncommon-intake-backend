-- Students can delete items from their own career coach history.
create policy "student deletes own coach session" on public.coach_sessions for delete
  using (student_id = auth.uid());
