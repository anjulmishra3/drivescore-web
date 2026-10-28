"use client";

import type { ScoreBreakdown, TripSample } from "@/types/db";

// Durable, on-device sample buffer backed by IndexedDB. Every captured sample is
// written here FIRST, then streamed to the server; a background flusher marks
// rows synced once the server confirms. This is what makes "don't lose a data
// point" real across network drops, tab reloads, and brief crashes.
//
// The `samples` store uses out-of-line auto-increment keys so we can update a
// row's `synced` flag by primary key after upload. An index on [tripId, synced]
// lets us pull the unsynced backlog cheaply; [tripId, seq] gives ordered reads
// for end-of-trip scoring. The `trips` store holds in-progress trip metadata so
// a reload can recover and finish an interrupted recording.

export interface StoredSample extends TripSample {
  tripId: string;
  seq: number;
  synced: 0 | 1;
}

export interface TripMeta {
  tripId: string;
  source: string;
  startedAt: string;
  lastSeq: number;
  // "recording": a live/interrupted capture (resumable).
  // "pending_finalize": the drive has ended; the data is saved locally and only
  //   the upload + server finalize remain (completes in the background / on next
  //   open). "finishing" is the legacy equivalent kept for backward compat.
  status: "recording" | "finishing" | "pending_finalize" | "completed";
  score?: ScoreBreakdown; // client-computed score, stored so a background finalize can POST it
  endedAt?: string;
}

// A maneuver label, stored on-device FIRST (same durability contract as samples).
// `clientId` is generated locally so a label survives even if its create request
// never reaches the server; `serverId` is filled once the insert is confirmed.
// `synced` is 0 whenever local state differs from the server (new, edited, or
// pending delete) and a background flusher reconciles it with retry.
export interface StoredLabel {
  clientId: string;
  tripId: string;
  t_ms: number;
  source: "auto" | "manual";
  type: string | null;
  direction: "L" | "R" | null;
  confirmed: boolean | null;
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  meta: Record<string, unknown> | null;
  deleted: 0 | 1;
  serverId: string | null;
  synced: 0 | 1;
}

const DB_NAME = "drivescore";
const DB_VERSION = 2;

let dbp: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable (use a normal, non-private browser window)."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("samples")) {
        const s = db.createObjectStore("samples", { autoIncrement: true });
        s.createIndex("by_trip_sync", ["tripId", "synced"]);
        s.createIndex("by_trip_seq", ["tripId", "seq"]);
      }
      if (!db.objectStoreNames.contains("trips")) {
        db.createObjectStore("trips", { keyPath: "tripId" });
      }
      if (!db.objectStoreNames.contains("labels")) {
        const l = db.createObjectStore("labels", { keyPath: "clientId" });
        l.createIndex("by_trip_sync", ["tripId", "synced"]);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqDone<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// --- samples ---

export async function putSamples(rows: StoredSample[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("samples", "readwrite");
    const store = t.objectStore("samples");
    for (const r of rows) store.add(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export interface UnsyncedBatch {
  keys: IDBValidKey[];
  values: StoredSample[];
}

export async function getUnsynced(tripId: string, limit: number): Promise<UnsyncedBatch> {
  const db = await openDB();
  const store = tx(db, "samples", "readonly");
  const index = store.index("by_trip_sync");
  const range = IDBKeyRange.only([tripId, 0]);
  const [values, keys] = await Promise.all([
    reqDone(index.getAll(range, limit)) as Promise<StoredSample[]>,
    reqDone(index.getAllKeys(range, limit)) as Promise<IDBValidKey[]>,
  ]);
  return { keys, values };
}

export async function markSynced(keys: IDBValidKey[], values: StoredSample[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("samples", "readwrite");
    const store = t.objectStore("samples");
    keys.forEach((k, i) => store.put({ ...values[i], synced: 1 }, k));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function countUnsynced(tripId: string): Promise<number> {
  const db = await openDB();
  const index = tx(db, "samples", "readonly").index("by_trip_sync");
  return reqDone(index.count(IDBKeyRange.only([tripId, 0])));
}

export async function countAll(tripId: string): Promise<number> {
  const db = await openDB();
  const index = tx(db, "samples", "readonly").index("by_trip_seq");
  return reqDone(
    index.count(IDBKeyRange.bound([tripId, -Infinity], [tripId, Infinity]))
  );
}

// All samples for a trip, ordered by seq — used for end-of-trip scoring.
export async function getAllForScoring(tripId: string): Promise<StoredSample[]> {
  const db = await openDB();
  const index = tx(db, "samples", "readonly").index("by_trip_seq");
  const range = IDBKeyRange.bound([tripId, -Infinity], [tripId, Infinity]);
  return reqDone(index.getAll(range)) as Promise<StoredSample[]>;
}

// --- labels ---

// Insert or overwrite a label (keyed by clientId).
export async function putLabelLocal(rec: StoredLabel): Promise<void> {
  const db = await openDB();
  await reqDone(tx(db, "labels", "readwrite").put(rec));
}

export async function getLabelLocal(clientId: string): Promise<StoredLabel | undefined> {
  const db = await openDB();
  return reqDone(tx(db, "labels", "readonly").get(clientId)) as Promise<StoredLabel | undefined>;
}

// All labels for a trip that still need to be reconciled with the server.
export async function getPendingLabels(tripId: string): Promise<StoredLabel[]> {
  const db = await openDB();
  const index = tx(db, "labels", "readonly").index("by_trip_sync");
  return reqDone(index.getAll(IDBKeyRange.only([tripId, 0]))) as Promise<StoredLabel[]>;
}

export async function removeLabelLocal(clientId: string): Promise<void> {
  const db = await openDB();
  await reqDone(tx(db, "labels", "readwrite").delete(clientId));
}

export async function countPendingLabels(tripId: string): Promise<number> {
  const db = await openDB();
  const index = tx(db, "labels", "readonly").index("by_trip_sync");
  return reqDone(index.count(IDBKeyRange.only([tripId, 0])));
}

// --- trip meta ---

export async function saveMeta(meta: TripMeta): Promise<void> {
  const db = await openDB();
  await reqDone(tx(db, "trips", "readwrite").put(meta));
}

export async function getMeta(tripId: string): Promise<TripMeta | undefined> {
  const db = await openDB();
  return reqDone(tx(db, "trips", "readonly").get(tripId)) as Promise<TripMeta | undefined>;
}

// An interrupted *recording* that can be resumed (distinct from a drive that has
// already ended and is only waiting to upload — see getPendingFinalizeTrips).
export async function getActiveTrip(): Promise<TripMeta | undefined> {
  const db = await openDB();
  const all = (await reqDone(tx(db, "trips", "readonly").getAll())) as TripMeta[];
  return all.find((m) => m.status === "recording");
}

// Drives that have ended locally but still need their upload + server finalize.
export async function getPendingFinalizeTrips(): Promise<TripMeta[]> {
  const db = await openDB();
  const all = (await reqDone(tx(db, "trips", "readonly").getAll())) as TripMeta[];
  return all.filter((m) => m.status === "pending_finalize" || m.status === "finishing");
}

export async function deleteTrip(tripId: string): Promise<void> {
  const db = await openDB();
  // remove meta; leave samples (already safe on the server) — they'll be cleaned
  // opportunistically by clearing the DB if storage pressure ever matters.
  await reqDone(tx(db, "trips", "readwrite").delete(tripId));
}
