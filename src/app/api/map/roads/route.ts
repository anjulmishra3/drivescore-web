import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/map/roads?minLng=&minLat=&maxLng=&maxLat=
// Returns the drivable road centerlines (simplified) inside a bounding box, for
// the app to cache on-device and run live map-matching / lane-change detection
// without a network round-trip per GPS fix. Payload is ~1 MB for a city-sized box.
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const u = new URL(req.url);
  const nums = ["minLng", "minLat", "maxLng", "maxLat"].map((k) => Number(u.searchParams.get(k)));
  if (nums.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ error: "minLng,minLat,maxLng,maxLat required" }, { status: 400 });
  }
  const [minLng, minLat, maxLng, maxLat] = nums;
  // guard against an accidentally huge request (keep the cached payload bounded).
  // 0.35 deg² allows up to roughly a 27 km radius box.
  if ((maxLng - minLng) * (maxLat - minLat) > 0.35) {
    return NextResponse.json({ error: "bbox too large (max ~27 km radius)" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("roads_in_bbox", {
    min_lng: minLng, min_lat: minLat, max_lng: maxLng, max_lat: maxLat,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { bbox: { minLng, minLat, maxLng, maxLat }, roads: data ?? [] },
    { headers: { "Cache-Control": "private, max-age=86400" } },
  );
}
