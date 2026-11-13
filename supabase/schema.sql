-- Kitchen dashboard schema. Run once in the Supabase SQL editor (or via the Management API).
-- People and chores are edited in the Supabase table editor; the tablet picks changes up within 30 s.

create table if not exists family (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  color text not null default '#2a78d6',   -- tile/avatar colour
  sort  int  not null default 0
);

create table if not exists chores (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  sort   int  not null default 0,
  active boolean not null default true      -- untick to hide a tile without losing its history
);

create table if not exists chore_log (
  id        uuid primary key,                -- made on the tablet, so offline retries never double-count
  chore_id  uuid not null references chores(id) on delete cascade,
  person_id uuid not null references family(id) on delete cascade,
  done_at   timestamptz not null default now()
);
create index if not exists chore_log_done_at on chore_log (done_at desc);

-- Next feature: shopping list. The tablet ("ran out of peanut butter") and the
-- family Telegram bot (items spotted in the group chat) both write here.
create table if not exists shopping (
  id        uuid primary key default gen_random_uuid(),
  item      text not null,
  added_by  uuid references family(id) on delete set null,
  source    text not null default 'tablet',  -- tablet | voice | telegram
  added_at  timestamptz not null default now(),
  bought_at timestamptz                       -- null = still on the list
);

-- The tablet uses the publishable (anon) key, with no login: it may read everything,
-- add and undo chore entries, and add/tick shopping items. Nobody can edit people or
-- chores without the dashboard.
alter table family    enable row level security;
alter table chores    enable row level security;
alter table chore_log enable row level security;
alter table shopping  enable row level security;

create policy "tablet reads family"    on family    for select to anon using (true);
create policy "tablet reads chores"    on chores    for select to anon using (true);
create policy "tablet reads log"       on chore_log for select to anon using (true);
create policy "tablet logs chores"     on chore_log for insert to anon with check (true);
create policy "tablet undoes chores"   on chore_log for delete to anon using (done_at > now() - interval '1 day');
create policy "tablet reads shopping"  on shopping  for select to anon using (true);
create policy "tablet adds shopping"   on shopping  for insert to anon with check (true);
create policy "tablet ticks shopping"  on shopping  for update to anon using (true) with check (true);

-- App updates: CI uploads kitchen.apk + version.json here; the tablet checks every 30 min.
insert into storage.buckets (id, name, public) values ('app', 'app', true) on conflict (id) do nothing;
