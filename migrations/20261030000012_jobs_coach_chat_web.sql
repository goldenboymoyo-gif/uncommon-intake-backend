-- Graduates, job opportunities, WhatsApp style coach chats, and website notifications.

-- ---------- Graduates: same access as students to the coach and jobs ----------
alter type public.user_role add value if not exists 'graduate';

-- Casts to text because a new enum value cannot be compared to in the transaction that adds it.
create or replace function public.is_learner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role::text in ('student', 'graduate'));
$$;

-- ---------- Job opportunities: staff post, students and graduates apply on the employer's link ----------
create table public.job_opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  company text not null,
  location text not null default '',
  details text not null,
  requirements text not null default '',
  apply_url text not null check (apply_url ~* '^https?://'),
  closes_on date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.job_opportunities enable row level security;
create policy "staff manage jobs" on public.job_opportunities for all using (public.is_staff()) with check (public.is_staff());
create policy "learners read jobs" on public.job_opportunities for select using (public.is_learner());

-- ---------- Coach chats: private to the person. Only the coach-chat function writes messages. ----------
create table public.coach_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  topic text not null check (topic in ('cv', 'cover_letter', 'interview', 'english')),
  subject_id text not null,
  subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coach_chats_user on public.coach_chats (user_id, updated_at desc);

create table public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.coach_chats (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sender text not null check (sender in ('coach', 'student')),
  body text not null,
  from_voice boolean not null default false,
  document_text text,
  model text,
  created_at timestamptz not null default now()
);
create index coach_messages_chat on public.coach_messages (chat_id, created_at);
create index coach_messages_daily on public.coach_messages (user_id, sender, created_at);

alter table public.coach_chats enable row level security;
alter table public.coach_messages enable row level security;
create policy "own coach chats" on public.coach_chats for select using (user_id = auth.uid());
create policy "delete own coach chats" on public.coach_chats for delete using (user_id = auth.uid());
create policy "own coach messages" on public.coach_messages for select using (user_id = auth.uid());

-- Voice notes (deleted once written out) and the coach's spoken words use the private coach-files bucket.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'video/webm']
where id = 'coach-files';

-- Recordings from the website: Chrome may give webm.
update storage.buckets
set allowed_mime_types = array[
  'audio/m4a', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/mpeg', 'audio/webm', 'audio/ogg',
  'video/mp4', 'video/quicktime', 'video/webm']
where id = 'interview-media';

-- ---------- Website notifications (one row per browser) ----------
create table public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index web_push_user on public.web_push_subscriptions (user_id);
alter table public.web_push_subscriptions enable row level security;
create policy "own web push" on public.web_push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
