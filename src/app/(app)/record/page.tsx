"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRoadTripRecorder } from "@/lib/useRoadTripRecorder";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-score-good" : tone === "warn" ? "text-score-ok" : tone === "bad" ? "text-score-bad" : "text-slate-800";
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

export default function RecordPage() {
  const { status, start, finish, resume, discardRecovery } = useRoadTripRecorder(25);
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const mm = Math.floor(status.elapsed / 60);
  const hh = Math.floor(mm / 60);
  const clock = `${hh}:${String(mm % 60).padStart(2, "0")}:${String(status.elapsed % 60).padStart(2, "0")}`;

  async function doFinish() {
    setConfirming(false);
    const r = await finish();
    if (r?.ok) router.push("/dashboard");
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Road trip recording</h1>
        <p className="mt-1 text-sm text-slate-500">
          High-rate capture (25&nbsp;Hz) that streams every point to the cloud as you drive, with
          on-device backup so nothing is lost to a dropped signal.
        </p>
      </div>

      {/* recovery banner */}
      {status.recoverable && status.state === "idle" && (
        <div className="card border-amber-300 bg-amber-50">
          <div className="text-sm font-semibold text-amber-900">Unfinished trip found</div>
          <p className="mt-1 text-sm text-amber-800">
            A recording was interrupted. You can resume it (keep recording) or finalize/discard it.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => status.tripId && resume(status.tripId)}>Resume recording</button>
            <button className="btn-ghost" onClick={discardRecovery}>Discard</button>
          </div>
        </div>
      )}

      {status.state === "idle" && (
        <div className="card space-y-4">
          <div className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
            <p className="font-semibold">Before you start — this is a foreground recorder:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>Mount the phone and <strong>keep this screen on</strong> (we hold a wake lock, but set auto-lock to Never as backup).</li>
              <li><strong>Don&apos;t switch apps or lock the phone</strong> — Android suspends background tabs and sampling stops.</li>
              <li>Keep it <strong>plugged into the car charger</strong> — 1.5&nbsp;hrs at 25&nbsp;Hz uses battery.</li>
              <li>Grant <strong>location + motion</strong> access when prompted.</li>
            </ul>
          </div>
          <button className="btn-primary w-full py-3 text-base" onClick={() => start("quick")}>
            Start recording
          </button>
        </div>
      )}

      {(status.state === "recording" || status.state === "finishing") && (
        <>
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <span className="text-sm font-semibold text-slate-700">
                  {status.state === "finishing" ? "Finalizing…" : "Recording"}
                </span>
              </div>
              <div className="text-3xl font-bold tabular-nums">{clock}</div>
            </div>
          </div>

          {/* keep-alive warning */}
          <div className="card border-amber-300 bg-amber-50 text-sm text-amber-900">
            ⚠️ Keep this screen on and the tab in front. Locking the phone or switching apps pauses recording.
          </div>

          <div className="card grid grid-cols-3 gap-3 text-sm">
            <Stat label="Captured" value={status.captured.toLocaleString()} />
            <Stat label="Uploaded" value={status.uploaded.toLocaleString()} tone="good" />
            <Stat label="Pending" value={status.pending.toLocaleString()} tone={status.pending > 2000 ? "warn" : undefined} />
            <Stat label="Screen lock" value={status.wakeLock ? "held" : "off"} tone={status.wakeLock ? "good" : "warn"} />
            <Stat label="Network" value={status.online ? "online" : "offline"} tone={status.online ? "good" : "bad"} />
            <Stat label="Rate" value={`${status.hz} Hz`} />
          </div>

          <div className="card grid grid-cols-2 gap-3 text-sm">
            <Stat label="Speed" value={status.live.speed_kmh == null ? "—" : `${status.live.speed_kmh.toFixed(0)} km/h`} />
            <Stat label="Accel" value={status.live.accel == null ? "—" : `${status.live.accel.toFixed(1)} m/s²`} />
            <Stat label="GPS" value={status.live.gps ? "ok" : "waiting…"} tone={status.live.gps ? "good" : "warn"} />
            <Stat label="Motion" value={status.live.motion ? "ok" : "waiting…"} tone={status.live.motion ? "good" : "warn"} />
          </div>

          {status.error && (
            <div className="card border-slate-200 bg-slate-50 text-xs text-slate-500">{status.error}</div>
          )}

          {!confirming ? (
            <button className="btn-danger w-full" onClick={() => setConfirming(true)} disabled={status.state === "finishing"}>
              Finish trip
            </button>
          ) : (
            <div className="card border-red-200">
              <p className="text-sm font-medium text-slate-700">
                Finish and upload the last {status.pending.toLocaleString()} pending points?
              </p>
              <div className="mt-3 flex gap-2">
                <button className="btn-danger flex-1" onClick={doFinish}>Yes, finish</button>
                <button className="btn-ghost flex-1" onClick={() => setConfirming(false)}>Keep recording</button>
              </div>
            </div>
          )}
        </>
      )}

      {status.state === "done" && (
        <div className="card text-center">
          <div className="mb-2 text-4xl">✅</div>
          <h2 className="text-lg font-bold">Trip saved</h2>
          <p className="mt-1 text-sm text-slate-500">
            {status.pending > 0
              ? `Saved, but ${status.pending.toLocaleString()} points are still pending upload — reconnect and reopen to finish syncing.`
              : "All data points uploaded successfully."}
          </p>
          <Link href="/dashboard" className="btn-primary mt-4 inline-flex">Go to dashboard</Link>
        </div>
      )}

      {status.state === "error" && (
        <div className="card border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-800">Something went wrong</div>
          <p className="mt-1 text-sm text-red-700">{status.error}</p>
          <button className="btn-primary mt-3" onClick={() => finish()}>Retry finalize</button>
        </div>
      )}
    </div>
  );
}
