-- New applicants get 10 interview questions (from their CV and motivation letter).
do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.interview_questions'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%position%'
  loop
    execute format('alter table public.interview_questions drop constraint %I', c);
  end loop;
end $$;
alter table public.interview_questions add constraint interview_questions_position_check check (position between 1 and 10);
