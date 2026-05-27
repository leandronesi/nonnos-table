/**
 * TemaStep — Fase 1 della sessione 4-step.
 *
 * Passiva: l'utente guarda, non muove. Mostra la posizione più rappresentativa
 * del pattern del giorno con highlight della mossa avversaria e voce di Nonno.
 */
import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";
import { BoardLegend } from "../components/BoardLegend";

interface TemaStepProps {
  position: PositionRow;
  patternLabel: string;  // es. "il pezzo in presa"
  onNext: () => void;
}

// ---------------------------------------------------------------------------
// Coach voice helpers (parametrizzati su tempo, MAIA, waiting_moves)
// ---------------------------------------------------------------------------

type CoachLineParams = {
  patternLabel: string;
  cp_loss: number;
  p_mine?: number | null;    // MAIA mine (% che trovavo la giusta)
  p_target?: number | null;  // MAIA target (% che trova il 1600)
  motif?: string | null;
  oppRating?: number | null;
  date?: string | null;
};

function buildCoachLines(p: CoachLineParams): string[] {
  const lines: string[] = [];
  const loss = Math.round(p.cp_loss / 100 * 10) / 10;  // in pedoni

  // Linea 1: contesto posizione
  if (p.motif) {
    lines.push(`Guarda questa posizione: c'era un tema tattico — ${p.motif}.`);
  } else {
    lines.push(`Guarda questa posizione. È il pattern che stiamo lavorando questa settimana: ${p.patternLabel}.`);
  }

  // Linea 2: peso dell'errore + confronto MAIA
  if (p.cp_loss > 200) {
    lines.push(`La mossa giocata valeva −${loss} pedoni. Un errore pesante.`);
  } else if (p.cp_loss > 80) {
    lines.push(`La mossa giocata ha ceduto ${loss} pedoni. Evitabile.`);
  } else {
    lines.push(`Una piccola imprecisione, −${loss} pedoni. Ma si ripete.`);
  }

  // Linea 3: confronto livelli — voce Nonno, non statistico
  const minePct = p.p_mine != null ? Math.round(p.p_mine * 10) : null; // /10 per "su 10 volte"
  const targetPct = p.p_target != null ? Math.round(p.p_target * 10) : null;
  if (minePct != null && targetPct != null) {
    const gap = targetPct - minePct;
    if (gap >= 2) {
      lines.push(
        `Su 10 volte come questa, tu la prendi ${minePct}, uno al tuo obiettivo la prende ${targetPct}. ` +
        `Lavoriamo proprio su quel divario.`
      );
    } else if (targetPct <= 5) {
      lines.push(`Difficile anche per chi punti a diventare. Si lavora con calma.`);
    } else {
      lines.push(`Sei già vicino. Un po' di attenzione e diventa tua.`);
    }
  }

  // Linea 4: CTA verso warm-up
  lines.push(`Adesso passiamo al warm-up: la stessa posizione, ma la giochi tu.`);

  return lines;
}

// ---------------------------------------------------------------------------
// Seleziona la variazione di frase per "non aspettare" (waiting moves)
// ---------------------------------------------------------------------------
const WAITING_PHRASES = [
  "Prenditi 10 secondi. Guarda le frecce.",
  "Osserva la scacchiera prima di andare avanti.",
  "Respira. Scansiona le minacce.",
];

function pickWaiting(seed: number): string {
  return WAITING_PHRASES[Math.abs(seed) % WAITING_PHRASES.length];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemaStep({ position, patternLabel, onNext }: TemaStepProps) {
  const orientation = position.my_color || "white";

  // Highlight ultima mossa avversario (freccia gialla, stile Chess.com)
  const highlights = [
    ...(position.last_opp_from && position.last_opp_to
      ? [
          { square: position.last_opp_from, color: "#fde04755" },
          { square: position.last_opp_to, color: "#fde04788" },
        ]
      : []),
    // Highlight mossa giocata (rossa) per mostrare l'errore
    ...(position.best_san_sf && position.best_san_sf !== position.san
      ? [] // non mostriamo la giusta in Tema, è passiva
      : []),
  ];

  const arrows = [
    ...(position.last_opp_from && position.last_opp_to
      ? [{ from: position.last_opp_from, to: position.last_opp_to, color: "#fde047" }]
      : []),
  ];

  const coachLines = buildCoachLines({
    patternLabel,
    cp_loss: position.cp_loss,
    p_mine: position.p_mine_plays_best_sf,
    p_target: position.p_target_plays_best_sf,
    motif: position.motif_label_it,
    oppRating: position.opp_rating,
    date: position.date,
  });

  const waitingHint = pickWaiting(position.ply);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-10 items-start">
      {/* Scacchiera statica + legenda */}
      <div className="flex flex-col items-center gap-2">
        <BoardView
          fen={position.fen_before}
          resetKey={`tema:${position.game_id}:${position.ply}`}
          orientation={orientation}
          size={460}
          draggable={false}
          highlights={highlights}
          arrows={arrows}
        />
        <BoardLegend preset="tema" />
      </div>

      {/* Pannello informazioni */}
      <div className="space-y-5">
        {/* Header */}
        <div>
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
            Tema · {patternLabel}
          </div>
          <h3 className="display-small mt-2">
            Guarda la posizione
          </h3>
          <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
            {position.date && <span>{position.date}</span>}
            {position.opp_rating != null && (
              <span> · vs <span className="font-semibold tabular-nums">{position.opp_rating}</span></span>
            )}
            {position.opening && (
              <span> · {position.opening}
                {position.eco && <span className="font-mono opacity-70 text-xs"> ({position.eco})</span>}
              </span>
            )}
          </div>
        </div>

        {/* Invito all'osservazione */}
        <div
          className="rounded-xl p-4 border"
          style={{ background: "rgba(124,92,255,0.06)", borderColor: "rgba(124,92,255,0.25)" }}
        >
          <div className="label-eyebrow text-[color:var(--color-brand-soft)] mb-1">Osserva</div>
          <div className="text-sm leading-relaxed">{waitingHint}</div>
        </div>

        {/* Voce di Nonno */}
        <div className="space-y-3">
          {coachLines.map((line, i) => (
            <p
              key={i}
              className={
                "text-sm leading-relaxed " +
                (i === 0
                  ? "text-[color:var(--color-text)] font-medium"
                  : "text-[color:var(--color-text-soft)]")
              }
            >
              {line}
            </p>
          ))}
        </div>

        {/* Mossa giocata vs mossa giusta */}
        <div className="rounded-xl p-4 border border-[color:var(--color-line)] bg-white/[0.02] space-y-2 text-sm">
          <div className="label-eyebrow">Mossa giocata vs giusta</div>
          <div className="flex gap-6 mt-2">
            <div>
              <div className="label-eyebrow text-[10px]">Hai giocato</div>
              <span className="font-mono font-semibold text-rose-300">{position.san}</span>
            </div>
            {position.best_san_sf && position.best_san_sf !== position.san && (
              <div>
                <div className="label-eyebrow text-[10px]">Era</div>
                <span className="font-mono font-semibold text-emerald-300">{position.best_san_sf}</span>
              </div>
            )}
          </div>
        </div>

        {/* CTA */}
        <button onClick={onNext} className="btn btn-primary w-full justify-center">
          Vai al warm-up →
        </button>
      </div>
    </div>
  );
}
