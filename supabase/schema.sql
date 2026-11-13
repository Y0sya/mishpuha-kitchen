-- Kitchen dashboard schema. Run once in the Supabase SQL editor (or via the Management API).
-- People and chores are edited in the Supabase table editor; the tablet picks changes up within 30 s.

create table if not exists family (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  color text not null default '#2a78d6',   -- tile/avatar colour
  sort  int  not null default 0
);

-- A tile on the screen. mode:
--   single → one chore, tap → who did it?
--   split  → the tile is cut into halves, one per chore (Dishwasher: Meat | Dairy)
--   choose → tap → which ones? → who? (Trash: Recycling, Garbage, Compost)
create table if not exists tiles (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  mode   text not null default 'single' check (mode in ('single', 'split', 'choose')),
  sort   int  not null default 0,
  active boolean not null default true      -- untick to hide a tile without losing its history
);

-- What actually gets logged. A single tile has one chore (usually named like the tile).
create table if not exists chores (
  id      uuid primary key default gen_random_uuid(),
  tile_id uuid not null references tiles(id) on delete cascade,
  name    text not null,
  color   text,                              -- half/option colour, e.g. meat red, dairy blue
  sort    int  not null default 0,
  active  boolean not null default true
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
alter table tiles     enable row level security;
alter table chores    enable row level security;
alter table chore_log enable row level security;
alter table shopping  enable row level security;

create policy "tablet reads family"    on family    for select to anon using (true);
create policy "tablet reads tiles"     on tiles     for select to anon using (true);
create policy "tablet reads chores"    on chores    for select to anon using (true);
create policy "tablet reads log"       on chore_log for select to anon using (true);
create policy "tablet logs chores"     on chore_log for insert to anon with check (true);
create policy "tablet undoes chores"   on chore_log for delete to anon using (done_at > now() - interval '1 day');
create policy "tablet reads shopping"  on shopping  for select to anon using (true);
create policy "tablet adds shopping"   on shopping  for insert to anon with check (true);
create policy "tablet ticks shopping"  on shopping  for update to anon using (true) with check (true);

-- Starting tiles (edit names/colours in the table editor afterwards).
do $$
declare dw uuid; tb uuid; tr uuid; ct uuid; sw uuid;
begin
  if not exists (select 1 from tiles) then
    insert into tiles (name, mode, sort) values ('Dishwasher', 'split', 1) returning id into dw;
    insert into tiles (name, mode, sort) values ('Table', 'split', 2) returning id into tb;
    insert into tiles (name, mode, sort) values ('Countertops', 'single', 3) returning id into ct;
    insert into tiles (name, mode, sort) values ('Sweep', 'single', 4) returning id into sw;
    insert into tiles (name, mode, sort) values ('Trash', 'choose', 5) returning id into tr;
    insert into chores (tile_id, name, color, sort) values
      (dw, 'Meat', '#c9372f', 1), (dw, 'Dairy', '#2a78d6', 2),
      (tb, 'Set up', '#1baf7a', 1), (tb, 'Clean', '#c98500', 2),
      (ct, 'Countertops', null, 1), (sw, 'Sweep', null, 1),
      (tr, 'Recycling', '#2a78d6', 1), (tr, 'Garbage', '#52514e', 2), (tr, 'Compost', '#2e9e5b', 3);
  end if;
end $$;

-- App updates: CI uploads kitchen.apk + version.json here; the tablet checks every 30 min.
insert into storage.buckets (id, name, public) values ('app', 'app', true) on conflict (id) do nothing;
