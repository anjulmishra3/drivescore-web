-- DriveScore v0 — initial schema
-- Backend contract shared by the v0 web app and the future v1 Android app.
--
-- Model:
--   profiles      1:1 with auth.users — vehicle info, notification & privacy prefs
--   devices       OBD dongles a user has paired (BLE handled natively in v1)
--   trips         one recorded drive (calibration | quick | obd) with scores
--   trip_samples  raw sensor samples for foreground trips (quick/calibration)
--
-- Scores live on the trip row: an overall 0-100 plus five sub-scores. In v0
-- the app fills these via a server-side heuristic (a stand-in for the future
-- cloud scoring pipeline); v1 will POST the same shape from the device pipeline.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  display_name      text,
  vehicle_make      text,
  vehicle_model     text,
  vehicle_year      int,
  -- notification preferences
  notify_trip_summary   boolean not null default true,
  notify_weekly_digest  boolean not null default true,
  notify_device_alerts  boolean not null default true,
  -- privacy / data-sharing controls
  share_anonymized_data boolean not null default false,
  store_raw_samples     boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- devices (OBD dongles)
-- ---------------------------------------------------------------------------
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null,
  ble_id        text,                 -- BLE identifier / MAC (set by v1 native app)
  status        text not null default 'unpaired'
                  check (status in ('unpaired', 'paired', 'disconnected')),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists devices_user_id_idx on public.devices (user_id);

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------
create table if not exists public.trips (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  source        text not null default 'quick'
                  check (source in ('calibration', 'quick', 'obd')),
  status        text not null default 'recording'
                  check (status in ('recording', 'completed', 'discarded')),
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  distance_km   numeric(8,2),
  duration_s    int,
  max_speed_kmh numeric(6,2),
  -- scores (0-100); null until scored
  overall_score      int check (overall_score between 0 and 100),
  score_smoothness   int check (score_smoothness between 0 and 100),  -- accel/brake gentleness
  score_braking      int check (score_braking between 0 and 100),
  score_cornering    int check (score_cornering between 0 and 100),
  score_speeding     int check (score_speeding between 0 and 100),
  score_focus        int check (score_focus between 0 and 100),       -- phone / distraction
  event_count   int not null default 0,   -- harsh events detected
  created_at    timestamptz not null default now()
);
create index if not exists trips_user_started_idx on public.trips (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- trip_samples (raw sensor stream for foreground trips)
-- ---------------------------------------------------------------------------
create table if not exists public.trip_samples (
  id          bigint generated always as identity primary key,
  trip_id     uuid not null references public.trips (id) on delete cascade,
  t_ms        bigint not null,          -- ms since trip start
  lat         double precision,
  lng         double precision,
  speed_kmh   double precision,
  accel_x     double precision,
  accel_y     double precision,
  accel_z     double precision,
  gyro_alpha  double precision,
  gyro_beta   double precision,
  gyro_gamma  double precision
);
create index if not exists trip_samples_trip_idx on public.trip_samples (trip_id, t_ms);

-- ---------------------------------------------------------------------------
-- updated_at trigger for profiles
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- auto-create a profile row when a new auth user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security — every table is scoped to the owning user
-- ---------------------------------------------------------------------------
alter table public.profiles     enable row level security;
alter table public.devices      enable row level security;
alter table public.trips        enable row level security;
alter table public.trip_samples enable row level security;

-- profiles
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- devices
drop policy if exists "own devices" on public.devices;
create policy "own devices" on public.devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trips
drop policy if exists "own trips" on public.trips;
create policy "own trips" on public.trips
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- trip_samples — ownership is derived through the parent trip
drop policy if exists "own trip samples" on public.trip_samples;
create policy "own trip samples" on public.trip_samples
  for all
  using (exists (
    select 1 from public.trips t
    where t.id = trip_samples.trip_id and t.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.trips t
    where t.id = trip_samples.trip_id and t.user_id = auth.uid()
  ));
