"use client";

// Mount-state heuristic: is the phone rigidly mounted to the car, or loose
// (pocket / cup holder / hand)? It matters because our accel/gyro detectors
// assume the phone moves WITH the car — a loose phone adds its own sliding and
// tipping, which corrupts lane-change and cornering signals.
//
// Key idea: a MOUNTED phone only rotates in YAW (it turns with the car); its
// roll/pitch stay fixed, so the rotation-rate component perpendicular to gravity
// ("tumble") is ~0. A LOOSE phone tips and rolls → non-zero tumble — and it
// rattles → high-frequency translational jitter the car's own motion lacks.
// (Turns are pure yaw, so they don't fool this.) Runs passively from the sensor
// stream; the driver does nothing.
//
// Thresholds below are first-cut and expected to need on-road tuning.

export type MountState = "uncertain" | "mounted" | "loose";

export interface MountSample {
  accel_x: number | null; accel_y: number | null; accel_z: number | null;
  gyro_alpha: number | null; gyro_beta: number | null; gyro_gamma: number | null;
}

const GRAV_ALPHA = 0.05;       // gravity EMA
const SMOOTH_ALPHA = 0.02;     // ~2 s smoothing of the decision signals at 25 Hz
const WARMUP_SAMPLES = 75;     // ~3 s of data before leaving "uncertain"
const TUMBLE_MOUNTED = 6;      // deg/s non-yaw rotation at/below which it looks mounted
const TUMBLE_LOOSE = 18;       // deg/s above which it looks loose
const JITTER_MOUNTED = 0.9;    // m/s² sample-to-sample accel change (mounted is smooth)
const JITTER_LOOSE = 2.2;      // m/s² above which it looks loose

export class MountStateDetector {
  private gx: number | null = null; private gy = 0; private gz = 0;
  private pax: number | null = null; private pay = 0; private paz = 0;
  private tumbleS = 0; private jitterS = 0;
  private haveGyro = false; private n = 0;
  private _state: MountState = "uncertain";

  push(s: MountSample) {
    const { accel_x: ax, accel_y: ay, accel_z: az } = s;
    if (ax == null || ay == null || az == null) return;

    // gravity EMA → unit gravity axis
    if (this.gx == null) { this.gx = ax; this.gy = ay; this.gz = az; }
    this.gx += GRAV_ALPHA * (ax - this.gx);
    this.gy += GRAV_ALPHA * (ay - this.gy);
    this.gz += GRAV_ALPHA * (az - this.gz);
    const gmag = Math.hypot(this.gx, this.gy, this.gz) || 1e-9;
    const gux = this.gx / gmag, guy = this.gy / gmag, guz = this.gz / gmag;

    // translational jitter: smoothed magnitude of the sample-to-sample accel change
    if (this.pax != null) {
      const d = Math.hypot(ax - this.pax, ay - this.pay, az - this.paz);
      this.jitterS += SMOOTH_ALPHA * (d - this.jitterS);
    }
    this.pax = ax; this.pay = ay; this.paz = az;

    // tumble: rotation-rate component perpendicular to gravity (non-yaw)
    const { gyro_alpha: ga, gyro_beta: gb, gyro_gamma: gg } = s;
    if (ga != null && gb != null && gg != null) {
      this.haveGyro = true;
      const yaw = ga * gux + gb * guy + gg * guz;          // rotation about gravity
      const tumble = Math.sqrt(Math.max(0, ga * ga + gb * gb + gg * gg - yaw * yaw));
      this.tumbleS += SMOOTH_ALPHA * (tumble - this.tumbleS);
    }

    if (++this.n < WARMUP_SAMPLES) return;

    // classify with hysteresis: commit to mounted/loose only on clear evidence,
    // otherwise hold the previous state (prevents flapping at the boundary).
    const looksMounted = this.haveGyro && this.tumbleS < TUMBLE_MOUNTED && this.jitterS < JITTER_MOUNTED;
    const looksLoose = this.tumbleS > TUMBLE_LOOSE || this.jitterS > JITTER_LOOSE;
    if (looksMounted) this._state = "mounted";
    else if (looksLoose) this._state = "loose";
    // else: keep current state (hysteresis band)
  }

  get state(): MountState { return this._state; }
  // exposed for tuning/telemetry
  get signals() { return { tumble: Math.round(this.tumbleS * 10) / 10, jitter: Math.round(this.jitterS * 100) / 100 }; }
}
