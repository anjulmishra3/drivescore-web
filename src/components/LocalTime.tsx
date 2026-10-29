"use client";

import { useEffect, useState } from "react";

// Renders a timestamp in the viewer's own timezone. These pages are server
// components (so a server-side toLocaleString would use the server's UTC clock);
// this formats in the browser instead, where the device timezone is known.
// Server-render / pre-hydration fallback is IST so no UTC is ever shown; once
// mounted it switches to the device's actual timezone.
const FALLBACK_TZ = "Asia/Kolkata";

export default function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "date" }) {
  const opts: Intl.DateTimeFormatOptions =
    mode === "date"
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" };

  const fmt = (tz?: string) => {
    try { return new Date(iso).toLocaleString(undefined, tz ? { ...opts, timeZone: tz } : opts); }
    catch { return new Date(iso).toLocaleString(); }
  };

  const [text, setText] = useState(() => fmt(FALLBACK_TZ));
  useEffect(() => { setText(fmt()); /* device timezone */ }, [iso]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span suppressHydrationWarning>{text}</span>;
}
