import os, geopandas as gpd, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
OUT = HERE + "batches/"
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(OUT + f)

MAJOR = ["motorway", "trunk", "primary", "secondary", "tertiary",
         "motorway_link", "trunk_link", "primary_link", "secondary_link",
         "tertiary_link", "unclassified"]
DEF = {"motorway": 100, "trunk": 80, "primary": 60, "secondary": 60, "tertiary": 50,
       "residential": 40, "unclassified": 50, "service": 20, "living_street": 20,
       "trunk_link": 60, "primary_link": 50, "secondary_link": 50, "tertiary_link": 40,
       "motorway_link": 60}

def q(v):
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

# ---------- roads ----------
r = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_roads_free")
r = r[r.fclass.isin(MAJOR)].reset_index(drop=True)
r["geom_s"] = r.geometry.simplify(0.00005)  # ~5 m

cols = "osm_id,fclass,name,ref,oneway,maxspeed,limit_kmh,bridge,tunnel,geom"
MAX_BYTES = 260_000
batch, size, bi = [], 0, 0

def flush():
    global batch, size, bi
    if not batch:
        return
    sql = f"insert into public.map_roads ({cols}) values\n" + ",\n".join(batch) + ";\n"
    open(OUT + f"roads_{bi:03d}.sql", "w").write(sql)
    bi += 1
    batch, size = [], 0

for _, row in r.iterrows():
    ms = int(row.maxspeed) if row.maxspeed and row.maxspeed > 0 else 0
    lim = ms if ms > 0 else DEF.get(row.fclass, 50)
    vals = (f"({q(row.osm_id)},{q(row.fclass)},{q(row['name'])},{q(row.ref)},{q(row.oneway)},"
            f"{ms},{lim},{q(row.bridge)},{q(row.tunnel)},"
            f"st_geomfromtext('{row.geom_s.wkt}',4326))")
    if size + len(vals) > MAX_BYTES and batch:
        flush()
    batch.append(vals); size += len(vals)
flush()

# ---------- points ----------
tr = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_traffic_free")[["osm_id", "fclass", "name", "geometry"]]
tp = gpd.read_file(HERE + "goa.gpkg", layer="gis_osm_transport_free")[["osm_id", "fclass", "name", "geometry"]]
pts = pd.concat([tr, tp], ignore_index=True)
pvals = [f"({q(p.osm_id)},{q(p.fclass)},{q(p['name'])},st_geomfromtext('{p.geometry.wkt}',4326))"
         for _, p in pts.iterrows()]
psql = "insert into public.map_points (osm_id,fclass,name,geom) values\n" + ",\n".join(pvals) + ";\n"
open(OUT + "points_000.sql", "w").write(psql)

files = sorted(os.listdir(OUT))
print(f"roads: {len(r)} | POIs: {len(pts)}")
print(f"generated {len(files)} batch files:")
for f in files:
    print(f"  {f}  {os.path.getsize(OUT+f)//1024} KB")
