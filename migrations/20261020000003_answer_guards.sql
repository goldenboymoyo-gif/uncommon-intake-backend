-- Applicants may write their own answers, but never the transcript, the AI summary or a
-- "done" state. Those are written by the process-answer Edge Function (service role).

revoke insert, update on public.interview_answers from authenticated;
grant insert (application_id, question_id, format, text_answer, media_path, duration_seconds, state)
  on public.interview_answers to authenticated;
grant update (format, text_answer, media_path, duration_seconds, state)
  on public.interview_answers to authenticated;

create or replace function public.guard_interview_answer()
returns trigger language plpgsql as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.state not in ('pending', 'uploaded') then
    new.state := 'pending';
  end if;
  -- A new answer clears the old text version and summary.
  if tg_op = 'UPDATE' and (new.text_answer is distinct from old.text_answer
       or new.media_path is distinct from old.media_path or new.format is distinct from old.format) then
    new.transcript := null;
    new.ai_summary := null;
    new.ai_model := null;
  end if;
  return new;
end;
$$;

create trigger interview_answers_guard
  before insert or update on public.interview_answers
  for each row execute function public.guard_interview_answer();

-- Staff can run the summary again or mark rows; they go through Edge Functions too,
-- so they do not need direct write access here.
