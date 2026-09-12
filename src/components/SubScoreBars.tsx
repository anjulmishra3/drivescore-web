import { SUB_SCORES } from "@/types/db";
import { scoreColor } from "@/lib/scoring";
import type { Trip } from "@/types/db";

export default function SubScoreBars({ trip }: { trip: Partial<Trip> }) {
  return (
    <div className="space-y-3">
      {SUB_SCORES.map(({ key, label, hint }) => {
        const value = (trip[key as keyof Trip] as number | null) ?? null;
        const pct = value ?? 0;
        return (
          <div key={key}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-medium text-slate-700">
                {label}{" "}
                <span className="text-xs font-normal text-slate-400">· {hint}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums" style={{ color: scoreColor(value) }}>
                {value == null ? "—" : value}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: scoreColor(value) }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
