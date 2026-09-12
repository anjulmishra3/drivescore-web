"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function updateProfile(formData: FormData) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const yearRaw = String(formData.get("vehicle_year") || "").trim();
  const year = yearRaw ? parseInt(yearRaw, 10) : null;

  await supabase
    .from("profiles")
    .update({
      display_name: String(formData.get("display_name") || "") || null,
      vehicle_make: String(formData.get("vehicle_make") || "") || null,
      vehicle_model: String(formData.get("vehicle_model") || "") || null,
      vehicle_year: Number.isFinite(year) ? year : null,
      notify_trip_summary: formData.get("notify_trip_summary") === "on",
      notify_weekly_digest: formData.get("notify_weekly_digest") === "on",
      notify_device_alerts: formData.get("notify_device_alerts") === "on",
      share_anonymized_data: formData.get("share_anonymized_data") === "on",
      store_raw_samples: formData.get("store_raw_samples") === "on",
    })
    .eq("id", user.id);

  revalidatePath("/settings");
}
