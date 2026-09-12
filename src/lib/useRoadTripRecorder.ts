"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TripSample, TripSource } from "@/types/db";
import { scoreTrip } from "@/lib/scoring";
import {
  countAll,
  countUnsynced,
  deleteTrip,
  getActiveTrip,
  getAllForScoring,
  getUnsynced,
  markSynced,
  putSamples,
  saveMeta,
  type StoredSample,
} from "@/lib/sampleStore";

const IDB_FLUSH_MS = 1000; // memory -> IndexedDB
const NET_FLUSH_MS = 4000; // IndexedDB -> server
const UPLOAD_BATCH = 2000; // rows per network request

export interface RecorderStatus {
  state: "idle" | "recording" | "finishing" | "done" | "error";
  tripId: string | null;
  elapsed: number;
  captured: number; // points taken from sensors
  uploaded: number; // points confirmed saved to the cloud
  pending: number; // captured but not yet uploaded
  online: boolean;
  wakeLock: boolean;
  hz: number;
  error: string | null;
  recoverable: boolean; // an interrupted trip was found on load
  live: { speed_kmh: number | null; accel: number | null; gps: boolean; motion: boolean };
}

export function useRoadTripRecorder(hz = 25) {
  const [status, setStatus] = useState<RecorderStatus>({
    state: "idle", tripId: null, elapsed: 0, captured: 0, uploaded: 0, pending: 0,
    online: true, wakeLock: false, hz, error: null, recoverable: false,
    live: { speed_kmh: null, accel: null, gps: false, motion: false },
  });

  const tripIdRef = useRef<string | null>(null);
  const sourceRef = useRef<TripSource>("quick");
  const startMsRef = useRef(0);
  const seqRef = useRef(0);
  const uploadedRef = useRef(0);
  const latest = useRef<TripSample>({ t_ms: 0 });
  const memBuf = useRef<StoredSample[]>([]);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const flushing = useRef(false);

  const samplerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const netRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uiRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const geoWatch = useRef<number | null>(null);

  const patch = useCallback((p: Partial<RecorderStatus>) => setStatus((s) => ({ ...s, ...p })), []);

  // --- sensor listeners ---
  const onMotion = useCallback((e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (a) {
      latest.current = {
        ...latest.current,
        accel_x: a.x ?? null, accel_y: a.y ?? null, accel_z: a.z ?? null,
      };
    }
    const r = e.rotationRate;
    if (r) {
      latest.current = {
        ...latest.current,
        gyro_alpha: r.alpha ?? latest.current.gyro_alpha ?? null,
        gyro_beta: r.beta ?? latest.current.gyro_beta ?? null,
        gyro_gamma: r.gamma ?? latest.current.gyro_gamma ?? null,
      };
    }
  }, []);

  const onPosition = useCallback((pos: GeolocationPosition) => {
    latest.current = {
      ...latest.current,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      speed_kmh: pos.coords.speed != null ? Math.max(0, pos.coords.speed * 3.6) : latest.current.speed_kmh,
    };
  }, []);

  // --- network flush: IndexedDB -> server ---
  const flush = useCallback(async () => {
    const tripId = tripIdRef.current;
    if (!tripId || flushing.current || !navigator.onLine) return;
    flushing.current = true;
    try {
      // drain in batches until nothing is left unsynced
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { keys, values } = await getUnsynced(tripId, UPLOAD_BATCH);
        if (values.length === 0) break;
        const samples = values.map((v) => ({
          seq: v.seq, t_ms: v.t_ms, lat: v.lat, lng: v.lng, speed_kmh: v.speed_kmh,
          accel_x: v.accel_x, accel_y: v.accel_y, accel_z: v.accel_z,
          gyro_alpha: v.gyro_alpha, gyro_beta: v.gyro_beta, gyro_gamma: v.gyro_gamma,
        }));
        const res = await fetch(`/api/trips/${tripId}/samples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ samples }),
          keepalive: samples.length <= 500,
        });
        if (!res.ok) throw new Error(await res.text());
        await markSynced(keys, values);
        uploadedRef.current += values.length;
      }
      patch({ error: null });
    } catch (e) {
      // leave rows unsynced; next tick retries. Surface but don't stop recording.
      patch({ error: "Upload retrying… " + (e as Error).message });
    } finally {
      flushing.current = false;
    }
  }, [patch]);

  const stopTimers = useCallback(() => {
    [samplerRef, idbRef, netRef, uiRef].forEach((r) => {
      if (r.current) clearInterval(r.current);
      r.current = null;
    });
    if (geoWatch.current != null) navigator.geolocation.clearWatch(geoWatch.current);
    geoWatch.current = null;
    window.removeEventListener("devicemotion", onMotion);
  }, [onMotion]);

  const acquireWake = useCallback(async () => {
    try {
      wakeRef.current = (await navigator.wakeLock?.request("screen")) ?? null;
      if (wakeRef.current) {
        patch({ wakeLock: true });
        wakeRef.current.addEventListener?.("release", () => patch({ wakeLock: false }));
      }
    } catch {
      patch({ wakeLock: false });
    }
  }, [patch]);

  const beginLoops = useCallback(() => {
    const hzMs = Math.max(10, Math.round(1000 / hz));

    window.addEventListener("devicemotion", onMotion);
    geoWatch.current = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 15000,
    });

    samplerRef.current = setInterval(() => {
      const l = latest.current;
      seqRef.current += 1;
      memBuf.current.push({
        tripId: tripIdRef.current!, seq: seqRef.current, synced: 0,
        t_ms: Date.now() - startMsRef.current,
        lat: l.lat ?? null, lng: l.lng ?? null, speed_kmh: l.speed_kmh ?? null,
        accel_x: l.accel_x ?? null, accel_y: l.accel_y ?? null, accel_z: l.accel_z ?? null,
        gyro_alpha: l.gyro_alpha ?? null, gyro_beta: l.gyro_beta ?? null, gyro_gamma: l.gyro_gamma ?? null,
      });
    }, hzMs);

    idbRef.current = setInterval(async () => {
      if (memBuf.current.length === 0) return;
      const chunk = memBuf.current.splice(0, memBuf.current.length);
      try {
        await putSamples(chunk);
        await saveMeta({
          tripId: tripIdRef.current!, source: sourceRef.current,
          startedAt: new Date(startMsRef.current).toISOString(),
          lastSeq: seqRef.current, status: "recording",
        });
      } catch {
        // put back on failure so we don't lose them
        memBuf.current.unshift(...chunk);
      }
    }, IDB_FLUSH_MS);

    netRef.current = setInterval(flush, NET_FLUSH_MS);

    uiRef.current = setInterval(() => {
      const l = latest.current;
      patch({
        elapsed: Math.floor((Date.now() - startMsRef.current) / 1000),
        captured: seqRef.current,
        uploaded: uploadedRef.current,
        pending: Math.max(0, seqRef.current - uploadedRef.current),
        online: navigator.onLine,
        live: {
          speed_kmh: l.speed_kmh ?? null,
          accel: l.accel_x != null && l.accel_y != null && l.accel_z != null
            ? Math.sqrt(l.accel_x ** 2 + l.accel_y ** 2 + l.accel_z ** 2) : null,
          gps: l.lat != null, motion: l.accel_x != null,
        },
      });
    }, 500);
  }, [flush, hz, onMotion, onPosition, patch]);

  const requestMotionPerm = useCallback(async () => {
    const M = (window as any).DeviceMotionEvent;
    if (M && typeof M.requestPermission === "function") {
      try { await M.requestPermission(); } catch { /* denied */ }
    }
  }, []);

  const start = useCallback(async (source: TripSource = "quick") => {
    try {
      await requestMotionPerm();
      if (!("geolocation" in navigator)) throw new Error("No Geolocation API on this device.");

      const res = await fetch("/api/trips/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { trip } = await res.json();

      tripIdRef.current = trip.id;
      sourceRef.current = source;
      startMsRef.current = Date.now();
      seqRef.current = 0;
      uploadedRef.current = 0;
      memBuf.current = [];

      await saveMeta({
        tripId: trip.id, source, startedAt: new Date(startMsRef.current).toISOString(),
        lastSeq: 0, status: "recording",
      });
      await acquireWake();
      beginLoops();
      patch({ state: "recording", tripId: trip.id, error: null, recoverable: false });
    } catch (e) {
      patch({ state: "error", error: (e as Error).message });
    }
  }, [acquireWake, beginLoops, patch, requestMotionPerm]);

  const finish = useCallback(async () => {
    patch({ state: "finishing" });
    stopTimers();
    // move any remaining in-memory samples to IndexedDB
    if (memBuf.current.length) {
      try { await putSamples(memBuf.current.splice(0, memBuf.current.length)); } catch { /* keep */ }
    }
    const tripId = tripIdRef.current!;

    // push everything up, retrying while online
    for (let i = 0; i < 60; i++) {
      await flush();
      if ((await countUnsynced(tripId)) === 0) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    const remaining = await countUnsynced(tripId);

    // score from the full local buffer (authoritative match to what we streamed)
    const all = await getAllForScoring(tripId);
    const score = scoreTrip(all);

    try {
      const res = await fetch(`/api/trips/${tripId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      patch({ state: "error", error: "Saved data, but finalizing failed: " + (e as Error).message });
      return { ok: false, remaining, tripId };
    }

    if (wakeRef.current) { try { await wakeRef.current.release(); } catch {} wakeRef.current = null; }
    await deleteTrip(tripId);
    patch({ state: "done", pending: remaining, wakeLock: false });
    return { ok: true, remaining, tripId };
  }, [flush, patch, stopTimers]);

  // resume an interrupted trip after a reload: keep recording from lastSeq
  const resume = useCallback(async (tripId: string) => {
    try {
      tripIdRef.current = tripId;
      const total = await countAll(tripId);
      const unsynced = await countUnsynced(tripId);
      seqRef.current = total; // continue seq after what we already have
      uploadedRef.current = Math.max(0, total - unsynced);
      startMsRef.current = Date.now() - 0; // elapsed restarts; t_ms stays monotonic via seq order
      await acquireWake();
      beginLoops();
      patch({ state: "recording", tripId, recoverable: false, error: null });
    } catch (e) {
      patch({ state: "error", error: (e as Error).message });
    }
  }, [acquireWake, beginLoops, patch]);

  // discard a recovered trip (stop offering recovery)
  const discardRecovery = useCallback(async () => {
    const active = await getActiveTrip();
    if (active) await deleteTrip(active.tripId);
    patch({ recoverable: false });
  }, [patch]);

  // on mount: detect an interrupted trip; re-acquire wake lock on visibility
  useEffect(() => {
    getActiveTrip().then((m) => { if (m) patch({ recoverable: true, tripId: m.tripId }); }).catch(() => {});
    const onVis = () => { if (document.visibilityState === "visible" && status.state === "recording") acquireWake(); };
    const onOnline = () => { patch({ online: true }); flush(); };
    const onOffline = () => patch({ online: false });
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => stopTimers(), [stopTimers]);

  return { status, start, finish, resume, discardRecovery };
}
