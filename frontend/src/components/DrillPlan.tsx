import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import type { PositionRow } from "../types";
import { BoardView } from "./BoardView";
import { useStockfish, type EvalResult } from "../engine/useStockfish";
import { cpToHuman, cpToPawns } from "../glossary";
import { turnFromFen } from "../chess-utils";
import { rankDrills, recordVerdict, srsLabel } from "../srs";
import { CoachNote } from "./CoachNote";
import { maiaLabel, positionCoachLine } from "../coaching";

/**
 * TRAINER POSIZIONALE INTERATTIVO.
 *
 * Per ogni drill (un blunder evitabile alla tua forza):
 *   1. mostra la posizione (FEN), tocca a te
 *   2. trascini un pezzo -> la mossa viene applicata
 *   3. il tavolo di analisi valuta la posizione PRIMA della tua mossa
 *      e DOPO la tua mossa (cp_after).
 *   4. cp_loss = cp_before - cp_after (dal POV del tuo colore).
 *   5. Feedback:
 *        verde   : cp_loss < 30   -> "hai trovato la mossa giusta"
 *        giallo  : cp_loss < 100  -> "giocabile, ma c'era meglio"
 *        rosso   : cp_loss >= 100 -> "errore, ecco la giusta"
 *   6. Fila salvata in localStorage. +1 se verde, reset se rosso.
 */

interface Props {
  drills: PositionRow[];
  maiaLevel?: number;
}

type Verdict = null | "perfect" | "ok" | "wrong";

interface StreakState {
  current: number;
  best: number;
  solvedIds: string[];      // "<game_id>:<ply>" per dedup
  lastSolved: number;       // epoch
}

const STREAK_KEY = "mygotham_drill_streak_v1";

