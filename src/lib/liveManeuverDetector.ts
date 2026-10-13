"use client";

// Real-time maneuver detector — the streaming version of the offline prototype.
// Fed one sensor sample at a time, it tracks vehicle yaw rate (rotation about the
// gravity axis), segments sustained-yaw "lobes", and emits turn / lane-change
// candidates as they complete. Zero allocation per sample beyond a tiny ring.

export interface DetSample {
  t_ms: number;
  speed_kmh: number | null;
  accel_x: number | null; accel_y: number | null; accel_z: number | null;
  gyro_alpha: number | null; gyro_beta: number | null; gyro_gamma: number | null;
  lat: number | null; lng: number | null;
}

export interface ManeuverEvent {
  type: "turn" | "lane_change";
  t_ms: number;              // center time of the maneuver
  net_heading: number;       // deg (signed)
  peak_yaw: number;          // deg/s
  dur_s: number;
  speed_kmh: number | null;
  lat: number | null; lng: number | null;
}

interface Lobe {
  sign: number; net: number; peak: number;
  startT: number; endT: number; speed: number | null;
  lat: number | null; lng: number | null;
}

const GRAV_ALPHA = 0.04;   // ~1s gravity time constant at 25 Hz
const SMOOTH_N = 13;       // ~0.5s yaw smoothing
const TH = 3;              // deg/s — lobe on/off threshold
const SPEED_GATE = 25;     // km/h — only judge while driving
const CLOSE_MS = 300;      // below-threshold time that ends a lobe
const TURN_DEG = 35;       // net heading that marks a turn
const PAIR_GAP_MS = 2500;  // max gap between the two lobes of a lane change

export class LiveManeuverDetector {
  private gx: number | null = null; private gy = 0; private gz = 0;
  private ring: number[] = []; private ringSum = 0;
  private lastT: number | null = null;
  private cur: Lobe | null = null;
  private belowSince: number | null = null;
  private prevLobe: Lobe | null = null;
  private lastPairT = -1e15;

  constructor(private onEvent: (e: ManeuverEvent) => void) {}

  push(s: DetSample) {
    const { accel_x: ax, accel_y: ay, accel_z: az,
            gyro_alpha: ga, gyro_beta: gb, gyro_gamma: gg } = s;
    if (ax == null || ay == null || az == null || ga == null || gb == null || gg == null) return;

    // gravity estimate (EMA) and yaw = rotationRate projected onto gravity axis
    if (this.gx == null) { this.gx = ax; this.gy = ay; this.gz = az; }
    this.gx += GRAV_ALPHA * (ax - this.gx);
    this.gy += GRAV_ALPHA * (ay - this.gy);
    this.gz += GRAV_ALPHA * (az - this.gz);
    const gmag = Math.hypot(this.gx, this.gy, this.gz);
    if (gmag === 0) return;
    const yawRaw = (this.gx * ga + this.gy * gb + this.gz * gg) / gmag;

    // smooth with a short moving average
    this.ring.push(yawRaw); this.ringSum += yawRaw;
    if (this.ring.length > SMOOTH_N) this.ringSum -= this.ring.shift()!;
    const yaw = this.ringSum / this.ring.length;

    const dt = this.lastT == null ? 0 : (s.t_ms - this.lastT) / 1000;
    this.lastT = s.t_ms;

    const moving = (s.speed_kmh ?? 0) >= SPEED_GATE;
    const active = moving && Math.abs(yaw) > TH;

    if (active) {
      this.belowSince = null;
      const sgn = Math.sign(yaw);
      if (!this.cur || this.cur.sign !== sgn) {
        if (this.cur) this.closeLobe(s);          // sign flipped → close & start new
        this.cur = { sign: sgn, net: 0, peak: 0, startT: s.t_ms, endT: s.t_ms,
                     speed: s.speed_kmh, lat: s.lat, lng: s.lng };
      }
      this.cur.net += yaw * dt;
      this.cur.peak = Math.max(this.cur.peak, Math.abs(yaw));
      this.cur.endT = s.t_ms;
      this.cur.speed = s.speed_kmh;
      this.cur.lat = s.lat; this.cur.lng = s.lng;
    } else if (this.cur) {
      if (this.belowSince == null) this.belowSince = s.t_ms;
      if (s.t_ms - this.belowSince >= CLOSE_MS) this.closeLobe(s);
    }
  }

  private closeLobe(_s: DetSample) {
    const lobe = this.cur!;
    this.cur = null; this.belowSince = null;
    const durS = (lobe.endT - lobe.startT) / 1000;
    if (durS < 0.4) { this.prevLobe = lobe; return; }

    const netAbs = Math.abs(lobe.net);

    // Turn: large net heading change.
    if (netAbs >= TURN_DEG) {
      this.emit("turn", lobe);
      this.prevLobe = lobe;
      return;
    }

    // Lane change: this lobe + the previous one are opposite, close in time,
    // each modest, and nearly cancel.
    const p = this.prevLobe;
    if (p && p.sign !== lobe.sign &&
        lobe.startT - p.endT <= PAIR_GAP_MS &&
        Math.abs(p.net) >= 3 && Math.abs(p.net) <= 20 &&
        netAbs >= 3 && netAbs <= 20 &&
        Math.abs(p.net + lobe.net) <= 0.5 * (Math.abs(p.net) + netAbs) &&
        Math.min(p.speed ?? 0, lobe.speed ?? 0) >= 30 &&
        lobe.startT - this.lastPairT > 3000) {
      this.lastPairT = lobe.startT;
      const merged: Lobe = {
        sign: lobe.sign,
        net: p.net + lobe.net,
        peak: Math.max(p.peak, lobe.peak),
        startT: p.startT, endT: lobe.endT,
        speed: lobe.speed, lat: lobe.lat, lng: lobe.lng,
      };
      this.emit("lane_change", merged);
    }
    this.prevLobe = lobe;
  }

  private emit(type: "turn" | "lane_change", l: Lobe) {
    this.onEvent({
      type,
      t_ms: Math.round((l.startT + l.endT) / 2),
      net_heading: Math.round(l.net * 10) / 10,
      peak_yaw: Math.round(l.peak * 10) / 10,
      dur_s: Math.round(((l.endT - l.startT) / 1000) * 100) / 100,
      speed_kmh: l.speed == null ? null : Math.round(l.speed * 10) / 10,
      lat: l.lat, lng: l.lng,
    });
  }
}
