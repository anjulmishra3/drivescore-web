"""Load the Goa OSM roads + POIs into Supabase PostGIS for real-time queries.

Reads the DB connection string from env DB_URL or the local file map/.db_url
(so the password never goes through the chat). Use the Supabase *Session pooler*
or Direct connection URI (port 5432), e.g.:
  postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
"""
import os
import pandas as pd
import geopandas as gpd
from sqlalchemy import create_engine, text

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"

url = os.environ.get("DB_URL")
if not url:
    with open(HERE + ".db_url") as f:
        url = f.read().strip()
if url.startswith("postgresql://"):
    url = "postgresql+psycopg2://" + url[len("postgresql://"):]
if "sslmode" not in url:
    url += ("&" if "?" in url else "?") + "sslmode=require"

eng = create_engine(url)

# --- roads ---
roads = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_roads_free")
roads = roads[["osm_id", "fclass", "name", "ref", "oneway", "maxspeed", "bridge", "tunnel", "geometry"]]
roads = roads.rename_geometry("geom")
roads.to_postgis("map_roads", eng, if_exists="replace", index=False)

# --- points of interest (traffic + transport) ---
tr = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_traffic_free")[["osm_id", "fclass", "name", "geometry"]]
tp = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_transport_free")[["osm_id", "fclass", "name", "geometry"]]
pts = gpd.GeoDataFrame(pd.concat([tr, tp], ignore_index=True), crs=tr.crs).rename_geometry("geom")
pts.to_postgis("map_points", eng, if_exists="replace", index=False)

# --- indexes, derived speed limit, grants ---
with eng.begin() as con:
    con.execute(text("create index if not exists map_roads_geom_idx on public.map_roads using gist(geom)"))
    con.execute(text("create index if not exists map_points_geom_idx on public.map_points using gist(geom)"))
    con.execute(text("alter table public.map_roads add column if not exists limit_kmh int"))
    con.execute(text("""
        update public.map_roads set limit_kmh = case
          when maxspeed is not null and maxspeed > 0 then maxspeed
          else case fclass
            when 'motorway' then 100 when 'trunk' then 80 when 'primary' then 60
            when 'secondary' then 60 when 'tertiary' then 50 when 'residential' then 40
            when 'unclassified' then 50 when 'service' then 20 when 'living_street' then 20
            when 'trunk_link' then 60 when 'primary_link' then 50 when 'secondary_link' then 50
            when 'tertiary_link' then 40 when 'motorway_link' then 60 else 50 end
        end
    """))
    con.execute(text("grant select on public.map_roads, public.map_points to anon, authenticated"))

print(f"loaded {len(roads)} roads, {len(pts)} POIs into PostGIS")
