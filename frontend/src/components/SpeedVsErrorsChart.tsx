import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SpentBucket } from "../types";
import { NonnoExplain } from "./NonnoExplain";
import { tr } from "../i18n/lang";

/** Errori Maia-scored con supporto della policy al livello attuale, per fascia. */
export interface AvoidableByTime {
  key: string;
  errors: number;
  avoidable: number;
}

/**
 * Associazione tra tempo speso ed errori: per fascia di tempo
 * SPESO sulla mossa, le barre = % mosse-errore, la linea = ACPL (precisione).
 * SOTTO ogni cluster: la quota di posizioni-errore con avoidable_at_current=true,
 * quando disponibile. Il grafico descrive un'associazione: difficolta',
 * fase e tempo rimasto possono influenzare sia i secondi sia la qualita'.
 */
export function SpeedVsErrorsChart({
  data,
  avoidable,
}: {
  data: SpentBucket[];
  avoidable?: AvoidableByTime[];
}) {
  if (!data || data.length === 0) return null;

  const avoidMap = new Map<string, AvoidableByTime>();
  for (const a of avoidable ?? []) avoidMap.set(a.key, a);

  const rows = data.map((b) => {
    const av = avoidMap.get(b.key);
    const supportPct = av && av.errors > 0 ? Math.round((av.avoidable / av.errors) * 100) : null;
    return {
      bucket: b.bucket,
      key: b.key,
      positions: b.positions,
      errors: b.errors,
      error_pct: Math.round((b.error_rate ?? 0) * 100),
      acpl: Math.round(b.avg_cp_loss ?? 0),
      supportPct,
      supportedErrors: av?.avoidable ?? null,
      scoredErrors: av?.errors ?? null,
    };
  });

  const hasCurrentSupport = rows.some((r) => r.supportPct != null);

  function barColor(errPct: number): string {
    if (errPct >= 35) return "#fb923c"; // arancio
    if (errPct >= 22) return "#f5a524"; // ambra
    return "#facc15"; // giallo
  }

  return (
    <div className="surface surface-padded">
      <div className="label-eyebrow" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        {tr("Velocita' della mossa", "Move speed")}
        <NonnoExplain
          title={tr("Velocita' e errori", "Speed and errors")}
          lines={[
            tr(
              "Qui confronti tempo speso ed errori osservati. Barre alte sulle mosse veloci indicano piu' errori in quella fascia, ma non provano che la fretta li abbia causati.",
              "This compares time spent with observed errors. Tall bars on fast moves mean more errors in that band, but do not prove that rushing caused them.",
            ),
            tr(
              "Difficolta' della posizione, fase e tempo rimasto possono cambiare insieme sia i secondi sia la qualita'. Usa il grafico per scegliere cosa rivedere.",
              "Position difficulty, phase, and time remaining can affect both seconds and quality. Use the chart to choose what to review.",
            ),
          ]}
        />
      </div>
      <h3 className="section-title mt-1">{tr("Come cambiano gli errori col tempo speso?", "How do errors vary with time spent?")}</h3>
      <p className="section-sub mb-4">
        {tr(
          "Tempo speso sulla singola mossa, non tempo rimasto. La linea sale quando la perdita media aumenta. E' un'associazione osservata, non una causa.",
          "Time spent on each move, not time remaining. The line rises as average loss increases. This is an observed association, not a cause.",
        )}
        {hasCurrentSupport ? tr(" Sotto ogni fascia: quota di posizioni-errore Maia-scored con supporto al livello attuale.", " Below each band: share of Maia-scored error positions with current-level support.") : ""}
      </p>

      <div className="h-[260px]" role="img" aria-label={tr("Grafico tempo speso ed errori", "Time spent and errors chart")}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 24, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickLine={false}
              axisLine={{ stroke: "var(--color-line)" }}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 11, fill: "var(--color-muted)" }}
            />
            <YAxis
              yAxisId="acpl"
              tickLine={false}
              axisLine={false}
              width={36}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--color-muted)" }}
            />
            <YAxis
              yAxisId="err"
              orientation="right"
              tickLine={false}
              axisLine={false}
              width={40}
              domain={[0, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fontFamily: "var(--font-mono)", fontSize: 10, fill: "var(--color-muted)" }}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.03)" }}
              content={<SpeedTooltip />}
            />
            <Legend
              verticalAlign="bottom"
              height={28}
              formatter={(v: string) => (v === "error_pct" ? tr("Errori (% mosse)", "Errors (% of moves)") : tr("Errore medio per mossa", "Average error per move"))}
              wrapperStyle={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}
            />
            <Bar yAxisId="err" dataKey="error_pct" name="error_pct" radius={[6, 6, 0, 0]} maxBarSize={64}>
              {rows.map((r) => (
                <Cell key={r.key} fill={barColor(r.error_pct)} />
              ))}
              <LabelList
                dataKey="error_pct"
                position="top"
                formatter={(v: number) => `${v}%`}
                fill="var(--color-text)"
                fontSize={12}
                fontFamily="var(--font-mono)"
                fontWeight={700}
              />
            </Bar>
            <Line
              yAxisId="acpl"
              type="monotone"
              dataKey="acpl"
              name="acpl"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              dot={{ r: 4, fill: "var(--color-brand-soft)", stroke: "var(--color-bg)", strokeWidth: 2 }}
            >
              <LabelList
                dataKey="acpl"
                position="top"
                fill="var(--color-brand-soft)"
                fontSize={11}
                fontFamily="var(--font-mono)"
                fontWeight={700}
              />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Quota di posizioni-errore con supporto Maia attuale. */}
      {hasCurrentSupport && (
        <div className="flex mt-1 overflow-x-auto pb-1" style={{ paddingLeft: 36, paddingRight: 40 }}>
          {rows.map((r) => (
            <div key={r.key} className="flex-1 text-center min-w-[5.25rem]">
              <div
                className="font-mono font-bold tabular-nums"
                style={{
                  fontSize: "1rem",
                  lineHeight: 1,
                  color:
                    r.supportPct == null
                      ? "var(--color-faint)"
                      : r.supportPct >= 50
                      ? "var(--color-danger)"
                      : "var(--color-text-soft)",
                }}
              >
                {r.supportPct != null ? `${r.supportPct}%` : "—"}
              </div>
              <div
                className="font-mono"
                style={{ fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", marginTop: "0.15rem" }}
              >
                {tr("supporto attuale", "current support")}
                {r.supportedErrors != null && r.scoredErrors != null
                  ? ` ${r.supportedErrors}/${r.scoredErrors}`
                  : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasCurrentSupport && (
        <div className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--color-muted)" }}>
          {tr(
            "Supporto attuale = posizioni-errore Maia-scored con avoidable_at_current. E' una classificazione relativa della policy del modello, non probabilita' o facilita'. La distribuzione per velocita' non dimostra una causa.",
            "Current support = Maia-scored error positions with avoidable_at_current. It is a relative model-policy classification, not probability or ease. Its distribution by speed does not show causation.",
          )}
        </div>
      )}
    </div>
  );
}

interface SpeedTooltipRow {
  bucket: string;
  positions: number;
  errors: number;
  error_pct: number;
  acpl: number;
  supportPct: number | null;
  supportedErrors: number | null;
  scoredErrors: number | null;
}

function SpeedTooltip({ active, payload }: { active?: boolean; payload?: { payload: SpeedTooltipRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-[color:var(--color-line-strong)] bg-[color:var(--color-surface-2)] px-3 py-2.5 min-w-[220px] text-xs">
      <div className="font-mono uppercase tracking-widest text-[color:var(--color-muted)] mb-1.5">
        {tr("Tempo speso", "Time spent")}: {row.bucket}
      </div>
      <div className="flex justify-between gap-4"><span>{tr("Mosse osservate", "Observed moves")}</span><b>{row.positions}</b></div>
      <div className="flex justify-between gap-4"><span>{tr("Errori osservati", "Observed errors")}</span><b>{row.errors} ({row.error_pct}%)</b></div>
      <div className="flex justify-between gap-4"><span>{tr("Perdita media", "Average loss")}</span><b>{row.acpl}</b></div>
      {row.supportedErrors != null && row.scoredErrors != null && (
        <div className="flex justify-between gap-4 mt-1 pt-1 border-t border-[color:var(--color-line)]">
          <span>{tr("Supporto Maia attuale", "Current Maia support")}</span>
          <b>{row.supportedErrors}/{row.scoredErrors} ({row.supportPct}%)</b>
        </div>
      )}
    </div>
  );
}
