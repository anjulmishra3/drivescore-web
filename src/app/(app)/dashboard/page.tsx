import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Trip } from "@/types/db";
import ScoreGauge from "@/components/ScoreGauge";
import SubScoreBars from "@/components/SubScoreBars";
import TrendChart, { type TrendPoint } from "@/components/TrendChart";
import { scoreColor } from "@/lib/scoring";
import SeedButton from "./SeedButton";

export const dynamic = "force-dynamic";

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Group completed trips into weekly average scores (last 8 weeks).
function weeklyTrend(trips: Trip[]): TrendPoint[] {
  const byWeek = new Map<string, { sum: number; n: number; ts: number }>();
  for (const t of trips) {
    if (t.overall_score == null) continue;
    const d = new Date(t.started_at);
    const day = d.getUTCDay();
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
    monday.setUTCHours(0, 0, 0, 0);
    const key = monday.toISOString().slice(0, 10);
    const cur = byWeek.get(key) ?? { sum: 0, n: 0, ts: monday.getTime() };
    cur.sum += t.overall_score;
    cur.n += 1;
    byWeek.set(key, cur);
  }
  return [...byWeek.values()]
    .sort((a, b) => a.ts - b.ts)
    .slice(-8)
    .map((w) => ({
      label: new Date(w.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      score: Math.round(w.sum / w.n),
    }));
}

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: trips = [] } = await supabase
    .from("trips")
    .select("*")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(50);

  const list = (trips ?? []) as Trip[];
  const latest = list[0];
  const scored = list.filter((t) => t.overall_score != null);
  const avg =
    scored.length > 0
      ? Math.round(scored.reduce((s, t) => s + (t.overall_score ?? 0), 0) / scored.length)
      : null;
  const totalKm = list.reduce((s, t) => s + (t.distance_km ?? 0), 0);
  const trend = weeklyTrend(list);

  if (list.length === 0) {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="card mt-6">
          <div className="mb-3 text-4xl">📊</div>
          <h1 className="text-xl font-bold">No trips yet</h1>
          <p className="mt-2 text-sm text-slate-500">
            Record a calibration drive or a quick trip to see your first score. Or load some
            demo data to explore the dashboard.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Link href="/calibrate" className="btn-primary">Start calibration drive</Link>
            <Link href="/trip" className="btn-ghost">Record a quick trip</Link>
            <SeedButton />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex gap-2">
          <Link href="/calibrate" className="btn-ghost">Calibrate</Link>
          <Link href="/trip" className="btn-primary">Quick trip</Link>
        </div>
      </div>

      {/* summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Avg score</div>
          <div className="mt-1 text-3xl font-extrabold" style={{ color: scoreColor(avg) }}>
            {avg ?? "—"}
          </div>
        </div>
        <div className="card text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Trips</div>
          <div className="mt-1 text-3xl font-extrabold text-slate-900">{list.length}</div>
        </div>
        <div className="card text-center">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Distance</div>
          <div className="mt-1 text-3xl font-extrabold text-slate-900">
            {totalKm.toFixed(0)}<span className="text-base font-semibold text-slate-400"> km</span>
          </div>
        </div>
      </div>

      {/* latest trip + breakdown */}
      {latest && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="card flex flex-col items-center justify-center">
            <div className="mb-2 text-sm font-medium text-slate-500">Latest trip</div>
            <ScoreGauge score={latest.overall_score} />
            <div className="mt-3 text-xs text-slate-400">
              {fmtDate(latest.started_at)} · {latest.distance_km?.toFixed(1) ?? "0"} km ·{" "}
              <span className="capitalize">{latest.source}</span>
            </div>
          </div>
          <div className="card">
            <div className="mb-4 text-sm font-medium text-slate-500">Sub-scores</div>
            <SubScoreBars trip={latest} />
          </div>
        </div>
      )}

      {/* weekly trend */}
      <div className="card">
        <div className="mb-2 text-sm font-medium text-slate-500">Weekly trend</div>
        <TrendChart data={trend} />
      </div>

      {/* trip history */}
      <div className="card">
        <div className="mb-3 text-sm font-medium text-slate-500">Recent trips</div>
        <div className="divide-y divide-slate-100">
          {list.map((t) => (
            <div key={t.id} className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm font-medium text-slate-800">{fmtDate(t.started_at)}</div>
                <div className="text-xs text-slate-400">
                  {t.distance_km?.toFixed(1) ?? "0"} km ·{" "}
                  {t.duration_s ? `${Math.round(t.duration_s / 60)} min` : "—"} ·{" "}
                  <span className="capitalize">{t.source}</span>
                  {t.event_count > 0 && ` · ${t.event_count} events`}
                </div>
              </div>
              <div
                className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: scoreColor(t.overall_score) }}
              >
                {t.overall_score ?? "—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
