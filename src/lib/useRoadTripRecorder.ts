"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScoreBreakdown, TripSample, TripSource } from "@/types/db";
import { scoreTrip } from "@/lib/scoring";
import { LiveManeuverDetector, type ManeuverEvent } from "@/lib/liveManeuverDetector";
import { LiveLaneChangeDetector } from "@/lib/liveLaneChangeDetector";
import { MountStateDetector, type MountState } from "@/lib/mountStateDetector";
import { isLoaded as roadMapLoaded, nearestRoad } from "@/lib/localRoadMap";
import {
  countAll,
  countUnsynced,
  deleteTrip,
  getActiveTrip,
  getAllForScoring,
  getLabelLocal,
  getMeta,
  getPendingFinalizeTrips,
  getPendingLabels,
  getUnsynced,
  markSynced,
  putLabelLocal,
  putSamples,
  removeLabelLocal,
  saveMeta,
  type StoredLabel,
  type StoredSample,
} from "@/lib/sampleStore";

const IDB_FLUSH_MS = 1000; // memory -> IndexedDB
const NET_FLUSH_MS = 4000; // IndexedDB -> server
const UPLOAD_BATCH = 2000; // rows per network request
const NET_TIMEOUT_MS = 12000; // abort a single request that stalls (dead/half-open link)
const FINALIZE_RETRY_MS = 15000; // background retry cadence for a pending finalize
export const PROMPT_MS = 8000; // how long a detection prompt stays before auto-dismiss

// fetch that fails fast instead of hanging forever on a connected-but-dead link
// (captive wifi, basement, airport) — a timeout just means "retry later".
async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = NET_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  gpsError: string | null; // location permission denied / unavailable
  gotGpsFix: boolean;      // at least one position fix received this trip
  recoverable: boolean; // an interrupted *recording* was found on load (resumable)
  pendingFinalize: boolean; // a finished drive is saved locally and still uploading
  mountState: MountState; // phone mounted vs loose (gates live lane-change prompts)
  live: { speed_kmh: number | null; accel: number | null; gps: boolean; motion: boolean };
}

export type ManeuverLabelType =
  | "lane_change" | "turn" | "u_turn" | "harsh_corner" | "hard_brake" | "harsh_accel"
  | "overtake" | "stop" | "wrong_side" | "phone_use" | "other";

export interface RecentLabel {
  id: string | null;
  t_ms: number;
  source: "auto" | "manual";
  type: ManeuverLabelType | null;
  direction: "L" | "R" | null;
  confirmed: boolean | null;
}

export interface PendingPrompt {
  event: ManeuverEvent;
  labelId: string | null;
}

