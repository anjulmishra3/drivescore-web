#!/usr/bin/env python3
"""Generates gyro_calibration.ipynb (kept as a builder so the notebook JSON is
always valid). Run: python3 analysis/build_notebook.py"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
TRIP = "4941031e-df94-4caf-ab4c-f821e1b8b9fd"  # 2026-11-01 09:41 UTC (first drive, has labels)

cells = []
def md(src): cells.append({"cell_type": "markdown", "metadata": {}, "source": src})
def code(src): cells.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [], "source": src})

md(f"""# Gyro / mount calibration — drive `{TRIP[:8]}` (2026-11-01 09:41)

The phone sits in the mount at an **unknown, fixed orientation**. The raw accel/gyro
are in the *phone* frame, so "yaw" isn't cleanly about the vertical axis and
"forward accel" is mixed across axes. This notebook recovers the phone→vehicle
rotation from the data itself and transforms the whole drive into the **vehicle
frame** (longitudinal / lateral / vertical, and true yaw rate).

Method (no magnetometer, fixed-mount assumption):
1. **Gyro bias** — mean rotation rate while stationary (should be ~0) → subtract.
2. **Up axis** — gravity direction from the accelerometer at rest.
3. **Forward axis** — the horizontal direction whose acceleration best matches the
   GPS speed changes (braking/accelerating happens along travel).
4. Build the rotation, transform accel + gyro, and **validate** yaw against the
   GPS heading-rate and longitudinal accel against GPS acceleration.""")

code("""import numpy as np, pandas as pd, matplotlib.pyplot as plt
TRIP = "%s"
df = pd.read_csv(f"data/trip_{TRIP}.csv").sort_values("seq").reset_index(drop=True)
try:
    labels = pd.read_csv(f"data/trip_{TRIP}_labels.csv")
except FileNotFoundError:
    labels = pd.DataFrame(columns=["t_ms","type","source","direction","confirmed"])
print(f"{len(df):,} samples, {len(labels)} labels")

t = df["t_ms"].to_numpy(float) / 1000.0                 # seconds
A = df[["accel_x","accel_y","accel_z"]].to_numpy(float) # m/s^2, phone frame
Gr = df[["gyro_alpha","gyro_beta","gyro_gamma"]].to_numpy(float)  # deg/s, phone frame
spd = df["speed_kmh"].to_numpy(float) / 3.6             # m/s
ok = np.isfinite(A).all(1) & np.isfinite(Gr).all(1)
print("rows with full accel+gyro:", int(ok.sum()))
assert ok.sum() > 1000, "this drive lacks motion data"
""" % TRIP)

md("""## 1. Gyro bias
Parked, the gyro should read ~0 on every axis; any constant is bias. Use the
stationary samples (speed ≈ 0), falling back to the slowest 10% if the drive has
little idle time.""")
code("""stat = ok & (spd < 0.5)
if stat.sum() < 100:
    thr = np.nanpercentile(spd[ok], 10)
    stat = ok & (spd <= thr)
