import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/seed — insert a spread of demo trips for the current user so the
// dashboard has trends to show. Dev/demo convenience only.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const now = Date.now();
  const rand = (lo: number, hi: number) => Math.round(lo + Math.random() * (hi - lo));

  // 18 trips over the last ~8 weeks with a gentle upward trend
  const rows = Array.from({ length: 18 }).map((_, i) => {
    const daysAgo = i * 3 + rand(0, 2);
    const started = new Date(now - daysAgo * 86400000 - rand(0, 8) * 3600000);
    const base = 62 + (18 - i) * 1.4; // improves over time
    const j = () => Math.max(30, Math.min(100, Math.round(base + rand(-12, 12))));
    const sm = j(), br = j(), co = j(), sp = j(), fo = j();
    const overall = Math.round(sm * 0.25 + br * 0.25 + co * 0.2 + sp * 0.2 + fo * 0.1);
    const dur = rand(300, 2400);
    return {
      user_id: user.id,
      source: i % 5 === 0 ? "calibration" : "quick",
      status: "completed",
      started_at: started.toISOString(),
      ended_at: new Date(started.getTime() + dur * 1000).toISOString(),
      distance_km: Math.round((dur / 120) * 10) / 10,
      duration_s: dur,
      max_speed_kmh: rand(60, 115),
      overall_score: overall,
      score_smoothness: sm,
      score_braking: br,
      score_cornering: co,
      score_speeding: sp,
      score_focus: fo,
      event_count: Math.max(0, Math.round((100 - overall) / 8)),
    };
  });

  const { error } = await supabase.from("trips").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: rows.length });
}
