/**
 * Quaderno — backstage navigabile a tab. Quattro domande, quattro schede.
 *
 * STRUTTURA:
 *   Tab 1 — EVOLUZIONE : "sto migliorando?" — le ancore nel tempo (sparkline) con
 *                         micro-riga transfer per le ancore tattiche, curva dal primo
 *                         giorno (RatingCurveChart + Giorno 1 vs oggi), striscia
 *                         compatta dei traguardi (computeMilestones), diagnosi collassabile.
 *   Tab 2 — CADUTE     : "dove cado?" — galleria posizioni allenabili, raggruppabile
 *                         "per ancora" (default) o "per giorno" (rassegna del Diario).
 *   Tab 3 — PROFILO    : "chi sono?" — decisioni, tempo, tilt, fase, colore.
 *   Tab 4 — REPERTORIO : aperture e dove si concentrano gli errori evitabili.
 *
 * Cross-link OOUX:
 *   Ancora (Evoluzione) -> filtra Cadute per motif/tipo
 *   Caduta -> mostra apertura (eco/opening)
 *
 * Route deep-link via URL hash: #evoluzione | #cadute | #profilo | #repertorio
 *   Alias legacy: #percorso/#storia/#traguardi -> evoluzione, #diario -> cadute
 *
 * Invarianti DESIGN.md:
 *   - FLAT: tonal layers, niente ombre decorative
 *   - twilight <=15%, una CTA per schermo
 *   - ORO solo Obiettivo e rating_upside
 *   - niente gradient-text, em-dash, card-dentro-card
 *   - classi tt-* + .segment/.segment-item
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../auth/AuthContext";
import { downloadJson, downloadText, quadernoPath } from "../../auth/storage";
import { PRODUCT_NAME } from "../../coaching";
import type { Aggregates, PositionExample } from "../../pipeline/aggregate";
import { WEAKNESS_META } from "../../pipeline/aggregate";
import type { PlayerModelLite } from "../../pipeline/playerModelLite";
import type { HistoryFile, Milestone, AnchorTrail, TimeManagement, Tilt } from "../../types";
import {
  readHistory,
  computeMilestones,
  anchorTrendsFromHistory,
} from "../../pipeline/history";
import { Viaggio } from "../../components/Viaggio";
import { RatingCurveChart } from "../../components/RatingCurveChart";
import { DecisionsCard } from "../../components/DecisionsCard";
import { WeeklyTrendCard } from "../../components/WeeklyTrendCard";
import { SpeedVsErrorsChart } from "../../components/SpeedVsErrorsChart";
import { TimeManagementChart } from "../../components/TimeManagementChart";
import { GameArcChart } from "../../components/GameArcChart";
import { BoardView } from "../../components/BoardView";
import { RepertorioPanel } from "../../components/RepertorioPanel";
import { CaduteTrainer } from "../../session/CaduteTrainer";
import { uciToArrow, uciToSan } from "./boardArrows";

// ── Tab definition ─────────────────────────────────────────────────────────────

type TabKey = "evoluzione" | "cadute" | "profilo" | "repertorio";

const TABS: { key: TabKey; label: string }[] = [
  { key: "evoluzione",  label: "Evoluzione"  },
  { key: "cadute",      label: "Cadute"      },
  { key: "profilo",     label: "Profilo"     },
  { key: "repertorio",  label: "Repertorio"  },
];

function tabFromHash(): TabKey {
  const h = typeof window !== "undefined" ? window.location.hash.replace("#", "") : "";
  // Legacy hash aliases: Percorso/Storia/Traguardi were merged into Evoluzione,
  // and Diario was merged into Cadute. Keep old deep-links alive.
  if (h === "percorso" || h === "storia" || h === "traguardi") return "evoluzione";
  if (h === "diario") return "cadute";
  return TABS.some((t) => t.key === h) ? (h as TabKey) : "evoluzione";
}

// ── Italian date helpers ───────────────────────────────────────────────────────

const MONTHS_IT = [
  "gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic",
];

function dateIt(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS_IT[d.getMonth()]} ${d.getFullYear()}`;
  } catch { return iso.slice(0, 10); }
}

// ── Reveal ─────────────────────────────────────────────────────────────────────

function useReveal(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { el.classList.add("in"); io.disconnect(); } },
      { threshold: 0.06 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
}

function Reveal({ children, delay = 0, className = "" }: {
  children: React.ReactNode; delay?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref);
  return (
    <div ref={ref} className={`tt-reveal ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

// ── Mini sparkline (SVG, no dep) ──────────────────────────────────────────────

function MiniSparkline({ points, improving, neutral = false }: { points: number[]; improving: boolean; neutral?: boolean }) {
  if (points.length < 2) return null;
  const W = 80, H = 22, PAD = 2;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const pts = points.map((v, i) => ({
    x: PAD + ((W - PAD * 2) * i) / (points.length - 1),
    y: PAD + (H - PAD * 2) * (1 - (v - min) / range),
  }));
  const polyline = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const lineColor = neutral ? "var(--color-faint)" : improving ? "var(--color-ok)" : "var(--color-danger)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true"
      style={{ display: "block", flexShrink: 0 }}>
      <polyline points={polyline} fill="none" stroke={lineColor}
        strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x.toFixed(1)} cy={last.y.toFixed(1)} r="3" fill={lineColor} />
    </svg>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ children, eyebrow, delay = 0 }: {
  children: React.ReactNode; eyebrow?: string; delay?: number;
}) {
  return (
    <Reveal delay={delay} className="mb-8">
      <div
        className="paper"
        style={{
          border: "1px solid var(--color-line)",
          borderRadius: "14px",
          padding: "clamp(18px,4vw,28px)",
        }}
      >
        {eyebrow && (
          <div className="tt-eyebrow" style={{ marginBottom: "1rem", color: "var(--color-muted)" }}>
            {eyebrow}
          </div>
        )}
        {children}
      </div>
    </Reveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: EVOLUZIONE ("sto migliorando?") — anchor trails + transfer micro-line,
// "dal primo giorno" (rating curve + day1 vs now), traguardi strip, diagnosi.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFER -> ANCORA mapping (for the per-anchor "transfer" micro-line)
// Only tactical anchors get a micro-line. The transfer motifs (heuristic, chess.js)
// map to anchor types as follows:
//   hanging_piece -> hung_piece    ("Pezzi in presa")
//   fork + back_rank -> missed_tactic ("Tattiche mancate": doppio attacco, ultima traversa)
// Non-tactical anchors (zeitnot/rushed/conversion/careless) get no micro-line.
// ─────────────────────────────────────────────────────────────────────────────

/** Which transfer motifs feed each anchor key. */
const ANCHOR_TRANSFER_MOTIFS: Record<string, import("../../types").TransferMotifType[]> = {
  hung_piece:    ["hanging_piece"],
  missed_tactic: ["fork", "back_rank"],
};

interface TransferWindow { faced: number; handled: number }

/**
 * Aggregates the transfer recent/prior windows for an anchor key.
 * Returns null when the anchor is not tactical or has no recent faced positions.
 */
function transferForAnchor(
  anchorKey: string,
  transfer: import("../../pipeline/aggregate").Aggregates["transfer"] | null | undefined,
): { recent: TransferWindow; prior: TransferWindow | null } | null {
  const motifs = ANCHOR_TRANSFER_MOTIFS[anchorKey];
  if (!motifs || !transfer) return null;

  const sum = (stats: import("../../types").TransferMotifStat[]): TransferWindow => {
    let faced = 0, handled = 0;
    for (const s of stats) {
      if (motifs.includes(s.motif)) { faced += s.faced; handled += s.handled; }
    }
    return { faced, handled };
  };

  const recent = sum(transfer.recent);
  if (recent.faced === 0) return null;

  const priorRaw = sum(transfer.prior);
  const prior = priorRaw.faced > 0 ? priorRaw : null;
  return { recent, prior };
}

