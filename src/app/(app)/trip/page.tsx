"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTripRecorder } from "@/lib/useTripRecorder";
import ScoreGauge from "@/components/ScoreGauge";
import SubScoreBars from "@/components/SubScoreBars";
import type { Trip } from "@/types/db";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}

export default function QuickTripPage() {
  const rec = useTripRecorder(5);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Trip | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function finish() {
    const samples = rec.stop();
    if (samples.length < 2) {
      setErr("Not enough data captured. Allow location + motion access and try again.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "quick", samples, store_samples: true }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { trip } = await res.json();
      setResult(trip);
    } catch (e) {
      setErr("Could not save trip: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    return () => { rec.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (result) {
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <h1 className="text-2xl font-bold">Trip scored</h1>
        <div className="card flex flex-col items-center">
          <ScoreGauge score={result.overall_score} size={180} />
          <div className="mt-3 grid w-full grid-cols-3 gap-3">
            <Stat label="Distance" value={`${result.distance_km?.toFixed(1) ?? 0} km`} />
            <Stat label="Duration" value={`${Math.round((result.duration_s ?? 0) / 60)} min`} />
            <Stat label="Harsh events" value={String(result.event_count)} />
          </div>
        </div>
        <div className="card">
          <div className="mb-4 text-sm font-medium text-slate-500">Sub-scores</div>
          <SubScoreBars trip={result} />
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard" className="btn-primary flex-1">Back to dashboard</Link>
          <button className="btn-ghost flex-1" onClick={() => setResult(null)}>Record another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Quick trip</h1>
        <p className="mt-1 text-sm text-slate-500">
          Record a short errand in the foreground. Keep the screen on and this tab open — browsers
          suspend background tabs, so this is for short trips only. Long commutes need the Android
          app.
        </p>
      </div>

      {err && <div className="card border-red-200 bg-red-50 text-sm text-red-700">{err}</div>}

      {!rec.recording ? (
        <div className="card">
          <button className="btn-primary w-full" onClick={rec.start}>Start recording</button>
          <p className="mt-2 text-center text-xs text-slate-400">
            Grant location + motion access when prompted.
          </p>
        </div>
      ) : (
        <>
          <div className="card flex items-center justify-between">
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

          <div className="card grid grid-cols-2 gap-3 text-sm">
            <Stat label="Speed" value={rec.live.speed_kmh == null ? "—" : `${rec.live.speed_kmh.toFixed(0)} km/h`} />
            <Stat label="Accel" value={rec.live.accel == null ? "—" : `${rec.live.accel.toFixed(1)} m/s²`} />
            <Stat label="GPS" value={rec.avail.geolocation ? "ok" : "waiting…"} />
            <Stat label="Motion" value={rec.avail.motion ? "ok" : "waiting…"} />
          </div>

          <button className="btn-primary w-full" onClick={finish} disabled={saving}>
            {saving ? "Scoring…" : "Finish trip"}
          </button>
        </>
      )}
    </div>
  );
}
