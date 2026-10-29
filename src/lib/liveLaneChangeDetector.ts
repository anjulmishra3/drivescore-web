"use client";

import type { ManeuverEvent } from "@/lib/liveManeuverDetector";

// Live lane-change detector: "accel proposes, offset confirms".
//
// A lateral-acceleration spike (steering) TRIGGERS a candidate; it is only
// CONFIRMED (and prompted) if the on-device road-offset shifts by ~a lane width
// across the moment. This precision-tuned AND of two independent signals keeps
// live prompts rare and trustworthy (unlike the recall-tuned post-drive pass).
// Direction comes from the offset-step sign.
//
// Needs the region road map cached (localRoadMap) so `match` resolves offsets
// with no network; without it, lane-change prompts simply don't fire.

export interface LcSample {
  t_ms: number;
  lat: number | null; lng: number | null; speed_kmh: number | null;
  accel_x: number | null; accel_y: number | null; accel_z: number | null;
}
type MatchFn = (lat: number, lng: number) => { offset_m: number } | null;

const GRAV_ALPHA = 0.04;      // gravity EMA (~1s at 25 Hz)
const HMAG_SMOOTH_N = 12;     // ~0.5 s horizontal-accel smoothing
const ACCEL_TH = 1.8;         // m/s² smoothed horizontal accel that proposes a candidate
const MIN_KMH = 25;           // lane changes we care about happen at road speed
const TRIG_COOLDOWN_MS = 1500;// min gap between accel triggers
const CONFIRM_DELAY_MS = 3000;// wait this long for the "after" offset window
const STEP_M = 1.5;           // min signed offset step to confirm a lane change
const EMIT_COOLDOWN_MS = 4000;// min gap between emitted lane changes
const RING_MS = 9000;         // offset history kept

interface OffPt { t: number; off: number; lat: number; lng: number }

export class LiveLaneChangeDetector {
  private gx: number | null = null; private gy = 0; private gz = 0;
  private ring: number[] = []; private ringSum = 0;      // hmag smoothing
  private offs: OffPt[] = [];                            // offset history
  private pending: { t: number; speed: number | null }[] = [];
  private lastTrig = -1e15; private lastEmit = -1e15;
  private lastLat: number | null = null; private lastLng: number | null = null;
  private armed = true;

  constructor(private match: MatchFn, private onEvent: (e: ManeuverEvent) => void) {}

  push(s: LcSample) {
    const { accel_x: ax, accel_y: ay, accel_z: az } = s;
    if (ax == null || ay == null || az == null) return;

    // gravity EMA + horizontal (lateral) accel magnitude
    if (this.gx == null) { this.gx = ax; this.gy = ay; this.gz = az; }
    this.gx += GRAV_ALPHA * (ax - this.gx);
    this.gy += GRAV_ALPHA * (ay - this.gy);
    this.gz += GRAV_ALPHA * (az - this.gz);
    const gmag = Math.hypot(this.gx, this.gy, this.gz) || 1e-9;
    const lx = ax - this.gx, ly = ay - this.gy, lz = az - this.gz;
    const dot = (lx * this.gx + ly * this.gy + lz * this.gz) / gmag;
    const hmag = Math.sqrt(Math.max(0, lx * lx + ly * ly + lz * lz - dot * dot));

    this.ring.push(hmag); this.ringSum += hmag;
    if (this.ring.length > HMAG_SMOOTH_N) this.ringSum -= this.ring.shift()!;
    const hs = this.ringSum / this.ring.length;

    const spd = s.speed_kmh ?? 0;

    // accel trigger (rising edge over threshold, at road speed, debounced)
    if (hs >= ACCEL_TH && spd >= MIN_KMH) {
      if (this.armed && s.t_ms - this.lastTrig > TRIG_COOLDOWN_MS) {
        this.pending.push({ t: s.t_ms, speed: s.speed_kmh });
        this.lastTrig = s.t_ms;
        this.armed = false;
      }
    } else if (hs < ACCEL_TH * 0.6) {
      this.armed = true; // re-arm once the pulse subsides
    }

    // offset history, only on a fresh GPS fix (match is relatively costly)
    if (s.lat != null && s.lng != null && (s.lat !== this.lastLat || s.lng !== this.lastLng)) {
      this.lastLat = s.lat; this.lastLng = s.lng;
      const m = this.match(s.lat, s.lng);
      if (m) this.offs.push({ t: s.t_ms, off: m.offset_m, lat: s.lat, lng: s.lng });
      while (this.offs.length && s.t_ms - this.offs[0].t > RING_MS) this.offs.shift();
    }

    // confirm pending triggers that now have enough "after" data
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (s.t_ms - p.t < CONFIRM_DELAY_MS) continue;       // wait for after-window
      this.pending.splice(i, 1);
      const before = this.avgOff(p.t - 3000, p.t - 1000);
      const after = this.avgOff(p.t + 1000, p.t + 3000);
      if (before == null || after == null) continue;
      const step = after - before;
      if (Math.abs(step) < STEP_M) continue;               // offset didn't confirm
      if (p.t - this.lastEmit <= EMIT_COOLDOWN_MS) continue;
      this.lastEmit = p.t;
      const at = this.nearest(p.t);
      this.onEvent({
        type: "lane_change",
        t_ms: p.t,
        net_heading: 0, peak_yaw: 0,
        dur_s: Math.round(((after != null ? CONFIRM_DELAY_MS : 0) / 1000) * 10) / 10,
        speed_kmh: p.speed == null ? null : Math.round(p.speed * 10) / 10,
        lat: at?.lat ?? null, lng: at?.lng ?? null,
      });
    }
  }

  private avgOff(t0: number, t1: number): number | null {
    let sum = 0, n = 0;
    for (const o of this.offs) if (o.t >= t0 && o.t <= t1) { sum += o.off; n++; }
    return n >= 2 ? sum / n : null;
  }
  private nearest(t: number): OffPt | null {
    let best: OffPt | null = null, bd = Infinity;
    for (const o of this.offs) { const d = Math.abs(o.t - t); if (d < bd) { bd = d; best = o; } }
    return best;
  }
}
