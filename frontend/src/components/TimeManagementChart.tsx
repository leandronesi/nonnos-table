import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeManagement, Tilt } from "../types";

/**
 * "Cosa succede quando l'orologio scende."
 *
 * Asse X: tempo RIMASTO sull'orologio (bucket).
 * Asse Y sinistro (linea viola): ACPL — più alto = mossa peggiore.
 * Asse Y destro (barre): % di mosse che diventano blunder in quel bucket.
 *
 * Color coding delle barre: gradiente dal rosso (alto ACPL = problema) al
 * verde (basso ACPL = ok). Stesso color coding tra linea e barre per evitare
 * dissociazione cognitiva.
 */
export function TimeManagementChart({
  time_management,
  tilt,
}: {
  time_management: TimeManagement;
  tilt: Tilt;
}) {
  // Deriva blunder_rate per ogni bucket (count / positions).
  const data = time_management.clock_vs_accuracy.map((d) => ({
    ...d,
    blunder_pct: d.positions > 0 ? Math.round((d.blunders / d.positions) * 1000) / 10 : 0,
  }));

  // Colore in base ad ACPL (alto = rosso = male, basso = verde = bene)
  function colorForAcpl(acpl: number): string {
    if (acpl >= 130) return "#f43f5e";  // rosso
    if (acpl >= 100) return "#fb923c";  // arancio
    if (acpl >= 80) return "#f5a524";   // ambra
    if (acpl >= 65) return "#facc15";   // giallo
    return "#34d399";                   // verde
  }

  return (
    <div className="surface surface-padded">
      <div className="h-[320px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 30, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
              label={{
                value: "Tempo RIMASTO sull'orologio",
                position: "insideBottom",
                offset: -2,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              width={66}
              label={{
                value: "ACPL · alto = peggio",
                angle: -90,
                position: "insideLeft",
                offset: 16,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={56}
              tickFormatter={(v) => `${v}%`}
              label={{
                value: "% mosse blunder",
                angle: 90,
                position: "insideRight",
                offset: 10,
                fill: "var(--color-muted)",
                fontSize: 11,
              }}
            />
            <Tooltip content={<RichTooltip />} />
            <Legend
              wrapperStyle={{ paddingTop: 8 }}
              formatter={(v) =>
                v === "avg_cp_loss"
                  ? "ACPL · linea (sx)"
                  : v === "blunder_pct"
                  ? "% blunder · barre (dx)"
                  : v
              }
            />
            <Bar
              yAxisId="right"
              dataKey="blunder_pct"
              name="blunder_pct"
              radius={[8, 8, 0, 0]}
              opacity={0.75}
            >
              {data.map((d) => (
                <Cell key={d.key} fill={colorForAcpl(d.avg_cp_loss)} />
              ))}
              <LabelList
                dataKey="blunder_pct"
                position="insideTop"
                formatter={(v: number) => `${v}%`}
                fill="#0a0c18"
                fontSize={11}
                fontWeight={700}
                style={{ fontFamily: "var(--font-mono)" }}
                offset={6}
              />
            </Bar>
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avg_cp_loss"
              name="avg_cp_loss"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              dot={{ r: 5, fill: "var(--color-brand-soft)", stroke: "#0a0c18", strokeWidth: 2 }}
            >
              <LabelList
                dataKey="avg_cp_loss"
                position="top"
                fill="var(--color-brand-soft)"
                fontSize={11}
                style={{ fontFamily: "var(--font-mono)" }}
                offset={12}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <ClockAvoidabilityStrip data={time_management.clock_vs_accuracy} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
        <StatCard
          label="Mosse istantanee in critica"
          sub="< 2 secondi su posizione critica"
          value={time_management.instant_moves_in_critical.n}
          danger={time_management.instant_moves_in_critical.avg_cp_loss > 100}
          metric={`ACPL ${time_management.instant_moves_in_critical.avg_cp_loss}`}
          extra={`${time_management.instant_moves_in_critical.blunders} blunder`}
        />
        <StatCard
          label="Mosse in zeitnot"
          sub="< 30s rimasti sull'orologio"
          value={time_management.zeitnot.n}
          danger={time_management.zeitnot.avg_cp_loss > 100}
          metric={`ACPL ${time_management.zeitnot.avg_cp_loss}`}
          extra={`${time_management.zeitnot.blunders} blunder`}
        />
        <StatCard
          label="Tilt factor"
          sub="quanto peggiori dopo un tuo blunder"
          value={`${tilt.tilt_factor}×`}
          danger={tilt.tilt_factor > 1.3}
          metric={`ACPL ${tilt.after_blunder_avg_cp_loss} · baseline ${tilt.baseline_avg_cp_loss}`}
          extra=""
        />
      </div>
    </div>
  );
}

/**
 * Strip "evitabili dal target" per fascia di clock. Stesso pattern di
 * SpeedVsErrors: di tutti gli errori in questa fascia, quanti il 1600
 * li avrebbe trovati con >40% di probabilita`?
 */
function ClockAvoidabilityStrip({ data }: { data: TimeManagement["clock_vs_accuracy"] }) {
  const anyAvoidable = data.some((d) => (d.avoidable_errors ?? 0) > 0);
  if (!anyAvoidable) return null;
  return (
    <div className="mt-5 pt-4 border-t border-[color:var(--color-line)]">
      <div className="label-eyebrow text-[10px] mb-2">
        Errori per fascia di clock — quanti evitabili dal target (1600)
      </div>
      <div className="grid grid-cols-5 gap-2">
        {data.map((d) => {
          const share = d.avoidable_share ?? 0;
          const pct = Math.round(share * 100);
          const tone =
            pct >= 25 ? { fg: "#fda4af", bg: "rgba(244,63,94,0.10)", border: "rgba(244,63,94,0.30)" }
            : pct >= 15 ? { fg: "#fcd34d", bg: "rgba(251,191,36,0.10)", border: "rgba(251,191,36,0.30)" }
            : { fg: "#86efac", bg: "rgba(52,211,153,0.08)", border: "rgba(52,211,153,0.25)" };
          return (
            <div
              key={d.key}
              className="rounded-lg p-2 text-center"
              style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
            >
              <div className="text-[10px] text-[color:var(--color-muted)] tracking-wider uppercase">
                {d.bucket}
              </div>
              <div className="text-lg font-bold tabular-nums mt-0.5" style={{ color: tone.fg }}>
                {pct}%
              </div>
              <div className="text-[10px] text-[color:var(--color-muted)] tabular-nums">
                {d.avoidable_errors}/{d.errors ?? 0}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface TooltipPayload {
  payload: {
    bucket: string;
    positions: number;
    avg_cp_loss: number;
    blunders: number;
    blunder_pct: number;
  };
}

function RichTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface-2)] px-3 py-2.5 shadow-2xl min-w-[200px]">
      <div className="text-[10px] font-mono uppercase tracking-widest text-[color:var(--color-muted)] mb-1.5">
        Tempo rimasto: {p.bucket}
      </div>
      <Row label="ACPL medio" value={p.avg_cp_loss} color="var(--color-brand-soft)" suffix="" />
      <Row label="% mosse blunder" value={p.blunder_pct} color="#f43f5e" suffix="%" />
      <div className="my-1.5 h-px bg-[color:var(--color-line)]" />
      <Row label="Mosse totali" value={p.positions} />
      <Row label="Blunder assoluti" value={p.blunders} />
    </div>
  );
}

function Row({
  label,
  value,
  color,
  suffix = "",
}: {
  label: string;
  value: number | string;
  color?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[color:var(--color-muted)] flex items-center gap-1.5">
        {color && <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />}
        {label}
      </span>
      <span className="text-[color:var(--color-text)] tabular-nums font-medium">
        {value}{suffix}
      </span>
    </div>
  );
}

function StatCard({
  label,
  sub,
  value,
  metric,
  extra,
  danger,
}: {
  label: string;
  sub: string;
  value: string | number;
  metric: string;
  extra: string;
  danger?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value tabular-nums ${danger ? "text-rose-300" : ""}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
      <div className="text-[11px] font-mono mt-2 pt-2 border-t border-[color:var(--color-line)] text-[color:var(--color-text-soft)] flex items-baseline justify-between">
        <span>{metric}</span>
        {extra && <span className="text-[color:var(--color-muted)]">{extra}</span>}
      </div>
    </div>
  );
}
