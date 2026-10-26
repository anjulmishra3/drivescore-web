"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { MapLabel, RoutePoint } from "@/components/RouteMap";

// Driver-action labels (events)
const ACTION_TAGS: { type: string; label: string; dir?: "L" | "R" }[] = [
  { type: "lane_change", label: "Lane ◀ L", dir: "L" },
  { type: "lane_change", label: "Lane R ▶", dir: "R" },
  { type: "turn", label: "Turn" },
  { type: "u_turn", label: "U-turn" },
  { type: "harsh_corner", label: "Harsh corner" },
  { type: "hard_brake", label: "Hard brake" },
  { type: "harsh_accel", label: "Harsh accel" },
  { type: "overtake", label: "Overtake" },
  { type: "stop", label: "Stop" },
  { type: "wrong_side", label: "Wrong side" },
  { type: "phone_use", label: "Phone use" },
];
// Road-context labels (fill gaps the map data is missing); speed_limit carries a value
const ROAD_TAGS: { type: string; label: string }[] = [
  { type: "stop_sign", label: "Stop sign" },
  { type: "speed_bump", label: "Speed bump" },
  { type: "school_zone", label: "School zone" },
  { type: "no_stopping", label: "No stopping" },
  { type: "traffic_signal", label: "Signal" },
];
const SPEED_LIMITS = [20, 30, 40, 50, 60, 80, 100];

interface RoadInfo {
  fclass: string; name: string | null; ref: string | null; oneway: string;
  limit_kmh: number | null; bearing: number | null; dist_m: number | null; wrong_side_possible: boolean;
}

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-xl bg-slate-100" />,
});

interface Label {
  id: string;
  t_ms: number;
  source: "auto" | "manual";
  type: string | null;
  direction: "L" | "R" | null;
  confirmed: boolean | null;
  value: number | null;
  speed_kmh: number | null;
  lat: number | null;
  lng: number | null;
  meta: { peak_yaw?: number; net_heading?: number; dur_s?: number } | null;
}

