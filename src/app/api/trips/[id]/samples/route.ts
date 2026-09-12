import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { TripSample } from "@/types/db";

// POST /api/trips/:id/samples
// Body: { samples: TripSample[] }  (each MUST carry a per-trip `seq`)
// Idempotent batch append: ON CONFLICT (trip_id, seq) DO NOTHING, so retrying a
// batch after a network blip never duplicates points. RLS ensures the caller
// owns the parent trip.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { samples?: TripSample[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const samples = Array.isArray(body.samples) ? body.samples : [];
  if (samples.length === 0) return NextResponse.json({ saved: 0 });
  if (samples.some((s) => s.seq == null)) {
    return NextResponse.json({ error: "every sample needs a seq" }, { status: 400 });
  }
  if (samples.length > 5000) {
    return NextResponse.json({ error: "batch too large (max 5000)" }, { status: 400 });
  }

  const rows = samples.map((s) => ({ ...s, trip_id: params.id }));

  const { error } = await supabase
    .from("trip_samples")
    .upsert(rows, { onConflict: "trip_id,seq", ignoreDuplicates: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: samples.length });
}
