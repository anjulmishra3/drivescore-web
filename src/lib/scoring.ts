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
  let harshAccel = 0;
  let harshBrake = 0;
  let harshCorner = 0;
  let speedingSamples = 0;
  let speedSamples = 0;
  let events = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dt = (cur.t_ms - prev.t_ms) / 1000;
    if (dt <= 0) continue;

    distanceKm += haversineKm(prev, cur);

    // longitudinal acceleration from GPS speed (km/h -> m/s)
    if (cur.speed_kmh != null && prev.speed_kmh != null) {
      const dv = ((cur.speed_kmh - prev.speed_kmh) * 1000) / 3600;
      const aLong = dv / dt / G; // in g
      if (aLong > HARSH_ACCEL_G) { harshAccel++; events++; }
      if (-aLong > HARSH_BRAKE_G) { harshBrake++; events++; }

      maxSpeed = Math.max(maxSpeed, cur.speed_kmh);
      speedSamples++;
      if (cur.speed_kmh > SPEED_LIMIT_KMH) speedingSamples++;
    }

    // lateral / cornering from device accelerometer (x/y in m/s^2)
    if (cur.accel_x != null && cur.accel_y != null) {
      const lat = Math.sqrt(cur.accel_x ** 2 + cur.accel_y ** 2) / G;
      if (lat > HARSH_CORNER_G) { harshCorner++; events++; }
    }
  }

  const durationS = Math.round((sorted[sorted.length - 1].t_ms - sorted[0].t_ms) / 1000);
  const distanceForRate = Math.max(distanceKm, 0.1);

  // penalty scaled per km so short and long trips are comparable
  const perKm = (n: number) => n / distanceForRate;

  const smoothness = clamp(100 - perKm(harshAccel) * 12);
  const braking = clamp(100 - perKm(harshBrake) * 14);
  const cornering = clamp(100 - perKm(harshCorner) * 12);
  const speeding = clamp(
    100 - (speedSamples ? (speedingSamples / speedSamples) * 100 : 0)
  );
  // Focus (phone handling) can't be measured from these sensors in v0; assume
  // full marks. v1 gets this from the OBD/device pipeline.
  const focus = 100;

  const overall = clamp(
    smoothness * 0.25 +
      braking * 0.25 +
      cornering * 0.2 +
      speeding * 0.2 +
      focus * 0.1
  );

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