export function useRoadTripRecorder(hz = 25) {
  const [status, setStatus] = useState<RecorderStatus>({
    state: "idle", tripId: null, elapsed: 0, captured: 0, uploaded: 0, pending: 0,
    online: true, wakeLock: false, hz, error: null, gpsError: null, gotGpsFix: false, recoverable: false,
    pendingFinalize: false, mountState: "uncertain",
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

  // --- maneuver labeling ---
  const detectorRef = useRef<LiveManeuverDetector | null>(null);
  const lcDetectorRef = useRef<LiveLaneChangeDetector | null>(null);
  const lcActiveRef = useRef(false);
  const mountRef = useRef<MountStateDetector | null>(null);
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPromptAtRef = useRef(0);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const [recentLabels, setRecentLabels] = useState<RecentLabel[]>([]);
  const [labelCount, setLabelCount] = useState(0);

  const samplerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idbRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const netRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const labelNetRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const labelFlushing = useRef(false);
  const finalizeRetryRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

  const lastFix = useRef<{ lat: number; lng: number; t: number } | null>(null);
  const onPosition = useCallback((pos: GeolocationPosition) => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude, t = pos.timestamp;

    // Prefer the device-reported speed; fall back to speed derived from the
    // distance between consecutive fixes (many phones, iOS especially, leave
    // coords.speed null even while moving).
    let speed_kmh = latest.current.speed_kmh ?? null;
    if (pos.coords.speed != null && pos.coords.speed >= 0) {
      speed_kmh = pos.coords.speed * 3.6;
    } else if (lastFix.current) {
      const dt = (t - lastFix.current.t) / 1000;
      if (dt > 0) {
        const R = 6371, toRad = Math.PI / 180;
        const dLat = (lat - lastFix.current.lat) * toRad;
        const dLng = (lng - lastFix.current.lng) * toRad;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(lastFix.current.lat * toRad) * Math.cos(lat * toRad) * Math.sin(dLng / 2) ** 2;
        const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
        speed_kmh = (km / dt) * 3600;
      }
    }
    lastFix.current = { lat, lng, t };

    latest.current = { ...latest.current, lat, lng, speed_kmh };
    setStatus((s) => (s.gotGpsFix ? s : { ...s, gotGpsFix: true, gpsError: null }));
  }, []);

  // --- network flush: IndexedDB -> server ---
  // Pass a tripId to flush a specific (e.g. background-finalizing) trip; omit it
  // to flush the one currently recording and keep the live upload counter in sync.
  const flush = useCallback(async (tripIdArg?: string) => {
    const tripId = tripIdArg ?? tripIdRef.current;
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
        const res = await fetchWithTimeout(`/api/trips/${tripId}/samples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ samples }),
          keepalive: samples.length <= 500,
        });
        if (!res.ok) throw new Error(await res.text());
        await markSynced(keys, values);
        if (!tripIdArg) uploadedRef.current += values.length;
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
    [samplerRef, idbRef, netRef, labelNetRef, uiRef].forEach((r) => {
      if (r.current) clearInterval(r.current);
      r.current = null;
    });
    if (geoWatch.current != null) navigator.geolocation.clearWatch(geoWatch.current);
    geoWatch.current = null;
    window.removeEventListener("devicemotion", onMotion);
    detectorRef.current = null;
    lcDetectorRef.current = null;
    mountRef.current = null;
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    setPendingPrompt(null);
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

  // Reconcile locally-stored labels with the server, with retry. Labels are
  // written to IndexedDB the instant they're tagged (same durability contract as
  // samples), so a failed network call, a paused DB, or a hung finish can never
  // lose a hand-labelled point — this flusher keeps trying until each one lands.
  const flushLabels = useCallback(async (tripId?: string | null) => {
    const id = tripId ?? tripIdRef.current;
    if (!id || labelFlushing.current || !navigator.onLine) return;
    labelFlushing.current = true;
    try {
      const pending = await getPendingLabels(id);
      for (const rec of pending) {
        try {
          if (rec.deleted) {
            // delete on the server if it ever got created, then drop locally
            if (rec.serverId) {
              const res = await fetchWithTimeout(`/api/trips/${id}/labels?label_id=${rec.serverId}`, { method: "DELETE" });
              if (!res.ok) continue; // retry next tick
            }
            await removeLabelLocal(rec.clientId);
          } else if (!rec.serverId) {
            // create (carries the current confirmed/direction in one shot)
            const res = await fetchWithTimeout(`/api/trips/${id}/labels`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                t_ms: rec.t_ms, source: rec.source, type: rec.type, direction: rec.direction,
                confirmed: rec.confirmed, lat: rec.lat, lng: rec.lng, speed_kmh: rec.speed_kmh, meta: rec.meta,
              }),
            });
            if (!res.ok) continue;
            const { id: serverId } = await res.json();
            await putLabelLocal({ ...rec, serverId: serverId ?? null, synced: 1 });
          } else {
            // already created but edited since (e.g. a prompt answer) → PATCH
            const res = await fetchWithTimeout(`/api/trips/${id}/labels`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label_id: rec.serverId, confirmed: rec.confirmed, direction: rec.direction, type: rec.type }),
            });
            if (!res.ok) continue;
            await putLabelLocal({ ...rec, synced: 1 });
          }
        } catch { /* leave unsynced; next tick retries */ }
      }
    } finally {
      labelFlushing.current = false;
    }
  }, []);

  // Persist a freshly-tagged label locally (durable immediately) and kick a sync.
  const logLabelLocal = useCallback((rec: Omit<StoredLabel, "deleted" | "serverId" | "synced">) => {
    const full: StoredLabel = { ...rec, deleted: 0, serverId: null, synced: 0 };
    void putLabelLocal(full).then(() => flushLabels());
    return full.clientId;
  }, [flushLabels]);

  // auto-detected maneuver → log it, and (for lane changes) raise a quick prompt
  const handleAutoEvent = useCallback((e: ManeuverEvent) => {
    const tripId = tripIdRef.current;
    if (!tripId) return;
    const clientId = crypto.randomUUID();
    logLabelLocal({
      clientId, tripId, t_ms: e.t_ms, source: "auto", type: e.type, direction: null, confirmed: null,
      lat: e.lat, lng: e.lng, speed_kmh: e.speed_kmh,
      meta: { peak_yaw: e.peak_yaw, net_heading: e.net_heading, dur_s: e.dur_s },
    });
    setLabelCount((n) => n + 1);
    setRecentLabels((r) => [{ id: clientId, t_ms: e.t_ms, source: "auto" as const, type: e.type, direction: null, confirmed: null }, ...r].slice(0, 8));

    // Prompt for the detected maneuver (yes/no), with a cooldown so prompts
    // don't stack. Auto-logging above already captured it regardless of answer.
    const now = Date.now();
    if (now - lastPromptAtRef.current > 6000) {
      lastPromptAtRef.current = now;
      setPendingPrompt({ event: e, labelId: clientId });
      if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
      promptTimerRef.current = setTimeout(() => setPendingPrompt(null), PROMPT_MS);
    }
  }, [logLabelLocal]);

  // manual tag at the current moment
  const logManual = useCallback((type: ManeuverLabelType, direction: "L" | "R" | null = null) => {
    const tripId = tripIdRef.current;
    if (!tripId) return;
    const l = latest.current;
    const t_ms = Date.now() - startMsRef.current;
    const clientId = crypto.randomUUID();
    logLabelLocal({
      clientId, tripId, t_ms, source: "manual", type, direction, confirmed: null,
      lat: l.lat ?? null, lng: l.lng ?? null, speed_kmh: l.speed_kmh ?? null, meta: null,
    });
    setLabelCount((n) => n + 1);
    setRecentLabels((r) => [{ id: clientId, t_ms, source: "manual" as const, type, direction, confirmed: null }, ...r].slice(0, 8));
  }, [logLabelLocal]);

  // answer a prompt (yes/no, optional direction for lane changes) → edit locally + sync
  const answerPrompt = useCallback(async (yes: boolean, direction: "L" | "R" | null = null) => {
    const p = pendingPrompt;
    setPendingPrompt(null);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
    if (!p?.labelId) return;
    setRecentLabels((r) => r.map((x) => (x.id === p.labelId ? { ...x, confirmed: yes, direction: direction ?? x.direction } : x)));
    const rec = await getLabelLocal(p.labelId);
    if (rec) {
      await putLabelLocal({ ...rec, confirmed: yes, direction: direction ?? rec.direction, synced: 0 });
      void flushLabels();
    }
  }, [pendingPrompt, flushLabels]);

  const dismissPrompt = useCallback(() => {
    setPendingPrompt(null);
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current);
  }, []);

  // undo the most recent label
  const undoLast = useCallback(async () => {
    const top = recentLabels[0];
    if (!top) return;
    setRecentLabels((r) => r.slice(1));
    setLabelCount((n) => Math.max(0, n - 1));
    if (!top.id) return;
    const rec = await getLabelLocal(top.id);
    if (rec) {
      await putLabelLocal({ ...rec, deleted: 1, synced: 0 });
      void flushLabels();
    }
  }, [recentLabels, flushLabels]);

  const beginLoops = useCallback(() => {
    const hzMs = Math.max(10, Math.round(1000 / hz));
    // When the region road map is cached, the map+accel lane-change detector runs
    // and is the authority for lane changes; suppress the gyro detector's weaker
    // lane-change events so we don't double-prompt. The gyro detector still owns turns.
    lcActiveRef.current = roadMapLoaded();
    mountRef.current = new MountStateDetector();
    detectorRef.current = new LiveManeuverDetector((e) => {
      if (e.type === "lane_change" && lcActiveRef.current) return;
      void handleAutoEvent(e);
    });
    lcDetectorRef.current = lcActiveRef.current
      ? new LiveLaneChangeDetector(nearestRoad, (e) => {
          // only trust live lane-change prompts when the phone is actually mounted;
          // a loose phone's lateral-accel is its own sliding, not the car steering.
          if (mountRef.current?.state !== "mounted") return;
          void handleAutoEvent(e);
        })
      : null;

    window.addEventListener("devicemotion", onMotion);
    lastFix.current = null;
    geoWatch.current = navigator.geolocation.watchPosition(
      onPosition,
      (err) => {
        const msg = err.code === err.PERMISSION_DENIED
          ? "Location blocked — allow location access for this site (maneuver detection needs GPS)."
          : `Location unavailable (${err.message}).`;
        patch({ gpsError: msg });
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    samplerRef.current = setInterval(() => {
      const l = latest.current;
      seqRef.current += 1;
      const t_ms = Date.now() - startMsRef.current;
      memBuf.current.push({
        tripId: tripIdRef.current!, seq: seqRef.current, synced: 0,
        t_ms,
        lat: l.lat ?? null, lng: l.lng ?? null, speed_kmh: l.speed_kmh ?? null,
        accel_x: l.accel_x ?? null, accel_y: l.accel_y ?? null, accel_z: l.accel_z ?? null,
        gyro_alpha: l.gyro_alpha ?? null, gyro_beta: l.gyro_beta ?? null, gyro_gamma: l.gyro_gamma ?? null,
      });
      // feed the live maneuver detector
      detectorRef.current?.push({
        t_ms, speed_kmh: l.speed_kmh ?? null,
        accel_x: l.accel_x ?? null, accel_y: l.accel_y ?? null, accel_z: l.accel_z ?? null,
        gyro_alpha: l.gyro_alpha ?? null, gyro_beta: l.gyro_beta ?? null, gyro_gamma: l.gyro_gamma ?? null,
        lat: l.lat ?? null, lng: l.lng ?? null,
      });
      lcDetectorRef.current?.push({
        t_ms, lat: l.lat ?? null, lng: l.lng ?? null, speed_kmh: l.speed_kmh ?? null,
        accel_x: l.accel_x ?? null, accel_y: l.accel_y ?? null, accel_z: l.accel_z ?? null,
      });
      mountRef.current?.push({
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
    labelNetRef.current = setInterval(() => void flushLabels(), NET_FLUSH_MS);

    uiRef.current = setInterval(() => {
      const l = latest.current;
      patch({
        elapsed: Math.floor((Date.now() - startMsRef.current) / 1000),
        captured: seqRef.current,
        uploaded: uploadedRef.current,
        pending: Math.max(0, seqRef.current - uploadedRef.current),
        online: navigator.onLine,
        mountState: mountRef.current?.state ?? "uncertain",
        live: {
          speed_kmh: l.speed_kmh ?? null,
          accel: l.accel_x != null && l.accel_y != null && l.accel_z != null
            ? Math.sqrt(l.accel_x ** 2 + l.accel_y ** 2 + l.accel_z ** 2) : null,
          gps: l.lat != null, motion: l.accel_x != null,
        },
      });
    }, 500);
  }, [flush, flushLabels, hz, onMotion, onPosition, patch, handleAutoEvent]);

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
      patch({ state: "recording", tripId: trip.id, error: null, gpsError: null, gotGpsFix: false, recoverable: false });
    } catch (e) {
      patch({ state: "error", error: (e as Error).message });
    }
  }, [acquireWake, beginLoops, patch, requestMotionPerm]);

  const stopFinalizeRetry = useCallback(() => {
    if (finalizeRetryRef.current) { clearInterval(finalizeRetryRef.current); finalizeRetryRef.current = null; }
  }, []);

  // Push a trip the rest of the way to the server: remaining samples, labels, the
  // finish call, then the heavy map scoring. Fails fast (timeouts) and returns
  // false if anything doesn't land — the caller leaves it pending to retry. On
  // success the local copy is removed. Safe to call repeatedly (idempotent-ish:
  // finish just re-stamps a completed trip; labels/samples are already synced).
  const finalizeTrip = useCallback(async (tripId: string, score: ScoreBreakdown): Promise<boolean> => {
    if (!navigator.onLine) return false;
    // upload any remaining samples (a few passes)
    for (let i = 0; i < 4; i++) {
      await flush(tripId);
      if ((await countUnsynced(tripId)) === 0) break;
    }
    // and any unsynced labels
    for (let i = 0; i < 4; i++) {
      await flushLabels(tripId);
      if ((await getPendingLabels(tripId)).length === 0) break;
    }
    // finalize on the server
    try {
      const res = await fetchWithTimeout(`/api/trips/${tripId}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      if (!res.ok) return false;
    } catch {
      return false;
    }
    // best-effort heavy map scoring (never blocks)
    try {
      fetchWithTimeout(`/api/trips/${tripId}/map-score`, { method: "POST", keepalive: true }).catch(() => {});
    } catch {}
    await deleteTrip(tripId);
    return true;
  }, [flush, flushLabels]);

  // Try to finalize every drive that ended locally but hasn't uploaded yet.
  const finalizePending = useCallback(async (): Promise<boolean> => {
    const metas = await getPendingFinalizeTrips();
    for (const m of metas) {
      const score = m.score ?? scoreTrip(await getAllForScoring(m.tripId));
      await finalizeTrip(m.tripId, score);
    }
    const left = await getPendingFinalizeTrips();
    if (left.length === 0) { stopFinalizeRetry(); patch({ pendingFinalize: false }); return true; }
    patch({ pendingFinalize: true });
    return false;
  }, [finalizeTrip, patch, stopFinalizeRetry]);

  const startFinalizeRetry = useCallback(() => {
    if (finalizeRetryRef.current) return;
    finalizeRetryRef.current = setInterval(() => { void finalizePending(); }, FINALIZE_RETRY_MS);
  }, [finalizePending]);

  // End the drive. This never blocks on the network: the drive is scored from the
  // local buffer, marked ended on-device, and the upload + server finalize run in
  // the background (and keep retrying on reconnect / next app open). Stopping in a
  // dead-signal spot ends the trip instantly; it finalizes itself once online.
  const finish = useCallback(async () => {
    patch({ state: "finishing" });
    stopTimers();
    // move any remaining in-memory samples to IndexedDB
    if (memBuf.current.length) {
      try { await putSamples(memBuf.current.splice(0, memBuf.current.length)); } catch { /* keep */ }
    }
    const tripId = tripIdRef.current!;

    // score from the full local buffer (authoritative match to what we streamed)
    const all = await getAllForScoring(tripId);
    const score = scoreTrip(all);

    // the drive is over regardless of connectivity — release the wake lock now
    if (wakeRef.current) { try { await wakeRef.current.release(); } catch {} wakeRef.current = null; }

    // persist the ended state + score locally so a background / next-open finalize
    // can complete the upload even if we never reach the server right now
    const prev = await getMeta(tripId);
    await saveMeta({
      tripId, source: sourceRef.current,
      startedAt: prev?.startedAt ?? new Date(startMsRef.current).toISOString(),
      lastSeq: seqRef.current, status: "pending_finalize", score, endedAt: new Date().toISOString(),
    });

    const remaining = await countUnsynced(tripId);
    patch({ state: "done", pending: remaining, pendingFinalize: true, wakeLock: false });

    // fire the finalize in the background; retry on failure
    void finalizeTrip(tripId, score).then((ok) => {
      if (ok) patch({ pendingFinalize: false, pending: 0 });
      else startFinalizeRetry();
    });

    return { ok: true, remaining, tripId };
  }, [finalizeTrip, patch, startFinalizeRetry, stopTimers]);

  // Finalize a recovered *recording* without resuming capture (upload + finish only).
  const finalizeRecovered = useCallback(async (tripId: string) => {
    patch({ state: "finishing", recoverable: false });
    const prev = await getMeta(tripId);
    const score = prev?.score ?? scoreTrip(await getAllForScoring(tripId));
    await saveMeta({
      tripId, source: prev?.source ?? "quick",
      startedAt: prev?.startedAt ?? new Date().toISOString(),
      lastSeq: prev?.lastSeq ?? (await countAll(tripId)), status: "pending_finalize",
      score, endedAt: new Date().toISOString(),
    });
    tripIdRef.current = tripId;
    const remaining = await countUnsynced(tripId);
    patch({ state: "done", pending: remaining, pendingFinalize: true, tripId });
    const ok = await finalizeTrip(tripId, score);
    if (ok) patch({ pendingFinalize: false, pending: 0 });
    else startFinalizeRetry();
    return { ok, tripId };
  }, [finalizeTrip, patch, startFinalizeRetry]);

  // Manually retry any pending finalize (e.g. a "Retry upload" button).
  const retryFinalize = useCallback(() => { void finalizePending(); }, [finalizePending]);

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
      patch({ state: "recording", tripId, recoverable: false, error: null, gpsError: null, gotGpsFix: false });
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

  // on mount: offer to resume an interrupted *recording*; silently complete any
  // drive that ended earlier but never finished uploading; re-acquire wake lock.
  useEffect(() => {
    getActiveTrip().then((m) => { if (m) patch({ recoverable: true, tripId: m.tripId }); }).catch(() => {});
    getPendingFinalizeTrips().then((ms) => {
      if (ms.length) { patch({ pendingFinalize: true }); void finalizePending(); startFinalizeRetry(); }
    }).catch(() => {});
    const onVis = () => { if (document.visibilityState === "visible" && status.state === "recording") acquireWake(); };
    const onOnline = () => { patch({ online: true }); flush(); void flushLabels(); void finalizePending(); };
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

  useEffect(() => () => { stopTimers(); stopFinalizeRetry(); }, [stopTimers, stopFinalizeRetry]);

  return {
    status, start, finish, resume, discardRecovery, finalizeRecovered, retryFinalize,
    labels: {
      pending: pendingPrompt,
      recent: recentLabels,
      count: labelCount,
      logManual,
      answerPrompt,
      dismissPrompt,
      undoLast,
    },
  };
}
