-- 1. Two commitments asked at the end of the interview (wording from uncommon.org:
--    the bootcamp is full time, and students teach free coding classes to children).
alter table public.applications
  add column available_daily boolean,
  add column will_teach_children boolean;

-- 2. Hardening: every function runs with a fixed search_path, so nobody can trick it
--    with a look-alike table in another schema.
alter function public.set_media_expiry() set search_path = public;
alter function public.guard_interview_answer() set search_path = public;