function loadStreak(): StreakState {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    if (raw) return { current: 0, best: 0, solvedIds: [], lastSolved: 0, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { current: 0, best: 0, solvedIds: [], lastSolved: 0 };
}

function saveStreak(s: StreakState): void {
  try { localStorage.setItem(STREAK_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function DrillPlan({ drills, maiaLevel = 1600 }: Props) {
  const sf = useStockfish();
  // SRS: riordina i drill mettendo prima i "da ripassare" e i "nuovi".
  // Memo per drills.length per stabilità (no shuffle a ogni render).
  const orderedDrills = useMemo(() => rankDrills(drills), [drills]);
  const [idx, setIdx] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [cpLoss, setCpLoss] = useState<number | null>(null);
  const [playedSan, setPlayedSan] = useState<string | null>(null);
  const [displayFen, setDisplayFen] = useState<string | null>(null); // FEN mostrato (dopo la mia mossa)
  const [evaluating, setEvaluating] = useState(false);
  const [streak, setStreak] = useState<StreakState>(loadStreak);

  // Reset stato quando cambio posizione
  useEffect(() => {
    setVerdict(null);
    setCpLoss(null);
    setPlayedSan(null);
    setDisplayFen(null);
  }, [idx]);

  if (!orderedDrills || orderedDrills.length === 0) {
    return (
      <div className="surface surface-padded">
        <p className="text-[color:var(--color-text-soft)]">Nessuna posizione disponibile.</p>
      </div>
    );
  }

  const safeIdx = ((idx % orderedDrills.length) + orderedDrills.length) % orderedDrills.length;
  const d = orderedDrills[safeIdx];
  const orientation = d.my_color || turnFromFen(d.fen_before);
  const baseFen = d.fen_before;
  const drillKey = `${d.game_id}:${d.ply}`;

  // Quando l'utente droppa un pezzo
  async function onDrop(from: string, to: string): Promise<boolean> {
    if (verdict !== null) return false;     // gia' giudicato
    if (evaluating) return false;
    const board = new Chess(baseFen);
    // promotion sempre a regina per semplificare (qui il pawn promotion sarebbe gestita meglio in UI)
    const move = board.move({ from, to, promotion: "q" } as never);
    if (!move) return false;

    const fenAfter = board.fen();
    const myColor: "white" | "black" = orientation;
    setPlayedSan(move.san);
    setDisplayFen(fenAfter); // mostra il pezzo nella nuova casa (altrimenti react-chessboard fa snap-back)
    setEvaluating(true);

    try {
      const evBefore: EvalResult = await sf.evaluate(baseFen, { depth: 14 });
      const evAfter: EvalResult = await sf.evaluate(fenAfter, { depth: 14 });
      // Score dal POV del player AL TRATTO in quel FEN.
      // Per fare cp_loss devo riportare tutto allo stesso POV (mio colore).
      const cpBeforeMine = scoreFromMyPov(evBefore, myColor === "white", "white" === sideToMove(baseFen));
      const cpAfterMine = scoreFromMyPov(evAfter, myColor === "white", "white" === sideToMove(fenAfter));
      const loss = Math.max(0, cpBeforeMine - cpAfterMine);
      setCpLoss(loss);

      let v: Verdict;
      if (loss < 30) v = "perfect";
      else if (loss < 100) v = "ok";
      else v = "wrong";
      setVerdict(v);

      // SRS: registra il verdict (sempre, anche su gia` risolto)
      recordVerdict(drillKey, v);

      // fila: success solo se perfect/ok E non gia' risolto
      const alreadySolved = streak.solvedIds.includes(drillKey);
      if (v === "perfect" || v === "ok") {
        if (!alreadySolved) {
          const next: StreakState = {
            current: streak.current + 1,
            best: Math.max(streak.best, streak.current + 1),
            solvedIds: [...streak.solvedIds, drillKey].slice(-200),
            lastSolved: Date.now(),
          };
          setStreak(next);
          saveStreak(next);
        }
      } else if (v === "wrong") {
        const next: StreakState = { ...streak, current: 0 };
        setStreak(next);
        saveStreak(next);
      }
    } finally {
      setEvaluating(false);
    }
    return true;
  }

  function next() { setIdx((i) => i + 1); }
  function prev() { setIdx((i) => i - 1); }

  const lichessUrl = `https://lichess.org/analysis?fen=${encodeURIComponent(baseFen)}&color=${orientation}`;
  const alreadySolved = streak.solvedIds.includes(drillKey);
  const progressPct = ((safeIdx + 1) / orderedDrills.length) * 100;

  return (
    <div className="surface surface-padded trainer-shell">
      <div className="trainer-header">
        <div>
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
            Training room - {maiaLabel(maiaLevel)}
          </div>
          <h3 className="trainer-title">Trova la mossa senza tema regalato.</h3>
          <p className="trainer-subtitle">
            La posizione viene dal tuo storico. La soluzione resta coperta: prima leggi
            minacce, pezzi non difesi e candidate forzanti, poi giochi sulla scacchiera.
          </p>
          <div className="trainer-progress" aria-label={`Progresso posizione ${safeIdx + 1} di ${orderedDrills.length}`}>
            <span style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <div className="trainer-scorebox">
          <div>
            <span>Focus</span>
            <strong>{streak.current}</strong>
            <small>record {streak.best}</small>
          </div>
          <div>
            <span>Posizione</span>
            <strong>{safeIdx + 1}/{orderedDrills.length}</strong>
            <SrsChip id={drillKey} />
          </div>
        </div>
      </div>

      <div className="trainer-grid">
        <div className="trainer-board-stage">
          <div className="trainer-board-top">
            <span>{orientation === "white" ? "Bianco" : "Nero"} muove</span>
            <strong>{d.phase}</strong>
          </div>
          <BoardView
            fen={displayFen || baseFen}
            resetKey={drillKey}
            orientation={orientation}
            size={440}
            draggable={verdict === null && !evaluating}
            onPieceDrop={onDrop}
            highlights={[
              ...buildLastOppHighlights(d),
              ...(verdict ? buildHighlights(d, playedSan, baseFen) : []),
            ]}
            arrows={[
              ...buildLastOppArrows(d),
              ...(verdict ? buildArrows(d, playedSan, baseFen) : []),
            ]}
          />
          <div className="trainer-board-info">
            <span>ultima mossa avversaria</span>
            <strong>{d.last_opp_san || "non disponibile"}</strong>
          </div>
        </div>

        <div className="trainer-side">
          <CalculationProtocol />
          <CoachNote text={positionCoachLine(d, maiaLevel)} />

          {/* Contesto */}
          <div className="trainer-context">
            <div className="label-eyebrow">Contesto</div>
            <div className="text-sm text-[color:var(--color-text)] mt-2">
              {d.date} - {d.my_color === "white" ? "bianco" : "nero"} vs{" "}
              <span className="font-semibold tabular-nums">{d.opp_rating ?? "?"}</span>
            </div>
            {d.opening && (
              <div className="text-sm text-[color:var(--color-text-soft)] mt-1">
                {d.opening} <span className="font-mono text-xs opacity-70">({d.eco})</span>
              </div>
            )}
            <div className="text-xs text-[color:var(--color-muted)] mt-1 font-mono">
              mossa {d.move_number} - {d.phase}
            </div>
          </div>

          <TacticChips d={d} revealed={verdict !== null} />

          <DifficultyMoney d={d} maiaLevel={maiaLevel} revealed={verdict !== null} />

          {/* Stato */}
          {!sf.isReady && (
            <div className="pill pill-warn">Preparo il tavolo di analisi...</div>
          )}

          {verdict === null && !evaluating && (
            <div className="trainer-attempt">
              <div>
                <b>Tocca a te.</b> Trascina il pezzo che giocheresti.{" "}
                {alreadySolved && <span>(gia' risolto)</span>}
              </div>
              <small>La correzione, il tema tattico e la linea migliore si sbloccano solo dopo il tentativo.</small>
            </div>
          )}

          {evaluating && (
            <div className="pill pill-brand">Controllo varianti, catture e difensori...</div>
          )}

          {verdict === "perfect" && (
            <Verdict tone="good" title="Mossa esatta">
              {playedSan && <span className="font-mono">{playedSan}</span>} - {cpLoss != null && `perdita ${cpLoss} cp`} -
              ottima scelta.
            </Verdict>
          )}
          {verdict === "ok" && (
            <Verdict tone="warn" title="Giocabile">
              {playedSan && <span className="font-mono">{playedSan}</span>} - cedi {cpLoss} cp.
              Linea migliore: <span className="font-mono text-emerald-300">{d.best_san_sf}</span>
            </Verdict>
          )}
          {verdict === "wrong" && (
            <Verdict tone="bad" title="Errore">
              {playedSan && <span className="font-mono">{playedSan}</span>} - perdi{" "}
              {cpLoss != null ? `${cpToPawns(cpLoss).replace("+", "")} (${cpToHuman(cpLoss)})` : ""}.
              <br />
              Linea corretta: <span className="font-mono text-emerald-300">{d.best_san_sf}</span>
              {d.pv_san_sf && (
                <div className="text-xs font-mono text-[color:var(--color-text-soft)] mt-1">
                  seguito: {d.pv_san_sf}
                </div>
              )}
            </Verdict>
          )}

          <div className="trainer-actions">
            <button onClick={prev} className="btn btn-ghost text-xs">Prec</button>
            <button onClick={next} className="btn btn-ghost text-xs">Succ</button>
            <a href={lichessUrl} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs ml-auto">
              Analizza su Lichess
            </a>
            {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="btn btn-ghost text-xs">Apri partita</a>}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Chip SRS status. "Nuovo" / "Da ripassare" / "Box N - tra Xg".
 */
function SrsChip({ id }: { id: string }) {
  const lbl = srsLabel(id);
  const tone =
    lbl.tone === "due"
      ? { bg: "rgba(244, 63, 94, 0.16)", border: "rgba(244, 63, 94, 0.45)", fg: "#fda4af" }
      : lbl.tone === "new"
      ? { bg: "rgba(124, 92, 255, 0.16)", border: "rgba(124, 92, 255, 0.45)", fg: "#cfc6ff" }
      : { bg: "rgba(52, 211, 153, 0.10)", border: "rgba(52, 211, 153, 0.30)", fg: "#86efac" };
  return (
    <span
      className="inline-block mt-1 px-1.5 py-0.5 rounded text-[9px] tracking-wider uppercase"
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg }}
    >
      {lbl.text}
    </span>
  );
}

function CalculationProtocol() {
  const steps = [
    { label: "Minacce", text: "Cosa vuole l'avversario alla prossima?" },
    { label: "Difensori", text: "Quali pezzi restano senza protezione?" },
    { label: "Candidate", text: "Quali catture, scacchi e mosse forzanti hai?" },
  ];
  return (
    <div className="calculation-protocol" aria-label="Protocollo di calcolo">
      <div className="label-eyebrow">Protocollo</div>
      <div className="calculation-steps">
        {steps.map((step, i) => (
          <div key={step.label} className="calculation-step">
            <span>{i + 1}</span>
            <strong>{step.label}</strong>
            <small>{step.text}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Chip dei motivi tattici. Prima del verdict NON mostriamo i tag (senno'
 * spoileriamo la soluzione: sapere "qui c'e` un fork" suggerisce la mossa).
 * Solo dopo che l'utente ha mosso o ha aperto la soluzione li facciamo vedere.
 */
const _TACTIC_LABELS: { key: keyof PositionRow; label: string; emoji: string }[] = [
  { key: "motif_fork",              label: "Forchetta",            emoji: "" },
  { key: "motif_hanging_piece",     label: "Pezzo appeso",         emoji: "" },
  { key: "motif_removed_defender",  label: "Rimozione difensore",  emoji: "" },
  { key: "motif_back_rank",         label: "Ottava traversa",      emoji: "" },
  { key: "motif_discovered_attack", label: "Attacco scoperto",     emoji: "" },
];

function TacticChips({ d, revealed }: { d: PositionRow; revealed: boolean }) {
  if (!revealed) return null;
  const active = _TACTIC_LABELS.filter((t) => Number((d as unknown as Record<string, unknown>)[t.key]) === 1);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {active.map((t) => (
        <span
          key={t.key as string}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full"
          style={{
            background: "rgba(124, 92, 255, 0.12)",
            border: "1px solid rgba(124, 92, 255, 0.35)",
            color: "#cfc6ff",
          }}
        >
          <span>{t.emoji}</span>
          <span>{t.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * Difficulty-as-money: il cuore del prodotto.
 *
 * Mostra il gap quantificato tra "quanto spesso il target gioca la mossa
 * giusta" vs "quanto spesso il mio livello la gioca". Prima del verdict
 * mostra solo i due numeri, NON la mossa (senno' spoileri la soluzione).
 */
function DifficultyMoney({ d, maiaLevel, revealed }: { d: PositionRow; maiaLevel: number; revealed: boolean }) {
  const pTarget = d.p_target_plays_best_sf;
  const pMine = d.p_mine_plays_best_sf;
  if (pTarget == null || pMine == null) return null;

  const target = Math.round(pTarget * 100);
  const mine = Math.round(pMine * 100);
  const gap = target - mine;

  // tono in base al gap
  const tone =
    gap >= 30 ? { bg: "rgba(244, 63, 94, 0.10)", border: "rgba(244, 63, 94, 0.45)", label: "#fda4af" }
    : gap >= 15 ? { bg: "rgba(251, 191, 36, 0.10)", border: "rgba(251, 191, 36, 0.45)", label: "#fcd34d" }
    : { bg: "rgba(148, 163, 184, 0.08)", border: "rgba(148, 163, 184, 0.30)", label: "#cbd5e1" };

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
    >
      <div className="label-eyebrow" style={{ color: tone.label, marginBottom: "0.5rem" }}>
        Scarto MAIA - mio livello
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-[10px] tracking-wider uppercase text-[color:var(--color-muted)]">
            {maiaLabel(maiaLevel)} trova
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#fff" }}>
            {target}%
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-wider uppercase text-[color:var(--color-muted)]">
            tuo livello
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: "#fff" }}>
            {mine}%
          </div>
        </div>
        <div>
          <div className="text-[10px] tracking-wider uppercase text-[color:var(--color-muted)]">
            gap
          </div>
          <div className="text-2xl font-bold tabular-nums" style={{ color: tone.label }}>
            +{gap}
          </div>
        </div>
      </div>
      {revealed && d.best_san_sf && (
        <div className="text-xs mt-3 leading-relaxed text-[color:var(--color-text-soft)]">
          Il {target}% di {maiaLabel(maiaLevel)} gioca{" "}
          <span className="font-mono text-emerald-300">{d.best_san_sf}</span> qui.
          Al tuo livello la trova solo il {mine}%.
        </div>
      )}
    </div>
  );
}

function Verdict({
  tone,
  title,
  children,
}: {
  tone: "good" | "warn" | "bad";
  title: string;
  children: React.ReactNode;
}) {
  const color = tone === "good" ? "var(--color-ok)" : tone === "warn" ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: `${color}11`,
        border: `1px solid ${color}55`,
        boxShadow: `0 0 30px -10px ${color}88`,
      }}
    >
      <div className="font-[var(--font-display)] text-base font-semibold" style={{ color }}>
        {title}
      </div>
      <div className="text-sm text-[color:var(--color-text)] mt-2 leading-relaxed">{children}</div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function sideToMove(fen: string): "white" | "black" {
  return fen.split(" ")[1] === "b" ? "black" : "white";
}

// Score restituito dal tavolo di analisi: lo riporto SEMPRE
// dal POV del MIO colore (per cp_loss coerente).
function scoreFromMyPov(ev: EvalResult, iAmWhite: boolean, sideToMoveIsWhite: boolean): number {
  let cp = ev.scoreCp ?? 0;
  // se chi muove e' bianco, lo score e' dal POV del bianco. Se chi muove e' nero, dal POV del nero.
  // Normalizzo allo POV del bianco:
  if (!sideToMoveIsWhite) cp = -cp;
  // poi dal POV del MIO colore:
  if (!iAmWhite) cp = -cp;
  // cap
  if (cp > 1000) cp = 1000;
  if (cp < -1000) cp = -1000;
  return cp;
}

// Highlights: rosso = mossa giocata, verde = mossa migliore.
function buildHighlights(d: PositionRow, playedSan: string | null, fen: string) {
  const out: { square: string; color: string }[] = [];
  if (playedSan) {
    const sq = sanToSquares(fen, playedSan);
    if (sq) {
      out.push({ square: sq.from, color: "#f43f5e66" });
      out.push({ square: sq.to, color: "#f43f5e" });
    }
  }
  if (d.best_san_sf) {
    const sq = sanToSquares(fen, d.best_san_sf);
    if (sq) {
      out.push({ square: sq.from, color: "#34d39966" });
      out.push({ square: sq.to, color: "#34d399" });
    }
  }
  return out;
}

function buildArrows(d: PositionRow, playedSan: string | null, fen: string) {
  const out: { from: string; to: string; color?: string }[] = [];
  if (playedSan) {
    const sq = sanToSquares(fen, playedSan);
    if (sq) out.push({ from: sq.from, to: sq.to, color: "#f43f5e" });
  }
  if (d.best_san_sf) {
    const sq = sanToSquares(fen, d.best_san_sf);
    if (sq) out.push({ from: sq.from, to: sq.to, color: "#34d399" });
  }
  return out;
}

function sanToSquares(fen: string, san: string): { from: string; to: string } | null {
  try {
    const c = new Chess(fen);
    const mv = c.move(san, { strict: false } as never);
    if (!mv) return null;
    return { from: mv.from, to: mv.to };
  } catch {
    return null;
  }
}

// Freccia "ultima mossa avversario": sempre visibile, in giallo soft.
function buildLastOppHighlights(d: PositionRow) {
  if (!d.last_opp_from || !d.last_opp_to) return [];
  return [
    { square: d.last_opp_from, color: "#fde04755" },
    { square: d.last_opp_to, color: "#fde04788" },
  ];
}

function buildLastOppArrows(d: PositionRow) {
  if (!d.last_opp_from || !d.last_opp_to) return [];
  return [{ from: d.last_opp_from, to: d.last_opp_to, color: "#fde047" }];
}

