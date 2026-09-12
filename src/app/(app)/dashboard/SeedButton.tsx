"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SeedButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function seed() {
    setLoading(true);
    try {
      const res = await fetch("/api/seed", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      alert("Could not load demo data: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button className="btn-ghost" onClick={seed} disabled={loading}>
      {loading ? "Loading…" : "Load demo data"}
    </button>
  );
}
