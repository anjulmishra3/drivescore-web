-- Map layer (PostGIS) + map-based scoring. The road/POI *data* is bulk-loaded
-- separately by ~/Desktop/sae/map/load_map.py (needs a direct DB connection);
-- this migration defines the schema, indexes, query RPCs, and scoring functions.

create extension if not exists postgis;

create table if not exists public.map_roads (
  osm_id text, fclass text, name text, ref text, oneway text,
  maxspeed int, limit_kmh int, bridge text, tunnel text,
  geom geometry(Geometry, 4326)
);
create table if not exists public.map_points (
  osm_id text, fclass text, name text, geom geometry(Geometry, 4326)
);
create index if not exists map_roads_geom_idx on public.map_roads using gist(geom);
create index if not exists map_points_geom_idx on public.map_points using gist(geom);
grant select on public.map_roads, public.map_points to anon, authenticated;

-- new per-trip map-based sub-scores
alter table public.trips
  add column if not exists score_wrong_side int check (score_wrong_side between 0 and 100),
  add column if not exists score_stops int check (score_stops between 0 and 100),
  add column if not exists wrong_side_events int,
  add column if not exists illegal_stops int;

-- road_context / stop_context RPCs and the two scoring functions
-- (rescore_speeding_mapped, score_map_discipline) are created in the DB as applied
-- via the Supabase MCP during development; see migrations 0007-0008 history. They
-- are re-runnable with `create or replace`. The authoritative definitions live in
-- the database; this file documents the schema they depend on.
