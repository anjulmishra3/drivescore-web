"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRoadTripRecorder, type ManeuverLabelType } from "@/lib/useRoadTripRecorder";

type Step = { type: ManeuverLabelType; dir: "L" | "R" | null; title: string; hint: string };

// One deliberate maneuver per step. Direction-specific ones are split L/R so the
// prompt is unambiguous. Keep it short enough to do in one safe empty-road session.
const STEPS: Step[] = [
  { type: "hard_brake", dir: null, title: "Brake firmly to a near-stop", hint: "Build some speed, then brake hard but safely." },
  { type: "hard_brake", dir: null, title: "Brake firmly — again", hint: "A second rep gives us more than one example." },
  { type: "harsh_accel", dir: null, title: "Accelerate hard", hint: "From low speed, accelerate briskly." },
  { type: "lane_change", dir: "L", title: "Change lane to the LEFT", hint: "One deliberate, single lane change." },
  { type: "lane_change", dir: "R", title: "Change lane to the RIGHT", hint: "One deliberate, single lane change." },
  { type: "turn", dir: "L", title: "Take a LEFT turn", hint: "A normal junction turn." },
  { type: "turn", dir: "R", title: "Take a RIGHT turn", hint: "A normal junction turn." },
  { type: "harsh_corner", dir: null, title: "Take a sharp corner", hint: "A tight corner taken a bit briskly." },
  { type: "phone_use", dir: null, title: "Handle the phone (~5s)", hint: "Lift it from the mount, hold a few seconds, replace." },
];

type Phase = "intro" | "ready" | "countdown" | "recording" | "form" | "finishing" | "done";

