import os, math, numpy as np, geopandas as gpd
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from shapely.geometry import Point

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"

# --- load trip track (t_ms, lat, lng, speed) ---
T = np.loadtxt(HERE + "goa_trip.csv", delimiter=",")
tms, lat, lng, spd = T[:, 0], T[:, 1], T[:, 2], T[:, 3]
n = len(lat)

def bearing(la1, lo1, la2, lo2):
    dl = math.radians(lo2 - lo1)
    y = math.sin(dl) * math.cos(math.radians(la2))
    x = (math.cos(math.radians(la1)) * math.sin(math.radians(la2))
         - math.sin(math.radians(la1)) * math.cos(math.radians(la2)) * math.cos(dl))
    return (math.degrees(math.atan2(y, x)) + 360) % 360

def angdiff(a, b):
    return abs((a - b + 180) % 360 - 180)

# travel heading at each point (prev -> next)
head = np.full(n, np.nan)
for i in range(n):
    a, b = max(0, i - 1), min(n - 1, i + 1)
    if a != b:
        head[i] = bearing(lat[a], lng[a], lat[b], lng[b])

# --- load Goa roads, keep driveable ---
roads = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_roads_free")
roads = roads[~roads.fclass.isin(
    ["footway", "path", "steps", "cycleway", "pedestrian", "track",
     "bridleway", "track_grade1", "track_grade2", "track_grade3", "track_grade4", "track_grade5"]
)].reset_index(drop=True)
sindex = roads.sindex
geoms = roads.geometry.values
fcl = roads.fclass.values
oneway = roads.oneway.values
maxspd = roads.maxspeed.values

# India default limits by road class (km/h) — used where maxspeed is absent
DEF = {"motorway": 100, "trunk": 80, "primary": 60, "secondary": 60, "tertiary": 50,
       "residential": 40, "unclassified": 50, "service": 20, "living_street": 20,
       "trunk_link": 60, "primary_link": 50, "secondary_link": 50, "tertiary_link": 40,
       "motorway_link": 60, "busway": 40}

def meters(dlat, dlng, at):
    return math.hypot(dlat * 111320, dlng * 111320 * math.cos(math.radians(at)))

def seg_bearing(line, d):
    p1 = line.interpolate(max(0, d - 0.00015))
    p2 = line.interpolate(min(line.length, d + 0.00015))
    return bearing(p1.y, p1.x, p2.y, p2.x)

m_fc, m_dist, m_ow, m_limit, m_wrong = [], [], [], [], []
for i in range(n):
    pt = Point(lng[i], lat[i])
    cand = list(sindex.query(pt.buffer(0.0006)))  # ~65 m search
    best, bestcost = None, 1e9
    for ci in cand:
        line = geoms[ci]
        d = line.project(pt)
        near = line.interpolate(d)
        dm = meters(near.y - lat[i], near.x - lng[i], lat[i])
        if dm > 45:
            continue
        rb = seg_bearing(line, d)
        ow = oneway[ci]
        if not math.isnan(head[i]):
            diff = angdiff(head[i], rb)
            hcost = diff if ow == "F" else min(diff, 180 - diff)
        else:
            hcost = 0
        cost = dm + hcost * 0.6
        if cost < bestcost:
            bestcost, best = cost, (ci, dm, rb, ow)
    if best is None:
        m_fc.append(None); m_dist.append(np.nan); m_ow.append(None); m_limit.append(np.nan); m_wrong.append(0)
        continue
    ci, dm, rb, ow = best
    m_fc.append(fcl[ci]); m_dist.append(dm); m_ow.append(ow)
    ms = maxspd[ci]
    m_limit.append(ms if ms and ms > 0 else DEF.get(fcl[ci], 50))
    w = 0
    if ow == "F" and not math.isnan(head[i]) and angdiff(head[i], rb) > 120:
        w = 1
    m_wrong.append(w)

m_dist = np.array(m_dist, float)
m_wrong = np.array(m_wrong)
m_limit = np.array(m_limit, float)

matched = ~np.isnan(m_dist)
print("=== MAP-MATCH QUALITY ===")
print(f"points: {n} | matched: {matched.sum()} ({100*matched.mean():.0f}%)")
print(f"match distance: median {np.nanmedian(m_dist):.1f} m | 90th pct {np.nanpercentile(m_dist,90):.1f} m")
from collections import Counter
print("road classes on route:", dict(Counter([f for f in m_fc if f]).most_common(8)))
print(f"points on one-way segments: {sum(1 for o in m_ow if o=='F')}")

print("\n=== WRONG-SIDE ===")
print(f"candidates: {int(m_wrong.sum())} points")
for i in np.where(m_wrong == 1)[0]:
    print(f"  t={tms[i]/1000:5.0f}s  ({lat[i]:.5f},{lng[i]:.5f})  {m_fc[i]}  {spd[i]:.0f} km/h")

print("\n=== SPEEDING vs map limits (default-by-class) ===")
over = matched & (spd > m_limit * 1.1)
print(f"points over limit+10%: {int(over.sum())} ({100*over.mean():.0f}% of matched)")

# --- plot ---
fig, ax = plt.subplots(figsize=(8, 9))
# faint roads in view
minx, maxx = lng.min() - .01, lng.max() + .01
miny, maxy = lat.min() - .01, lat.max() + .01
view = roads.cx[minx:maxx, miny:maxy]
view.plot(ax=ax, color="#e2e8f0", linewidth=0.6, zorder=1)
ok = matched & (m_wrong == 0)
ax.scatter(lng[ok], lat[ok], s=10, c="#1f66f5", label="matched", zorder=3)
if (~matched).any():
    ax.scatter(lng[~matched], lat[~matched], s=10, c="#cbd5e1", label="unmatched", zorder=2)
if m_wrong.sum():
    ax.scatter(lng[m_wrong == 1], lat[m_wrong == 1], s=60, c="#dc2626", marker="X", label="wrong-side?", zorder=5)
ax.set_aspect("equal"); ax.set_title("Goa trip map-matched to OSM roads"); ax.legend(fontsize=8)
ax.set_xlabel("lng"); ax.set_ylabel("lat")
plt.tight_layout()
out = HERE + "map_match_prototype.png"
plt.savefig(out, dpi=130)
print("\nsaved:", out)