/** Faint Nonno micro-line: "di recente gestito 7 su 10 (prima 4 su 8)". */
function transferMicroLine(t: { recent: TransferWindow; prior: TransferWindow | null }): string {
  const r = `di recente gestito ${t.recent.handled} su ${t.recent.faced}`;
  if (t.prior) return `${r} (prima ${t.prior.handled} su ${t.prior.faced})`;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANCHOR TRAILS — sparkline per-ancora nel tempo (3A)
// Cuore della prova di progresso: frequenza errore per ancora, snapshot-by-snapshot.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds Nonno's verdict line for one AnchorTrail.
 * Honest: only speaks when freq is real (not null on endpoints).
 * Nonno voice: calm, direct, Italian chess vocabulary.
 */
/** Phrase a per-game error frequency in Nonno's voice (no bare decimals). */
function freqPhrase(freq: number): string {
  if (freq <= 0.001) return "quasi sparita";
  if (freq < 1) return `circa 1 ogni ${Math.max(2, Math.round(1 / freq))} partite`;
  return `${freq.toFixed(1)} volte a partita`;
}

function anchorTrailVerdictLine(trail: AnchorTrail): string {
  const first = trail.points[0];
  const last  = trail.points[trail.points.length - 1];

  if (first.freq == null || last.freq == null) {
    return "Il segnale e' incompleto: alcune sessioni non hanno dati di frequenza.";
  }

  const firstP = freqPhrase(first.freq);
  const lastP  = freqPhrase(last.freq);

  if (trail.direction === "improving") {
    return `Prima ${firstP}, ora ${lastP}. Sta calando: continua.`;
  }
  if (trail.direction === "worsening") {
    return `Prima ${firstP}, ora ${lastP}. E' risalita: tienila d'occhio.`;
  }
  // stable
  if (last.freq <= 0.5) {
    return `Stabile, ${lastP}. Bassa, va bene.`;
  }
  return `Stabile, ${lastP}. Non peggiora, ma non cala ancora.`;
}

function AnchorTrailsSection({
  history,
  transfer,
  onSelectAnchor,
}: {
  history: HistoryFile;
  transfer: import("../../pipeline/aggregate").Aggregates["transfer"] | null | undefined;
  onSelectAnchor: (anchorType: string) => void;
}) {
  const trails = anchorTrendsFromHistory(history);

  return (
    <Section eyebrow="Le tue ancore nel tempo" delay={80}>
      {trails.length === 0 ? (
        <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", lineHeight: 1.6 }}>
          Il percorso si disegna con le analisi: torna dopo la prossima.
        </div>
      ) : (
        <div>
          {trails.map((trail, i) => {
            const improving = trail.direction === "improving";
            const worsening = trail.direction === "worsening";
            const freqPoints = trail.points
              .map((p) => p.freq)
              .filter((f): f is number => f != null);
            const verdict = anchorTrailVerdictLine(trail);
            // Transfer micro-line: only for tactical anchors with recent faced data.
            const transferData = transferForAnchor(trail.key, transfer);

            return (
              <div
                key={trail.key}
                style={{
                  padding: "0.875rem 0",
                  borderBottom: i < trails.length - 1 ? "1px solid var(--color-line)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem" }}>
                  {/* Label + verdict */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
                      <button
                        onClick={() => onSelectAnchor(trail.key)}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: 0,
                          fontWeight: 700, fontSize: "0.92rem",
                          color: worsening ? "var(--color-warn)" : "var(--color-text)",
                          textAlign: "left",
                          textDecoration: "underline", textUnderlineOffset: "2px",
                          textDecorationColor: "transparent",
                          transition: "text-decoration-color 160ms",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecorationColor = "currentColor"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.textDecorationColor = "transparent"; }}
                        title="Vai alle cadute per questa ancora"
                      >
                        {trail.label_it}
                      </button>
                      {improving && (
                        <span className="tt-chip good" style={{ fontSize: "0.65rem" }}>in calo</span>
                      )}
                      {worsening && (
                        <span className="tt-chip warn" style={{ fontSize: "0.65rem" }}>in salita</span>
                      )}
                      {trail.confidence === "low" && (
                        <span className="tt-chip" style={{ fontSize: "0.6rem", color: "var(--color-faint)", background: "rgba(255,255,255,0.03)" }}>dati parziali</span>
                      )}
                    </div>
                    {WEAKNESS_META[trail.key]?.meaning_it && (
                      <div style={{ marginBottom: "0.375rem", fontSize: "0.78rem", color: "var(--color-faint)", lineHeight: 1.45 }}>
                        {WEAKNESS_META[trail.key]?.meaning_it}
                      </div>
                    )}
                    <div style={{ fontSize: "0.82rem", color: "var(--color-text-soft)", lineHeight: 1.55 }}>
                      {verdict}
                    </div>
                    {/* Transfer micro-line (tactical anchors only): "di recente gestito 7 su 10 (prima 4 su 8)" */}
                    {transferData && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.72rem", color: "var(--color-faint)", lineHeight: 1.5, fontVariantNumeric: "tabular-nums" }}>
                        {transferMicroLine(transferData)}
                      </div>
                    )}
                    <div style={{ marginTop: "0.25rem", fontSize: "0.72rem", color: "var(--color-faint)", fontVariantNumeric: "tabular-nums" }}>
                      {trail.points.length} analisi
                    </div>
                  </div>

                  {/* Sparkline */}
                  {freqPoints.length >= 2 && (
                    <div style={{ flexShrink: 0, paddingTop: "0.25rem" }}>
                      <MiniSparkline
                        points={freqPoints}
                        improving={improving}
                        neutral={!improving && !worsening}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSI COLLAPSIBLE (latest journal entry, secondary)
// ─────────────────────────────────────────────────────────────────────────────

function DiagnosiCollapsible({ entry }: { entry: JournalEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal delay={240} className="mb-6">
      <div style={{ border: "1px solid var(--color-line)", borderRadius: "10px", overflow: "hidden" }}>
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            width: "100%", padding: "0.75rem 1rem",
            background: "var(--color-surface)", border: "none", cursor: "pointer",
            textAlign: "left", gap: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.78rem", color: "var(--color-faint)", fontFamily: "var(--font-mono)" }}>
            Diagnosi attuale di Nonno · {dateIt(entry.date)}
          </span>
          <span style={{ color: "var(--color-muted)", fontSize: "0.72rem", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 200ms" }}>
            ▾
          </span>
        </button>
        {open && (
          <div style={{ padding: "0.75rem 1rem 1rem", borderTop: "1px solid var(--color-line)", background: "var(--color-surface)" }}>
            <div style={{ fontSize: "0.84rem", color: "var(--color-text-soft)", lineHeight: 1.65 }}>
              {entry.text.split("\n").map((line, j, arr) => (
                <span key={j}>{renderInline(line)}{j < arr.length - 1 && <br />}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </Reveal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DIARIO logic — per-day review, reused inside Cadute as the "per giorno" grouping
// (the morning-after review survives as a view, not a separate tab)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A per-day review.
 * "The morning-after review": reviews games of day D (played on D).
 * The framing is "yesterday" for the most recent day.
 */
interface DayReview {
  /** ISO date "YYYY-MM-DD" of the day games were played */
  date: string;
  n_games: number;
  wins: number;
  draws: number;
  losses: number;
  n_errori_gravi: number;
  errori_per_fase: { apertura: number; mediogioco: number; finale: number };
  /** Dominant anchor label for this day, or null if no anchors */
  ancora_dominante: string | null;
  /** Worst position of the day (highest cp_loss) */
  peggior_caduta: {
    cp_loss: number;
    phase: string;
    game_url: string | null;
    fen_before: string;
    color: "white" | "black";
    played_uci: string;
    best_uci: string | null;
  } | null;
}

/**
 * Build per-day reviews from rating_curve (games metadata) and cadute (errors).
 * One DayReview per day where at least one game was played.
 * Sorted descending (most recent first).
 */
function buildDayReviews(
  ratingCurve: Record<string, import("../../types").RatingPoint[]> | undefined,
  cadute: import("../../pipeline/aggregate").PositionExample[] | undefined,
  anchors: import("../../pipeline/aggregate").Anchor[] | undefined,
): DayReview[] {
  if (!ratingCurve) return [];

  // ── Step 1: collect all games per date from rating_curve ──────────────────
  // rating_curve is Record<time_class, RatingPoint[]>
  // Each RatingPoint has date (YYYY-MM-DD), result, game_id
  const gamesByDate = new Map<string, {
    wins: number; draws: number; losses: number;
    gameIds: Set<string>;
  }>();

  for (const pts of Object.values(ratingCurve)) {
    for (const pt of pts) {
      if (!pt.date) continue;
      const d = pt.date.slice(0, 10);
      if (!gamesByDate.has(d)) {
        gamesByDate.set(d, { wins: 0, draws: 0, losses: 0, gameIds: new Set() });
      }
      const g = gamesByDate.get(d)!;
      g.gameIds.add(pt.game_id ?? d + Math.random());
      if (pt.result === "win") g.wins++;
      else if (pt.result === "draw") g.draws++;
      else if (pt.result === "loss") g.losses++;
    }
  }

  if (gamesByDate.size === 0) return [];

  // ── Step 2: group cadute by date ──────────────────────────────────────────
  interface DayCadute {
    n_gravi: number;
    fase: { apertura: number; mediogioco: number; finale: number };
    worst: import("../../pipeline/aggregate").PositionExample | null;
    anchorTypes: Record<string, number>;
  }

  const caduteByDate = new Map<string, DayCadute>();

  for (const c of cadute ?? []) {
    if (!c.played_at) continue;
    const d = c.played_at.slice(0, 10);
    if (!caduteByDate.has(d)) {
      caduteByDate.set(d, {
        n_gravi: 0,
        fase: { apertura: 0, mediogioco: 0, finale: 0 },
        worst: null,
        anchorTypes: {},
      });
    }
    const dc = caduteByDate.get(d)!;
    dc.n_gravi++;

    // Count by phase
    const ph = c.phase ?? "mediogioco";
    if (ph === "apertura") dc.fase.apertura++;
    else if (ph === "finale") dc.fase.finale++;
    else dc.fase.mediogioco++;

    // Track worst (max cp_loss)
    if (!dc.worst || c.cp_loss > dc.worst.cp_loss) dc.worst = c;

    // Anchor type from error_type
    if (c.error_type) {
      dc.anchorTypes[c.error_type] = (dc.anchorTypes[c.error_type] ?? 0) + 1;
    }
  }

  // Build anchor label map
  const anchorLabelMap = new Map<string, string>();
  for (const a of anchors ?? []) {
    anchorLabelMap.set(a.type, a.label_it);
  }

  // ── Step 3: build DayReview per date ─────────────────────────────────────
  const reviews: DayReview[] = [];

  for (const [date, gd] of gamesByDate) {
    const dc = caduteByDate.get(date);

    // Dominant anchor: the error type with the highest count for this day
    let ancoraDominante: string | null = null;
    if (dc && Object.keys(dc.anchorTypes).length > 0) {
      const topType = Object.entries(dc.anchorTypes).sort((a, b) => b[1] - a[1])[0][0];
      ancoraDominante = anchorLabelMap.get(topType) ?? topType;
    }

    reviews.push({
      date,
      n_games: gd.wins + gd.draws + gd.losses || Array.from(gd.gameIds).length,
      wins: gd.wins,
      draws: gd.draws,
      losses: gd.losses,
      n_errori_gravi: dc?.n_gravi ?? 0,
      errori_per_fase: dc?.fase ?? { apertura: 0, mediogioco: 0, finale: 0 },
      ancora_dominante: ancoraDominante,
      peggior_caduta: dc?.worst
        ? {
            cp_loss: dc.worst.cp_loss,
            phase: dc.worst.phase,
            game_url: dc.worst.game_url ?? null,
            fen_before: dc.worst.fen_before,
            color: dc.worst.color,
            played_uci: dc.worst.played_uci,
            best_uci: dc.worst.best_uci ?? null,
          }
        : null,
    });
  }

  // Sort descending (most recent first)
  reviews.sort((a, b) => b.date.localeCompare(a.date));
  return reviews;
}

/** Nonno's voice line for a day, template-based (no LLM) */
function nonnoLineDayTemplate(r: DayReview, isLatest: boolean): string {
  const dateStr = isLatest ? `Ieri (${dateIt(r.date)})` : `Il ${dateIt(r.date)}`;
  const resultStr = (() => {
    if (r.n_games === 0) return "nessuna partita registrata";
    const res: string[] = [];
    if (r.wins > 0) res.push(`${r.wins} ${r.wins === 1 ? "vinta" : "vinte"}`);
    if (r.draws > 0) res.push(`${r.draws} patta`);
    if (r.losses > 0) res.push(`${r.losses} ${r.losses === 1 ? "persa" : "perse"}`);
    return res.join(", ");
  })();

  if (r.n_errori_gravi === 0) {
    return `${dateStr} hai giocato ${r.n_games} ${r.n_games === 1 ? "partita" : "partite"} (${resultStr}) senza errori gravi. Giornata pulita.`;
  }

  const faseTop = (() => {
    const f = r.errori_per_fase;
    const max = Math.max(f.apertura, f.mediogioco, f.finale);
    if (max === 0) return "mediogioco";
    if (f.mediogioco === max) return "mediogioco";
    if (f.apertura === max) return "apertura";
    return "finale";
  })();

  const ancoraPart = r.ancora_dominante ? ` Ancora piu' frequente: ${r.ancora_dominante}.` : "";

  return `${dateStr} hai giocato ${r.n_games} ${r.n_games === 1 ? "partita" : "partite"} (${resultStr}): ${r.n_errori_gravi} ${r.n_errori_gravi === 1 ? "errore grave" : "errori gravi"}, soprattutto in ${faseTop}.${ancoraPart}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAGUARDI — compact strip (merged into Evoluzione, secondary)
// Reuses deduplicateMilestones/computeMilestones logic, rendered tight: the achieved
// thresholds as muted chips + the single closest next-in-progress with a bar.
// No badges/gamification: these are real measures.
// ─────────────────────────────────────────────────────────────────────────────

function TraguardiStrip({
  milestones,
  historyLength,
}: {
  milestones: Milestone[];
  historyLength: number;
}) {
  const dedupedCards = deduplicateMilestones(milestones);

  // All achieved milestones, as compact chips (most relevant per type, plus passed thresholds).
  const achievedChips: { key: string; label: string }[] = [];
  for (const { topAchieved, allAchievedSameType } of dedupedCards) {
    if (topAchieved.type === "rating_gain" || topAchieved.type === "gap_closed") {
      // Show only the highest threshold passed per type (it implies the lower ones).
      const top = [...allAchievedSameType].sort((a, b) => b.threshold - a.threshold)[0];
      achievedChips.push({
        key: `${top.type}-${top.threshold}`,
        label: top.type === "rating_gain"
          ? `+${top.threshold} punti`
          : `${Math.round(top.threshold * 100)}% del gap`,
      });
    } else {
      achievedChips.push({ key: `${topAchieved.type}`, label: topAchieved.label_it.replace(/^"|"$/g, "") });
    }
  }

  // Single closest next-in-progress across all types.
  const allInProgress = milestones
    .filter((m) => !m.achieved && m.progress_pct != null && m.progress_pct < 1)
    .sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0));
  const next = allInProgress[0] ?? null;
  const nextPct = next != null ? Math.round((next.progress_pct ?? 0) * 100) : null;

  // Nothing to show yet.
  if (historyLength < 2 || (achievedChips.length === 0 && next == null)) {
    return (
      <Section eyebrow="Traguardi" delay={300}>
        <div style={{ color: "var(--color-muted)", fontSize: "0.84rem", lineHeight: 1.6 }}>
          {historyLength < 2
            ? "I traguardi si calcolano dopo la seconda analisi. Sono misure reali, arrivano con la continuita'."
            : "Nessun traguardo ancora. Continua a giocare."}
        </div>
      </Section>
    );
  }

  return (
    <Section eyebrow="Traguardi" delay={300}>
      {/* Achieved, as muted chips */}
      {achievedChips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: next != null ? "1rem" : 0 }}>
          {achievedChips.map((c) => (
            <span key={c.key}
              className="tt-chip"
              style={{ background: "color-mix(in srgb, var(--color-ok) 10%, transparent)", color: "var(--color-ok)", fontSize: "0.72rem" }}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      {/* The single closest next, with bar */}
      {next != null && nextPct != null && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "0.5rem", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.82rem", color: "var(--color-text-soft)", lineHeight: 1.3 }}>
              Prossimo: {next.label_it.replace(/^"|"$/g, "")}
            </div>
            <span className="font-mono font-bold" style={{
              flexShrink: 0, fontSize: "0.82rem",
              color: nextPct >= 75 ? "var(--color-ok)" : "var(--color-brand-soft)",
              fontVariantNumeric: "tabular-nums",
            }}>
              {nextPct}%
            </span>
          </div>
          <div style={{ height: "4px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div style={{
              width: `${nextPct}%`, height: "100%", borderRadius: "999px",
              background: nextPct >= 75 ? "var(--color-ok)" : nextPct >= 40 ? "var(--color-warn)" : "var(--color-brand-soft)",
              transition: "width 600ms cubic-bezier(0.23,1,0.32,1)",
            }} />
          </div>
        </div>
      )}
    </Section>
  );
}

function TabEvoluzione({
  aggregates,
  pmLite,
  history,
  journalRaw,
  milestones,
  onSelectAnchor,
}: {
  aggregates: Aggregates | null;
  pmLite: PlayerModelLite | null;
  history: HistoryFile;
  journalRaw: string | null;
  milestones: Milestone[];
  onSelectAnchor: (anchorType: string) => void;
}) {
  const goal = pmLite?.identity?.goal ?? null;
  const transfer = aggregates?.transfer ?? null;

  // Target rating for verdicts
  const evoluzioneTargetRating = pmLite?.identity?.goal?.target ?? null;

  // History for "Dal primo giorno"
  const snaps = [...history.snapshots].sort((a, b) =>
    a.captured_at.localeCompare(b.captured_at),
  );
  const firstSnap = snaps[0] ?? null;
  const lastSnap = snaps[snaps.length - 1] ?? null;

  // Journal entries (deduplicated, for the collapsible diagnosis at bottom)
  const journalEntries = journalRaw ? parseJournal(journalRaw) : [];

  // Maia avoidability verdict for Evoluzione tab (C.5)
  const maiaverdictLine = (() => {
    const mw = aggregates?.maia_weighted;
    if (mw == null || mw.mine_pct == null || mw.target_pct == null) return null;
    const mine = Math.round(mw.mine_pct);
    const tgt = Math.round(mw.target_pct);
    // The sentence frames a positive gap toward the target; with no gap it reads wrong.
    if (tgt <= mine) return null;
    const ratingLabel = evoluzioneTargetRating != null && evoluzioneTargetRating > 0
      ? `Uno da ${evoluzioneTargetRating}`
      : "Uno al tuo obiettivo";
    return `Degli errori che hai fatto, il ${mine}% erano mosse alla tua portata. ${ratingLabel} ne avrebbe evitati il ${tgt}%. La distanza sta tutta li': non nella fortuna, nella visione.`;
  })();

  // Nonno's intro for Evoluzione: identity-framed, "sto migliorando?"
  const evoluzioneNonno = (() => {
    const trails = anchorTrendsFromHistory(history);
    if (trails.length === 0) {
      return "Il percorso si disegna con le analisi. Dopo la seconda vedrai le tue ancore muoversi nel tempo, partita dopo partita.";
    }
    const improving = trails.filter((t) => t.direction === "improving");
    const worsening = trails.filter((t) => t.direction === "worsening");
    if (improving.length > 0 && worsening.length === 0) {
      return "Stai migliorando dove conta: le ancore che seguivamo stanno calando. Qui sotto vedi quanto, una per una.";
    }
    if (worsening.length > 0) {
      return "Qualcosa sta risalendo, te la mostro senza addolcirla. Sotto trovi cosa cala e cosa torna a pesare, ancora per ancora.";
    }
    return "Ecco come stai evolvendo, dal primo giorno a oggi. Le ancore nel tempo, poi il rating, poi i traguardi che hai gia' messo da parte.";
  })();

  // ── "Dal primo giorno": rating curve + day1 vs now ─────────────────────────
  const hasRatingCurve = pmLite?.rating_curve != null &&
    Object.values(pmLite.rating_curve).some((pts) => pts.length > 0);

  const day1Profile = firstSnap != null && lastSnap != null && firstSnap.week_iso !== lastSnap.week_iso
    ? {
        rating: firstSnap.goal.current,
        topAnchors: firstSnap.anchors.slice(0, 3).map((a) => a.label_it),
        gamesAnalyzed: firstSnap.games_analyzed,
        capturedAt: firstSnap.captured_at,
      }
    : null;

  const nowProfile = lastSnap != null
    ? {
        rating: lastSnap.goal.current,
        topAnchors: lastSnap.anchors.slice(0, 3).map((a) => a.label_it),
        gamesAnalyzed: lastSnap.games_analyzed,
      }
    : null;

  const ratingDelta =
    day1Profile?.rating != null && nowProfile?.rating != null
      ? nowProfile.rating - day1Profile.rating
      : null;

  return (
    <div>
      {/* ── Il viaggio — ink timeline (top of Evoluzione) ─────────────────── */}
      {goal != null && (
        <Viaggio
          snapshots={history.snapshots}
          milestones={milestones}
          goal={{
            target: goal.target,
            current: goal.current_rating ?? null,
            deadline: goal.deadline ?? null,
          }}
        />
      )}

      {/* Nonno voice */}
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{evoluzioneNonno}</p>
      </Reveal>

      {/* Maia avoidability verdict */}
      {maiaverdictLine != null && (
        <Reveal delay={20} className="mb-6">
          <p className="tt-nonno">{maiaverdictLine}</p>
        </Reveal>
      )}

      {/* ── Le tue ancore nel tempo (anchor trails + transfer micro-line) ──── */}
      <AnchorTrailsSection history={history} transfer={transfer} onSelectAnchor={onSelectAnchor} />

      {/* ── Dal primo giorno ───────────────────────────────────────────────── */}
      <Section eyebrow="Dal primo giorno" delay={240}>
        {/* Rating curve */}
        {hasRatingCurve && pmLite != null && goal != null ? (
          <Reveal delay={0} className="mb-6">
            <RatingCurveChart ratingCurve={pmLite.rating_curve} goal={goal} />
          </Reveal>
        ) : (
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", marginBottom: "1.5rem" }}>
            Curva di rating non disponibile ancora.
          </div>
        )}

        {/* Day 1 vs now comparison */}
        {day1Profile != null && nowProfile != null ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginTop: "1rem" }}>
            {/* Day 1 */}
            <div style={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line)",
              borderRadius: "10px",
              padding: "1rem",
            }}>
              <div className="tt-eyebrow" style={{ marginBottom: "0.5rem", color: "var(--color-faint)" }}>
                Giorno 1 · {dateIt(day1Profile.capturedAt.slice(0, 10))}
              </div>
              {day1Profile.rating != null && (
                <div className="font-mono font-bold" style={{ fontSize: "1.35rem", color: "var(--color-text)", fontVariantNumeric: "tabular-nums", marginBottom: "0.5rem" }}>
                  {day1Profile.rating}
                </div>
              )}
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-soft)", lineHeight: 1.45 }}>
                {day1Profile.topAnchors.length > 0
                  ? "Ancore: " + day1Profile.topAnchors.join(", ")
                  : "Profilo ancora da costruire"}
              </div>
            </div>

            {/* Now */}
            <div style={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line-strong)",
              borderRadius: "10px",
              padding: "1rem",
            }}>
              <div className="tt-eyebrow" style={{ marginBottom: "0.5rem", color: "var(--color-brand-soft)" }}>
                Oggi
              </div>
              {nowProfile.rating != null && (
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem" }}>
                  <span className="font-mono font-bold" style={{ fontSize: "1.35rem", color: "var(--color-text)", fontVariantNumeric: "tabular-nums" }}>
                    {nowProfile.rating}
                  </span>
                  {ratingDelta != null && (
                    <span
                      className="font-mono"
                      style={{
                        fontSize: "0.85rem",
                        fontVariantNumeric: "tabular-nums",
                        color: ratingDelta > 0 ? "var(--color-ok)" : ratingDelta < 0 ? "var(--color-danger)" : "var(--color-muted)",
                        fontWeight: 700,
                      }}
                    >
                      {ratingDelta > 0 ? "+" : ""}{ratingDelta}
                    </span>
                  )}
                </div>
              )}
              <div style={{ fontSize: "0.78rem", color: "var(--color-text-soft)", lineHeight: 1.45 }}>
                {nowProfile.topAnchors.length > 0
                  ? "Ancore: " + nowProfile.topAnchors.join(", ")
                  : "Nessuna ancora rilevata"}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", marginTop: "1rem" }}>
            Il confronto giorno 1 vs oggi appare dopo la seconda analisi.
          </div>
        )}
      </Section>

      {/* ── Traguardi — striscia compatta (fusa da TabTraguardi), secondaria ── */}
      <TraguardiStrip milestones={milestones} historyLength={history.snapshots.length} />

      {/* ── Coach journal — most recent entry only, collapsible ─────────── */}
      {journalEntries.length > 0 && (
        <DiagnosiCollapsible entry={journalEntries[0]} />
      )}

      {/* Cross-link to anchors */}
      {(aggregates?.anchors?.length ?? 0) > 0 && (
        <Reveal delay={280} className="mb-6">
          <p style={{ fontSize: "0.82rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
            Le ancore nel dettaglio:{" "}
            {(aggregates?.anchors ?? []).slice(0, 3).map((a, i, arr) => (
              <span key={a.type}>
                <button
                  onClick={() => onSelectAnchor(a.type)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-brand-soft)", fontSize: "0.82rem", padding: "0 0.15rem", textDecoration: "underline", textUnderlineOffset: "2px" }}
                >
                  {a.label_it}
                </button>
                {i < arr.length - 1 ? ", " : ""}
              </span>
            ))}
            {" "}(vai alle Cadute per allenarle).
          </p>
        </Reveal>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAGUARDI helpers (consumed by TraguardiStrip, merged into Evoluzione)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Picks the single most relevant achieved milestone per type
 * (highest threshold achieved) and the single closest next-in-progress per type.
 *
 * Returns { topAchieved, nextInProgress } pairs to render — one "card" per type.
 */
function deduplicateMilestones(milestones: Milestone[]): Array<{
  topAchieved: Milestone;
  allAchievedSameType: Milestone[];
  nextInProgress: Milestone | null;
}> {
  // Group by type
  const byType = new Map<string, { achieved: Milestone[]; inProgress: Milestone[] }>();
  for (const m of milestones) {
    let grp = byType.get(m.type);
    if (!grp) { grp = { achieved: [], inProgress: [] }; byType.set(m.type, grp); }
    if (m.achieved) grp.achieved.push(m);
    else if (m.progress_pct != null && m.progress_pct < 1) grp.inProgress.push(m);
  }

  const result: Array<{
    topAchieved: Milestone;
    allAchievedSameType: Milestone[];
    nextInProgress: Milestone | null;
  }> = [];

  for (const [, grp] of byType) {
    if (grp.achieved.length === 0) continue;
    // Most relevant = highest threshold achieved
    const sorted = [...grp.achieved].sort((a, b) => b.threshold - a.threshold);
    const topAchieved = sorted[0];
    // Next in progress = closest to completion (highest progress_pct with threshold > topAchieved.threshold)
    const nextCandidates = grp.inProgress
      .filter((m) => m.threshold > topAchieved.threshold)
      .sort((a, b) => (b.progress_pct ?? 0) - (a.progress_pct ?? 0));
    const nextInProgress = nextCandidates[0] ?? null;
    result.push({ topAchieved, allAchievedSameType: grp.achieved, nextInProgress });
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// COACH JOURNAL parsing (feeds the collapsible diagnosis in Evoluzione)
// ─────────────────────────────────────────────────────────────────────────────

interface JournalEntry {
  date: string;
  text: string;
}

function parseJournal(raw: string): JournalEntry[] {
  const entries: JournalEntry[] = [];
  // Split on lines that look like "## YYYY-MM-DD" or "# YYYY-MM-DD" or "--- YYYY-MM-DD ---"
  const lines = raw.split(/\r?\n/);
  let current: { date: string; lines: string[] } | null = null;

  for (const line of lines) {
    // Match date header patterns
    const headerMatch =
      line.match(/^#{1,3}\s+(\d{4}-\d{2}-\d{2})/) ||
      line.match(/^---+\s+(\d{4}-\d{2}-\d{2})\s+---+/) ||
      line.match(/^\[(\d{4}-\d{2}-\d{2})\]/);

    if (headerMatch) {
      if (current && current.lines.length > 0) {
        entries.push({ date: current.date, text: current.lines.join("\n").trim() });
      }
      current = { date: headerMatch[1], lines: [] };
    } else if (current) {
      // Skip dividers
      if (!line.match(/^---+$/) && !line.match(/^===+$/)) {
        current.lines.push(line);
      }
    }
  }
  if (current && current.lines.length > 0) {
    entries.push({ date: current.date, text: current.lines.join("\n").trim() });
  }

  // Ordina per DATA decrescente (dalla piu' recente alla piu' vecchia). Il file ha
  // le voci piu' recenti in cima (il coach prepende), quindi il sort STABILE a
  // parita' di data tiene la piu' recente di quel giorno. Poi DEDUP per giorno:
  // una nota al giorno (la coach appende a ogni analisi, anche piu' volte al giorno).
  const ordered = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const seenDate = new Set<string>();
  return ordered.filter((e) => {
    if (seenDate.has(e.date)) return false;
    seenDate.add(e.date);
    return true;
  });
}

/** Render inline del markdown del diario (**grassetto**, _corsivo_) in nodi React. */
function renderInline(text: string): ReactNode[] {
  // Normalizza la copy del diario gia' salvato: "freni/freno" -> "ancore/ancora"
  // (rinominati nel prodotto) e em-dash -> " · " (DESIGN.md). Stopgap a schermo;
  // il template del coach corretto arriva col redeploy di coach-llm.
  text = text
    .replace(/\s*—\s*/g, " · ")
    .replace(/\bFreni\b/g, "Ancore")
    .replace(/\bfreni\b/g, "ancore")
    .replace(/\bFreno\b/g, "Ancora")
    .replace(/\bfreno\b/g, "ancora");
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(
        <strong key={k++} style={{ color: "var(--color-text)", fontWeight: 700 }}>
          {tok.slice(2, -2)}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={k++} style={{ fontStyle: "italic", color: "var(--color-muted)" }}>
          {tok.slice(1, -1)}
        </em>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: PROFILO
// ─────────────────────────────────────────────────────────────────────────────

function HBar({ pct, danger, label, sub }: { pct: number; danger: boolean; label: string; sub: string }) {
  const capped = Math.min(100, pct * 5);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.375rem 0" }}>
      <div className="font-mono" style={{ fontSize: "0.75rem", width: "5.5rem", textAlign: "right", color: "var(--color-muted)", flexShrink: 0 }}>
        {label}
      </div>
      <div style={{ flex: 1, height: "5px", borderRadius: "999px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{
          width: `${capped}%`, height: "100%", borderRadius: "999px",
          background: danger ? "var(--color-danger)" : "var(--color-brand-soft)",
          transition: "width 600ms cubic-bezier(0.22,1,0.36,1)",
        }} />
      </div>
      <div className="font-mono font-bold" style={{ fontSize: "0.88rem", color: danger ? "var(--color-danger)" : "var(--color-text)", flexShrink: 0, fontVariantNumeric: "tabular-nums", width: "3rem", textAlign: "right" }}>
        {pct.toFixed(1)}%
      </div>
      <div className="font-mono" style={{ fontSize: "0.7rem", color: "var(--color-faint)", flexShrink: 0, width: "5rem" }}>
        {sub}
      </div>
    </div>
  );
}

function TabProfilo({
  aggregates,
  pmLite,
  targetRating,
}: {
  aggregates: Aggregates | null;
  pmLite: PlayerModelLite | null;
  targetRating: number;
}) {
  const decisions = pmLite?.decisions ?? null;
  const weeklyTrend = pmLite?.weekly_trend ?? null;
  const showWeekly = weeklyTrend != null && weeklyTrend.last_7d.n_games >= 1;
  const tilt = pmLite?.tilt ?? null;
  const showTilt = tilt != null && tilt.tilt_factor > 1.1 && tilt.after_blunder_n >= 5;

  // Nonno voice for Profilo
  const profiloNonno = (() => {
    if (showTilt && tilt) {
      const factor = tilt.tilt_factor.toFixed(1);
      return `Dopo un errore, nelle mosse che seguono sbagli quasi ${factor} volte piu' del solito. Conosci gia' il punto piu' delicato: e' li' che puoi guadagnare di piu'.`;
    }
    if (decisions != null && decisions.blow_rate != null && decisions.blow_rate > 0.35) {
      return `Trasformi meno del 65% delle posizioni vinte. La tua fase critica e' la conversione: guarda le Decisioni.`;
    }
    return `Qui dentro c'e' il tuo carattere scacchistico: come decidi, dove sbagli, con quale colore, in quale fase. Non giudizi, fatti.`;
  })();

  const phases = aggregates?.by_phase != null
    ? [
        { key: "opening"    as const, label: "Apertura",   pct: aggregates.by_phase.opening.blunder_pct,    moves: aggregates.by_phase.opening.moves    },
        { key: "middlegame" as const, label: "Mediogioco", pct: aggregates.by_phase.middlegame.blunder_pct,  moves: aggregates.by_phase.middlegame.moves  },
        { key: "endgame"    as const, label: "Finale",     pct: aggregates.by_phase.endgame.blunder_pct,     moves: aggregates.by_phase.endgame.moves     },
      ]
    : [];
  const maxPhasePct = phases.length > 0 ? Math.max(...phases.map((p) => p.pct)) : 0;
  const worstPhase = phases.find((p) => p.pct === maxPhasePct && p.pct > 0);

  const colors = aggregates?.by_color
    ? [
        { label: "Bianco", pct: aggregates.by_color.white.blunder_pct, games: aggregates.by_color.white.games, danger: aggregates.by_color.white.blunder_pct > aggregates.by_color.black.blunder_pct },
        { label: "Nero",   pct: aggregates.by_color.black.blunder_pct, games: aggregates.by_color.black.games, danger: aggregates.by_color.black.blunder_pct > aggregates.by_color.white.blunder_pct },
      ]
    : [];
  const colorDelta = colors.length === 2 ? Math.abs(colors[0].pct - colors[1].pct) : 0;
  const weakerColor = colors.find((c) => c.danger);

  const hasSpeedData = (pmLite?.time_management?.spent_vs_accuracy?.length ?? 0) > 0;
  const hasClockData = (pmLite?.time_management?.clock_vs_accuracy?.length ?? 0) > 0;

  // ── verdetti per-blocco (deterministic, only when signal is significant) ──

  // Fase verdict: solo se c'e' una fase dominante chiara (>= 1.5x la seconda)
  const phaseVerdictLine = (() => {
    if (worstPhase == null || phases.length < 2) return null;
    const others = phases.filter((p) => p.key !== worstPhase.key);
    const secondMax = Math.max(...others.map((p) => p.pct));
    if (worstPhase.pct < secondMax * 1.5) return null; // gap non abbastanza netto
    const labelMap: Record<string, string> = { opening: "apertura", middlegame: "mediogioco", endgame: "finale" };
    return `Dove lasci piu' valore e' il ${labelMap[worstPhase.key] ?? worstPhase.label.toLowerCase()}.`;
  })();

  // Colore verdict: solo se il divario e' reale (>= 1.5 punti %)
  const colorVerdictLine = (() => {
    if (weakerColor == null || colorDelta < 1.5) return null;
    return `Col ${weakerColor.label === "Nero" ? "Nero" : "Bianco"} fai piu' fatica: il divario e' reale, vale la pena guardare.`;
  })();

  // Tilt verdict: gia' nel profiloNonno globale, non lo ripetiamo qui

  // SpeedVsErrors verdict (3C-b): dal dato spent_vs_avoidable
  const speedVerdictLine = (() => {
    const sva = aggregates?.maia_weighted?.spent_vs_avoidable;
    if (!sva || sva.length === 0) return null;
    const lt5 = sva.find((b) => b.key === "lt_5s");
    if (!lt5 || lt5.errors === 0) return null;
    const totalErrors = sva.reduce((s, b) => s + b.errors, 0);
    if (totalErrors === 0) return null;
    const avoidPct = Math.round((lt5.avoidable / Math.max(lt5.errors, 1)) * 100);
    if (avoidPct < 30 || lt5.avoidable < 2) return null; // segnale troppo debole
    return `Il ${avoidPct}% degli errori evitabili sulle mosse sotto i 5 secondi: stai forzando posizioni che sapresti risolvere.`;
  })();

  // ClockVsAccuracy verdict (3C-a): il bucket <10% ha errori piu' alti?
  const clockVerdictLine = (() => {
    const cva = pmLite?.time_management?.clock_vs_accuracy;
    if (!cva || cva.length === 0) return null;
    const low = cva.find((b) => b.key === "lt_10pct");
    if (!low || low.positions < 3) return null;
    const avgAll = cva.reduce((s, b) => s + b.avg_cp_loss * b.positions, 0) /
                   Math.max(cva.reduce((s, b) => s + b.positions, 0), 1);
    if (low.avg_cp_loss < avgAll * 1.3) return null; // non abbastanza peggio
    return `Quando l'orologio scende sotto il 10%, gli errori gravi salgono.`;
  })();

  return (
    <div>
      {/* Nonno voice */}
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{profiloNonno}</p>
      </Reveal>

      {/* Decisioni */}
      {decisions != null && (
        <Section eyebrow="Decisioni" delay={60}>
          <DecisionsCard decisions={decisions} />
        </Section>
      )}

      {/* Velocita' vs errori — con verdetto Nonno sopra (3C-b) */}
      {hasSpeedData && (
        <Reveal delay={80} className="mb-8">
          <div>
            {speedVerdictLine && (
              <p className="tt-nonno" style={{ marginBottom: "0.875rem" }}>{speedVerdictLine}</p>
            )}
            <SpeedVsErrorsChart
              data={pmLite!.time_management!.spent_vs_accuracy!}
              avoidable={aggregates?.maia_weighted?.spent_vs_avoidable}
            />
          </div>
        </Reveal>
      )}

      {/* Gestione orologio — TimeManagementChart con verdetto Nonno sopra (3C-a) */}
      {hasClockData && pmLite?.time_management?.clock_vs_accuracy && pmLite?.time_management?.instant_moves_in_critical && pmLite?.time_management?.zeitnot && pmLite.tilt && (
        <Reveal delay={100} className="mb-8">
          <div>
            {clockVerdictLine && (
              <p className="tt-nonno" style={{ marginBottom: "0.875rem" }}>{clockVerdictLine}</p>
            )}
            <TimeManagementChart
              time_management={pmLite.time_management as TimeManagement}
              tilt={pmLite.tilt as Tilt}
              target={targetRating > 0 ? targetRating : undefined}
            />
          </div>
        </Reveal>
      )}

      {/* Gap Maia — GameArcChart (moved from Tavolo) */}
      {aggregates?.maia_weighted != null && (
        <Reveal delay={120} className="mb-8">
          <GameArcChart
            maiaWeighted={aggregates.maia_weighted}
            targetRating={targetRating > 0 ? targetRating : null}
          />
        </Reveal>
      )}

      {/* Tilt */}
      {showTilt && tilt != null && (
        <Section eyebrow="Tilt" delay={140}>
          <p style={{ fontSize: "0.88rem", color: "var(--color-text-soft)", lineHeight: 1.65, margin: 0 }}>
            Dopo un errore, nelle mosse che seguono sbagli quasi{" "}
            <span className="font-mono font-bold" style={{ color: "var(--color-warn)", fontVariantNumeric: "tabular-nums" }}>
              {tilt.tilt_factor.toFixed(1)}
            </span>
            {" "}volte piu' del solito. Te lo porti dietro per qualche mossa, poi passa. Quando senti che hai sbagliato, e' il momento di rallentare, non di recuperare.
          </p>
        </Section>
      )}

      {/* Errori per fase — con verdetto Nonno sopra (3B) */}
      {phases.length > 0 && (
        <Section eyebrow="Errori gravi per fase" delay={180}>
          {phaseVerdictLine && (
            <p style={{ fontSize: "0.88rem", color: "var(--color-text-soft)", lineHeight: 1.55, marginBottom: "0.875rem", marginTop: 0 }}>
              {phaseVerdictLine}
            </p>
          )}
          {phases.map((p) => (
            <HBar key={p.key} label={p.label} pct={p.pct} sub={`${p.moves} mosse`} danger={p.pct === maxPhasePct && p.pct > 0} />
          ))}
        </Section>
      )}

      {/* Bianco vs Nero — con verdetto Nonno sopra (3B) */}
      {colors.length > 0 && (
        <Section eyebrow="Bianco vs Nero" delay={220}>
          {colorVerdictLine && (
            <p style={{ fontSize: "0.88rem", color: "var(--color-text-soft)", lineHeight: 1.55, marginBottom: "0.875rem", marginTop: 0 }}>
              {colorVerdictLine}
            </p>
          )}
          {colors.map((c) => (
            <HBar key={c.label} label={c.label} pct={c.pct} sub={`${c.games} partite`} danger={c.danger} />
          ))}
        </Section>
      )}

      {/* Trend settimanale */}
      {showWeekly && weeklyTrend != null && (
        <Reveal delay={260} className="mb-8">
          <WeeklyTrendCard trend={weeklyTrend} title="Settimana vs precedente" />
        </Reveal>
      )}

      {decisions == null && !hasSpeedData && !hasClockData && phases.length === 0 && (
        <Section delay={0}>
          <div style={{ color: "var(--color-muted)", fontSize: "0.88rem", textAlign: "center", padding: "2rem 0" }}>
            Ancora nessun dato di profilo. Completa l'analisi.
          </div>
        </Section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: CADUTE
// ─────────────────────────────────────────────────────────────────────────────

/** Group cadute by ANCHOR (error_type) — the same taxonomy as everywhere else
 *  (Tavolo, Evoluzione). Key = error_type, "varie" for unclassified. */
interface CaduteGroup {
  key: string;          // anchor (error_type) key, "varie" for unclassified
  label: string;        // Italian display label
  meaning?: string;     // one-line explanation of the anchor
  positions: PositionExample[];
}

function buildCaduteGroups(raw: PositionExample[]): CaduteGroup[] {
  const map = new Map<string, CaduteGroup>();

  for (const pos of raw) {
    const et = pos.error_type ?? null;
    const meta = et ? WEAKNESS_META[et] : undefined;
    const key = et ?? "varie";
    const label = meta?.label_it ?? "Varie";

    let grp = map.get(key);
    if (!grp) {
      grp = { key, label, meaning: meta?.meaning_it, positions: [] };
      map.set(key, grp);
    }
    grp.positions.push(pos);
  }

  // Sort: named anchors by count desc, "varie" last
  const named = [...map.values()].filter((g) => g.key !== "varie").sort((a, b) => b.positions.length - a.positions.length);
  const varie = map.get("varie");
  return varie ? [...named, varie] : named;
}

function avoidabilityLabel(c: PositionExample): "evitabile" | "difficile" | null {
  if (c.avoidable === true || (c.priority_score != null && c.priority_score >= 2)) return "evitabile";
  if (c.move_difficulty != null) {
    return c.move_difficulty >= 0.6 ? "difficile" : c.move_difficulty < 0.5 ? "evitabile" : null;
  }
  return null;
}

/** Mini gallery of position boards for a group */
function GroupGallery({ positions, onOpeningLink }: { positions: PositionExample[]; onOpeningLink: (eco: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
      {positions.slice(0, 6).map((c, i) => {
        const arrowPlayed = uciToArrow(c.played_uci, "rgba(239,68,68,0.85)");
        const arrowBest   = uciToArrow(c.best_uci ?? null, "rgba(34,197,94,0.85)");
        const arrows = [arrowPlayed, arrowBest].filter(Boolean) as { from: string; to: string; color: string }[];
        const avoid = avoidabilityLabel(c);
        return (
          <div key={i} style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-line)", borderRadius: "8px", padding: "0.625rem" }}>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <BoardView fen={c.fen_before} orientation={c.color} size={180} arrows={arrows} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.375rem" }}>
              <span className="tt-chip" style={{ background: "rgba(96,165,250,0.10)", color: "var(--color-info)", fontSize: "0.65rem" }}>
                {c.phase.charAt(0).toUpperCase() + c.phase.slice(1)}
              </span>
              {c.category === "blunder" ? (
                <span className="tt-chip bad" style={{ fontSize: "0.65rem" }}>Errore grave</span>
              ) : (
                <span className="tt-chip warn" style={{ fontSize: "0.65rem" }}>Errore</span>
              )}
              {avoid === "evitabile" && <span className="tt-chip warn" style={{ fontSize: "0.65rem" }}>Evitabile</span>}
            </div>
            <div className="font-mono" style={{ fontSize: "0.65rem", color: "var(--color-muted)", marginTop: "0.25rem", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{c.san}</span>
              <span style={{ color: "var(--color-faint)" }}>{" > "}</span>
              <span style={{ color: "var(--color-ok)", fontWeight: 600 }}>{uciToSan(c.fen_before, c.best_uci ?? null)}</span>
            </div>
            {c.eco && (
              <button
                onClick={() => onOpeningLink(c.eco!)}
                style={{ marginTop: "0.25rem", fontSize: "0.62rem", color: "var(--color-brand-soft)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", padding: 0, textAlign: "left" }}
              >
                {c.eco}{c.opening ? ` · ${c.opening.slice(0, 22)}` : ""}
              </button>
            )}
            {c.game_url && (
              <a
                href={c.game_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "block", marginTop: "0.25rem", fontSize: "0.60rem", color: "var(--color-faint)", fontFamily: "var(--font-mono)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                Vedi partita
              </a>
            )}
          </div>
        );
      })}
      {positions.length > 6 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-2)", border: "1px solid var(--color-line)", borderRadius: "8px", minHeight: "120px" }}>
          <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>+{positions.length - 6} altre</span>
        </div>
      )}
    </div>
  );
}

type CaduteGrouping = "ancora" | "giorno";

/** Build per-day groups from positions: key = "YYYY-MM-DD", label from Nonno's day line. */
function buildDayGroups(
  positions: PositionExample[],
  ratingCurve: Record<string, import("../../types").RatingPoint[]> | undefined,
  anchors: import("../../pipeline/aggregate").Anchor[] | undefined,
): Array<{ date: string; review: DayReview | null; positions: PositionExample[]; isLatest: boolean }> {
  // Group positions by played_at date.
  const byDate = new Map<string, PositionExample[]>();
  for (const c of positions) {
    if (!c.played_at) continue;
    const d = c.played_at.slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(c);
  }

  // DayReviews give us the Nonno voice line per date (from the Diario logic).
  const reviews = buildDayReviews(ratingCurve, positions, anchors);
  const reviewByDate = new Map(reviews.map((r) => [r.date, r]));

  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  const latestDate = dates[0] ?? null;

  return dates.map((date) => ({
    date,
    review: reviewByDate.get(date) ?? null,
    positions: [...byDate.get(date)!].sort((a, b) => b.cp_loss - a.cp_loss),
    isLatest: date === latestDate,
  }));
}

function TabCadute({
  aggregates,
  pmLite,
  anchorFilter,
  onClearAnchorFilter,
  onOpeningLink,
}: {
  aggregates: Aggregates | null;
  pmLite: PlayerModelLite | null;
  anchorFilter: string | null;
  onClearAnchorFilter: () => void;
  onOpeningLink: (eco: string) => void;
}) {
  // trainer state: null = group list, string = key of group being trained
  const [trainingGroup, setTrainingGroup] = useState<string | null>(null);
  // expanded group for gallery view
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  // grouping mode: "ancora" (default) or "giorno" (absorbs the old Diario)
  const [grouping, setGrouping] = useState<CaduteGrouping>("ancora");

  const raw: PositionExample[] = aggregates?.cadute ?? aggregates?.examples ?? [];

  // If an anchor filter is active, filter by the ANCHOR (error_type) exactly —
  // the same taxonomy the filter key comes from. The old code matched the
  // error_type against the tactical motif and let every motif-less caduta
  // through (`!c.motif || ...`), which dumped almost everything into "Varie".
  const basePositions = anchorFilter
    ? raw.filter((c) => c.error_type === anchorFilter)
    : raw;

  const groups = buildCaduteGroups(basePositions);
  const dayGroups = buildDayGroups(basePositions, pmLite?.rating_curve, aggregates?.anchors);
  // How many positions carry a played_at date (needed for the "per giorno" view).
  const datedCount = basePositions.filter((c) => c.played_at).length;

  const nonnoLine = (() => {
    if (raw.length === 0) return null;
    if (grouping === "giorno") {
      if (dayGroups.length === 0) {
        return `Hai ${raw.length} posizioni raccolte, ma senza la data della partita non posso ordinarle per giorno. Resta sulle ancore.`;
      }
      return "Le tue cadute, giorno per giorno. La rassegna del mattino dopo: apri un giorno, rivedi gli errori e allena.";
    }
    const total = raw.length;
    const named = groups.filter((g) => g.key !== "varie");
    if (named.length > 0) {
      const top = named[0];
      return `Hai ${total} posizioni raccolte. Il pattern piu' frequente e' "${top.label}" (${top.positions.length} volte). Scegli un gruppo e allena.`;
    }
    return `Hai ${total} cadute raccolte. Puoi allenarle una per una o a gruppi.`;
  })();

  // If trainer is active, show full trainer. trainingGroup may be an anchor key
  // or a "day:YYYY-MM-DD" key for the per-day view.
  if (trainingGroup !== null) {
    if (trainingGroup.startsWith("day:")) {
      const date = trainingGroup.slice(4);
      const dg = dayGroups.find((g) => g.date === date);
      if (!dg) { setTrainingGroup(null); return null; }
      return (
        <div>
          <CaduteTrainer
            positions={dg.positions}
            groupLabel={dg.isLatest ? "Ieri" : dateIt(dg.date)}
            onClose={() => setTrainingGroup(null)}
          />
        </div>
      );
    }
    const grp = groups.find((g) => g.key === trainingGroup);
    if (!grp) {
      setTrainingGroup(null);
      return null;
    }
    return (
      <div>
        <CaduteTrainer
          positions={grp.positions}
          groupLabel={grp.label}
          onClose={() => setTrainingGroup(null)}
        />
      </div>
    );
  }

  if (raw.length === 0) {
    return (
      <div style={{ padding: "3rem 0", textAlign: "center" }}>
        <p className="tt-nonno" style={{ marginBottom: "1rem" }}>
          Ancora nessuna caduta registrata. Torna dopo la prossima analisi.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Nonno voice */}
      {nonnoLine && (
        <Reveal delay={0} className="mb-6">
          <p className="tt-nonno">{nonnoLine}</p>
        </Reveal>
      )}

      {/* Grouping toggle: per ancora | per giorno */}
      <Reveal delay={0} className="mb-4">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
          <div className="segment" style={{ display: "inline-flex" }}>
            <button
              onClick={() => { setGrouping("ancora"); setExpandedGroup(null); }}
              className={`segment-item${grouping === "ancora" ? " active" : ""}`}
            >
              Per ancora
            </button>
            <button
              onClick={() => { setGrouping("giorno"); setExpandedGroup(null); }}
              className={`segment-item${grouping === "giorno" ? " active" : ""}`}
            >
              Per giorno
            </button>
          </div>
          {grouping === "giorno" && datedCount < basePositions.length && (
            <span style={{ fontSize: "0.72rem", color: "var(--color-faint)", fontVariantNumeric: "tabular-nums" }}>
              {datedCount} su {basePositions.length} con data
            </span>
          )}
        </div>
      </Reveal>

      {/* Anchor filter banner — names the anchor and offers a clear way out. */}
      {anchorFilter && (
        <Reveal delay={0} className="mb-4">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "0.5rem 0.875rem", background: "color-mix(in srgb, var(--color-brand) 8%, transparent)", borderRadius: "8px", border: "1px solid color-mix(in srgb, var(--color-brand) 20%, transparent)" }}>
            <span style={{ fontSize: "0.82rem", color: "var(--color-brand-soft)" }}>
              Stai guardando solo: <strong>{WEAKNESS_META[anchorFilter]?.label_it ?? "questa ancora"}</strong>
            </span>
            <button onClick={onClearAnchorFilter} className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem", flexShrink: 0 }}>
              vedi tutte
            </button>
          </div>
        </Reveal>
      )}

      {/* ── Group list — per ancora ──────────────────────────────────────── */}
      {grouping === "ancora" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {groups.map((grp, idx) => {
            const isExpanded = expandedGroup === grp.key;
            const avoidable = grp.positions.filter((p) => avoidabilityLabel(p) === "evitabile").length;
            return (
              <Reveal key={grp.key} delay={idx * 40}>
                <div style={{
                  background: "var(--color-surface)", border: "1px solid var(--color-line)",
                  borderRadius: "12px", overflow: "hidden",
                }}>
                  {/* Group header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "1rem",
                    padding: "1rem 1.25rem",
                  }}>
                    {/* Label + count — 3D: avoidable count come numero-titolo */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--color-text)", lineHeight: 1.25 }}>
                        {grp.label}
                      </div>
                      {grp.meaning && (
                        <div style={{ marginTop: "0.25rem", fontSize: "0.8rem", color: "var(--color-muted)", lineHeight: 1.5 }}>
                          {grp.meaning}
                        </div>
                      )}
                      <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                        {avoidable > 0 ? (
                          <>
                            <span className="font-mono" style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--color-warn)", fontVariantNumeric: "tabular-nums" }}>
                              {avoidable}
                            </span>
                            <span style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>alla tua portata</span>
                            <span className="font-mono" style={{ fontSize: "0.72rem", color: "var(--color-faint)", fontVariantNumeric: "tabular-nums" }}>
                              su {grp.positions.length}
                            </span>
                          </>
                        ) : (
                          <span className="font-mono" style={{ fontSize: "0.75rem", color: "var(--color-muted)", fontVariantNumeric: "tabular-nums" }}>
                            {grp.positions.length} {grp.positions.length === 1 ? "posizione" : "posizioni"}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                      <button
                        onClick={() => setExpandedGroup(isExpanded ? null : grp.key)}
                        className="btn btn-ghost btn-sm"
                        style={{ fontSize: "0.75rem" }}
                      >
                        {isExpanded ? "Nascondi" : "Sfoglia"}
                      </button>
                      <button
                        onClick={() => setTrainingGroup(grp.key)}
                        className="btn btn-primary btn-sm"
                        style={{ fontSize: "0.82rem", fontWeight: 700 }}
                      >
                        Allena
                      </button>
                    </div>
                  </div>

                  {/* Expanded gallery */}
                  {isExpanded && (
                    <div style={{ padding: "0 1.25rem 1rem" }}>
                      <GroupGallery positions={grp.positions} onOpeningLink={onOpeningLink} />
                    </div>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
      )}

      {/* ── Group list — per giorno (absorbs the old Diario) ─────────────── */}
      {grouping === "giorno" && (
        dayGroups.length === 0 ? (
          <Section delay={0}>
            <div style={{ textAlign: "center", padding: "2rem 0", color: "var(--color-muted)", fontSize: "0.88rem" }}>
              Nessuna caduta con la data della partita. Passa alla vista per ancora.
            </div>
          </Section>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {dayGroups.map((dg, idx) => {
              const groupKey = `day:${dg.date}`;
              const isExpanded = expandedGroup === groupKey;
              const dateLabel = dg.isLatest ? "Ieri" : dateIt(dg.date);
              const nonnoDay = dg.review ? nonnoLineDayTemplate(dg.review, dg.isLatest) : null;
              return (
                <Reveal key={dg.date} delay={Math.min(idx * 40, 240)}>
                  <div style={{
                    background: "var(--color-surface)",
                    border: `1px solid ${dg.isLatest ? "var(--color-line-strong)" : "var(--color-line)"}`,
                    borderRadius: "12px", overflow: "hidden",
                  }}>
                    {/* Day header */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", padding: "1rem 1.25rem" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontFamily: "var(--font-mono)", fontSize: "0.78rem",
                          fontWeight: dg.isLatest ? 700 : 600,
                          color: dg.isLatest ? "var(--color-text)" : "var(--color-muted)",
                          marginBottom: "0.35rem",
                        }}>
                          {dateLabel}
                        </div>
                        {nonnoDay && (
                          <div style={{ fontSize: "0.82rem", color: "var(--color-text-soft)", lineHeight: 1.55 }}>
                            {nonnoDay}
                          </div>
                        )}
                        <div className="font-mono" style={{ marginTop: "0.35rem", fontSize: "0.72rem", color: "var(--color-faint)", fontVariantNumeric: "tabular-nums" }}>
                          {dg.positions.length} {dg.positions.length === 1 ? "posizione" : "posizioni"} da rivedere
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
                        <button
                          onClick={() => setExpandedGroup(isExpanded ? null : groupKey)}
                          className="btn btn-ghost btn-sm"
                          style={{ fontSize: "0.75rem" }}
                        >
                          {isExpanded ? "Nascondi" : "Sfoglia"}
                        </button>
                        <button
                          onClick={() => setTrainingGroup(groupKey)}
                          className="btn btn-primary btn-sm"
                          style={{ fontSize: "0.82rem", fontWeight: 700 }}
                        >
                          Allena
                        </button>
                      </div>
                    </div>

                    {/* Expanded gallery */}
                    {isExpanded && (
                      <div style={{ padding: "0 1.25rem 1rem" }}>
                        <GroupGallery positions={dg.positions} onOpeningLink={onOpeningLink} />
                      </div>
                    )}
                  </div>
                </Reveal>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB: REPERTORIO
// ─────────────────────────────────────────────────────────────────────────────

function TabRepertorio({ aggregates }: { aggregates: Aggregates | null }) {
  const hasRepertoire = (aggregates?.repertoire?.length ?? 0) > 0;

  const repertorioNonno = (() => {
    if (!hasRepertoire) return "Il repertorio si costruisce con le partite analizzate. Ogni apertura giocata lascia una traccia.";
    const total = aggregates!.repertoire!.length;
    return `${total} aperture nel repertorio. Clicca su un'apertura per vedere dove si concentrano gli errori evitabili.`;
  })();

  const cadute = aggregates?.cadute ?? aggregates?.examples ?? [];

  return (
    <div>
      <Reveal delay={0} className="mb-6">
        <p className="tt-nonno">{repertorioNonno}</p>
      </Reveal>
      <Section delay={60}>
        <RepertorioPanel repertoire={aggregates?.repertoire} cadute={cadute} />
      </Section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN: Quaderno
// ─────────────────────────────────────────────────────────────────────────────

export function Quaderno() {
  const { user, profile } = useAuth();
  const [pmLite,     setPmLite]     = useState<PlayerModelLite | null>(null);
  const [aggregates, setAggregates] = useState<Aggregates | null>(null);
  const [history,    setHistory]    = useState<HistoryFile>({ schema_version: 1, snapshots: [] });
  const [journalRaw, setJournalRaw] = useState<string | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<TabKey>(() => tabFromHash());
  // Cross-link state: which anchor is selected (to filter cadute)
  const [selectedAnchor, setSelectedAnchor] = useState<string | null>(null);

  // Milestones (computed from history + goal + aggregates)
  const [milestones, setMilestones] = useState<Milestone[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [pm, agg, hist, journal] = await Promise.all([
          downloadJson<PlayerModelLite>(quadernoPath(user.id, "player_model_lite.json")),
          downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json")),
          readHistory(user.id),
          downloadText(quadernoPath(user.id, "coach_journal.md")),
        ]);
        if (cancelled) return;
        setPmLite(pm);
        setAggregates(agg);
        setHistory(hist);
        setJournalRaw(journal);

        // Compute milestones if we have enough data
        if (pm?.identity?.goal && agg) {
          const ms = computeMilestones({
            history: hist,
            goal: pm.identity.goal,
            aggregates: agg,
          });
          setMilestones(ms);
        }
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Sync tab to URL hash
  useEffect(() => {
    const onHash = () => {
      const t = tabFromHash();
      setActiveTab(t);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function goTab(key: TabKey) {
    setActiveTab(key);
    window.history.replaceState(null, "", `#${key}`);
  }

  function handleSelectAnchor(anchorType: string) {
    setSelectedAnchor(anchorType);
    goTab("cadute");
  }

  function handleOpeningLink(_eco: string) {
    // Navigate to Repertorio tab — the panel will show by color/opening
    goTab("repertorio");
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-bg)" }}>
        <div className="text-center">
          <div className="tt-eyebrow" style={{ marginBottom: "0.5rem" }}>{PRODUCT_NAME}</div>
          <div style={{ fontSize: "0.9rem", color: "var(--color-muted)" }}>Apro il Quaderno…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "14px", padding: "2rem", maxWidth: "36rem" }}>
          <div className="tt-eyebrow" style={{ color: "var(--color-danger)", marginBottom: "0.5rem" }}>Errore</div>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>{error}</p>
          <Link to="/" className="btn btn-ghost btn-sm">Torna al Tavolo</Link>
        </div>
      </div>
    );
  }

  if (!aggregates && !pmLite) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "var(--color-bg)" }}>
        <div style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "14px", padding: "2.5rem", maxWidth: "36rem", textAlign: "center" }}>
          <div className="tt-eyebrow" style={{ marginBottom: "0.75rem" }}>{PRODUCT_NAME}</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.4rem", color: "var(--color-text)", marginBottom: "0.75rem" }}>
            Il Quaderno e' ancora vuoto
          </h1>
          <p style={{ color: "var(--color-text-soft)", fontSize: "0.88rem", marginBottom: "1.5rem", lineHeight: 1.6 }}>
            Dopo la prima analisi troverai la tua evoluzione, le cadute da allenare e il tuo profilo.
          </p>
          <Link to="/" className="btn btn-primary">Torna al Tavolo</Link>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto px-5 py-8 md:px-8 md:py-12" style={{ maxWidth: "58rem" }}>

        {/* Page title */}
        <div style={{ marginBottom: "1.75rem" }}>
          <h1 style={{ fontFamily: "var(--font-voice)", fontWeight: 600, fontSize: "clamp(1.6rem,4vw,2.4rem)", lineHeight: 1.15, color: "var(--color-text)", marginBottom: "0.4rem" }}>
            Il tuo Quaderno
          </h1>
          <p style={{ fontSize: "0.88rem", color: "var(--color-muted)", lineHeight: 1.5, maxWidth: "52ch" }}>
            La casa continua della tua storia a scacchi. Tutto quello che costruisci nel tempo.
          </p>
        </div>

        {/* Tab bar */}
        <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
          <div className="segment" style={{ display: "inline-flex", minWidth: "max-content" }}>
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => goTab(tab.key)}
                className={`segment-item${activeTab === tab.key ? " active" : ""}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div>
          {activeTab === "evoluzione" && (
            <TabEvoluzione
              aggregates={aggregates}
              pmLite={pmLite}
              history={history}
              journalRaw={journalRaw}
              milestones={milestones}
              onSelectAnchor={handleSelectAnchor}
            />
          )}
          {activeTab === "cadute" && (
            <TabCadute
              aggregates={aggregates}
              pmLite={pmLite}
              anchorFilter={selectedAnchor}
              onClearAnchorFilter={() => setSelectedAnchor(null)}
              onOpeningLink={handleOpeningLink}
            />
          )}
          {activeTab === "profilo" && (
            <TabProfilo
              aggregates={aggregates}
              pmLite={pmLite}
              targetRating={profile?.goal_rating ?? pmLite?.identity?.goal?.target ?? 0}
            />
          )}
          {activeTab === "repertorio" && (
            <TabRepertorio aggregates={aggregates} />
          )}
        </div>

    </div>
  );
}