bias = Gr[stat].mean(0)
Gc = Gr - bias            # bias-corrected gyro
print("stationary samples:", int(stat.sum()))
print("gyro bias (deg/s):  alpha=%.3f  beta=%.3f  gamma=%.3f" % tuple(bias))
""")

md("""## 2. Up axis (gravity) and mount tilt
`accelerationIncludingGravity` at rest is the reaction to gravity → points **up**.
Its direction in the phone frame tells us how the mount is pitched/rolled.""")
code("""up = A[stat].mean(0)
up = up / np.linalg.norm(up)
# phone is "flat" when up ~ [0,0,1]; tilt = angle between up and phone z
tilt = np.degrees(np.arccos(np.clip(abs(up[2]), -1, 1)))
print("up (phone frame): [%.3f %.3f %.3f]" % tuple(up))
print("mount tilt from flat: %.1f deg" % tilt)
""")

md("""## 3. Forward axis
Remove gravity → linear acceleration. Its **horizontal** part, during speed
changes, points along the direction of travel. So we find the horizontal unit
vector `f` whose projection best matches the GPS-derived longitudinal accel
`dv/dt` (least squares). The fitted magnitude ~1 is a sanity check that the accel
scale is consistent.""")
code("""grav = up * 9.81
lin = A - grav                                  # linear accel, phone frame
horiz = lin - (lin @ up)[:, None] * up          # drop vertical component
# a horizontal orthonormal basis (e1, e2) perpendicular to up
seed = np.array([1.0, 0, 0]) if abs(up[0]) < 0.9 else np.array([0, 1.0, 0])
e1 = seed - (seed @ up) * up; e1 /= np.linalg.norm(e1)
e2 = np.cross(up, e1)
H = np.c_[horiz @ e1, horiz @ e2]               # horizontal accel in (e1,e2)
a_gps = np.gradient(spd, t)                      # m/s^2 from GPS speed
fit = ok & (spd > 2) & np.isfinite(a_gps) & (np.abs(a_gps) < 4)
coef, *_ = np.linalg.lstsq(H[fit], a_gps[fit], rcond=None)
fwd = coef[0] * e1 + coef[1] * e2
scale = np.linalg.norm(coef)
fwd = fwd / np.linalg.norm(fwd)
pred = H @ coef
corr = np.corrcoef(pred[fit], a_gps[fit])[0, 1]
print("forward (phone frame): [%.3f %.3f %.3f]" % tuple(fwd))
print("fit: accel-scale=%.2f (want ~1), corr(pred, GPS accel)=%.2f, n=%d" % (scale, corr, int(fit.sum())))
""")

md("""## 4. Build the vehicle frame and transform the drive
`x`=forward, `z`=up, `y`=left (z×x), re-orthonormalized. Columns of `R` are the
vehicle axes expressed in phone coordinates, so `v_vehicle = v_phone @ R` gives
`[longitudinal, lateral, vertical]`. The same rotation turns the gyro vector into
roll/pitch/**yaw** rates.""")
code("""x = fwd.copy(); z = up.copy()
y = np.cross(z, x); y /= np.linalg.norm(y)
x = np.cross(y, z)                 # ensure exact orthonormality
R = np.c_[x, y, z]                 # phone->vehicle (columns are vehicle axes in phone coords)

A_veh   = A   @ R                  # [long, lat, vert] incl gravity
lin_veh = lin @ R                  # linear accel [long, lat, vert]
G_veh   = Gc  @ R                  # rotation rate [roll, pitch, yaw] deg/s

yaw_rate = G_veh[:, 2]             # about vertical = heading change rate
lon_acc  = lin_veh[:, 0]           # + = accelerating, - = braking
lat_acc  = lin_veh[:, 1]           # + = one side, - = other (cornering)
print("rotation R (phone->vehicle):\\n", np.round(R, 3))
""")

md("""## 5. Validate against GPS
Independent checks that the frame is right:
- **Yaw rate** (gyro, about up) should track the **GPS heading-rate** through turns.
- **Longitudinal accel** should track **GPS dv/dt**.
Sign conventions can flip; we align sign by correlation for the comparison.""")
code("""# GPS heading from the local velocity vector, then its rate
latr = np.radians(df["lat"].to_numpy(float))
dN = np.gradient(df["lat"].to_numpy(float)) * 111320.0
dE = np.gradient(df["lng"].to_numpy(float)) * 111320.0 * np.cos(latr)
heading = np.unwrap(np.arctan2(dE, dN))          # radians
head_rate = np.degrees(np.gradient(heading, t))  # deg/s
mov = ok & (spd > 3) & np.isfinite(head_rate) & (np.abs(head_rate) < 60)

s_yaw = np.sign(np.corrcoef(yaw_rate[mov], head_rate[mov])[0, 1]) or 1.0
print("corr(yaw_rate, GPS heading-rate) = %.2f  (n=%d)" % (
      np.corrcoef(s_yaw*yaw_rate[mov], head_rate[mov])[0, 1], int(mov.sum())))
print("corr(longitudinal accel, GPS dv/dt) = %.2f" % (
      np.corrcoef(lon_acc[fit], a_gps[fit])[0, 1]))
""")

code("""fig, ax = plt.subplots(3, 1, figsize=(12, 9), sharex=True)
ax[0].plot(t, s_yaw*yaw_rate, lw=0.6, label="gyro yaw rate (calibrated)")
ax[0].plot(t, head_rate, lw=0.8, alpha=0.7, label="GPS heading rate")
ax[0].set_ylim(-60, 60); ax[0].set_ylabel("deg/s"); ax[0].legend(loc="upper right")
ax[0].set_title("Yaw: calibrated gyro vs GPS heading-rate")
# overlay confirmed turns
for _, L in labels[(labels.type=="turn") & (labels.confirmed==True)].iterrows():
    ax[0].axvline(L.t_ms/1000.0, color="g", alpha=0.25)

ax[1].plot(t, lon_acc, lw=0.6, label="longitudinal accel")
ax[1].plot(t, a_gps, lw=0.8, alpha=0.7, label="GPS dv/dt")
ax[1].set_ylim(-5, 5); ax[1].set_ylabel("m/s^2"); ax[1].legend(loc="upper right")
ax[1].set_title("Longitudinal: calibrated accel vs GPS acceleration")

ax[2].plot(t, lat_acc, lw=0.6, color="purple", label="lateral accel")
ax[2].set_ylim(-6, 6); ax[2].set_ylabel("m/s^2"); ax[2].set_xlabel("time (s)"); ax[2].legend(loc="upper right")
for _, L in labels[(labels.type=="lane_change") & (labels.confirmed==True)].iterrows():
    ax[2].axvline(L.t_ms/1000.0, color="b", alpha=0.3)
ax[2].set_title("Lateral accel (blue = confirmed lane changes)")
plt.tight_layout(); plt.show()
""")

md("""## Notes
- **Fixed-mount assumption:** we use one constant gravity/forward estimate for the
  whole drive. If the phone shifts mid-drive, redo per-segment, or replace the
  constant gravity with a slow EMA (and re-estimate forward on windows).
- **Yaw rate here is what the maneuver detector wants.** The live detector already
  projects rotationRate onto gravity (≈ this yaw); the full rotation additionally
  gives clean longitudinal/lateral accel for braking/cornering.
- **To fold into the app:** estimate `R` online (gravity EMA for up; accumulate the
  forward fit over the first ~minute of driving), then feed `G_veh`/`lin_veh` to the
  detectors instead of the raw/gravity-projected values.
- If `corr(yaw, GPS heading-rate)` is high (~0.8+), the calibration is good.""")

nb = {
    "cells": cells,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python", "version": "3.11"},
    },
    "nbformat": 4, "nbformat_minor": 5,
}
with open(HERE + "gyro_calibration.ipynb", "w") as f:
    json.dump(nb, f, indent=1)
print("wrote gyro_calibration.ipynb")
