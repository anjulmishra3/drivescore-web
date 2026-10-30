"use client";

// On-device road map for live map-matching. We cache the drivable road
// centerlines for a region (fetched once from /api/map/roads, ~1 MB for a city)
// in IndexedDB, build an in-memory grid index, and expose a nearest-road /
// signed-lateral-offset lookup that runs per GPS fix with no network. This is
// what lets lane-change detection (the position-offset half) run live, offline.

export interface Road {
  id: string; ref: string | null; name: string | null; fclass: string;
  oneway: string | null; limit_kmh: number | null;
  coords: [number, number][]; // [lng, lat] pairs
}
export interface BBox { minLng: number; minLat: number; maxLng: number; maxLat: number }

export interface RoadMatch {
  offset_m: number;   // signed perpendicular distance (right of travel +, left −)
  dist_m: number;     // unsigned distance to the centerline
  ref: string | null; name: string | null; fclass: string;
}

const DB_NAME = "drivescore-map";
const DB_VERSION = 1;
const CELL = 0.005; // ~0.5 km grid cell

let dbp: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("regions")) db.createObjectStore("regions", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function reqDone<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function key(b: BBox) {
  return [b.minLng, b.minLat, b.maxLng, b.maxLat].map((n) => n.toFixed(3)).join(",");
}

async function cacheGet(k: string): Promise<{ key: string; roads: Road[]; fetchedAt: number } | undefined> {
  try {
    const db = await openDB();
    return (await reqDone(db.transaction("regions", "readonly").objectStore("regions").get(k))) as never;
  } catch { return undefined; }
}
async function cachePut(k: string, roads: Road[]): Promise<void> {
  try {
    const db = await openDB();
    await reqDone(db.transaction("regions", "readwrite").objectStore("regions").put({ key: k, roads, fetchedAt: Date.now() }));
  } catch { /* best effort */ }
}

// --- in-memory spatial index over the currently-loaded roads ---
let grid: Map<string, Road[]> | null = null;
let loadedRoads: Road[] = [];

function cellKey(lat: number, lng: number) {
  return `${Math.floor(lat / CELL)}:${Math.floor(lng / CELL)}`;
}
function buildIndex(roads: Road[]) {
  const g = new Map<string, Road[]>();
  for (const r of roads) {
    if (!r.coords || r.coords.length < 2) continue; // skip degenerate/empty geometry
    const seen = new Set<string>();
    for (const [lng, lat] of r.coords) {
      const k = cellKey(lat, lng);
      if (seen.has(k)) continue;
      seen.add(k);
      (g.get(k) ?? g.set(k, []).get(k)!).push(r);
    }
  }
  grid = g; loadedRoads = roads;
}

export function isLoaded() { return grid != null && loadedRoads.length > 0; }
export function loadedRoadCount() { return loadedRoads.length; }

// A box of the given radius (km) centred on a point. Latitude degrees are ~111 km
// everywhere; longitude degrees shrink with latitude (cos), so convert per-axis.
export function bboxAround(lat: number, lng: number, radiusKm = 10): BBox {
  const dLat = radiusKm / 111.0;
  const dLng = radiusKm / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLng: lng - dLng, maxLng: lng + dLng };
}

// Load the most recently cached region into the in-memory index (no network),
// so a cached area is ready for live matching right after the page opens.
export async function loadAnyCached(): Promise<number> {
  try {
    const db = await openDB();
    const all = (await reqDone(db.transaction("regions", "readonly").objectStore("regions").getAll())) as
      { key: string; roads: Road[]; fetchedAt: number }[];
    if (!all.length) return 0;
    all.sort((a, b) => b.fetchedAt - a.fetchedAt);
    buildIndex(all[0].roads);
    return loadedRoads.length;
  } catch { return 0; }
}

// Load a region into memory, fetching + caching it if we don't have it yet.
export async function ensureRegion(bbox: BBox): Promise<number> {
  const k = key(bbox);
  let rec = await cacheGet(k);
  if (!rec) {
    const qs = new URLSearchParams({
      minLng: String(bbox.minLng), minLat: String(bbox.minLat),
      maxLng: String(bbox.maxLng), maxLat: String(bbox.maxLat),
    });
    const res = await fetch(`/api/map/roads?${qs}`);
    if (!res.ok) throw new Error(await res.text());
    const { roads } = (await res.json()) as { roads: Road[] };
    await cachePut(k, roads);
    rec = { key: k, roads, fetchedAt: Date.now() };
  }
  buildIndex(rec.roads);
  return loadedRoads.length;
}

// equirectangular local meters around a reference latitude
function toXY(lat: number, lng: number, lat0: number): [number, number] {
  const mPerDegLat = 110540, mPerDegLng = 111320 * Math.cos((lat0 * Math.PI) / 180);
  return [lng * mPerDegLng, lat * mPerDegLat];
}

// Nearest road + signed lateral offset for a GPS fix. Returns null if nothing is
// loaded or no road is within ~40 m. Offset sign: + is right of travel direction.
export function nearestRoad(lat: number, lng: number): RoadMatch | null {
  if (!grid) return null;
  const candidates = new Set<Road>();
  const ci = Math.floor(lat / CELL), cj = Math.floor(lng / CELL);
  for (let di = -1; di <= 1; di++)
    for (let dj = -1; dj <= 1; dj++)
      for (const r of grid.get(`${ci + di}:${cj + dj}`) ?? []) candidates.add(r);
  if (candidates.size === 0) return null;

  const [px, py] = toXY(lat, lng, lat);
  let best: RoadMatch | null = null, bestD = Infinity;
  for (const r of candidates) {
    if (!r.coords) continue;
    for (let s = 0; s + 1 < r.coords.length; s++) {
      const [ax, ay] = toXY(r.coords[s][1], r.coords[s][0], lat);
      const [bx, by] = toXY(r.coords[s + 1][1], r.coords[s + 1][0], lat);
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      if (len2 === 0) continue;
      let t = ((px - ax) * vx + (py - ay) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * vx, cy = ay + t * vy;
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) {
        bestD = d;
        const cross = vx * (py - ay) - vy * (px - ax); // >0 => point is left of travel
        best = { offset_m: cross >= 0 ? -d : d, dist_m: d, ref: r.ref, name: r.name, fclass: r.fclass };
      }
    }
  }
  if (!best || bestD > 40) return null;
  return best;
}
