"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TripSample } from "@/types/db";

// Live readout of the most recent sensor values, for UI feedback.
export interface LiveReadout {
  lat: number | null;
  lng: number | null;
  speed_kmh: number | null;
  accel: number | null; // magnitude of linear-ish accel (m/s^2)
  accel_x: number | null;
  accel_y: number | null;
  accel_z: number | null;
  gyro_alpha: number | null;
  gyro_beta: number | null;
  gyro_gamma: number | null;
}

export interface SensorAvailability {
  geolocation: boolean;
  motion: boolean;
  orientation: boolean;
}

const EMPTY: LiveReadout = {
  lat: null, lng: null, speed_kmh: null, accel: null,
  accel_x: null, accel_y: null, accel_z: null,
  gyro_alpha: null, gyro_beta: null, gyro_gamma: null,
};

// iOS 13+ Safari gates motion/orientation behind a permission call that MUST
// be triggered from a user gesture.
async function requestIosPermissions(): Promise<void> {
  const anyMotion = (window as any).DeviceMotionEvent;
  const anyOrient = (window as any).DeviceOrientationEvent;
  if (anyMotion && typeof anyMotion.requestPermission === "function") {
    try { await anyMotion.requestPermission(); } catch { /* denied */ }
  }
  if (anyOrient && typeof anyOrient.requestPermission === "function") {
    try { await anyOrient.requestPermission(); } catch { /* denied */ }
  }
}

export function useTripRecorder(sampleHz = 5) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<LiveReadout>(EMPTY);
  const [avail, setAvail] = useState<SensorAvailability>({
    geolocation: false, motion: false, orientation: false,
  });
  const [error, setError] = useState<string | null>(null);

  const samplesRef = useRef<TripSample[]>([]);
  const latestRef = useRef<LiveReadout>(EMPTY);
  const startRef = useRef<number>(0);
  const watchIdRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onMotion = useCallback((e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (a) {
      latestRef.current = {
        ...latestRef.current,
        accel_x: a.x ?? null,
        accel_y: a.y ?? null,
        accel_z: a.z ?? null,
        accel:
          a.x != null && a.y != null && a.z != null
            ? Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2)
            : null,
      };
      setAvail((s) => (s.motion ? s : { ...s, motion: true }));
    }
  }, []);

  const onOrientation = useCallback((e: DeviceOrientationEvent) => {
    latestRef.current = {
      ...latestRef.current,
      gyro_alpha: e.alpha,
      gyro_beta: e.beta,
      gyro_gamma: e.gamma,
    };
    if (e.alpha != null || e.beta != null || e.gamma != null) {
      setAvail((s) => (s.orientation ? s : { ...s, orientation: true }));
    }
  }, []);

  const onPosition = useCallback((pos: GeolocationPosition) => {
    latestRef.current = {
      ...latestRef.current,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      speed_kmh: pos.coords.speed != null ? Math.max(0, pos.coords.speed * 3.6) : latestRef.current.speed_kmh,
    };
    setAvail((s) => (s.geolocation ? s : { ...s, geolocation: true }));
  }, []);

  const stop = useCallback(() => {
    setRecording(false);
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    window.removeEventListener("devicemotion", onMotion);
    window.removeEventListener("deviceorientation", onOrientation);
    watchIdRef.current = null;
    intervalRef.current = null;
    tickRef.current = null;
    return samplesRef.current;
  }, [onMotion, onOrientation]);

  const start = useCallback(async () => {
    setError(null);
    samplesRef.current = [];
    latestRef.current = EMPTY;
    setLive(EMPTY);
    setElapsed(0);

    await requestIosPermissions();

    if (!("geolocation" in navigator)) {
      setError("This device/browser has no Geolocation API.");
      return;
    }

    window.addEventListener("devicemotion", onMotion);
    window.addEventListener("deviceorientation", onOrientation);

    watchIdRef.current = navigator.geolocation.watchPosition(
      onPosition,
      (err) => setError(`Location error: ${err.message}. Allow location access and use HTTPS.`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );

    startRef.current = Date.now();
    setRecording(true);

    // sample buffer tick
    intervalRef.current = setInterval(() => {
      const l = latestRef.current;
      samplesRef.current.push({
        t_ms: Date.now() - startRef.current,
        lat: l.lat, lng: l.lng, speed_kmh: l.speed_kmh,
        accel_x: l.accel_x, accel_y: l.accel_y, accel_z: l.accel_z,
        gyro_alpha: l.gyro_alpha, gyro_beta: l.gyro_beta, gyro_gamma: l.gyro_gamma,
      });
    }, 1000 / sampleHz);

    // UI tick (throttled)
    tickRef.current = setInterval(() => {
      setLive({ ...latestRef.current });
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 250);
  }, [onMotion, onOrientation, onPosition, sampleHz]);

  useEffect(() => {
    return () => { stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    recording, elapsed, live, avail, error,
    sampleCount: samplesRef.current.length,
    start, stop,
    getSamples: () => samplesRef.current,
  };
}
