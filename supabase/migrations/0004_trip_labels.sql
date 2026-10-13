-- Ground-truth labels for maneuvers: auto-detected (optionally confirmed) and manual.
create table if not exists public.trip_labels (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  t_ms        bigint not null,                 -- ms since trip start
  source      text not null check (source in ('auto','manual')),
  type        text,                            -- lane_change|turn|overtake|hard_brake|stop|other
  direction   text check (direction in ('L','R')),
  confirmed   boolean,                         -- yes/no answer to an auto prompt; null = unanswered
  lat         double precision,
  lng         double precision,
  speed_kmh   double precision,
  meta        jsonb,                           -- {peak_yaw, net_heading, dur_s}
  created_at  timestamptz not null default now()
);
create index if not exists trip_labels_trip_idx on public.trip_labels (trip_id, t_ms);

alter table public.trip_labels enable row level security;
drop policy if exists "own trip labels" on public.trip_labels;
create policy "own trip labels" on public.trip_labels
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
