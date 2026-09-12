import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreTrip } from "@/lib/scoring";
import type { TripSample, TripSource } from "@/types/db";

// POST /api/trips
// Body: { source, started_at, samples: TripSample[], store_samples?: boolean }
// Scores the sensor stream server-side (v0 stand-in for the cloud pipeline),
// persists the trip, and returns it. This is the API contract v1 will reuse.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: {
    source?: TripSource;
    started_at?: string;
    samples?: TripSample[];
    store_samples?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const samples = Array.isArray(body.samples) ? body.samples : [];
  if (samples.length < 2) {
    return NextResponse.json({ error: "need at least 2 samples" }, { status: 400 });
  }

  const source: TripSource = body.source ?? "quick";
  const score = scoreTrip(samples);
  const startedAt = body.started_at ?? new Date(Date.now() - score.duration_s * 1000).toISOString();

  const { data: trip, error } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      source,
      status: "completed",
      started_at: startedAt,
      ended_at: new Date().toISOString(),
      distance_km: score.distance_km,
      duration_s: score.duration_s,
      max_speed_kmh: score.max_speed_kmh,
      overall_score: score.overall_score,
      score_smoothness: score.score_smoothness,
      score_braking: score.score_braking,
      score_cornering: score.score_cornering,
      score_speeding: score.score_speeding,
      score_focus: score.score_focus,
      event_count: score.event_count,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optionally persist raw samples (respect the user's privacy preference).
  if (body.store_samples) {
    const rows = samples.map((s) => ({ ...s, trip_id: trip.id }));
    // insert in chunks to stay within payload limits
    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from("trip_samples").insert(rows.slice(i, i + 500));
    }
  }

  return NextResponse.json({ trip });
}