export default function TrainPage() {
  const rec = useRoadTripRecorder(25);
  const [phase, setPhase] = useState<Phase>("intro");
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(3);
  const [tStart, setTStart] = useState(0);
  const [tEnd, setTEnd] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [intensity, setIntensity] = useState<"gentle" | "normal" | "hard">("normal");
  const [dir, setDir] = useState<"L" | "R" | null>(null);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(0);

  const step = STEPS[idx];
  const mounted = rec.status.mountState === "mounted";

  useEffect(() => {
    if (phase !== "countdown") return;
    if (count <= 0) { setTStart(rec.tripTimeMs()); setElapsed(0); setPhase("recording"); return; }
    const id = setTimeout(() => setCount((c) => c - 1), 800);
    return () => clearTimeout(id);
  }, [phase, count, rec]);

  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setElapsed(rec.tripTimeMs() - tStart), 100);
    return () => clearInterval(id);
  }, [phase, tStart, rec]);

  async function begin() { await rec.start("calibration"); setIdx(0); setPhase("ready"); }
  function startManeuver() { setCount(3); setPhase("countdown"); }
  function done() { setTEnd(rec.tripTimeMs()); setDir(step.dir); setIntensity("normal"); setNote(""); setPhase("form"); }
  function save() {
    rec.logCalibration({ type: step.type, direction: step.dir ? dir : null, tStart, tEnd, intensity, clean: true, note });
    setSaved((s) => s + 1);
    advance();
  }
  function advance() {
    if (idx + 1 >= STEPS.length) finishAll();
    else { setIdx((i) => i + 1); setPhase("ready"); }
  }
  async function finishAll() { setPhase("finishing"); await rec.finish(); setPhase("done"); }

  const Intent = ({ v }: { v: "gentle" | "normal" | "hard" }) => (
    <button onClick={() => setIntensity(v)}
      className={`flex-1 rounded-lg py-2.5 text-sm font-medium capitalize ${intensity === v ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600"}`}>{v}</button>
  );

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Calibration drive</h1>
        <p className="mt-1 text-sm text-slate-500">
          Perform each maneuver on a safe, empty road. We record the exact moment and your notes to
          build clean ground-truth for detection &amp; scoring. Nothing here affects your scores.
        </p>
      </div>

      {phase === "intro" && (
        <div className="card space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Mount your phone firmly.</li>
            <li>Find a safe, empty stretch of road.</li>
            <li>Tap <strong>Start</strong> before each maneuver, do it, then tap <strong>Done</strong>.</li>
          </ol>
          <div className={`rounded-lg px-3 py-2 text-sm ${mounted ? "bg-score-good/10 text-score-good" : "bg-score-ok/10 text-score-ok"}`}>
            Phone: {rec.status.mountState === "mounted" ? "mounted ✓" : rec.status.mountState === "loose" ? "seems loose — mount it firmly" : "checking…"}
          </div>
          <button className="btn-primary w-full" onClick={begin}>Start calibration ({STEPS.length} maneuvers)</button>
          <Link href="/record" className="block text-center text-xs text-slate-400">Back to recording</Link>
        </div>
      )}

      {(phase === "ready" || phase === "countdown" || phase === "recording" || phase === "form") && (
        <div className="card space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Maneuver {idx + 1} of {STEPS.length}</span>
            <span>{saved} saved{rec.status.mountState === "loose" ? " · ⚠ phone loose" : ""}</span>
          </div>
          <div>
            <div className="text-lg font-bold text-slate-900">{step.title}</div>
            <div className="mt-0.5 text-sm text-slate-500">{step.hint}</div>
          </div>

          {phase === "ready" && (
            <div className="flex gap-2">
              <button className="btn-primary flex-1" onClick={startManeuver}>Start maneuver</button>
              <button className="btn-ghost" onClick={advance}>Skip</button>
            </div>
          )}

          {phase === "countdown" && (
            <div className="py-8 text-center">
              <div className="text-6xl font-bold text-brand-500">{count === 0 ? "GO" : count}</div>
              <div className="mt-2 text-sm text-slate-500">get ready…</div>
            </div>
          )}

          {phase === "recording" && (
            <div className="space-y-3">
              <div className="rounded-xl bg-red-50 py-6 text-center">
                <div className="text-sm font-semibold text-red-600">● Recording the maneuver</div>
                <div className="mt-1 text-3xl font-bold tabular-nums text-red-700">{(elapsed / 1000).toFixed(1)}s</div>
                <div className="mt-1 text-xs text-red-500">Live: {rec.status.live.speed_kmh?.toFixed(0) ?? "—"} km/h</div>
              </div>
              <button className="btn-primary w-full" onClick={done}>Done — I finished the maneuver</button>
            </div>
          )}

          {phase === "form" && (
            <div className="space-y-3">
              <div className="text-xs text-slate-400">Captured a {((tEnd - tStart) / 1000).toFixed(1)}s window. A few quick questions:</div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-500">How hard?</div>
                <div className="flex gap-2"><Intent v="gentle" /><Intent v="normal" /><Intent v="hard" /></div>
              </div>
              {step.dir && (
                <div>
                  <div className="mb-1 text-xs font-medium text-slate-500">Direction</div>
                  <div className="flex gap-2">
                    <button onClick={() => setDir("L")} className={`flex-1 rounded-lg py-2.5 text-sm font-medium ${dir === "L" ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600"}`}>◀ Left</button>
                    <button onClick={() => setDir("R")} className={`flex-1 rounded-lg py-2.5 text-sm font-medium ${dir === "R" ? "bg-brand-500 text-white" : "bg-slate-100 text-slate-600"}`}>Right ▶</button>
                  </div>
                </div>
              )}
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. had to brake mid-corner"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button className="btn-primary flex-1" onClick={save}>Save ✓</button>
                <button className="btn-ghost" onClick={() => setPhase("ready")}>Redo ↻</button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "ready" && (
        <button className="btn-ghost w-full text-sm" onClick={finishAll}>Finish calibration early</button>
      )}

      {phase === "finishing" && <div className="card text-center text-sm text-slate-500">Saving…</div>}

      {phase === "done" && (
        <div className="card space-y-3 text-center">
          <div className="text-4xl">🎯</div>
          <h2 className="text-lg font-bold">Calibration saved</h2>
          <p className="text-sm text-slate-500">{saved} labeled maneuvers captured with precise timing.</p>
          <div className="flex justify-center gap-2">
            <Link href="/dashboard" className="btn-ghost">Dashboard</Link>
            <Link href="/record" className="btn-primary">Record a drive</Link>
          </div>
        </div>
      )}
    </div>
  );
}
