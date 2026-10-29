"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRoadTripRecorder } from "@/lib/useRoadTripRecorder";
import { ensureRegion, bboxAround, loadAnyCached, isLoaded } from "@/lib/localRoadMap";

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-score-good" : tone === "warn" ? "text-score-ok" : tone === "bad" ? "text-score-bad" : "text-slate-800";
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// A small, focused manual set (revealed only when the driver's passenger wants it).
const MANUAL_TAGS: { type: "lane_change" | "turn" | "u_turn" | "harsh_corner" | "overtake" | "hard_brake" | "other"; label: string; dir?: "L" | "R" }[] = [
  { type: "lane_change", label: "Lane ◀ L", dir: "L" },
  { type: "lane_change", label: "Lane R ▶", dir: "R" },
  { type: "turn", label: "Turn" },
  { type: "u_turn", label: "U-turn" },
  { type: "harsh_corner", label: "Harsh corner" },
  { type: "hard_brake", label: "Hard brake" },
  { type: "overtake", label: "Overtake" },
];

const TYPE_LABEL: Record<string, string> = {
  lane_change: "Lane change", turn: "Turn", overtake: "Overtake",
  hard_brake: "Hard brake", stop: "Stop", other: "Maneuver",
};

export default function RecordPage() {
  const { status, start, finish, resume, discardRecovery, finalizeRecovered, retryFinalize, labels } = useRoadTripRecorder(25);
  const [confirming, setConfirming] = useState(false);
  const [showManual, setShowManual] = useState(false);

  const mm = Math.floor(status.elapsed / 60);
  const hh = Math.floor(mm / 60);
  const clock = `${hh}:${String(mm % 60).padStart(2, "0")}:${String(status.elapsed % 60).padStart(2, "0")}`;

  const [finishedTripId, setFinishedTripId] = useState<string | null>(null);

  // on-device road map (enables live lane-change prompts)
  const [mapState, setMapState] = useState<"none" | "loading" | "ready" | "error">("none");
  const [mapRoads, setMapRoads] = useState(0);
  const [mapErr, setMapErr] = useState<string | null>(null);

  useEffect(() => {
    loadAnyCached().then((n) => { if (n > 0) { setMapRoads(n); setMapState("ready"); } }).catch(() => {});
  }, []);

  function downloadArea() {
    setMapState("loading"); setMapErr(null);
    if (!("geolocation" in navigator)) { setMapState("error"); setMapErr("No location on this device."); return; }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const n = await ensureRegion(bboxAround(pos.coords.latitude, pos.coords.longitude));
          setMapRoads(n); setMapState(isLoaded() ? "ready" : "none");
        } catch (e) { setMapState("error"); setMapErr((e as Error).message); }
      },
      (err) => { setMapState("error"); setMapErr(err.message); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function doFinish() {
    setConfirming(false);
    const r = await finish();
    if (r?.ok) setFinishedTripId(r.tripId); // stay on the done screen to offer review
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

      {/* recovery banner — an interrupted recording */}
      {status.recoverable && status.state === "idle" && (
        <div className="card border-amber-300 bg-amber-50">
          <div className="text-sm font-semibold text-amber-900">Unfinished trip found</div>
          <p className="mt-1 text-sm text-amber-800">
            A recording was interrupted. <strong>Finalize</strong> it (save &amp; score what was captured)
            or <strong>resume</strong> to keep recording more.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => status.tripId && finalizeRecovered(status.tripId)}>Finalize &amp; save</button>
            <button className="btn-ghost" onClick={() => status.tripId && resume(status.tripId)}>Resume recording</button>
            <button className="btn-ghost" onClick={discardRecovery}>Discard</button>
          </div>
        </div>
      )}

      {/* a finished drive is still uploading in the background */}
      {status.pendingFinalize && status.state === "idle" && (
        <div className="card border-sky-300 bg-sky-50">
          <div className="text-sm font-semibold text-sky-900">Finishing a saved trip…</div>
          <p className="mt-1 text-sm text-sky-800">
            A previous drive is saved on this phone and finishing its upload. It will complete
            automatically once you have a good connection.
          </p>
          <button className="btn-ghost mt-3" onClick={retryFinalize}>Retry now</button>
        </div>
      )}

      {/* on-device road map → live lane-change prompts */}
      {status.state === "idle" && (
        <div className="card flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-800">Live lane-change tagging</div>
            <div className="mt-0.5 text-xs text-slate-500">
              {mapState === "ready"
                ? `Area cached (${mapRoads.toLocaleString()} roads) — you'll get live prompts in this area.`
                : mapState === "loading"
                ? "Downloading road data for this area…"
                : mapState === "error"
                ? `Couldn't download: ${mapErr}`
                : "Download this area's roads to get live lane-change prompts while driving (works offline)."}
            </div>
          </div>
          <button
            className={mapState === "ready" ? "btn-ghost shrink-0" : "btn-primary shrink-0"}
            disabled={mapState === "loading"}
            onClick={downloadArea}
          >
            {mapState === "ready" ? "Re-download" : mapState === "loading" ? "…" : "Download area"}
          </button>
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

          {/* GPS status — detection needs location */}
          {status.gpsError ? (
            <div className="card border-red-300 bg-red-50 text-sm font-medium text-red-800">
              📍 {status.gpsError}
            </div>
          ) : !status.gotGpsFix && status.elapsed > 12 ? (
            <div className="card border-red-300 bg-red-50 text-sm font-medium text-red-800">
              📍 No GPS fix yet. Maneuver detection won&apos;t run without location — check that location
              access is allowed and the phone has a clear view of the sky.
            </div>
          ) : null}

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
            <Stat
              label="Phone"
              value={status.mountState === "mounted" ? "mounted" : status.mountState === "loose" ? "loose" : "checking…"}
              tone={status.mountState === "mounted" ? "good" : status.mountState === "loose" ? "warn" : undefined}
            />
          </div>
          {status.mountState === "loose" && (
            <p className="-mt-2 text-xs text-score-ok">
              Phone seems loose — mount it for reliable live lane-change prompts (your data is still recorded).
            </p>
          )}

          {/* ── Labeling: detector drives it; minimal manual fallback ── */}
          <div className="card flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-slate-700">Maneuver labels</div>
              <div className="text-xs text-slate-400">
                {labels.count} tagged · prompts appear automatically — review the rest when parked
              </div>
            </div>
            <button className="btn-ghost text-xs" onClick={() => setShowManual((v) => !v)}>
              {showManual ? "Hide" : "＋ Tag"}
            </button>
          </div>

          {showManual && (
            <div className="card space-y-2">
              <p className="text-xs text-slate-400">Passenger only — tag something the detector missed:</p>
              <div className="grid grid-cols-3 gap-2">
                {MANUAL_TAGS.map((t) => (
                  <button key={t.label} className="btn-ghost py-3 text-xs" onClick={() => labels.logManual(t.type, t.dir ?? null)}>
                    {t.label}
                  </button>
                ))}
              </div>
              {labels.recent.length > 0 && (
                <button className="w-full text-xs font-medium text-brand-600 hover:underline" onClick={labels.undoLast}>
                  Undo last tag
                </button>
              )}
            </div>
          )}

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
            {status.pendingFinalize
              ? "Saved to your phone. Finishing the upload in the background — you can leave; it'll complete on its own once you have signal."
              : status.pending > 0
              ? `Saved, but ${status.pending.toLocaleString()} points are still pending upload — reconnect and reopen to finish syncing.`
              : "All data points uploaded successfully."}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            {(finishedTripId ?? status.tripId) && (
              <Link href={`/trips/${finishedTripId ?? status.tripId}/review`} className="btn-primary">
                Review {labels.count} labels
              </Link>
            )}
            <Link href="/dashboard" className="btn-ghost">Dashboard</Link>
          </div>
        </div>
      )}

      {status.state === "error" && (
        <div className="card border-red-200 bg-red-50">
          <div className="text-sm font-semibold text-red-800">Something went wrong</div>
          <p className="mt-1 text-sm text-red-700">{status.error}</p>
          <button className="btn-primary mt-3" onClick={() => finish()}>Retry finalize</button>
        </div>
      )}

      {/* ── Floating detection prompt (Netflix-style auto-dismiss) ── */}
      {labels.pending && (
        <div
          className="fixed inset-x-0 z-50 mx-auto max-w-md px-4"
          style={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }}
        >
          <div className="overflow-hidden rounded-2xl border-2 border-brand-400 bg-white shadow-2xl ring-4 ring-brand-500/20">
            <div className="p-4">
              <div className="flex items-baseline justify-between">
                <div className="text-lg font-bold text-slate-900">
                  {TYPE_LABEL[labels.pending.event.type] ?? "Maneuver"}?
                </div>
                <div className="text-xs text-slate-400">
                  {labels.pending.event.speed_kmh?.toFixed(0) ?? "—"} km/h
                </div>
              </div>
              {labels.pending.event.type === "lane_change" ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button className="btn-primary py-3" onClick={() => labels.answerPrompt(true, "L")}>◀ Left</button>
                  <button className="btn-primary py-3" onClick={() => labels.answerPrompt(true, "R")}>Right ▶</button>
                  <button className="btn-ghost py-3" onClick={() => labels.answerPrompt(false)}>No</button>
                </div>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn-primary py-3" onClick={() => labels.answerPrompt(true)}>Yes</button>
                  <button className="btn-ghost py-3" onClick={() => labels.answerPrompt(false)}>No</button>
                </div>
              )}
            </div>
            {/* draining countdown — restarts each prompt via key */}
            <div className="h-1.5 bg-brand-100">
              <div key={labels.pending.event.t_ms} className="countdown-bar h-full bg-brand-500" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
