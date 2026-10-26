# DriveScore — Worklog

Chronological record of work done, current status, and next steps. Deep detail lives in
the reference docs:
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — stack, components, data model, deployment.
- [`docs/SCORING.md`](docs/SCORING.md) — the scoring algorithm (sensors + map).
- [`docs/wrong-side-test-cases.md`](docs/wrong-side-test-cases.md) — regression fixtures.

---

## Current status (2026-10-26)

**Live:** `https://drivescore-web.vercel.app` — Next.js 14 on Vercel, auto-deploying from
`github.com/anjulmishra3/drivescore-web` (branch `main`). Backend: Supabase project
`drive_score` (`gtfbsszcjzsjrmvoibtd`), Postgres + PostGIS + Auth.

**What works end-to-end:**
- Email/password auth, signup confirmation, self-serve password reset.
- `/record` — 25 Hz trip recording (GPS + accel + gyro), resilient streaming with on-device
  IndexedDB buffering, resume after interruption, wake-lock, no-GPS warning.
- Live maneuver detector (turns / lane-changes) with auto-logging + in-drive confirm prompts.
- Labeling: auto + manual tags, post-trip **review map** (Leaflet) with tap-to-tag, driver-action
  and road-context (speed-limit, signs) labels.
- **7-factor drive score**: smoothness, braking, cornering, speeding (map limits), focus
  (phone-off-mount), wrong-side, no-stop-zone — see `docs/SCORING.md`.
- **Map layer in PostGIS**: full Goa OSM roads (38k) + POIs (1k), queried live via RPCs
  (`road_context`, `stop_context`).

**Data so far:** ~9 trips, 2–3 users (all Sep 12–13 + Oct test drives). Richest: the 55 km "Goa"
trip `efe33f89-…` (143k samples @25 Hz) and the 61 km trip `283396a8-…`.

---

## Log

### Phase 1 — v0 web app scaffold
- Next.js 14 (App Router) + TS + Tailwind + Supabase chosen (matches the user's invoice-bot stack).
- Pages: onboarding, calibration drive, dashboard, settings; Supabase Auth (email/password).
- Schema (`0001_init`): `profiles`, `devices`, `trips`, `trip_samples` with Row-Level Security.
  Advisor-flagged functions hardened (`0002`).
- Deployed to Vercel; GitHub repo connected for auto-deploy.

### Phase 2 — Auth hardening
- `/auth/confirm` route (handles both PKCE `code` and `token_hash` email flows).
- Self-serve password reset (`/forgot-password`, `/reset-password`) reusing the confirm flow.
- Clarified: the app connects with the **anon key only**; the DB password is never in code.

### Phase 3 — Resilient recording
- **Phone-only** decision (no OBD device).
- `/record` road-trip recorder (`useRoadTripRecorder.ts`): 25 Hz sampler → IndexedDB
  (`sampleStore.ts`) → batched streaming to `trips`/`trip_samples` (`/api/trips/start`,
  `/api/trips/[id]/samples`, `/api/trips/[id]/finish`), idempotent via per-trip `seq`
  (`0003_streaming_samples`). Resume after reload, wake-lock, speed-from-position fallback.
- Removed the old Quick-trip page in favor of `/record`.

### Phase 4 — Scoring fixes (deterministic engine)
- Fixed **GPS teleport** distance blow-up (811,304 km trip → filter by step size).
- Fixed **GPS-speed aliasing**: longitudinal g was differentiated every 40 ms against ~1 Hz GPS
  speed → false harsh events (smoothness/braking pinned at 0). Now differentiates only across real
  speed updates + debounces events. Re-scored all trips via `rescore_trip()` plpgsql.
- Added **Focus** (phone-off-mount) detection: baseline gravity orientation vs. sustained tilt.
- Lowered the live detector's speed gate 25 → 8 km/h (peak-speed gated) — city turns were being
  ignored, so prompts never fired.

### Phase 5 — Labeling system
- `trip_labels` table (`0004`) + `/api/trips/[id]/labels` (GET/POST/PATCH/DELETE).
- Live detector (`liveManeuverDetector.ts`) emits turns/lane-changes → auto-logged; Netflix-style
  auto-dismiss confirm prompt; minimal manual "+ Tag".
- Post-trip **review** (`/trips/[id]/review`) with a Leaflet map (`RouteMap.tsx`): confirm/correct
  detected events, **tap anywhere on the route to add a label** (`trip_route` RPC, `0005`/`0006`).
- `/trips` index page. Road-context labels (speed_limit with a numeric `value`, signs). `u_turn`.

### Phase 6 — Map integration (OSM → PostGIS)
- Source: Geofabrik OSM GeoPackage (western India) at
  `~/Downloads/western-zone-261005-free.gpkg/western-zone.gpkg`.
- Clipped to Goa → `map/goa.gpkg` (`clip_goa.py`): 38k roads, 1k POIs.
- Offline map-matching prototype (`match_goa.py`) proved **~1.9 m median** accuracy — validating
  that road-level matching works despite ~10 m GPS (lane-level still impossible).
- Loaded into Supabase **PostGIS** (`load_map.py`, via a direct DB connection):
  `public.map_roads` (38,073, 2,065 one-way, `limit_kmh` filled), `public.map_points` (1,022),
  GIST-indexed. RPCs: `road_context(lat,lng)`, `stop_context(lat,lng,radius)` (`0008`).

### Phase 7 — Map-based scoring
- **Speeding vs real limits** (`rescore_speeding_mapped`): replaces the flat 120 km/h fallback;
  the finish route runs it automatically. Goa trip speeding 100 → 88 (12% over NH's 80).
- **Wrong-side + no-stop-zone** (`score_map_discipline`): heading vs one-way road bearing; stops
  (≥10 s, excluding start/end parking) away from signals/junctions on through-roads.
- **Confidence weighting** baked into both so low-confidence hits barely move the score.
- **Parallel-carriageway factor** for wrong-side — down-weights divided-highway U-turn artifacts
  (see FP-1 in `docs/wrong-side-test-cases.md`).
- Overall is now **7-factor** (computed authoritatively by `score_map_discipline`).

---

## Next steps

### Near-term (no new data / infra needed)
1. **Wrong-side trajectory logic** — rework `score_map_discipline` to use the before/after
   trajectory window instead of point-wise opposition, so U-turns are recognised structurally.
   Regression target: FP-1 (`283396a8-…`) → `wrong_side_events = 0`.
2. **Calibrate penalty weights** against labeled drives — cornering is over-sensitive (0.35 g flags
   normal city junctions); wrong-side/no-stop penalties are provisional.

### Needs data
3. **Collect labeled drives** — the real bottleneck. A few mounted, tagged drives unblock all
   calibration and any future ML. Labeling pipeline is ready (GPS + detector + review map).
4. **No-stop-zone reason prompt** — let the human confirm "at signal / in traffic / legal / illegal"
   to correct map false-positives (OSM feature gaps).

### Bigger / future (recorded, not started)
5. **Interpretability layer** ("why this score") — build while logic is still deterministic; much
   harder after ML. *Prioritise before #6.*
6. **ML / non-deterministic scoring** — train models once enough labeled data exists.
7. **Native Android app (v1)** — true background/screen-off recording (original design doc's v1).

### Ops notes
- Supabase **free tier auto-pauses** after ~1 week idle; restore via MCP `restore_project` (takes a
  few minutes). Data survives.
- **iOS** is untested beyond GPS; motion works but needs Safari Location Services on; screen must
  stay on (Wake Lock 16.4+).
- Map data load needs a direct DB connection string in `map/.db_url` (deletable after
  load); the app itself never uses it.
