import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type LabelType = "lane_change" | "turn" | "overtake" | "hard_brake" | "stop" | "other";

// POST   /api/trips/:id/labels        insert a label (auto or manual)
// PATCH  /api/trips/:id/labels         { label_id, confirmed }  answer a prompt
// DELETE /api/trips/:id/labels?label_id=...   undo a label
async function requireUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("trip_labels")
    .select("*")
    .eq("trip_id", params.id)
    .eq("user_id", user.id)
    .order("t_ms", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ labels: data ?? [] });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let b: {
    t_ms?: number; source?: "auto" | "manual"; type?: string;
    direction?: "L" | "R" | null; confirmed?: boolean | null;
    value?: number | null;
    lat?: number | null; lng?: number | null; speed_kmh?: number | null;
    meta?: Record<string, unknown>;
  };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  if (b.t_ms == null || (b.source !== "auto" && b.source !== "manual")) {
    return NextResponse.json({ error: "t_ms and source required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("trip_labels")
    .insert({
      trip_id: params.id,
      user_id: user.id,
      t_ms: Math.round(b.t_ms),
      source: b.source,
      type: b.type ?? null,
      direction: b.direction ?? null,
      confirmed: b.confirmed ?? null,
      value: b.value ?? null,
      lat: b.lat ?? null,
      lng: b.lng ?? null,
      speed_kmh: b.speed_kmh ?? null,
      meta: b.meta ?? null,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let b: { label_id?: string; confirmed?: boolean; type?: LabelType; direction?: "L" | "R" | null };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }
  if (!b.label_id) return NextResponse.json({ error: "label_id required" }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (b.confirmed !== undefined) patch.confirmed = b.confirmed;
  if (b.type !== undefined) patch.type = b.type;
  if (b.direction !== undefined) patch.direction = b.direction;

  const { error } = await supabase
    .from("trip_labels")
    .update(patch)
    .eq("id", b.label_id)
    .eq("trip_id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const labelId = new URL(req.url).searchParams.get("label_id");
  if (!labelId) return NextResponse.json({ error: "label_id required" }, { status: 400 });

  const { error } = await supabase
    .from("trip_labels")
    .delete()
    .eq("id", labelId)
    .eq("trip_id", params.id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
