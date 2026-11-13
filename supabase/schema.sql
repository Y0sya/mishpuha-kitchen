-- Kitchen dashboard schema. Run once in the Supabase SQL editor (or via the Management API).
-- People and chores are edited in the Supabase table editor; the tablet picks changes up within 30 s.

create table if not exists family (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  color text not null default '#2a78d6',   -- tile/avatar colour
  initials text,                           -- shown in the circle; default first letter
  photo text,                              -- selfie from the tablet (small JPEG data URL), replaces initials
  sort  int  not null default 0
);

-- A tile on the screen. mode:
--   single → one chore, tap → who did it?
--   split  → the tile is cut into halves, one per chore (Dishwasher: Meat | Dairy)
--   choose → tap → which ones? → who? (Trash: Recycling, Garbage, Compost)
create table if not exists tiles (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  icon   text,                              -- key in web/icons.js; the name is the fallback
  mode   text not null default 'single' check (mode in ('single', 'split', 'choose')),
  sort   int  not null default 0,
  active boolean not null default true      -- untick to hide a tile without losing its history
);

-- What actually gets logged. A single tile has one chore (usually named like the tile).
create table if not exists chores (
  id      uuid primary key default gen_random_uuid(),
  tile_id uuid not null references tiles(id) on delete cascade,
  name    text not null,
  icon    text,
  color   text,                              -- half/option colour, e.g. meat red, dairy blue
  actions text[],                            -- asked before who, e.g. {Unload,Reload} (+ Both)
  sort    int  not null default 0,
  active  boolean not null default true
);

create table if not exists chore_log (
  id        uuid primary key,                -- made on the tablet, so offline retries never double-count
  chore_id  uuid not null references chores(id) on delete cascade,
  person_id uuid not null references family(id) on delete cascade,
  action    text,                            -- e.g. Unload / Reload (one row each for Both)
  done_at   timestamptz not null default now()
);
create index if not exists chore_log_done_at on chore_log (done_at desc);

-- Groceries: one running list. The tablet ("Finished" peanut butter, or "Request" milk) and
-- the family Telegram bot (items spotted in the group chat) both write here. An item already
-- on the list is never added twice: the new person is appended to `people` instead.
create table if not exists shopping (
  id        uuid primary key default gen_random_uuid(),
  item      text not null,
  people    uuid[] not null default '{}',     -- family ids who asked for it (initials on the row)
  kind      text not null default 'request' check (kind in ('request', 'finished')),
  source    text not null default 'tablet',  -- tablet | voice | telegram
  added_at  timestamptz not null default now(),
  bought_at timestamptz                       -- null = still on the list
);
create index if not exists shopping_open on shopping (added_at) where bought_at is null;

-- Feedback from the round button on the tablet. Read it in the table editor; tick `done`.
create table if not exists feedback (
  id          uuid primary key,
  text        text not null,
  person_id   uuid references family(id) on delete set null,
  person_name text,
  created_at  timestamptz not null default now(),
  done        boolean not null default false
);

-- The tablet uses the publishable (anon) key, with no login: it may read everything,
-- add and undo chore entries, and add/tick shopping items. Nobody can edit people or
-- chores without the dashboard.
alter table family    enable row level security;
alter table tiles     enable row level security;
alter table chores    enable row level security;
alter table chore_log enable row level security;
alter table shopping  enable row level security;
alter table feedback  enable row level security;

create policy "tablet reads family"    on family    for select to anon using (true);
-- The tablet may change only people's photos (Settings -> People), nothing else about them.
create policy "tablet sets photos"     on family    for update to anon using (true) with check (true);
revoke update on family from anon;
grant update (photo) on family to anon;
create policy "tablet reads tiles"     on tiles     for select to anon using (true);
create policy "tablet reads chores"    on chores    for select to anon using (true);
create policy "tablet reads log"       on chore_log for select to anon using (true);
create policy "tablet logs chores"     on chore_log for insert to anon with check (true);
-- Undo, and "hold a tile → remove an entry" (shows the last 10, within the 35 days the tablet loads).
create policy "tablet removes chores"  on chore_log for delete to anon using (done_at > now() - interval '60 days');
create policy "tablet reads shopping"  on shopping  for select to anon using (true);
create policy "tablet adds shopping"   on shopping  for insert to anon with check (true);
create policy "tablet ticks shopping"  on shopping  for update to anon using (true) with check (true);
create policy "tablet removes shopping" on shopping for delete to anon using (true);   -- hold an item to remove it
create policy "tablet sends feedback"  on feedback  for insert to anon with check (true);   -- write-only

-- Starting family and tiles (edit in the table editor afterwards).
insert into family (name, color, initials, sort)
select * from (values
  ('Mama', '#2a78d6', null, 1), ('Papa', '#eb6834', null, 2), ('Yosya', '#1baf7a', 'Y', 3), ('David', '#6250d6', 'DY', 4),
  ('Shmulik', '#c98500', null, 5), ('Yoni', '#0f9fb5', 'YS', 6), ('Sara Bella', '#d6409f', 'SB', 7)
) v where not exists (select 1 from family);

do $$
declare dw uuid; tb uuid; dn uuid; ct uuid; sw uuid; tr uuid;
begin
  if not exists (select 1 from tiles) then
    insert into tiles (name, icon, mode, sort) values ('Dishwasher', 'dishwasher', 'split', 1) returning id into dw;
    insert into tiles (name, icon, mode, sort) values ('Table', 'table', 'split', 2) returning id into tb;
    insert into tiles (name, icon, mode, sort) values ('Dinner', 'dinner', 'single', 3) returning id into dn;
    insert into tiles (name, icon, mode, sort) values ('Countertops', 'countertops', 'single', 4) returning id into ct;
    insert into tiles (name, icon, mode, sort) values ('Sweep', 'sweep', 'single', 5) returning id into sw;
    insert into tiles (name, icon, mode, sort) values ('Trash', 'trash', 'choose', 6) returning id into tr;
    insert into chores (tile_id, name, icon, color, sort) values
      (dw, 'Meat', 'meat', '#c9372f', 1), (dw, 'Dairy', 'dairy', '#2a78d6', 2),
      -- (dishwasher halves get actions below)
      (tb, 'Set up', 'setup', '#1baf7a', 1), (tb, 'Clean', 'clean', '#c98500', 2),
      (dn, 'Dinner', 'dinner', null, 1), (ct, 'Countertops', 'countertops', null, 1), (sw, 'Sweep', 'sweep', null, 1),
      (tr, 'Recycling', 'recycling', '#2a78d6', 1), (tr, 'Garbage', 'garbage', '#52514e', 2), (tr, 'Compost', 'compost', '#2e9e5b', 3);
    update chores set actions = '{Unload,Reload}' where tile_id = dw;
  end if;
end $$;

-- App updates: CI uploads kitchen.apk + version.json here; the tablet checks every 30 min.
insert into storage.buckets (id, name, public) values ('app', 'app', true) on conflict (id) do nothing;
