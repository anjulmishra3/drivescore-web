import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Trip } from "@/types/db";
import { scoreColor } from "@/lib/scoring";
import LocalTime from "@/components/LocalTime";

export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const supabase = createClient();
  const { data: trips = [] } = await supabase
    .from("trips")
    .select("*")
    .order("started_at", { ascending: false });

  const list = (trips ?? []) as Trip[];

  // label counts per trip (trip_labels is small)
  const { data: labelRows = [] } = await supabase.from("trip_labels").select("trip_id");
  const counts = new Map<string, number>();
  for (const r of (labelRows ?? []) as { trip_id: string }[]) {
    counts.set(r.trip_id, (counts.get(r.trip_id) ?? 0) + 1);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">All trips</h1>
        <Link href="/record" className="btn-primary">Record</Link>
      </div>
      <p className="text-sm text-slate-500">
        Tap a trip to open its map, then tap anywhere on the route to tag maneuvers.
      </p>

      {list.length === 0 ? (
        <div className="card text-center text-sm text-slate-500">No trips yet.</div>
      ) : (
        <div className="space-y-2">
          {list.map((t) => (
            <Link
              key={t.id}
              href={`/trips/${t.id}/review`}
              className="card flex items-center justify-between transition hover:bg-slate-50"
            >
              <div>
                <div className="text-sm font-medium text-slate-800"><LocalTime iso={t.started_at} /></div>
                <div className="text-xs text-slate-400">
                  {t.distance_km?.toFixed(1) ?? "0"} km ·{" "}
                  {t.duration_s ? `${Math.round(t.duration_s / 60)} min` : "—"} ·{" "}
                  <span className="capitalize">{t.source}</span>
                  {counts.get(t.id) ? ` · ${counts.get(t.id)} tags` : " · untagged"}
                  {t.status !== "completed" ? ` · ${t.status}` : ""}
                </div>
              </div>
              <div
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: scoreColor(t.overall_score) }}
              >
                {t.overall_score ?? "—"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
