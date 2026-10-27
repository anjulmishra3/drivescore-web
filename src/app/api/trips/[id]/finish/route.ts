import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { ScoreBreakdown } from "@/types/db";

// POST /api/trips/:id/finish
// Body: { score: ScoreBreakdown }
// Finalizes a streamed trip: marks it completed and writes the score. The score
// is computed on the client from its full local buffer (which already matches
// what was streamed to the DB) — this avoids re-reading ~100k+ rows inside a
// short serverless timeout. Raw samples are already safe in trip_samples.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { score?: Partial<ScoreBreakdown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const s = body.score ?? {};
  const clamp = (n: unknown) =>
    n == null ? null : Math.max(0, Math.min(100, Math.round(Number(n))));

  const { data: trip, error } = await supabase
    .from("trips")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      distance_km: s.distance_km ?? null,
      duration_s: s.duration_s ?? null,
      max_speed_kmh: s.max_speed_kmh ?? null,
      overall_score: clamp(s.overall_score),
      score_smoothness: clamp(s.score_smoothness),
      score_braking: clamp(s.score_braking),
      score_cornering: clamp(s.score_cornering),
      score_speeding: clamp(s.score_speeding),
      score_focus: clamp(s.score_focus),
      event_count: s.event_count ?? 0,
    })
    .eq("id", params.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // NOTE: the map-based scoring (speeding vs real limits, wrong-side, no-stop-zone)
  // is deliberately NOT run here. Those PostGIS functions do hundreds of spatial
  // queries and routinely exceed the serverless timeout, which made the whole
  // finish request fail on the client. They now run out-of-band via the
  // `score_pending_map` pg_cron job (~every minute) on completed trips whose map
  // scores are still null. Finish just records the trip + client sensor score and
  // returns immediately.
  return NextResponse.json({ trip });
}
