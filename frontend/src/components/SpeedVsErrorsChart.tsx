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
  // Colore barra in base all'ACPL del bucket: alto=rosso (problema), basso=verde (ok).
  // NON in base al tempo, per evitare il bias visivo del racconto canonico
  // "veloce=cattivo" quando i dati del singolo giocatore possono dire l'opposto.
  function colorForAcpl(acpl: number): string {
    if (acpl >= 130) return "#f43f5e";  // rosso
    if (acpl >= 100) return "#fb923c";  // arancio
    if (acpl >= 80) return "#f5a524";   // ambra
    if (acpl >= 65) return "#facc15";   // giallo
    return "#34d399";                   // verde (ACPL < 65 = sweet spot)
  }

  // Tabella dati con percentuali per LabelList
  const enriched = data.map((d) => ({
    ...d,
    error_pct: Math.round(d.error_rate * 100),
  }));

  // Confronto: quanto è ACPL sulle mosse istantanee vs le mosse lunghe.
  // Se fast < slow (cioè la riga "rapide" ha ACPL minore) significa che NON
  // sbagli di più quando muovi in fretta — semplicemente passi più tempo
  // sulle posizioni difficili, ed è lì che sbagli.
  const fast = data.find((d) => d.key === "lt_1s");
  const slow = data.find((d) => d.key === "gt_30s");
  let interpretation: { label: string; tone: "good" | "bad" | "mute"; sub: string } | null = null;
  if (fast && slow) {
    if (fast.avg_cp_loss > slow.avg_cp_loss + 20) {
      interpretation = {
        label: "Sì, muovi troppo veloce",
        tone: "bad",
        sub: `Le mosse <1s costano +${Math.round(fast.avg_cp_loss - slow.avg_cp_loss)} ACPL rispetto a quelle riflessive.`,
      };
    } else if (slow.avg_cp_loss > fast.avg_cp_loss + 20) {
      interpretation = {
        label: "No, pensi solo nelle posizioni difficili",
        tone: "mute",
        sub: `Le mosse rapide hanno ACPL ${Math.round(fast.avg_cp_loss)} (basso). Quelle lunghe ${Math.round(slow.avg_cp_loss)} (alto). Vuol dire che spendi tempo sulle posizioni complesse — è lì che sbagli, non perché muovi veloce.`,
      };
    } else {
      interpretation = {
        label: "Precisione costante",
        tone: "mute",
        sub: "ACPL simile a tutte le velocità.",
      };
    }
  }

  return (
    <div className="surface surface-padded">
      <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
        <div>
          <div className="label-eyebrow">Velocità della mossa</div>
          <h3 className="section-title mt-1">Sbagli perché muovi in fretta?</h3>
        </div>
        {interpretation && (
          <div className="text-right max-w-md">
            <div className="label-eyebrow text-[10px]">Verdetto</div>
            <div className={`display-small mt-1 ${interpretation.tone === "bad" ? "text-rose-300" : interpretation.tone === "good" ? "text-emerald-300" : "text-slate-200"}`}>
              {interpretation.label}
            </div>
          </div>
        )}
      </div>
      <p className="section-sub mb-2">
        Tempo SPESO sulla singola mossa (≠ tempo rimasto sull'orologio). Asse Y: <b>ACPL alto = mossa peggiore</b>.
      </p>
      {interpretation && (
        <p className="text-sm text-[color:var(--color-text-soft)] mb-5 leading-relaxed max-w-3xl">
          {interpretation.sub}
        </p>
      )}

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
                <Cell key={d.key} fill={colorForAcpl(d.avg_cp_loss)} />
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

      <AvoidabilityStrip data={data} />
    </div>
  );
}

/**
 * Strip "evitabili dal target" per bucket. Risponde all'angolo Maia:
 * di tutti gli errori che hai fatto in questo bucket, quanti il 1600 li
 * avrebbe evitati con >40% di probabilita`?
 *
 * Alto = errori "stupidi" che si possono allenare. Basso = errori
 * oggettivamente difficili (anche un target ci cade), quindi meno drillable.
 */
function AvoidabilityStrip({ data }: { data: SpentBucket[] }) {
  const anyAvoidable = data.some((d) => (d.avoidable_errors ?? 0) > 0);
  if (!anyAvoidable) return null;
  return (
    <div className="mt-5 pt-4 border-t border-[color:var(--color-line)]">
      <div className="label-eyebrow text-[10px] mb-2">Di questi errori, quanti evitabili dal target (1600)?</div>
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
                {d.avoidable_errors}/{d.errors}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[11px] text-[color:var(--color-muted)] mt-3 leading-relaxed">
        Avoidable = posizioni dove il target Maia trova la mossa giusta con
        &gt;40% probabilita`. Alto = errore "stupido", drillable.
      </div>
    </div>
  );
}
