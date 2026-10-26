# DriveScore — Scoring

The drive score is a **deterministic, interpretable** heuristic (no ML yet). It blends
sensor-derived "driving quality" factors with map-matched "road context" factors. All penalty
weights are **provisional** — to be calibrated against labeled drives.

## Overall score (7 factors)

```
overall = smoothness·0.20 + braking·0.20 + cornering·0.15 + speeding·0.15
        + focus·0.10 + wrong_side·0.10 + stops·0.10
```

Each sub-score is 0–100. The authoritative overall is computed by `score_map_discipline` (after
the sensor factors and speeding are set), so it always reflects all seven.

Where computed:
- **Sensor factors** (smoothness, braking, cornering, focus) — `src/lib/scoring.ts` at finish,
  re-runnable server-side via `rescore_trip()`.
- **Speeding** — `rescore_speeding_mapped()` (map limits).
- **Wrong-side, stops** — `score_map_discipline()` (map + confidence).

## Sensor factors (`scoring.ts`)

Constants: `G=9.81`; harsh thresholds 0.30 g accel / 0.35 g brake / 0.35 g corner; `MOVING=4`,
`CORNER_MIN=8` km/h; `DEBOUNCE=1.5 s`.

- **Gravity removal** — a slow per-axis EMA estimates the mounted gravity vector; subtracting it
  gives *linear* acceleration (so a tilted mount isn't read as permanent cornering).
- **Longitudinal g (smoothness/braking)** — derived from GPS speed, but GPS updates ~1 Hz while we
  sample at 25 Hz. **Differentiating every sample caused the aliasing bug** (each 1 Hz speed step
  looked like a violent spike → sub-scores pinned at 0). Fix: differentiate **only across real
  speed changes**, over the actual elapsed time. Events are **debounced** (a sustained hard brake
  = one event).
- **Cornering** — gravity-removed lateral magnitude > 0.35 g while moving ≥ 8 km/h, debounced.
  *Known over-sensitive* — normal city junctions hit 0.35 g.
- **Penalty** — each sub-score = `100 − (events/km)·weight` (weights: accel 50, brake 55,
  corner 45), floored at 1 km so short trips don't explode.
- **Focus (phone-off-mount)** — baseline = trip-average accel vector ≈ mounted gravity direction.
  A *sustained* tilt away from it (>25° for ≥1 s) = handling; sum the duration; penalise the
  fraction of the trip handled. Transient bumps/potholes don't shift the smoothed gravity and the
  1 s gate rejects them. If the phone wasn't mounted (no stable baseline), focus stays 100.

## Map factors

Each driven point is **map-matched** (nearest road via PostGIS KNN, ~1.9 m median accuracy).

### Speeding (`rescore_speeding_mapped`)
Downsample to ~1 Hz, match each point to its road's `limit_kmh` (OSM `maxspeed` if present, else a
per-`fclass` default — motorway 100, trunk 80, primary/secondary 60, tertiary 50, residential 40,
…, since OSM maxspeed is only ~1% populated). `speeding = 100 − (% of moving points over
limit+10%)`.

### Wrong-side (`score_map_discipline`)
On one-way (`oneway='F'`) segments, compare travel **heading** (from before/after track points) to
the road's digitized **bearing**. A point is a candidate if heading opposes bearing by > 120°,
within 40 m.

Each candidate carries a **confidence** (0–1), and the penalty scales with it:
```
conf = heading_opposition × gps_match_closeness × parallel_carriageway_factor
```
- `heading_opposition` = how close to a full 180° reversal.
- `gps_match_closeness` = how tight the GPS match is.
- `parallel_carriageway_factor` = **0.15 if a one-way road going the driver's *own* direction sits
  within 30 m** (i.e. a divided highway → ambiguous match) else 1.0.

`score_wrong_side = 100 − Σ(conf)·20`. The raw `wrong_side_events` count is still recorded for
transparency even when confidence is low.

> **TODO (planned):** replace point-wise opposition with a **before/after trajectory window** —
> a genuine wrong-side event sustains opposing heading over distance; a U-turn / divided-carriageway
> artifact reverses within the window. See `docs/wrong-side-test-cases.md` (FP-1).

### No-stop-zone (`score_map_discipline`)
Detect stop episodes (speed < 3 km/h for ≥ 10 s), **excluding start/end parking** (first/last 60 s).
Flag a stop if it's on a through-road (trunk/primary/motorway) with **no** signal/junction/
crossing/bus-stop within 60 m. Confidence per stop:
```
conf = road_severity × distance_from_nearest_feature × stop_duration
```
`score_stops = 100 − Σ(conf)·15`.

## Confidence philosophy

Map signals (wrong-side, no-stop) are **noisy** — OSM doesn't map every junction, and close
carriageways confuse matching. Confidence weighting means **low-confidence hits barely affect the
score**, so we don't over-index on uncertain detections. The **human review** (confirm/correct on
the review map, with a reason) supplies the ground truth the map can't infer, and will calibrate
the weights.

## Re-scoring

To re-score existing trips after a logic change:
```sql
select public.rescore_trip(id)            from public.trips where status='completed';
select public.rescore_speeding_mapped(id) from public.trips where status='completed' and distance_km>0.3;
select public.score_map_discipline(id)    from public.trips where status='completed' and distance_km>0.3;
```
(`scoring.ts` and the plpgsql functions intentionally mirror each other; keep them in sync.)
