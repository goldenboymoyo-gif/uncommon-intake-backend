-- Template for setting up a REAL intake. Copy it, replace every <...>, and run it in the
-- Supabase SQL editor. Do not run it with the placeholders.
--
-- Applicants fill in their details, choose a hub and upload a CV. AI then writes 5 interview
-- questions for each applicant from their CV, so there is no question list to add here.

-- 1. The intake (applications only open while is_open is true)
-- insert into intakes (year, title, opens_at, closes_at, places_total, is_open)
-- values (2027, 'Technology Bootcamp', '<yyyy-mm-dd>', '<yyyy-mm-dd>', <number of places or null>, true);

-- 2. Hubs. The 13 Uncommon hubs are already loaded. To mark one open or closed:
-- update hubs set status = 'open' where slug = '<hub slug>';   -- open | coming_soon | closed

-- 3. Optional: what staff look for. The AI summary of each answer describes what the answer
--    says about these points. It never scores them.
-- insert into review_checklist (intake_id, position, item)
-- select id, 0, '<what to look for>' from intakes where year = 2027;

-- 4. Make someone staff (accounts are created by an admin, never by sign up).
--    First invite them in Supabase Dashboard > Authentication > Users, then:
-- update profiles set role = 'admin', hub_id = null where email = '<their work email>';
-- update profiles set role = 'admin' where email = '<admin email>';

-- 5. Publishing a 2026 graduate story (only with written consent):
-- insert into graduate_stories (name, role, employer, story, consent_given, approved_by, approved_at)
-- values ('<name>', '<job title>', '<employer>', '<their story in their words>', true,
--         (select id from profiles where email = '<approving staff email>'), now());
