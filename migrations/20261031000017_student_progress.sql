-- What students do after they are accepted: attendance, LinkedIn posts, projects and social numbers.
-- These are for support only. Nothing here changes a student's place automatically.

create or replace function public.harare_today()
returns date language sql stable as $$ select (now() at time zone 'Africa/Harare')::date; $$;

create or replace function public.harare_week()
returns date language sql stable as $$ select date_trunc('week', now() at time zone 'Africa/Harare')::date; $$;

create table public.attendance_codes (
  hub_id uuid not null references public.hubs (id),
  day date not null,
  code text not null,
  opened_by uuid not null references public.profiles (id),
  primary key (hub_id, day)
);

create table public.attendance (
  student_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  hub_id uuid not null references public.hubs (id),
  checked_in_at timestamptz not null default now(),
  primary key (student_id, day)
);

create table public.attendance_tries (
  student_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  tries int not null default 0,
  primary key (student_id, day)
);

-- A row with no url means the student was reminded that week and has not sent a link.
create table public.linkedin_posts (
  student_id uuid not null references public.profiles (id) on delete cascade,
  week_start date not null,
  url text,
  sent_at timestamptz,
  primary key (student_id, week_start)
);

create table public.student_projects (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  url text not null,
  status text not null default 'waiting' check (status in ('waiting', 'confirmed', 'not_confirmed')),
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- The student types these numbers, so they are shown as self reported.
create table public.social_numbers (
  student_id uuid not null references public.profiles (id) on delete cascade,
  month date not null,
  platform text not null check (platform in ('LinkedIn', 'Facebook', 'Instagram', 'X')),
  followers int not null check (followers >= 0),
  primary key (student_id, month, platform)
);

-- All reads and writes go through the functions below, so a student can never read today's code.
alter table public.attendance_codes enable row level security;
alter table public.attendance enable row level security;
alter table public.attendance_tries enable row level security;
alter table public.linkedin_posts enable row level security;
alter table public.student_projects enable row level security;
alter table public.social_numbers enable row level security;

-- ---------- Staff open the day's code. Students type it at the hub. ----------
create or replace function public.open_attendance_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  hub uuid := public.my_hub();
  today date := public.harare_today();
  today_code text;
begin
  if hub is null then raise exception 'Only hub staff can open a code.'; end if;
  if extract(isodow from today) > 5 then raise exception 'Nobody is at the hub at the weekend.'; end if;
  insert into attendance_codes (hub_id, day, code, opened_by)
  values (hub, today, lpad(floor(random() * 1000000)::int::text, 6, '0'), auth.uid())
  on conflict (hub_id, day) do nothing;
  select code into today_code from attendance_codes where hub_id = hub and day = today;
  return today_code;
end;
$$;

create or replace function public.check_in(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  today date := public.harare_today();
  real_code text;
  used int;
begin
  select * into me from profiles where id = auth.uid();
  if me.role is distinct from 'student' or me.hub_id is null then return 'not_student'; end if;
  if exists (select 1 from attendance where student_id = me.id and day = today) then return 'ok'; end if;
  select tries into used from attendance_tries where student_id = me.id and day = today;
  if coalesce(used, 0) >= 5 then return 'locked'; end if;
  select code into real_code from attendance_codes where hub_id = me.hub_id and day = today;
  if real_code is null then return 'no_code'; end if;
  if real_code <> trim(p_code) then
    insert into attendance_tries (student_id, day, tries) values (me.id, today, 1)
    on conflict (student_id, day) do update set tries = attendance_tries.tries + 1;
    return 'wrong';
  end if;
  insert into attendance (student_id, day, hub_id) values (me.id, today, me.hub_id) on conflict do nothing;
  return 'ok';
end;
$$;

-- ---------- Things students send ----------
create or replace function public.send_linkedin_post(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare clean text := trim(p_url);
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'student') then raise exception 'Only students can do this.'; end if;
  if clean !~* '^https://([a-z]+\.)?linkedin\.com/(posts|feed/update|pulse)/\S+$' then
    raise exception 'Please paste the link to your LinkedIn post.';
  end if;
  insert into linkedin_posts (student_id, week_start, url, sent_at) values (auth.uid(), public.harare_week(), clean, now())
  on conflict (student_id, week_start) do update set url = excluded.url, sent_at = excluded.sent_at;
end;
$$;

create or replace function public.send_project(p_title text, p_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'student') then raise exception 'Only students can do this.'; end if;
  if length(trim(p_title)) = 0 then raise exception 'Please add the name of your project.'; end if;
  if trim(p_url) !~* '^https?://\S+$' then raise exception 'Please paste a full link, starting with https://'; end if;
  insert into student_projects (student_id, title, url) values (auth.uid(), left(trim(p_title), 120), trim(p_url));
end;
$$;

create or replace function public.review_project(p_project uuid, p_confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select student_id into owner from student_projects where id = p_project;
  if owner is null or not public.can_see_person(owner::text) then raise exception 'This project is from another hub.'; end if;
  update student_projects set status = case when p_confirmed then 'confirmed' else 'not_confirmed' end, reviewed_by = auth.uid() where id = p_project;
end;
$$;

create or replace function public.send_social_number(p_platform text, p_followers int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'student') then raise exception 'Only students can do this.'; end if;
  insert into social_numbers (student_id, month, platform, followers)
  values (auth.uid(), date_trunc('month', public.harare_today())::date, p_platform, p_followers)
  on conflict (student_id, month, platform) do update set followers = excluded.followers;
end;
$$;

-- ---------- One student's numbers, used by both progress screens ----------
create or replace function public.progress_of(p_student uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'attended', (select count(*) from attendance a where a.student_id = p.id),
    'days_open', (select count(*) from attendance_codes c where c.hub_id = p.hub_id and c.day >= p.created_at::date),
    'checked_in_today', exists (select 1 from attendance a where a.student_id = p.id and a.day = public.harare_today()),
    'linkedin_url', (select l.url from linkedin_posts l where l.student_id = p.id and l.week_start = public.harare_week()),
    'linkedin_missed', (select count(*) from linkedin_posts l where l.student_id = p.id and l.url is null and l.week_start < public.harare_week()),
    'projects', coalesce((select json_agg(json_build_object('id', s.id, 'title', s.title, 'url', s.url, 'status', s.status) order by s.created_at desc) from student_projects s where s.student_id = p.id), '[]'::json),
    'social', coalesce((
      select json_agg(json_build_object('platform', n.platform, 'month', n.month, 'followers', n.followers) order by n.platform, n.month desc)
      from social_numbers n where n.student_id = p.id and n.month >= (date_trunc('month', public.harare_today()) - interval '1 month')::date
    ), '[]'::json)
  ) from profiles p where p.id = p_student;
$$;
revoke execute on function public.progress_of(uuid) from public, anon, authenticated;

create or replace function public.my_progress()
returns json language sql stable security definer set search_path = public as $$
  select public.progress_of(auth.uid());
$$;

create or replace function public.hub_progress()
returns json language plpgsql stable security definer set search_path = public as $$
declare hub uuid := public.my_hub();
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  return json_build_object(
    'code', (select code from attendance_codes where hub_id = hub and day = public.harare_today()),
    'checked_in_today', (select count(*) from attendance a where a.day = public.harare_today() and public.can_see_hub(a.hub_id)),
    'students', coalesce((
      select json_agg(json_build_object('id', p.id, 'name', trim(p.first_names || ' ' || p.surname), 'email', p.email, 'hub', h.name, 'progress', public.progress_of(p.id)) order by p.first_names)
      from profiles p left join hubs h on h.id = p.hub_id
      where p.role = 'student' and public.can_see_hub(p.hub_id)
    ), '[]'::json)
  );
end;
$$;

-- ---------- Used only by the student-reminders function ----------
create or replace function public.linkedin_reminder_list()
returns table (id uuid, push_token text) language plpgsql security definer set search_path = public as $$
begin
  if extract(isodow from public.harare_today()) > 5 then return; end if;
  insert into linkedin_posts (student_id, week_start)
  select p.id, public.harare_week() from profiles p where p.role = 'student'
  on conflict do nothing;
  return query
    select p.id, p.push_token from profiles p
    join linkedin_posts l on l.student_id = p.id and l.week_start = public.harare_week()
    where p.role = 'student' and l.url is null;
end;
$$;

create or replace function public.weekly_numbers()
returns table (id uuid, push_token text, attended bigint, days_open bigint, confirmed bigint, posted boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.push_token,
    (select count(*) from attendance a where a.student_id = p.id and a.day >= public.harare_week()),
    (select count(*) from attendance_codes c where c.hub_id = p.hub_id and c.day >= public.harare_week()),
    (select count(*) from student_projects s where s.student_id = p.id and s.status = 'confirmed'),
    exists (select 1 from linkedin_posts l where l.student_id = p.id and l.week_start = public.harare_week() and l.url is not null)
  from profiles p where p.role = 'student';
$$;
revoke execute on function public.linkedin_reminder_list() from public, anon, authenticated;
revoke execute on function public.weekly_numbers() from public, anon, authenticated;
grant execute on function public.linkedin_reminder_list() to service_role;
grant execute on function public.weekly_numbers() to service_role;

-- Times are UTC. Zimbabwe is two hours ahead: 09:30 Monday to Friday, and 16:00 on Friday.
select cron.schedule('linkedin-reminder', '30 7 * * 1-5', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/student-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"run":"linkedin"}'::jsonb
  );
$$);
select cron.schedule('weekly-update', '0 14 * * 5', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/student-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"run":"update"}'::jsonb
  );
$$);