const TYPES = [
  "lane_change", "turn", "u_turn", "harsh_corner", "hard_brake", "harsh_accel", "overtake",
  "stop", "wrong_side", "phone_use", "speed_limit", "stop_sign", "speed_bump",
  "school_zone", "no_stopping", "traffic_signal", "other",
];

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ReviewPage({ params }: { params: { id: string } }) {
  const tripId = params.id;
  const [labels, setLabels] = useState<Label[]>([]);
  const [route, setRoute] = useState<RoutePoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAdd, setPendingAdd] = useState<RoutePoint | null>(null);
  const [speedPick, setSpeedPick] = useState(false);
  const [roadInfo, setRoadInfo] = useState<RoadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/labels`);
      const { labels } = await res.json();
      setLabels(labels ?? []);
      // downsampled GPS track for the map (RLS-safe RPC)
      const supabase = createClient();
      const { data: pts } = await supabase.rpc("trip_route", { p_trip: tripId, p_max: 1200 });
      if (Array.isArray(pts)) {
        setRoute(pts.filter((p) => p.lat != null && p.lng != null));
      }
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { load(); }, [load]);

  // clicking a marker selects a label → scroll its card into view
  const selectFromMap = useCallback((id: string) => {
    setSelectedId(id);
    rowRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // tap a point → stash it and fetch the live road context from PostGIS
  const onAddAt = useCallback(async (p: RoutePoint) => {
    setPendingAdd(p); setSpeedPick(false); setRoadInfo(null);
    try {
      const supabase = createClient();
      const { data } = await supabase.rpc("road_context", { p_lat: p.lat, p_lng: p.lng });
      if (Array.isArray(data) && data[0]) setRoadInfo(data[0] as RoadInfo);
    } catch { /* map lookup is best-effort */ }
  }, []);

  // tap a point on the map → choose a type → save a label there
  const addLabelAt = useCallback(async (type: string, direction: "L" | "R" | null, value: number | null = null) => {
    const pt = pendingAdd;
    setPendingAdd(null);
    setSpeedPick(false);
    if (!pt) return;
    await fetch(`/api/trips/${tripId}/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        t_ms: pt.t_ms, source: "manual", type, direction, value,
        lat: pt.lat, lng: pt.lng, speed_kmh: pt.speed_kmh ?? null, confirmed: true,
      }),
    });
    load();
  }, [pendingAdd, tripId, load]);

  const mapLabels: MapLabel[] = labels.map((l) => ({
    id: l.id, lat: l.lat ?? null, lng: l.lng ?? null, type: l.type, source: l.source, confirmed: l.confirmed,
  }));

  const patch = useCallback(async (id: string, body: Partial<Label>) => {
    setBusy(id);
    // optimistic
    setLabels((ls) => ls.map((l) => (l.id === id ? { ...l, ...body } : l)));
    try {
      await fetch(`/api/trips/${tripId}/labels`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label_id: id, ...body }),
      });
    } finally { setBusy(null); }
  }, [tripId]);

  const remove = useCallback(async (id: string) => {
    setBusy(id);
    setLabels((ls) => ls.filter((l) => l.id !== id));
    try {
      await fetch(`/api/trips/${tripId}/labels?label_id=${id}`, { method: "DELETE" });
    } finally { setBusy(null); }
  }, [tripId]);

  const n = labels.length;
  const auto = labels.filter((l) => l.source === "auto").length;
  const yes = labels.filter((l) => l.confirmed === true).length;
  const no = labels.filter((l) => l.confirmed === false).length;
  const open = labels.filter((l) => l.confirmed == null).length;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review maneuvers</h1>
        <Link href="/dashboard" className="btn-ghost">Done</Link>
      </div>
      <p className="text-sm text-slate-500">
        Confirm or correct detected maneuvers, or <strong>tap anywhere on the route</strong> to add a
        label at that spot. This is the ground truth that trains the scoring engine.
      </p>

      {!loading && (route.length > 0 || mapLabels.some((l) => l.lat != null)) && (
        <div className="card p-2">
          <RouteMap
            route={route}
            labels={mapLabels}
            selectedId={selectedId}
            onSelect={selectFromMap}
            onAddAt={onAddAt}
            highlight={pendingAdd}
          />
          <div className="mt-2 flex items-center justify-center gap-3 text-xs text-slate-400">
            <span>🔵 route</span>
            <span><span className="text-score-ok">●</span> to review</span>
            <span><span className="text-score-good">●</span> confirmed</span>
            <span><span className="text-score-bad">●</span> false</span>
            <span><span className="text-brand-600">●</span> manual</span>
          </div>
        </div>
      )}

      {!loading && n > 0 && (
        <div className="card grid grid-cols-4 gap-2 text-center text-sm">
          <div><div className="text-xs text-slate-400">Events</div><div className="font-bold">{n}</div></div>
          <div><div className="text-xs text-slate-400">Confirmed</div><div className="font-bold text-score-good">{yes}</div></div>
          <div><div className="text-xs text-slate-400">False</div><div className="font-bold text-score-bad">{no}</div></div>
          <div><div className="text-xs text-slate-400">To review</div><div className="font-bold text-score-ok">{open}</div></div>
        </div>
      )}

      {loading ? (
        <div className="card text-center text-sm text-slate-400">Loading…</div>
      ) : n === 0 ? (
        <div className="card text-center text-sm text-slate-500">
          No labels recorded for this trip.
        </div>
      ) : (
        <div className="space-y-2">
          {labels.map((l) => (
            <div
              key={l.id}
              ref={(el) => { rowRefs.current[l.id] = el; }}
              onClick={() => setSelectedId(l.id)}
              className={`card cursor-pointer transition ${selectedId === l.id ? "ring-2 ring-brand-400" : ""} ${l.confirmed === true ? "border-score-good/40" : l.confirmed === false ? "border-score-bad/40 opacity-70" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-sm font-semibold text-slate-700">{clock(l.t_ms)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${l.source === "auto" ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-600"}`}>
                    {l.source}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className={`rounded-lg px-2.5 py-1 text-sm ${l.confirmed === true ? "bg-score-good text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    disabled={busy === l.id}
                    onClick={() => patch(l.id, { confirmed: true })}
                    title="Real maneuver"
                  >✓</button>
                  <button
                    className={`rounded-lg px-2.5 py-1 text-sm ${l.confirmed === false ? "bg-score-bad text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                    disabled={busy === l.id}
                    onClick={() => patch(l.id, { confirmed: false })}
                    title="False detection"
                  >✗</button>
                  <button
                    className="rounded-lg px-2.5 py-1 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600"
                    disabled={busy === l.id}
                    onClick={() => remove(l.id)}
                    title="Delete"
                  >🗑</button>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <select
                  className="input !w-auto !py-1.5 text-sm"
                  value={l.type ?? "other"}
                  onChange={(e) => patch(l.id, { type: e.target.value })}
                >
                  {TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
                </select>
                {l.type === "lane_change" && (
                  <div className="flex gap-1">
                    {(["L", "R"] as const).map((d) => (
                      <button
                        key={d}
                        className={`rounded-lg px-2.5 py-1.5 text-sm ${l.direction === d ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                        onClick={() => patch(l.id, { direction: d })}
                      >{d}</button>
                    ))}
                  </div>
                )}
                {l.type === "speed_limit" && (
                  <div className="flex flex-wrap gap-1">
                    {SPEED_LIMITS.map((v) => (
                      <button
                        key={v}
                        className={`rounded-lg px-2 py-1.5 text-xs ${l.value === v ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                        onClick={() => patch(l.id, { value: v })}
                      >{v}</button>
                    ))}
                  </div>
                )}
                <span className="ml-auto text-xs text-slate-400">
                  {l.value != null ? `${l.value.toFixed(0)} km/h limit · ` : ""}
                  {l.speed_kmh != null ? `${l.speed_kmh.toFixed(0)} km/h` : ""}
                  {l.meta?.net_heading != null ? ` · ${l.meta.net_heading.toFixed(0)}°` : ""}
                  {l.meta?.peak_yaw != null ? ` · ${l.meta.peak_yaw.toFixed(0)}°/s` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* tap-to-tag palette */}
      {pendingAdd && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg px-3 pb-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                Tag at {Math.floor(pendingAdd.t_ms / 60000)}:{String(Math.floor((pendingAdd.t_ms % 60000) / 1000)).padStart(2, "0")}
                {pendingAdd.speed_kmh != null ? ` · ${pendingAdd.speed_kmh.toFixed(0)} km/h` : ""}
              </span>
              <button className="text-xs font-medium text-slate-400 hover:text-slate-700" onClick={() => { setPendingAdd(null); setSpeedPick(false); }}>Cancel</button>
            </div>

            {/* live road context from the map */}
            {roadInfo && (
              <div className="mb-2 rounded-lg bg-brand-50 px-3 py-1.5 text-xs text-brand-900">
                📍 {roadInfo.ref ? roadInfo.ref + " · " : ""}{roadInfo.name ?? roadInfo.fclass}
                {" · "}{roadInfo.limit_kmh ?? "?"} km/h{roadInfo.oneway === "F" ? " · one-way" : ""}
              </div>
            )}

            {speedPick ? (
              <div>
                <div className="mb-1 text-xs text-slate-400">Speed limit here (km/h):</div>
                <div className="grid grid-cols-4 gap-2">
                  {roadInfo?.limit_kmh && (
                    <button className="btn-primary py-2.5 text-sm" onClick={() => addLabelAt("speed_limit", null, roadInfo.limit_kmh)}>
                      {roadInfo.limit_kmh}*
                    </button>
                  )}
                  {SPEED_LIMITS.filter((v) => v !== roadInfo?.limit_kmh).map((v) => (
                    <button key={v} className="btn-ghost py-2.5 text-sm" onClick={() => addLabelAt("speed_limit", null, v)}>{v}</button>
                  ))}
                  <button className="btn-ghost py-2.5 text-xs text-slate-400" onClick={() => setSpeedPick(false)}>← back</button>
                </div>
                {roadInfo?.limit_kmh && <div className="mt-1 text-[10px] text-slate-400">* map&apos;s current value</div>}
              </div>
            ) : (
              <>
                <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Driver action</div>
                <div className="grid grid-cols-3 gap-2">
                  {ACTION_TAGS.map((t) => (
                    <button key={t.label} className="btn-ghost py-2.5 text-xs" onClick={() => addLabelAt(t.type, t.dir ?? null)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-slate-400">Road / sign</div>
                <div className="grid grid-cols-3 gap-2">
                  <button className="btn-ghost py-2.5 text-xs font-semibold text-brand-700" onClick={() => setSpeedPick(true)}>Speed limit…</button>
                  {ROAD_TAGS.map((t) => (
                    <button key={t.label} className="btn-ghost py-2.5 text-xs" onClick={() => addLabelAt(t.type, null)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
