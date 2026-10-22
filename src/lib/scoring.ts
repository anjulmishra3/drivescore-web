import type { ScoreBreakdown, TripSample } from "@/types/db";

// v0 heuristic scoring. This is a deliberate stand-in for the future cloud
// scoring pipeline (see design doc): it turns a foreground sensor stream into
// the canonical ScoreBreakdown shape so the dashboard has real data to show.
// v1 will replace the *source* of these numbers (edge/device pipeline) without
// changing the shape.
//
// Approach: each sub-score starts at 100 and loses points for "harsh" events
// detected in the sensor stream. Thresholds are approximate and tuned for
// phone-on-dashboard sampling, not laboratory accuracy.

const G = 9.81; // m/s^2

// thresholds (in g) above which an event counts as harsh
const HARSH_ACCEL_G = 0.30;
const HARSH_BRAKE_G = 0.35;
const HARSH_CORNER_G = 0.35;
const SPEED_LIMIT_KMH = 120; // coarse fallback; real limits need map data (v1+)
// GPS occasionally reports a wildly wrong fix, producing a huge position jump
// (seen: an 811,000 km "trip"). Speeds above this are treated as a bad fix.
const MAX_PLAUSIBLE_KMH = 250;
// GPS updates slower (~1 Hz) than we sample (25 Hz), so real movement appears as
// a small jump between two adjacent samples — legitimate even though its implied
// speed over 40 ms looks enormous. We therefore accept any step up to this size,
// and only reject *large* jumps whose implied speed is also implausible (a true
// GPS teleport). A step this big can't be real between nearby samples.
const MAX_STEP_KM = 0.5;

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function haversineKm(a: TripSample, b: TripSample): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 0;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function scoreTrip(samples: TripSample[]): ScoreBreakdown {
  if (samples.length < 2) {
    return {
      overall_score: 0,
      score_smoothness: 0,
      score_braking: 0,
      score_cornering: 0,
      score_speeding: 0,
      score_focus: 100,
      event_count: 0,
      distance_km: 0,
      duration_s: 0,
      max_speed_kmh: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a.t_ms - b.t_ms);

  let distanceKm = 0;
  let maxSpeed = 0;
  let harshAccel = 0, harshBrake = 0, harshCorner = 0;
  let speedingSamples = 0, speedSamples = 0;

  // Gravity is removed with a slow per-axis exponential moving average so a
  // tilted mount's constant gravity component isn't read as permanent cornering.
  let gx: number | null = null, gy = 0, gz = 0;
  const GRAV_ALPHA = 0.02;

  const MOVING_KMH = 4;
  const CORNER_MIN_KMH = 8;
  const DEBOUNCE_MS = 1500;    // a sustained harsh action counts as ONE event
  const MAX_ACCEL_GAP_S = 5;   // don't differentiate speed across recording gaps

  // Longitudinal g is derived from GPS speed, but GPS updates ~1 Hz while we
  // sample at 25 Hz. Differentiating every 40 ms sample turns each 1 Hz speed
  // update into a false spike (the old smoothness/braking = 0 bug). So we only
  // differentiate across *actual* speed changes, over the real elapsed time.
  let refSpeed: number | null = null, refT = 0;
  let lastAccelT = -Infinity, lastBrakeT = -Infinity, lastCornerT = -Infinity;

  // --- Focus: detect the phone being picked up off its mount ---
  // Baseline = the trip's average accelerometer vector ≈ the mounted gravity
  // direction (vehicle motion averages out). A *sustained* tilt away from it
  // means the phone left the mount (handled). Transient bumps/potholes don't
  // shift the smoothed gravity, and the >1s duration gate ignores them.
  const FOCUS_TILT_DEG = 25;  // deviation that counts as "off the mount"
  const FOCUS_NEAR_DEG = 15;  // "at the mount" for the mounted-ness check
  const FOCUS_MIN_S = 1.0;    // min handling duration (rejects bumps)
  const FOCUS_K = 150;        // focus penalty per fraction of the trip handled

  let bx = 0, by = 0, bz = 0, bn = 0;
  for (const s of sorted) {
    if (s.accel_x != null && s.accel_y != null && s.accel_z != null) {
      bx += s.accel_x; by += s.accel_y; bz += s.accel_z; bn++;
    }
  }
  const haveBase = bn > 0;
  if (haveBase) { bx /= bn; by /= bn; bz /= bn; }
  const bMag = Math.hypot(bx, by, bz) || 1;

  let handling = false, handStart = 0, phoneSeconds = 0;
  let accelSamples = 0, nearBaseline = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dt = (cur.t_ms - prev.t_ms) / 1000;
    if (dt <= 0) continue;

    const stepKm = haversineKm(prev, cur);
    if (stepKm <= MAX_STEP_KM || stepKm / (dt / 3600) <= MAX_PLAUSIBLE_KMH) {
      distanceKm += stepKm;
    }

    const sp = cur.speed_kmh;
    if (sp != null && sp <= MAX_PLAUSIBLE_KMH) {
      maxSpeed = Math.max(maxSpeed, sp);
      if (sp >= MOVING_KMH) {
        speedSamples++;
        if (sp > SPEED_LIMIT_KMH) speedingSamples++;
      }
      // de-aliased longitudinal: evaluate only when GPS speed actually changes
      if (refSpeed == null) { refSpeed = sp; refT = cur.t_ms; }
      else if (sp !== refSpeed) {
        const gap = (cur.t_ms - refT) / 1000;
        if (gap > 0 && gap <= MAX_ACCEL_GAP_S && sp >= MOVING_KMH) {
          const aLong = ((sp - refSpeed) * 1000) / 3600 / gap / G; // g
          if (aLong > HARSH_ACCEL_G && cur.t_ms - lastAccelT > DEBOUNCE_MS) { harshAccel++; lastAccelT = cur.t_ms; }
          if (-aLong > HARSH_BRAKE_G && cur.t_ms - lastBrakeT > DEBOUNCE_MS) { harshBrake++; lastBrakeT = cur.t_ms; }
        }
        refSpeed = sp; refT = cur.t_ms;
      }
    }

    // cornering from gravity-removed lateral accel, debounced into events
    if (cur.accel_x != null && cur.accel_y != null && cur.accel_z != null) {
      if (gx == null) { gx = cur.accel_x; gy = cur.accel_y; gz = cur.accel_z; }
      gx += GRAV_ALPHA * (cur.accel_x - gx);
      gy += GRAV_ALPHA * (cur.accel_y - gy);
      gz += GRAV_ALPHA * (cur.accel_z - gz);
      const lx = cur.accel_x - gx, ly = cur.accel_y - gy;
      const lateral = Math.sqrt(lx ** 2 + ly ** 2) / G;
      if ((sp ?? 0) >= CORNER_MIN_KMH && lateral > HARSH_CORNER_G && cur.t_ms - lastCornerT > DEBOUNCE_MS) {
        harshCorner++; lastCornerT = cur.t_ms;
      }

      // focus: tilt of the current gravity vector away from the mount baseline
      if (haveBase) {
        accelSamples++;
        const gMag = Math.hypot(gx, gy, gz) || 1;
        const cos = Math.max(-1, Math.min(1, (gx * bx + gy * by + gz * bz) / (gMag * bMag)));
        const devDeg = (Math.acos(cos) * 180) / Math.PI;
        if (devDeg < FOCUS_NEAR_DEG) nearBaseline++;
        if (devDeg > FOCUS_TILT_DEG) {
          if (!handling) { handling = true; handStart = cur.t_ms; }
        } else if (handling) {
          if ((cur.t_ms - handStart) / 1000 >= FOCUS_MIN_S) phoneSeconds += (cur.t_ms - handStart) / 1000;
          handling = false;
        }
      }
    }
  }

  const events = harshAccel + harshBrake + harshCorner;
  const durationS = Math.round((sorted[sorted.length - 1].t_ms - sorted[0].t_ms) / 1000);
  const distanceForRate = Math.max(distanceKm, 1);
  const perKm = (n: number) => n / distanceForRate;

  // Penalty per harsh event per km. Events are now debounced discrete maneuvers,
  // so these weights are much larger than the old per-sample multipliers.
  // Provisional — to be calibrated against labeled ground truth.
  const smoothness = clamp(100 - perKm(harshAccel) * 50);
  const braking = clamp(100 - perKm(harshBrake) * 55);
  const cornering = clamp(100 - perKm(harshCorner) * 45);
  const speeding = clamp(100 - (speedSamples ? (speedingSamples / speedSamples) * 100 : 0));

  // Focus: if the phone sat on the mount most of the time (a stable baseline to
  // deviate from), deduct for the fraction of the trip it was handled; otherwise
  // we can't judge it, so leave it at 100.
  if (handling && haveBase && (sorted[sorted.length - 1].t_ms - handStart) / 1000 >= FOCUS_MIN_S) {
    phoneSeconds += (sorted[sorted.length - 1].t_ms - handStart) / 1000;
  }
  const mounted = haveBase && accelSamples > 0 && nearBaseline / accelSamples >= 0.4;
  const focus = mounted ? clamp(100 - (phoneSeconds / Math.max(durationS, 1)) * FOCUS_K) : 100;

  const overall = clamp(smoothness * 0.25 + braking * 0.25 + cornering * 0.2 + speeding * 0.2 + focus * 0.1);

  return {
    overall_score: overall,
    score_smoothness: smoothness,
    score_braking: braking,
    score_cornering: cornering,
    score_speeding: speeding,
    score_focus: focus,
    event_count: events,
    distance_km: Math.round(distanceKm * 100) / 100,
    duration_s: durationS,
    max_speed_kmh: Math.round(maxSpeed * 100) / 100,
  };
}

export function scoreColor(score: number | null): string {
  if (score == null) return "#94a3b8";
  if (score >= 80) return "#16a34a";
  if (score >= 60) return "#f59e0b";
  return "#dc2626";
}

export function scoreLabel(score: number | null): string {
  if (score == null) return "—";
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 60) return "Fair";
  return "Needs work";
}
