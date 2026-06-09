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

/** % errori evitabili per fascia di tempo, da aggregates.maia_weighted.spent_vs_avoidable. */
export interface AvoidableByTime {
  key: string;
  errors: number;
  avoidable: number;
}

/**
 * "Sbagli perche' muovi in fretta?" — il grafico originale: per fascia di tempo
 * SPESO sulla mossa, le barre = % mosse-errore, la linea = ACPL (precisione).
 * SOTTO ogni cluster: la % di errori EVITABILI al tuo livello (Maia), quando
 * disponibile. Cosi' il tempo e' letto INSIEME alla difficolta':
 * tanti evitabili sulle mosse veloci = corri su posizioni che potevi risolvere.
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
    const avoidPct = av && av.errors > 0 ? Math.round((av.avoidable / av.errors) * 100) : null;
    return {
      bucket: b.bucket,
      key: b.key,
      error_pct: Math.round((b.error_rate ?? 0) * 100),
      acpl: Math.round(b.avg_cp_loss ?? 0),
      avoidPct,
      avoidCount: av ? `${av.avoidable}/${av.errors}` : null,
    };
  });

  const hasAvoidable = rows.some((r) => r.avoidPct != null);

  function barColor(errPct: number): string {
    if (errPct >= 35) return "#fb923c"; // arancio
    if (errPct >= 22) return "#f5a524"; // ambra
    return "#facc15"; // giallo
  }

  return (
    <div className="surface surface-padded">
      <div className="label-eyebrow">Velocità della mossa</div>
      <h3 className="section-title mt-1">Sbagli perché muovi in fretta?</h3>
      <p className="section-sub mb-4">
        Tempo speso sulla singola mossa (non il tempo rimasto sull'orologio). La linea sale quando la mossa e' peggiore.{hasAvoidable ? " Sotto ogni fascia: quanti di quegli errori erano alla tua portata." : ""}
      </p>

      <div className="h-[260px]" role="img" aria-label="Grafico velocità mossa vs errori">
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
              formatter={(value: number, name: string) => {
                if (name === "error_pct") return [`${value}%`, "Errori"];
                if (name === "acpl") return [value, "Errore medio"];
                return [value, name];
              }}
              labelFormatter={(label: string) => `Tempo: ${label}`}
              contentStyle={{
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-line)",
                borderRadius: "6px",
                fontFamily: "var(--font-mono)",
                fontSize: "0.75rem",
                color: "var(--color-text)",
              }}
              itemStyle={{ color: "var(--color-text)" }}
              labelStyle={{ color: "var(--color-muted)" }}
            />
            <Legend
              verticalAlign="bottom"
              height={28}
              formatter={(v: string) => (v === "error_pct" ? "Errori (% mosse)" : "Errore medio")}
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

      {/* SOTTO ogni cluster: % errori evitabili (Maia). Allineato alle barre. */}
      {hasAvoidable && (
        <div className="flex mt-1" style={{ paddingLeft: 36, paddingRight: 40 }}>
          {rows.map((r) => (
            <div key={r.key} className="flex-1 text-center min-w-0">
              <div
                className="font-mono font-bold tabular-nums"
                style={{
                  fontSize: "1rem",
                  lineHeight: 1,
                  color:
                    r.avoidPct == null
                      ? "var(--color-faint)"
                      : r.avoidPct >= 50
                      ? "var(--color-danger)"
                      : "var(--color-text-soft)",
                }}
              >
                {r.avoidPct != null ? `${r.avoidPct}%` : "—"}
              </div>
              <div
                className="font-mono"
                style={{ fontSize: "0.55rem", letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-muted)", marginTop: "0.15rem" }}
              >
                evitabili{r.avoidCount ? ` ${r.avoidCount}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasAvoidable && (
        <div className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--color-muted)" }}>
          Evitabili = mosse che un giocatore al tuo livello trovava. Tante evitabili sulle mosse
          veloci: stai correndo su posizioni che potevi risolvere. Poche sulle mosse lente: erano
          difficili davvero, non colpa tua.
        </div>
      )}
    </div>
  );
}
