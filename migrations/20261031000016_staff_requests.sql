-- Staff sign up with a work email and choose one hub. That hub's lead, or an admin, approves them.
-- The hub then stays locked. Moving to another hub is a transfer request to the new hub's lead.
alter table public.profiles
  add column is_hub_lead boolean not null default false,
  add column staff_status text check (staff_status in ('choosing', 'pending', 'rejected'));

create unique index one_lead_per_hub on public.profiles (hub_id) where is_hub_lead;

create table public.staff_requests (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  hub_id uuid not null references public.hubs (id),
  kind text not null check (kind in ('join', 'transfer')),
  created_at timestamptz not null default now()
);
alter table public.staff_requests enable row level security;
-- Written and listed by the staff-access function. People can read their own request.
create policy "own staff request" on public.staff_requests for select using (user_id = auth.uid());

-- A staff member with no hub yet has no staff access.
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or (role = 'staff' and hub_id is not null)));
$$;

alter table public.staff_invites add column is_lead boolean not null default false;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare invite public.staff_invites;
begin
  select * into invite from staff_invites where email = lower(coalesce(new.email, ''));
  if invite.is_lead then
    update profiles set is_hub_lead = false where hub_id = invite.hub_id and is_hub_lead;
  end if;
  insert into profiles (id, email, first_names, surname, phone, role, hub_id, is_hub_lead)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'first_names', ''),
    coalesce(new.raw_user_meta_data ->> 'surname', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', ''),
    case when invite.email is null then 'applicant'::public.user_role else 'staff'::public.user_role end,
    invite.hub_id,
    coalesce(invite.is_lead, false)
  );
  if invite.email is not null then
    delete from staff_invites where email = invite.email;
  end if;
  return new;
end;
$$;

drop function public.admin_set_staff(text, uuid);
create function public.admin_set_staff(p_email text, p_hub uuid, p_lead boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare
  clean text := lower(trim(p_email));
  person public.profiles;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if clean not like '%_@_%' then raise exception 'Please type a valid email.'; end if;
  if not exists (select 1 from hubs where id = p_hub) then raise exception 'Please choose a hub.'; end if;
  select * into person from profiles where lower(email) = clean;
  if person.id is null then
    insert into staff_invites (email, hub_id, is_lead, invited_by) values (clean, p_hub, p_lead, auth.uid())
    on conflict (email) do update set hub_id = excluded.hub_id, is_lead = excluded.is_lead, invited_by = excluded.invited_by;
    return 'invited';
  end if;
  if person.role = 'admin' then raise exception 'This person is an admin and already sees every hub.'; end if;
  -- Each hub has one lead, so a new lead replaces the old one.
  if p_lead then
    update profiles set is_hub_lead = false where hub_id = p_hub and is_hub_lead and id <> person.id;
  end if;
  update profiles set role = 'staff', hub_id = p_hub, is_hub_lead = p_lead, staff_status = null, updated_at = now() where id = person.id;
  delete from staff_requests where user_id = person.id;
  return 'added';
end;
$$;

create or replace function public.admin_remove_staff(p_person uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  delete from staff_requests where user_id = p_person;
  update profiles set role = 'applicant', hub_id = null, is_hub_lead = false, staff_status = null, updated_at = now()
  where id = p_person and role = 'staff';
end;
$$;
