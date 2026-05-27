import type { PositionRow } from "../types";
import { BoardView } from "../components/BoardView";

interface MomentReviewProps {
  position: PositionRow;
  index: number;   // 0-based
  total: number;
  maiaLevel: number;
  onNext: () => void;
  onPrev?: () => void;
}

/**
 * Un momento di review: mostra la posizione critica, il contesto (mosse precedenti),
 * e la voce di Nonno parametrizzata con dati reali (tempo, MAIA, mossa d'attesa).
 *
 * Fallback semplice per prev_moves: lista SAN statica, no navigazione ply.
 */
export function MomentReview({ position, index, total, onNext, onPrev }: MomentReviewProps) {
  const orientation = position.my_color || "white";

  // Freccia ultima mossa avversario (contesto visivo)
  const arrows = position.last_opp_from && position.last_opp_to
    ? [{ from: position.last_opp_from, to: position.last_opp_to, color: "#fde047" }]
    : [];
  const highlights = position.last_opp_from && position.last_opp_to
    ? [
        { square: position.last_opp_from, color: "#fde04755" },
        { square: position.last_opp_to, color: "#fde04788" },
      ]
    : [];

  const coachLines = buildCoachLines(position);
  const dateLabel = position.date ? formatItalianDate(position.date) : null;
  const moveLabel = position.move_number
    ? `${position.move_number}${orientation === "white" ? "." : "…"}`
    : null;

  return (
    <div className="moment-review fade-in">
      <div className="moment-review-header">
        <span className="moment-review-index">{index + 1} di {total}</span>
        {dateLabel && <span className="moment-review-date">{dateLabel}</span>}
        {position.opp_rating && (
          <span className="moment-review-opp">vs {position.opp_rating}</span>
        )}
        {position.opening && (
          <span className="moment-review-opening">{position.opening}</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-8 items-start mt-5">
        <div className="moment-review-board-frame flex justify-center">
          <BoardView
            fen={position.fen_before}
            orientation={orientation}
            size={460}
            resetKey={`review-${position.game_id}:${position.ply}`}
            arrows={arrows}
            highlights={highlights}
          />
        </div>

        <div className="space-y-5">
          {/* Prev moves — fallback statico */}
          {position.prev_moves && position.prev_moves.length > 0 && (
            <div className="moment-review-prev-moves">
              <div className="moment-review-prev-label">Prima di qui</div>
              <div className="moment-review-prev-sequence">
                {position.prev_moves.map((san, i) => (
                  <span key={i} className="moment-review-prev-move">{san}</span>
                ))}
                {moveLabel && (
                  <>
                    <span className="moment-review-prev-arrow">→</span>
                    <span className="moment-review-prev-move moment-review-prev-current">
                      {moveLabel} {position.san}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Frasi Nonno */}
          {coachLines.length > 0 && (
            <div className="moment-review-coach-lines">
              {coachLines.map((line, i) => (
                <p key={i} className="moment-review-coach-line">{line}</p>
              ))}
            </div>
          )}

          {/* Info posizione */}
          <div className="space-y-2 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="label-eyebrow w-36">Mossa giocata</span>
              <span className="font-mono font-semibold text-[color:var(--color-danger)]">
                {position.san}
              </span>
            </div>
            {position.best_san_sf && position.best_san_sf !== position.san && (
              <div className="flex items-baseline gap-2">
                <span className="label-eyebrow w-36">Mossa giusta</span>
                <span className="font-mono font-semibold text-[color:var(--color-ok)]">
                  {position.best_san_sf}
                </span>
              </div>
            )}
            {position.pv_san_sf && (
              <div className="flex items-baseline gap-2">
                <span className="label-eyebrow w-36">Seguito</span>
                <span className="font-mono text-xs text-[color:var(--color-text-soft)]">
                  {position.pv_san_sf}
                </span>
              </div>
            )}
            {position.motif_label_it && (
              <div className="flex items-baseline gap-2">
                <span className="label-eyebrow w-36">Tema</span>
                <span className="font-mono text-xs">{position.motif_label_it}</span>
              </div>
            )}
          </div>

          <div className="moment-review-actions">
            {onPrev && (
              <button onClick={onPrev} className="btn btn-ghost">
                ← Indietro
              </button>
            )}
            <button onClick={onNext} className="btn btn-primary flex-1 justify-center">
              {index + 1 >= total ? "Vai alla partita →" : "Avanti →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Voce Nonno — template puro, no LLM
// ---------------------------------------------------------------------------

// Varianti randomiche per evitare il loop meccanico

const RIGA1_VARIANTS: ((san: string, sec: number | null) => string)[] = [
  (san, sec) => sec != null ? `Hai mosso ${san} in ${sec} secondi.` : `Hai giocato ${san}.`,
  (san, sec) => sec != null && sec < 3 ? `${san}, ${sec} secondi e via.` : sec != null ? `${sec} secondi per ${san}.` : `${san}.`,
  (san, sec) => sec != null && sec > 15 ? `Hai pensato ${sec} secondi e hai mosso ${san}.` : sec != null ? `${san}, dopo ${sec} secondi.` : `${san}.`,
];

const RIGA2_VARIANTS: ((best: string) => string)[] = [
  (best) => `La mossa giusta era ${best}.`,
  (best) => `Andava giocata ${best}.`,
  (best) => `${best} era la mossa.`,
];

const RIGA3_HARD_VARIANTS: ((mine: number, target: number, maiaLabel: string) => string)[] = [
  (mine, target, _m) => `Solo ${mine} su 10 al tuo livello l'avrebbe trovata. Per un giocatore al tuo target era ${target} su 10.`,
  (mine, target, _m) => `Una mossa difficile per il tuo livello: la trovavano ${mine} su 10. Più chiara per chi vuoi diventare (${target} su 10).`,
  (mine, _t, m) => `Per il tuo livello era una mossa quasi invisibile (${mine} su 10). Per un ${m} era già più chiara.`,
];

const RIGA3_HARD_FOR_ALL_VARIANTS: ((mine: number) => string)[] = [
  (_mine) => `Era difficile per chiunque a questo livello.`,
  (_mine) => `Mossa che pochi trovano. Non per forza tua colpa.`,
  (mine) => `Non è una mossa semplice — solo ${mine} su 10 la trovavano.`,
];

const RIGA4_VARIANTS: ((list: string) => string)[] = [
  (list) => `Lì era meglio una mossa di attesa: ${list}. Aspettare, non forzare quando non vedi.`,
  (list) => `Quando non vedi il colpo, gioca calma: ${list}. Mosse che tengono la posizione.`,
  (list) => `${list} — mosse d'attesa. Meglio di forzare a vuoto.`,
];

const RIGA4_FALLBACK_VARIANTS: (() => string)[] = [
  () => `In posizioni così, se non vedi niente di concreto, rallenta e conta le minacce.`,
  () => `Quando il colpo non c'è, conta i difensori. Una mossa che tiene è meglio di un colpo a vuoto.`,
  () => `Senza un piano forzante chiaro, gioca solido. Il calcolo arriva dopo, prima la sicurezza.`,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildCoachLines(p: PositionRow): string[] {
  const lines: string[] = [];

  // Riga 1: hai mosso X in N secondi (varianti)
  const sec = p.spent_seconds != null && p.spent_seconds > 0 ? Math.round(p.spent_seconds) : null;
  lines.push(pick(RIGA1_VARIANTS)(p.san, sec));

  // Riga 2: la mossa giusta era Y (se diversa)
  if (p.best_san_sf && p.best_san_sf !== p.san) {
    lines.push(pick(RIGA2_VARIANTS)(p.best_san_sf));
  }

  // Riga 3: confronto MAIA (varianti, solo se p_maia_mine_top basso)
  const pMine = p.p_maia_mine_top;
  const pTarget = p.p_maia_target_top;
  if (pMine != null && pMine < 0.20) {
    const nOf10 = Math.max(1, Math.round(pMine * 10));
    if (pTarget != null && pTarget > pMine * 1.5) {
      const targetOf10 = Math.round(pTarget * 10);
      lines.push(pick(RIGA3_HARD_VARIANTS)(nOf10, targetOf10, formatMaiaLevel(pTarget)));
    } else {
      lines.push(pick(RIGA3_HARD_FOR_ALL_VARIANTS)(nOf10));
    }
  }

  // Riga 4: mossa d'attesa (varianti)
  if (p.waiting_moves && p.waiting_moves.length > 0) {
    const wm = p.waiting_moves.slice(0, 3).map((w) => w.san).join(", ");
    lines.push(pick(RIGA4_VARIANTS)(wm));
  } else if (pMine != null && pMine < 0.20 && p.best_san_sf) {
    lines.push(pick(RIGA4_FALLBACK_VARIANTS)());
  }

  return lines;
}

function formatMaiaLevel(p: number): string {
  // Stima approssimativa del livello Maia dalla top-policy
  if (p >= 0.5) return "1600+";
  if (p >= 0.35) return "1500";
  if (p >= 0.20) return "1400";
  return "1300";
}

function formatItalianDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}
