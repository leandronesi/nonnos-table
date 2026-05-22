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
import type { SpentBucket } from "../types";

/**
 * Chart "quanti errori faccio quando muovo TROPPO IN FRETTA".
 *
 * Asse X: tempo SPESO sulla mossa (NON tempo rimasto sull'orologio).
 * Linea viola: ACPL medio. Barre rosa→verde: error rate (% mosse con mistake/blunder).
 *
 * La domanda a cui risponde: "le mie mosse istantanee sono mosse cattive?"
 */
export function SpeedVsErrorsChart({ data }: { data: SpentBucket[] }) {
  if (!data || data.length === 0) {
    return (
      <div className="surface surface-padded">
        <p className="text-[color:var(--color-text-soft)]">
          Niente dati di tempo per-mossa (i PGN più vecchi non avevano i tag [%clk]).
        </p>
      </div>
    );
  }
  // Colore barra in base al tempo: rosso intenso quando muovi in fretta, verde quando rifletti
  const colors: Record<string, string> = {
    lt_1s: "#f43f5e",
    "1_3s": "#fb923c",
    "3_10s": "#facc15",
    "10_30s": "#86efac",
    gt_30s: "#34d399",
  };

  // Tabella dati con percentuali per LabelList
  const enriched = data.map((d) => ({
    ...d,
    error_pct: Math.round(d.error_rate * 100),
  }));

  // Stat veloce: confronto < 1s vs > 30s
  const fast = data.find((d) => d.key === "lt_1s");
  const slow = data.find((d) => d.key === "gt_30s");
  const acplDelta = fast && slow ? Math.round(fast.avg_cp_loss - slow.avg_cp_loss) : null;

  return (
    <div className="surface surface-padded">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="label-eyebrow">Velocità della mossa</div>
          <h3 className="section-title mt-1">
            Quanto sbagli quando muovi in fretta
          </h3>
        </div>
        {acplDelta != null && (
          <div className="text-right">
            <div className="label-eyebrow text-[10px]">∆ ACPL fretta vs riflessione</div>
            <div className={`display-small mt-1 ${acplDelta > 30 ? "text-rose-300" : "text-slate-200"}`}>
              {acplDelta > 0 ? "+" : ""}{acplDelta}
            </div>
          </div>
        )}
      </div>
      <p className="section-sub mb-5">
        Tempo SPESO sulla singola mossa (≠ tempo rimasto sull'orologio). Le barre rosse a
        sinistra sono mosse "istantanee". Le verdi a destra sono mosse riflessive.
        ACPL alto + barra alta = pilota automatico che ti costa partite.
      </p>

      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={enriched} margin={{ top: 24, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: "var(--color-line)" }} />
            <YAxis yAxisId="left" tickLine={false} axisLine={false} width={50} label={{ value: "ACPL", angle: -90, position: "insideLeft", fill: "var(--color-muted)", fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={50} domain={[0, "auto"]} label={{ value: "% mosse errore", angle: 90, position: "insideRight", fill: "var(--color-muted)", fontSize: 11 }} />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (name === "avg_cp_loss") return [value, "ACPL"];
                if (name === "error_pct") return [`${value}%`, "Mosse errore"];
                return [value, name];
              }}
            />
            <Legend
              formatter={(v) =>
                v === "avg_cp_loss" ? "ACPL (precisione)" : v === "error_pct" ? "Errori (% mosse)" : v
              }
            />
            <Bar yAxisId="right" dataKey="error_pct" name="error_pct" radius={[6, 6, 0, 0]}>
              {enriched.map((d) => (
                <Cell key={d.key} fill={colors[d.key]} />
              ))}
              <LabelList dataKey="positions" position="top" fill="var(--color-muted)" fontSize={10} formatter={(v: number) => `n=${v}`} />
            </Bar>
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avg_cp_loss"
              name="avg_cp_loss"
              stroke="var(--color-brand-soft)"
              strokeWidth={2.5}
              dot={{ r: 5, fill: "var(--color-brand-soft)", strokeWidth: 0 }}
            >
              <LabelList dataKey="avg_cp_loss" position="top" fill="var(--color-brand-soft)" fontSize={11} offset={10} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
