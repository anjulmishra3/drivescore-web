#!/usr/bin/env python3
"""
Populate map_roads.lanes / lanes_fwd / lanes_bwd from OpenStreetMap.

The Geofabrik "free" shapefile we loaded has no lane count, so lane-change
detection had to fall back to the `oneway` proxy (overfits: two-way multi-lane
roads exist). This fetches the real `lanes`, `lanes:forward`, `lanes:backward`
tags from Overpass for the Goa bbox and matches them onto map_roads by osm_id.

Run it like load_map.py — it reads the DB connection string from env DB_URL or
the local file map/.db_url (Session-pooler/Direct URI). The app itself never
uses this connection; only the anon key.

    python3 map/fetch_lanes.py

OSM lane coverage is partial, so expect many roads to stay NULL (the detector
falls back to the oneway heuristic for those). Re-run any time to refresh.
"""
import os, re, json, urllib.request
from sqlalchemy import create_engine, text

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
# Goa clip bbox (same as clip_goa.py): lng 73.6–74.4, lat 14.8–15.85
BBOX = (14.8, 73.6, 15.85, 74.4)  # Overpass order: south, west, north, east
OVERPASS = "https://overpass-api.de/api/interpreter"


def db_url():
    url = os.environ.get("DB_URL")
    if not url:
        with open(HERE + ".db_url") as f:
            url = f.read().strip()
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


def as_lanes(v):
    """OSM lane values can be '2', '1;2', '2.0' — take the first integer."""
    if v is None:
        return None
    m = re.search(r"\d+", str(v))
    return int(m.group()) if m else None


def fetch():
    s, w, n, e = BBOX
    q = f"""
    [out:json][timeout:300];
    (
      way["highway"]["lanes"]({s},{w},{n},{e});
      way["highway"]["lanes:forward"]({s},{w},{n},{e});
      way["highway"]["lanes:backward"]({s},{w},{n},{e});
    );
    out tags;
    """
    req = urllib.request.Request(OVERPASS, data=q.encode(), headers={"Content-Type": "text/plain"})
    print("Querying Overpass (this can take a minute)…")
    with urllib.request.urlopen(req, timeout=360) as r:
        data = json.load(r)
    rows = []
    for el in data.get("elements", []):
        if el.get("type") != "way":
            continue
        t = el.get("tags", {})
        lanes = as_lanes(t.get("lanes"))
        lf = as_lanes(t.get("lanes:forward"))
        lb = as_lanes(t.get("lanes:backward"))
        if lanes is None and lf is None and lb is None:
            continue
        rows.append({"osm_id": str(el["id"]), "lanes": lanes, "lf": lf, "lb": lb})
    print(f"Overpass returned {len(rows)} ways with lane tags.")
    return rows


def main():
    rows = fetch()
    eng = create_engine(db_url())
    with eng.begin() as c:
        c.execute(text("create temp table lane_src(osm_id text primary key, lanes int, lf int, lb int) on commit drop"))
        # insert in batches
        B = 1000
        for i in range(0, len(rows), B):
            chunk = rows[i:i + B]
            c.execute(
                text("insert into lane_src(osm_id,lanes,lf,lb) values (:osm_id,:lanes,:lf,:lb) "
                     "on conflict (osm_id) do nothing"),
                chunk,
            )
        res = c.execute(text(
            "update public.map_roads m set lanes = s.lanes, lanes_fwd = s.lf, lanes_bwd = s.lb "
            "from lane_src s where m.osm_id = s.osm_id"
        ))
        print(f"Updated {res.rowcount} map_roads rows with lane data.")
        cov = c.execute(text(
            "select count(*) total, count(lanes) with_lanes, "
            "count(*) filter (where fclass in "
            "('motorway','trunk','primary','secondary','motorway_link','trunk_link','primary_link')) as major_total, "
            "count(lanes) filter (where fclass in "
            "('motorway','trunk','primary','secondary','motorway_link','trunk_link','primary_link')) as major_with_lanes "
            "from public.map_roads"
        )).one()
        print(f"Coverage: {cov.with_lanes}/{cov.total} roads have lanes "
              f"({cov.major_with_lanes}/{cov.major_total} of major roads).")


if __name__ == "__main__":
    main()
