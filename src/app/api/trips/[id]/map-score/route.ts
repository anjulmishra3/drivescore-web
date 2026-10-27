import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/trips/:id/map-score
// Computes the map-based factors (speeding vs real limits, wrong-side, no-stop-zone)
// for a completed trip. This is deliberately split out of /finish: these PostGIS
// functions do hundreds of spatial queries and can exceed the serverless timeout,
// which — when they ran inside /finish — failed the whole finish request on the
// client and made drives appear to never end.
//
// The client calls this best-effort right after finish returns (the drive is
// already saved and ended by then). If it times out — typically only on very
// long trips — the trip simply keeps null map scores and can be rescored later;
// the user is never blocked.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Only the owner, and only if it still needs scoring (idempotent / cheap no-op).
  const { data: trip } = await supabase
    .from("trips")
    .select("id, score_wrong_side, status")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();
  if (!trip) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (trip.status !== "completed" || trip.score_wrong_side != null) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    await supabase.rpc("rescore_speeding_mapped", { p_trip: params.id });
    await supabase.rpc("score_map_discipline", { p_trip: params.id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: scored } = await supabase
    .from("trips")
    .select("*")
    .eq("id", params.id)
    .single();
  return NextResponse.json({ ok: true, trip: scored });
}
