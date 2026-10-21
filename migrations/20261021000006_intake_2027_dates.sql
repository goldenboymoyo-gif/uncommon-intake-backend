-- An intake is open only between its open and close dates (Zimbabwe time), and while is_open is true.
create or replace function public.intake_accepting(p_intake uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from intakes
    where id = p_intake and is_open
      and (opens_at is null or (now() at time zone 'Africa/Harare')::date >= opens_at)
      and (closes_at is null or (now() at time zone 'Africa/Harare')::date <= closes_at)
  );
$$;

drop policy "applicant creates own application" on public.applications;
create policy "applicant creates own application" on public.applications for insert
  with check (applicant_id = auth.uid() and review_status = 'not_started' and decision is null
              and public.intake_accepting(intake_id));

-- The 2027 intake.
insert into public.intakes (year, title, opens_at, closes_at, places_total, is_open)
values (2027, 'Technology Bootcamp', '2026-11-01', '2027-01-01', 45, true)
on conflict (year) do update set opens_at = excluded.opens_at, closes_at = excluded.closes_at,
  places_total = excluded.places_total, is_open = excluded.is_open;
