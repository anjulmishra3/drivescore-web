"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTripRecorder } from "@/lib/useTripRecorder";

function fmt(n: number | null, digits = 1, unit = "") {
  return n == null ? "—" : `${n.toFixed(digits)}${unit}`;
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full text-xs text-white ${
          ok ? "bg-score-good" : "bg-slate-300"
        }`}
      >
        {ok ? "✓" : "·"}
      </span>
      <span className={ok ? "text-slate-800" : "text-slate-400"}>{label}</span>
    </div>
  );
}

export default function CalibratePage() {
  const rec = useTripRecorder(5);
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // Suggested minimum calibration length.
  const MIN_SECONDS = 120;

  async function finishAndSave() {
    const samples = rec.stop();
    if (samples.length < 2) {
      setDone(true);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "calibration", samples, store_samples: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      router.push("/dashboard");
    } catch (e) {
      alert("Could not save calibration: " + (e as Error).message);
      setSaving(false);
    }
  }

  useEffect(() => {
    return () => { rec.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Calibration drive</h1>
        <p className="mt-1 text-sm text-slate-500">
          Mount your phone on the dash and keep this tab open. We&apos;ll sample GPS, accelerometer
          and gyroscope live for a couple of minutes to confirm your sensors work and are oriented
          correctly — so your trips are scored accurately.
        </p>
      </div>

      {!rec.recording && !rec.error && !done && (
        <div className="card space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Secure the phone in a dashboard mount.</li>
            <li>Tap start, then grant location + motion access when prompted.</li>
            <li>Drive normally for ~2 minutes on a familiar route.</li>
          </ol>
          <button className="btn-primary w-full" onClick={rec.start}>
            Start calibration drive
          </button>
          <p className="text-center text-xs text-slate-400">
            On iPhone this button is what unlocks motion sensors — they can&apos;t be enabled
            automatically.
          </p>
        </div>
      )}

      {rec.error && (
        <div className="card border-red-200 bg-red-50 text-sm text-red-700">{rec.error}</div>
      )}

      {rec.recording && (
        <>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-sm font-semibold text-slate-700">Recording</span>
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {Math.floor(rec.elapsed / 60)}:{String(rec.elapsed % 60).padStart(2, "0")}
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${Math.min(100, (rec.elapsed / MIN_SECONDS) * 100)}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {rec.elapsed < MIN_SECONDS
                ? `Keep going — ${MIN_SECONDS - rec.elapsed}s until the suggested minimum.`
                : "Enough data collected. You can finish any time."}
            </p>
          </div>

          <div className="card space-y-2">
            <div className="text-sm font-medium text-slate-500">Sensor check</div>
            <Check ok={rec.avail.geolocation} label="GPS / location reporting" />
            <Check ok={rec.avail.motion} label="Accelerometer reporting" />
            <Check ok={rec.avail.orientation} label="Gyroscope / orientation reporting" />
          </div>

          <div className="card">
            <div className="mb-3 text-sm font-medium text-slate-500">Live readout</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="Speed" value={fmt(rec.live.speed_kmh, 0, " km/h")} />
              <Stat label="Accel (mag)" value={fmt(rec.live.accel, 1, " m/s²")} />
              <Stat label="Lat" value={fmt(rec.live.lat, 4)} />
              <Stat label="Lng" value={fmt(rec.live.lng, 4)} />
              <Stat label="Tilt β" value={fmt(rec.live.gyro_beta, 0, "°")} />
              <Stat label="Tilt γ" value={fmt(rec.live.gyro_gamma, 0, "°")} />
            </div>
          </div>

          <button className="btn-primary w-full" onClick={finishAndSave} disabled={saving}>
            {saving ? "Saving…" : "Finish & save calibration"}
          </button>
        </>
      )}

      {done && (
        <div className="card text-center text-sm text-slate-600">
          No samples were captured. Make sure location and motion access are allowed, then try again.
          <button className="btn-ghost mt-4 w-full" onClick={() => { setDone(false); }}>
            Try again
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}
