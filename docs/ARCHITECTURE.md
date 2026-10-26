# DriveScore — Architecture

A phone-only driving-behaviour scoring web app (design doc's **v0**; native Android **v1**
deferred). Captures GPS + accelerometer + gyroscope during a drive, scores driving quality,
and collects human labels to improve the scoring.

## Stack & deployment

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router), TypeScript, Tailwind |
| Auth / DB | Supabase (Auth, Postgres 17, **PostGIS**) |
| Charts / maps | Recharts, Leaflet (+ OpenStreetMap tiles) |
| Hosting | Vercel, auto-deploy from `github.com/anjulmishra3/drivescore-web` (`main`) |
| Supabase project | `drive_score` — ref `gtfbsszcjzsjrmvoibtd` (region ap-northeast-1) |

The browser/app talks to Supabase over HTTPS with the **anon/publishable key**
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`); RLS enforces per-user access. There is **no DB password in
the app** — that's only for direct Postgres connections (migrations, the map bulk-load).

Local dev: `npm run dev` → port 8090. Sensor APIs need HTTPS, so test on a phone via the Vercel
URL (localhost works on desktop but most laptops lack accel/gyro).

## App structure (`src/`)

```
app/
  login, signup, forgot-password, reset-password, auth/confirm   # public auth
  (app)/                         # authed routes (middleware-guarded)
    dashboard                    # scores, trend, recent trips
    record                       # 25 Hz road-trip recorder + live labeling
    trips, trips/[id]/review     # trip list + review map (tap-to-tag)
    calibrate, onboarding, settings
  api/trips/
    start, [id]/samples, [id]/finish   # streaming recorder endpoints
    [id]/labels                        # label CRUD
    route.ts (batch), seed             # calibration batch upload, demo seed
lib/
  supabase/{client,server,admin}.ts    # SSR + service clients
  scoring.ts                           # deterministic sensor scoring (runs at finish)
  useRoadTripRecorder.ts               # /record controller (sampler, IDB, streaming, wake-lock)
  liveManeuverDetector.ts              # real-time turn/lane-change detector
  sampleStore.ts                       # IndexedDB durable buffer
  useTripRecorder.ts                   # simpler recorder (calibration)
components/  AppNav, ScoreGauge, SubScoreBars, TrendChart, RouteMap, SeedButton
types/db.ts                            # shared DB types + SUB_SCORES
middleware.ts                          # session refresh + route guards
```

## Data model (Postgres)

- **`profiles`** — 1:1 with `auth.users` (vehicle, notification/privacy prefs). Auto-created by a
  trigger on signup.
- **`trips`** — one drive. Status `recording|completed|discarded`, `source`, distance/duration/
  max-speed, and the score columns: `overall_score`, `score_smoothness`, `score_braking`,
  `score_cornering`, `score_speeding`, `score_focus`, `score_wrong_side`, `score_stops`,
  `event_count`, `wrong_side_events`, `illegal_stops`.
- **`trip_samples`** — raw 25 Hz stream (`seq`, `t_ms`, lat/lng, `speed_kmh`, accel x/y/z,
  gyro α/β/γ). `seq` is a per-trip monotonic id → idempotent batch upload.
- **`trip_labels`** — ground-truth labels: `source` (auto/manual), `type`, `direction`,
  `confirmed`, `value` (e.g. speed limit), lat/lng/speed, `meta`.
- **`devices`** — reserved for future OBD; unused.
- **`map_roads`** (PostGIS) — 38,073 Goa OSM roads: `fclass`, `name`, `ref`, `oneway`,
  `maxspeed`, `limit_kmh` (maxspeed else fclass default), `geom geometry(Geometry,4326)`, GIST.
- **`map_points`** (PostGIS) — 1,022 signals/junctions/crossings/bus-stops.

All user tables have RLS scoping rows to the owner; `map_roads`/`map_points` are public-read
reference data.

## Database functions (RPCs)

| Function | Purpose |
|---|---|
| `trip_route(trip, max)` | Downsampled GPS track (t_ms, lat, lng, speed) for the review map |
| `road_context(lat,lng)` | Nearest road: fclass/name/ref/oneway/limit_kmh/bearing/dist/wrong_side_possible |
| `stop_context(lat,lng,radius)` | Nearby stop-legitimizing features |
| `rescore_trip(trip)` | Re-run the sensor score over stored samples (mirrors `scoring.ts`) |
| `rescore_speeding_mapped(trip)` | Speeding vs map-matched road limits |
| `score_map_discipline(trip)` | Wrong-side + no-stop-zone + final 7-factor overall |

New trips: client `scoring.ts` writes the 5 sensor sub-scores at finish → the finish route then
calls `rescore_speeding_mapped` + `score_map_discipline` to add the map factors and the
authoritative overall.

## Recording pipeline (`/record`)

1. Sampler at 25 Hz reads the latest GPS/accel/gyro into a sample (`seq`, `t_ms`, …).
2. Each sample → **IndexedDB** immediately (durable), and fed to the live detector.
3. A flusher streams unsynced samples to `/api/trips/[id]/samples` in batches (idempotent).
4. On finish: upload stragglers, score client-side, POST `/finish`; server adds map scores.
5. Survives reload (resume), signal loss (local buffer + retry), and screen-off is mitigated by a
   Wake Lock (foreground only — true background is the native-app job).

## Map pipeline (in-repo: `map/`, see `map/README.md`)

```
clip_goa.py       western-zone.gpkg → goa.gpkg (bbox clip)
match_goa.py      offline map-matching prototype (validation)
load_map.py       goa.gpkg → Supabase PostGIS (needs .db_url connection string)
generate_batches.py  (fallback) batched INSERT SQL if no direct connection
wrongside_plot.py / *.png   diagnostics
```

Python geostack: geopandas, shapely, fiona, sqlalchemy, psycopg2.
