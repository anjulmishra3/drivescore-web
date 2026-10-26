import os, time
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
# Source: the full Geofabrik OSM export (download separately; override via env SRC_GPKG).
SRC = os.environ.get("SRC_GPKG",
    os.path.expanduser("~/Downloads/western-zone-261005-free.gpkg/western-zone.gpkg"))
OUT = os.path.join(HERE, "goa.gpkg")
BBOX = (73.6, 14.8, 74.4, 15.85)  # (minx, miny, maxx, maxy) — Goa + margin

LAYERS = [
    "gis_osm_roads_free",      # the road network (fclass, oneway, maxspeed, ref)
    "gis_osm_traffic_free",    # signals, crossings, railway crossings, cameras
    "gis_osm_transport_free",  # bus stops, stations
    "gis_osm_places_free",     # settlements (urban context)
    "gis_osm_pois_free",       # fuel stations etc. (legitimate-stop context)
]

os.makedirs(os.path.dirname(OUT), exist_ok=True)
if os.path.exists(OUT):
    os.remove(OUT)

for lyr in LAYERS:
    t = time.time()
    gdf = gpd.read_file(SRC, layer=lyr, bbox=BBOX)
    gdf.to_file(OUT, layer=lyr, driver="GPKG")
    print(f"{lyr:28s} {len(gdf):>7d} features  {time.time()-t:5.0f}s", flush=True)

sz = os.path.getsize(OUT) / 1e6
print(f"\nwrote {OUT}  ({sz:.1f} MB)")
