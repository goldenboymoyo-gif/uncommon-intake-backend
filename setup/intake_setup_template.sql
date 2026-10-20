-- Template for setting up a REAL intake. Copy it, replace every <...> with Uncommon's
-- real wording, and run it in the Supabase SQL editor. Do not run it with the placeholders.
-- The app never invents questions: steps 2 to 7 and the 5 interview questions come only from here.

-- 1. The intake
-- insert into intakes (year, title, opens_at, closes_at, places_total, is_open)
-- values (2027, 'Technology Bootcamp', '<yyyy-mm-dd>', '<yyyy-mm-dd>', <number of places or null>, true);

-- 2. Hubs (only the real hub names)
-- insert into hubs (name) values ('<hub name>'), ('<hub name>');

-- 3. Step titles for steps 2 to 7
-- insert into form_steps (intake_id, step, title)
-- select id, s.step, s.title from intakes,
--   (values (2, '<title>'), (3, '<title>'), (4, '<title>'), (5, '<title>'), (6, '<title>'), (7, '<title>')) as s(step, title)
-- where year = 2027;

-- 4. Form questions. kind is one of:
--    short_text, long_text, single_choice, multi_choice, date, number, yes_no, letter_upload
--    For choice questions, put the options in a JSON array.
-- insert into form_questions (intake_id, step, position, label, help_text, kind, options, required)
-- select id, 2, 0, '<question>', null, 'single_choice', '["<option>", "<option>"]'::jsonb, true from intakes where year = 2027;
-- The motivational letter upload (put it on the step where Uncommon's form has it):
-- insert into form_questions (intake_id, step, position, label, kind)
-- select id, 7, 99, 'Motivational letter', 'letter_upload' from intakes where year = 2027;

-- 5. The 5 interview questions
-- insert into interview_questions (intake_id, position, prompt)
-- select id, 1, '<question 1>' from intakes where year = 2027;
-- ... positions 2 to 5

-- 6. What staff look for (the AI summary is written against this list)
-- insert into review_checklist (intake_id, position, item)
-- select id, 0, '<what to look for>' from intakes where year = 2027;

-- 7. Make someone staff (accounts are created by an admin, never by sign up).
--    First invite them in Supabase Dashboard > Authentication > Users, then:
-- update profiles set role = 'staff' where email = '<their work email>';
-- update profiles set role = 'admin' where email = '<admin email>';

-- 8. Publishing a 2026 graduate story (only with written consent):
-- insert into graduate_stories (name, role, employer, story, consent_given, approved_by, approved_at)
-- values ('<name>', '<job title>', '<employer>', '<their story in their words>', true,
--         (select id from profiles where email = '<approving staff email>'), now());
