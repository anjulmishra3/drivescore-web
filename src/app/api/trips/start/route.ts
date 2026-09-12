import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TripSource } from "@/types/db";

// POST /api/trips/start
// Creates a trip row up front (status = 'recording') so samples can be streamed
// to it in batches during a long drive. Returns the trip id.
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { source?: TripSource; started_at?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const source: TripSource = body.source ?? "quick";
  const { data: trip, error } = await supabase
    .from("trips")
    .insert({
      user_id: user.id,
      source,
      status: "recording",
      started_at: body.started_at ?? new Date().toISOString(),
    })
    .select("id, started_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trip });
}
