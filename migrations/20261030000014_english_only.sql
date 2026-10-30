-- The English Tutor now teaches only in English.
alter table public.english_profiles drop column language;

-- Saved lesson openings may be in another language, so they are made again.
delete from public.english_lesson_cache;
