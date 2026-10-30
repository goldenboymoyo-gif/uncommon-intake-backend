-- English Tutor: placement, lessons, tests and progress for students and graduates.
-- The english-tutor function writes everything except the person's own language choice.

create table public.english_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  level text check (level in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  language text not null default 'English' check (language in ('English', 'Shona', 'Ndebele', 'Tonga')),
  plan jsonb,
  assessed_at timestamptz,
  points int not null default 0,
  streak_days int not null default 0,
  best_streak int not null default 0,
  last_active_on date,
  learning_seconds int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.english_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('assessment', 'lesson', 'daily', 'weekly', 'level_test')),
  lesson_id text,
  skill text,
  title text not null,
  level text not null,
  next_level text,
  next_skill text,
  status text not null default 'active' check (status in ('active', 'completed')),
  score int,
  passed boolean,
  completed_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index english_sessions_user on public.english_sessions (user_id, created_at desc);

create table public.english_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.english_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  sender text not null check (sender in ('teacher', 'student')),
  body text not null,
  speak_text text,
  from_voice boolean not null default false,
  model text,
  created_at timestamptz not null default now()
);
create index english_messages_session on public.english_messages (session_id, created_at);
create index english_messages_daily on public.english_messages (user_id, sender, created_at);

-- One row per marked answer. Scores are always counted from these rows.
create table public.english_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.english_sessions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  skill text not null check (skill in ('grammar', 'vocabulary', 'speaking', 'writing', 'reading', 'listening')),
  level text not null,
  question text not null,
  student_answer text not null,
  correct_answer text not null,
  is_correct boolean not null,
  explanation text not null,
  created_at timestamptz not null default now()
);
create index english_answers_user on public.english_answers (user_id, created_at desc);
create index english_answers_session on public.english_answers (session_id, created_at);

create table public.english_vocabulary (
  user_id uuid not null references public.profiles (id) on delete cascade,
  word text not null,
  meaning text not null,
  example text not null default '',
  next_review date not null default (current_date + 2),
  created_at timestamptz not null default now(),
  primary key (user_id, word)
);

create table public.english_mistakes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  pattern text not null,
  example text not null default '',
  correction text not null default '',
  times int not null default 1,
  last_seen timestamptz not null default now(),
  primary key (user_id, pattern)
);

create table public.english_daily (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  activity text not null,
  primary key (user_id, day, activity)
);

-- Lesson openings are shared between people at the same level, to save AI costs.
create table public.english_lesson_cache (
  key text primary key,
  opening text not null,
  created_at timestamptz not null default now()
);

alter table public.english_profiles enable row level security;
alter table public.english_sessions enable row level security;
alter table public.english_messages enable row level security;
alter table public.english_answers enable row level security;
alter table public.english_vocabulary enable row level security;
alter table public.english_mistakes enable row level security;
alter table public.english_daily enable row level security;
alter table public.english_lesson_cache enable row level security;

create policy "own english profile" on public.english_profiles for select using (user_id = auth.uid());
create policy "own english sessions" on public.english_sessions for select using (user_id = auth.uid());
create policy "own english messages" on public.english_messages for select using (user_id = auth.uid());
create policy "own english answers" on public.english_answers for select using (user_id = auth.uid());
create policy "own english vocabulary" on public.english_vocabulary for select using (user_id = auth.uid());
create policy "own english mistakes" on public.english_mistakes for select using (user_id = auth.uid());
create policy "own english daily" on public.english_daily for select using (user_id = auth.uid());
-- Staff see progress through the function, as summaries. Never the conversations.
