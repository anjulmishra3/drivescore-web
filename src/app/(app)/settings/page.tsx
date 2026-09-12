import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/db";
import { updateProfile } from "./actions";

export const dynamic = "force-dynamic";

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="text-sm font-medium text-slate-800">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
      </span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 h-5 w-5 accent-brand-600" />
    </label>
  );
}

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data } = await supabase.from("profiles").select("*").eq("id", user!.id).single();
  const p = (data ?? {}) as Partial<Profile>;

  return (
    <form action={updateProfile} className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Profile</h2>
        <div>
          <label className="label" htmlFor="display_name">Display name</label>
          <input className="input" id="display_name" name="display_name" defaultValue={p.display_name ?? ""} />
        </div>
        <div className="text-xs text-slate-400">Signed in as {user?.email}</div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Vehicle</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="vehicle_make">Make</label>
            <input className="input" id="vehicle_make" name="vehicle_make" defaultValue={p.vehicle_make ?? ""} />
          </div>
          <div>
            <label className="label" htmlFor="vehicle_model">Model</label>
            <input className="input" id="vehicle_model" name="vehicle_model" defaultValue={p.vehicle_model ?? ""} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="vehicle_year">Year</label>
          <input className="input" id="vehicle_year" name="vehicle_year" type="number" min={1980} max={2100} defaultValue={p.vehicle_year ?? ""} />
        </div>
      </section>

      <section className="card divide-y divide-slate-100">
        <h2 className="pb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Notifications</h2>
        <Toggle name="notify_trip_summary" label="Trip summaries" hint="A score summary after each trip." defaultChecked={p.notify_trip_summary ?? true} />
        <Toggle name="notify_weekly_digest" label="Weekly digest" hint="Your weekly score trend." defaultChecked={p.notify_weekly_digest ?? true} />
        <Toggle name="notify_device_alerts" label="Sensor warnings" hint="Alert me when a trip records with poor GPS or motion data." defaultChecked={p.notify_device_alerts ?? true} />
      </section>

      <section className="card divide-y divide-slate-100">
        <h2 className="pb-1 text-sm font-semibold uppercase tracking-wide text-slate-400">Privacy &amp; data</h2>
        <Toggle name="store_raw_samples" label="Store raw sensor samples" hint="Keep the per-second GPS/motion stream for each trip." defaultChecked={p.store_raw_samples ?? true} />
        <Toggle name="share_anonymized_data" label="Share anonymized data" hint="Help improve scoring models. No personal identifiers." defaultChecked={p.share_anonymized_data ?? false} />
      </section>

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary">Save changes</button>
        <Link href="/onboarding" className="btn-ghost">Getting started</Link>
      </div>
    </form>
  );
}
