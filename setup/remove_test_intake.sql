-- REMOVE THE TEST INTAKE before real applications open (1 November 2026).
-- Added on 21 October 2026 so the CV and interview flow could be tested early.
-- Run all of this in the Supabase SQL editor.

-- 1. Delete test applications (their answers, AI questions and notes go with them).
delete from applications where intake_id = (select id from intakes where year = 1999);

-- 2. Delete the test intake.
delete from intakes where year = 1999;

-- 3. Switch the real 2027 intake back on. It still only accepts applications from 1 Nov 2026 to 1 Jan 2027.
update intakes set is_open = true where year = 2027;

-- 4. Check: only the 2027 intake should be listed, with is_open = true.
select year, title, opens_at, closes_at, is_open from intakes;

-- Also: test CVs and recordings stay in Storage. Delete them by hand in
-- Storage > application-cvs and Storage > interview-media (folders named after your user id).
