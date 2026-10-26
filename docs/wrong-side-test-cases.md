# Wrong-side detection — test cases / known false positives

The wrong-side score is computed server-side by `public.score_map_discipline(trip_id)`
(a point's travel heading vs. the nearest one-way road's bearing). These are documented
cases to re-test whenever that logic changes.

---

## FP-1 — Divided-highway U-turn on NH66 (FALSE POSITIVE)

- **Trip:** `283396a8-8a6a-4ae6-8864-6285a86e138d` (the 61.5 km Goa drive, 2026-09-13 06:57)
- **Flagged point:** `lat 15.439855, lng 73.878375`
- **Geometry at the flag:**
  - travel heading **119°** (south-east)
  - nearest one-way road = **NH66**, digitized bearing **299°** (north-west)
  - opposition **180°** (exactly opposed), GPS match distance **5.3 m**
- **What actually happened:** NH66 is a **divided highway** whose two one-way carriageways
  are digitized within GPS error of each other. The driver did an **out-and-back / U-turn**
  (approached SE, turned around, returned NW on the parallel carriageway). On the SE leg,
  GPS matched to the carriageway digitized as NW-bound → a 180° "wrong-side" reading.
- **Why it's a false positive:** the driver was on the correct side of a divided road and
  performing a legal turnaround — not driving against traffic.
- **Plot:** `map/wrongside.png` (path = out-and-back; orange = NH66 one-way).

### Current handling (2026-10-23)
A **parallel-carriageway confidence factor** was added: if a one-way road going roughly the
driver's own direction sits within 30 m, confidence × 0.15. This drops the penalty to near
zero (`score_wrong_side` 84 → **98**). **However `wrong_side_events` still counts 1** — the
raw geometric opposition is still recorded.

### Planned logic change (TODO — not yet built)
Make wrong-side consider the **before-and-after trajectory window** around a candidate point,
not a single point:
- A **genuine** wrong-side event shows a *sustained* opposing heading over distance/time.
- A **U-turn / divided-carriageway artifact** shows a turnaround signature — the heading
  reverses within the window, or the opposing stretch is brief and bracketed by
  correctly-aligned travel.

**Expected result after the fix:** this trip should yield **`wrong_side_events = 0`** (the
candidate is recognised as a U-turn, not just down-weighted by confidence).

### How to re-test
Run `select public.score_map_discipline('283396a8-8a6a-4ae6-8864-6285a86e138d');` then check
`score_wrong_side` / `wrong_side_events` on `public.trips`. Target: 0 events, score 100.
