# Map pipeline (offline)

Scripts that build the road/POI layer used by the app's map-based scoring and real-time
`road_context` / `stop_context` RPCs. These run **offline** against OpenStreetMap data and a
direct Supabase connection — they are not part of the Next.js app.

**Python deps:** `geopandas shapely fiona pyproj sqlalchemy psycopg2-binary matplotlib numpy`

Paths are relative to this folder. `goa.gpkg`, `batches/`, and `.db_url` are gitignored (large /
secret) — regenerate as below.

## Pipeline

| Step | Script | What it does |
|---|---|---|
| 1. Clip | `clip_goa.py` | Clips the full Geofabrik OSM export to the Goa bbox → `goa.gpkg` (38k roads, 1k POIs). Source path via `SRC_GPKG` env (default `~/Downloads/western-zone-261005-free.gpkg/…`). |
| 2. Load | `load_map.py` | Bulk-loads `goa.gpkg` → Supabase PostGIS (`map_roads`, `map_points`), adds `limit_kmh` + GIST indexes. Needs a **Session-pooler connection URI** in `.db_url` (or `DB_URL` env). |
| — Fallback | `generate_batches.py` | If no direct DB connection: writes batched `INSERT` SQL to `batches/` to apply via the Supabase MCP (loads major roads only). |
| 3. Validate | `match_goa.py` | Offline map-matching of a trip track (`goa_trip.csv`) → `map_match_prototype.png`. Proved ~1.9 m median accuracy. |
| — Diagnostics | `wrongside_plot.py` | Renders the wrong-side false-positive case (`wrongside.png`) — see `../docs/wrong-side-test-cases.md`. |

## Notes
- The app queries the loaded data via RPCs; it never touches these files or `.db_url`.
- After loading, `.db_url` can be deleted (the DB password is only needed for direct connections).
- To refresh the map: re-run `clip_goa.py` then `load_map.py`.
- `goa_trip.csv` is a small committed track fixture (the Goa trip, downsampled) for `match_goa.py`.
