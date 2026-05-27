import type { PatternWeeklyPoint } from "../types";

interface Props {
  series: PatternWeeklyPoint[];
  width?: number;
  height?: number;
  color?: string;
  ariaLabel?: string;
}

/**
 * Mini sparkline della share% settimana per settimana.
 * Auto-scale verticale a max(series, 0.05) per evitare collasso visivo
 * quando il pattern è raro ma esiste.
 */
export function PatternSparkline({
  series,
  width = 160,
  height = 44,
  color = "var(--color-brand-soft)",
  ariaLabel,
}: Props) {
  if (!series || series.length === 0) {
    return (
      <div
        className="text-xs text-[color:var(--color-faint)]"
        style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        nessuna serie
      </div>
    );
  }
  const padX = 4;
  const padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;
  const maxShare = Math.max(0.05, ...series.map((p) => p.share));
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0;
  const points = series.map((p, i) => {
    const x = padX + stepX * i;
    const y = padY + innerH * (1 - p.share / maxShare);
    return { x, y, share: p.share };
  });
  const path = points
    .map((pt, i) => (i === 0 ? `M${pt.x},${pt.y}` : `L${pt.x},${pt.y}`))
    .join(" ");
  const areaPath =
    path +
    ` L${points[points.length - 1].x},${height - padY} L${points[0].x},${height - padY} Z`;
  const last = points[points.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={ariaLabel ?? "andamento settimanale"}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={`spark-grad-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-grad-${color.replace(/[^a-z0-9]/gi, "")})`} />
      <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
    </svg>
  );
}
