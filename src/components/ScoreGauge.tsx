import { scoreColor, scoreLabel } from "@/lib/scoring";

// Circular 0-100 gauge rendered as inline SVG (no client JS needed).
export default function ScoreGauge({
  score,
  size = 160,
  label = true,
}: {
  score: number | null;
  size?: number;
  label?: boolean;
}) {
  const stroke = size * 0.09;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * c;
  const color = scoreColor(score);

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          x="50%"
          y="47%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.3}
          fontWeight={800}
          fill="#0f172a"
        >
          {score == null ? "—" : score}
        </text>
        <text
          x="50%"
          y="66%"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={size * 0.09}
          fill="#64748b"
        >
          / 100
        </text>
      </svg>
      {label && (
        <span className="mt-1 text-sm font-semibold" style={{ color }}>
          {scoreLabel(score)}
        </span>
      )}
    </div>
  );
}
