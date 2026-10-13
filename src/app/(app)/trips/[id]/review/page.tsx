"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import type { MapLabel } from "@/components/RouteMap";

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
  speed_kmh: number | null;
  lat: number | null;
  lng: number | null;
  meta: { peak_yaw?: number; net_heading?: number; dur_s?: number } | null;
}

const TYPES = ["lane_change", "turn", "overtake", "hard_brake", "stop", "other"];

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function ReviewPage({ params }: { params: { id: string } }) {
  const tripId = params.id;
  const [labels, setLabels] = useState<Label[]>([]);
  const [route, setRoute] = useState<[number, number][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
      const { data: pts } = await supabase.rpc("trip_route", { p_trip: tripId, p_max: 800 });
      if (Array.isArray(pts)) {
        setRoute(pts.filter((p) => p.lat != null && p.lng != null).map((p) => [p.lat, p.lng] as [number, number]));
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
        Confirm or correct each detected maneuver while parked. This is the ground truth that
        trains the scoring engine — ✓ keeps it, ✗ marks a false detection, and you can fix the type.
      </p>

      {!loading && (route.length > 0 || mapLabels.some((l) => l.lat != null)) && (
        <div className="card p-2">
          <RouteMap route={route} labels={mapLabels} selectedId={selectedId} onSelect={selectFromMap} />
          <div className="mt-2 flex items-center justify-center gap-4 text-xs text-slate-400">
            <span>🔵 route</span>
            <span><span className="text-score-ok">●</span> to review</span>
            <span><span className="text-score-good">●</span> confirmed</span>
            <span><span className="text-score-bad">●</span> false</span>
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
                <span className="ml-auto text-xs text-slate-400">
                  {l.speed_kmh != null ? `${l.speed_kmh.toFixed(0)} km/h` : ""}
                  {l.meta?.net_heading != null ? ` · ${l.meta.net_heading.toFixed(0)}°` : ""}
                  {l.meta?.peak_yaw != null ? ` · ${l.meta.peak_yaw.toFixed(0)}°/s` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
