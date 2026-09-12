"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client. Safe to use the anon key here — Row Level
// Security enforces per-user access on the database side.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
