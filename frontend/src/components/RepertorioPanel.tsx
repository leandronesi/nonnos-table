/**
 * RepertorioPanel — "Dove perdi punti recuperabili in apertura".
 *
 * R3: ogni apertura è cliccabile e apre un dettaglio (accordion inline):
 *   1. Ripartizione per fase degli errori evitabili di quell'apertura.
 *   2. Posizioni critiche (cadute filtrate per eco): mini board + contesto + chip fase.
 *   3. Voce di Nonno che inquadra se il problema è la teoria o cosa viene dopo.
 *
 * Tesi: difficolta' e' la moneta. Guida per `avoidable`, non per win%.
 */

import { useState, useRef, useEffect } from "react";
import type { PositionExample, RepertoireRow } from "../pipeline/aggregate";
import { tr } from "../i18n/lang";
import { ecoName } from "../eco";
import { BoardView } from "./BoardView";
import { uciToArrow, uciToSan } from "../pages/quaderno/boardArrows";

// ── Phase label helpers ────────────────────────────────────────────────────────

/** Called at render time — never freeze tr() at module load. */
function phaseLabel(phase: string): string {
  const key = phase.toLowerCase();
  if (key === "apertura" || key === "opening")   return tr("Apertura",   "Opening");
  if (key === "mediogioco" || key === "middlegame") return tr("Mediogioco", "Middlegame");
  if (key === "finale" || key === "endgame")     return tr("Finale",     "Endgame");
  return phase;
}

const PHASE_CHIP_STYLE: Record<string, { bg: string; color: string }> = {
  apertura:   { bg: "rgba(96,165,250,0.12)",  color: "var(--color-info)" },
  opening:    { bg: "rgba(96,165,250,0.12)",  color: "var(--color-info)" },
  mediogioco: { bg: "rgba(161,139,255,0.12)", color: "var(--color-brand-soft)" },
  middlegame: { bg: "rgba(161,139,255,0.12)", color: "var(--color-brand-soft)" },
  finale:     { bg: "rgba(74,222,128,0.10)",  color: "var(--color-ok)" },
  endgame:    { bg: "rgba(74,222,128,0.10)",  color: "var(--color-ok)" },
};
const DEFAULT_PHASE_CHIP = { bg: "rgba(255,255,255,0.07)", color: "var(--color-text-soft)" };

// ── Phase breakdown ────────────────────────────────────────────────────────────

interface PhaseBreakdown {
  apertura: number;
  mediogioco: number;
  finale: number;
  total: number;
  dominantPhase: string | null;
}

function buildPhaseBreakdown(positions: PositionExample[]): PhaseBreakdown {
  const counts: Record<string, number> = { apertura: 0, mediogioco: 0, finale: 0 };
  for (const p of positions) {
    const ph = p.phase.toLowerCase();
    if (ph === "apertura" || ph === "opening") counts.apertura++;
    else if (ph === "finale" || ph === "endgame") counts.finale++;
    else counts.mediogioco++;
  }
  const total = counts.apertura + counts.mediogioco + counts.finale;
  const dominantPhase =
    total === 0
      ? null
      : counts.apertura >= counts.mediogioco && counts.apertura >= counts.finale
      ? "apertura"
      : counts.mediogioco >= counts.finale
      ? "mediogioco"
      : "finale";
  return { apertura: counts.apertura, mediogioco: counts.mediogioco, finale: counts.finale, total, dominantPhase };
}

// ── Nonno voice for drill detail ──────────────────────────────────────────────

function buildNonnoVoice(displayName: string, bd: PhaseBreakdown): string {
  if (bd.total === 0) return "";
  const outsideOpening = bd.mediogioco + bd.finale;
  if (bd.apertura === 0 || (bd.dominantPhase !== "apertura" && outsideOpening > bd.apertura)) {
    const dominante =
      bd.dominantPhase === "mediogioco"
        ? "il mediogioco"
        : bd.dominantPhase === "finale"
        ? "il finale"
        : "la fase fuori apertura";
    return `Nella ${displayName} non è la teoria che ti frega, è ${dominante}: lì si lavora.`;
  }
  if (bd.dominantPhase === "apertura" && bd.apertura > 0) {
    return `Gli errori della ${displayName} sono soprattutto in apertura: qui c'è teoria da rivedere.`;
  }
  return `Gli errori della ${displayName} sono distribuiti su più fasi: guarda le posizioni critiche per capire il pattern.`;
}

// ── Smooth accordion ──────────────────────────────────────────────────────────

function AccordionPanel({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    if (open) {
      const targetH = inner.scrollHeight;
      outer.style.height = `${targetH}px`;
      const onEnd = () => { outer.style.height = "auto"; };
      outer.addEventListener("transitionend", onEnd, { once: true });
      return () => outer.removeEventListener("transitionend", onEnd);
    } else {
      // Snap from auto to pixel, then animate to 0
      outer.style.height = `${outer.scrollHeight}px`;
      // force reflow so the browser registers the explicit height
      void outer.offsetHeight;
      outer.style.height = "0px";
    }
  }, [open]);

  return (
    <div
      ref={outerRef}
      style={{
        overflow: "hidden",
        height: 0,
        transition: "height 260ms cubic-bezier(0.4,0,0.2,1)",
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

// ── Mini position card (drill detail) ────────────────────────────────────────

function MiniPositionCard({ pos }: { pos: PositionExample }) {
  const arrowBest  = uciToArrow(pos.best_uci ?? null, "rgba(34,197,94,0.90)");
  const arrowPlayed = uciToArrow(pos.played_uci, "rgba(239,68,68,0.72)");
  const arrowOpp = pos.last_opp_from && pos.last_opp_to
    ? { from: pos.last_opp_from, to: pos.last_opp_to, color: "rgba(251,191,36,0.60)" }
    : null;
  const arrows = [arrowOpp, arrowPlayed, arrowBest].filter(Boolean) as {
    from: string;
    to: string;
    color: string;
  }[];

  const ph = pos.phase.toLowerCase();
  const chipStyle = PHASE_CHIP_STYLE[ph] ?? DEFAULT_PHASE_CHIP;

  const bestSan = pos.best_uci ? uciToSan(pos.fen_before, pos.best_uci) : null;

  return (
    <div
      style={{
        background: "var(--color-surface-2, var(--color-surface))",
        border: "1px solid var(--color-line)",
        borderRadius: "10px",
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      {/* Board */}
      <div style={{ display: "flex", justifyContent: "center" }}>
        <BoardView fen={pos.fen_before} orientation={pos.color} size={164} arrows={arrows} />
      </div>

      {/* Phase chip */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
        <span
          className="tt-chip"
          style={{ ...chipStyle, fontSize: "0.63rem", padding: "0.15rem 0.45rem" }}
        >
          {phaseLabel(pos.phase)}
        </span>
        {pos.avoidable && (
          <span
            className="tt-chip warn"
            style={{ fontSize: "0.63rem", padding: "0.15rem 0.45rem" }}
          >
            {tr("Evitabile", "Avoidable")}
          </span>
        )}
      </div>

      {/* Move context: played → best */}
      <div
        className="font-mono"
        style={{
          fontSize: "0.68rem",
          color: "var(--color-muted)",
          lineHeight: 1.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: "var(--color-danger)", fontWeight: 700 }}>{pos.san}</span>
        {bestSan && (
          <>
            <span style={{ color: "var(--color-faint)", margin: "0 0.2em" }}>&rsaquo;</span>
            <span style={{ color: "var(--color-ok)", fontWeight: 700 }}>{bestSan}</span>
          </>
        )}
      </div>

      {/* Last opp move context */}
      {pos.last_opp_san && (
        <div
          style={{ fontSize: "0.62rem", color: "var(--color-faint)", fontFamily: "var(--font-mono)" }}
        >
          {tr("dopo", "after")} {pos.last_opp_san}
        </div>
      )}

      {/* Game link */}
      {pos.game_url && (
        <a
          href={pos.game_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            marginTop: "0.25rem",
            fontSize: "0.62rem",
            color: "var(--color-brand-soft)",
            fontFamily: "var(--font-mono)",
            textDecoration: "none",
            opacity: 0.8,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.8")}
        >
          {tr("apri la partita", "open the game")}
        </a>
      )}
    </div>
  );
}

// ── Drill detail panel ────────────────────────────────────────────────────────

function DrillDetail({
  row,
  cadute,
}: {
  row: RepertoireRow;
  cadute: PositionExample[];
}) {
  // Filter by eco — exact match
  const ecoPositions = cadute.filter(
    (c) => c.eco != null && c.eco.trim().toUpperCase() === row.eco.trim().toUpperCase(),
  );

  const bd = buildPhaseBreakdown(ecoPositions);

  const isBlankOpening =
    !row.opening || row.opening === "Unknown" || row.opening === "Apertura non riconosciuta";
  const displayName: string =
    !isBlankOpening ? row.opening : (ecoName(row.eco) ?? `Apertura ECO ${row.eco}`);

  const nonnoVoice = bd.total > 0 ? buildNonnoVoice(displayName, bd) : "";

  // Bar widths
  const maxCount = Math.max(bd.apertura, bd.mediogioco, bd.finale, 1);

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-line)",
        padding: "1rem 0.25rem 0.75rem",
      }}
    >
      {/* ── Phase breakdown ──────────────────────────────────────────────── */}
      {bd.total > 0 ? (
        <div style={{ marginBottom: "1rem" }}>
          <div
            className="tt-eyebrow"
            style={{ marginBottom: "0.625rem", color: "var(--color-faint)" }}
          >
            {tr("Distribuzione errori per fase", "Error distribution by phase")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {(
              [
                { key: "apertura",   label: tr("Apertura",   "Opening"),    count: bd.apertura },
                { key: "mediogioco", label: tr("Mediogioco", "Middlegame"), count: bd.mediogioco },
                { key: "finale",     label: tr("Finale",     "Endgame"),    count: bd.finale },
              ] as { key: string; label: string; count: number }[]
            ).map(({ key, label, count }) => {
              const isDominant = key === bd.dominantPhase && count > 0;
              const chipStyle = PHASE_CHIP_STYLE[key] ?? DEFAULT_PHASE_CHIP;
              return (
                <div
                  key={key}
                  style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: "5rem",
                      fontSize: "0.72rem",
                      color: isDominant ? chipStyle.color : "var(--color-muted)",
                      fontWeight: isDominant ? 700 : 400,
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      height: "5px",
                      borderRadius: "999px",
                      background: "rgba(255,255,255,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.round((count / maxCount) * 100)}%`,
                        height: "100%",
                        borderRadius: "999px",
                        background: isDominant ? chipStyle.color : "rgba(255,255,255,0.18)",
                        transition: "width 400ms cubic-bezier(0.22,1,0.36,1)",
                      }}
                    />
                  </div>
                  <div
                    className="font-mono tabular-nums"
                    style={{
                      flexShrink: 0,
                      width: "1.5rem",
                      textAlign: "right",
                      fontSize: "0.72rem",
                      color: isDominant ? chipStyle.color : "var(--color-muted)",
                      fontWeight: isDominant ? 700 : 400,
                    }}
                  >
                    {count}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Nonno voice */}
          {nonnoVoice && (
            <p
              style={{
                marginTop: "0.75rem",
                fontSize: "0.83rem",
                color: "var(--color-text-soft)",
                lineHeight: 1.6,
                fontStyle: "italic",
              }}
            >
              {nonnoVoice}
            </p>
          )}
        </div>
      ) : null}

      {/* ── Critical positions ──────────────────────────────────────────── */}
      <div className="tt-eyebrow" style={{ marginBottom: "0.625rem", color: "var(--color-faint)" }}>
        {tr("Posizioni critiche", "Critical positions")}
      </div>

      {ecoPositions.length === 0 ? (
        <p
          style={{
            fontSize: "0.82rem",
            color: "var(--color-faint)",
            fontStyle: "italic",
            lineHeight: 1.5,
          }}
        >
          {tr("Niente posizioni critiche qui, per ora.", "No critical positions here yet.")}
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
            gap: "0.625rem",
          }}
        >
          {ecoPositions.slice(0, 6).map((pos, i) => (
            <MiniPositionCard key={i} pos={pos} />
          ))}
          {ecoPositions.length > 6 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--color-surface-2, var(--color-surface))",
                border: "1px solid var(--color-line)",
                borderRadius: "10px",
                minHeight: "100px",
              }}
            >
              <span style={{ fontSize: "0.82rem", color: "var(--color-muted)" }}>
                +{ecoPositions.length - 6} {tr("altre", "more")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── singola riga apertura (cliccabile) ────────────────────────────────────────

function AperturaRow({
  row,
  isOpen,
  onToggle,
  cadute,
}: {
  row: RepertoireRow;
  isOpen: boolean;
  onToggle: () => void;
  cadute: PositionExample[];
}) {
  const isUnknown = !row.recognized;

  const isBlankOpening =
    !row.opening ||
    row.opening === "Unknown" ||
    row.opening === "Apertura non riconosciuta";

  const displayName: string = isUnknown
    ? tr("Apertura non riconosciuta", "Unrecognised opening")
    : !isBlankOpening
    ? row.opening
    : (ecoName(row.eco) ?? `Apertura ECO ${row.eco}`);

  const avoidableColor =
    isUnknown
      ? "var(--color-faint)"
      : row.avoidable >= 3
      ? "var(--color-danger)"
      : row.avoidable >= 1
      ? "var(--color-warn, var(--color-signal-warn, #f5a524))"
      : "var(--color-text-soft)";

  const isClickable = !isUnknown;

  return (
    <div
      style={{
        borderBottom: "1px solid var(--color-line)",
        opacity: isUnknown ? 0.55 : 1,
      }}
    >
      {/* Header row */}
      <div
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        aria-expanded={isClickable ? isOpen : undefined}
        onClick={isClickable ? onToggle : undefined}
        onKeyDown={
          isClickable
            ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }
            : undefined
        }
        className="flex items-start gap-3 py-3"
        style={{
          cursor: isClickable ? "pointer" : "default",
          outline: "none",
          transition: "opacity 120ms",
          userSelect: "none",
        }}
        onMouseEnter={isClickable ? (e) => (e.currentTarget.style.opacity = "0.8") : undefined}
        onMouseLeave={isClickable ? (e) => (e.currentTarget.style.opacity = "1") : undefined}
      >
        {/* Nome + ECO */}
        <div className="flex-1 min-w-0">
          <div
            className="text-sm leading-snug"
            style={{
              color: isUnknown ? "var(--color-muted)" : "var(--color-text)",
              fontWeight: isUnknown ? 400 : 500,
            }}
          >
            {displayName}
          </div>
          {!isUnknown && (
            <div
              className="font-mono mt-0.5"
              style={{ fontSize: "0.7rem", color: "var(--color-faint)", letterSpacing: "0.06em" }}
            >
              {row.eco}
            </div>
          )}
        </div>

        {/* Errori evitabili */}
        <div className="shrink-0 text-right" style={{ minWidth: "5.5rem" }}>
          <div
            className="font-mono font-bold tabular-nums"
            style={{ fontSize: "1rem", lineHeight: 1, color: avoidableColor }}
          >
            {isUnknown ? "—" : row.avoidable}
          </div>
          <div
            className="font-mono"
            style={{
              fontSize: "0.62rem",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-faint)",
              marginTop: "0.2rem",
            }}
          >
            {tr("evitabili", "avoidable")}
          </div>
        </div>

        {/* Secondari: partite, win% */}
        <div
          className="shrink-0 flex flex-col items-end gap-0.5"
          style={{ minWidth: "5rem", color: "var(--color-muted)" }}
        >
          <div className="font-mono tabular-nums" style={{ fontSize: "0.75rem" }}>
            {row.games} {tr(row.games === 1 ? "partita" : "partite", row.games === 1 ? "game" : "games")}
          </div>
          {row.win_rate != null && (
            <div
              className="font-mono tabular-nums"
              style={{ fontSize: "0.72rem", color: "var(--color-text-soft)" }}
            >
              {Math.round(row.win_rate * 100)}% {tr("V", "W")}
            </div>
          )}
        </div>

        {/* Chevron indicator */}
        {isClickable && (
          <div
            style={{
              flexShrink: 0,
              alignSelf: "center",
              color: "var(--color-faint)",
              fontSize: "0.7rem",
              transition: "transform 260ms cubic-bezier(0.4,0,0.2,1)",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            ▾
          </div>
        )}
      </div>

      {/* Accordion detail */}
      {isClickable && (
        <AccordionPanel open={isOpen}>
          <DrillDetail row={row} cadute={cadute} />
        </AccordionPanel>
      )}
    </div>
  );
}

// ── sezione per colore ────────────────────────────────────────────────────────

function ColorSection({
  color,
  rows,
  openEco,
  onToggleEco,
  cadute,
}: {
  color: "white" | "black";
  rows: RepertoireRow[];
  openEco: string | null;
  onToggleEco: (eco: string) => void;
  cadute: PositionExample[];
}) {
  if (rows.length === 0) return null;

  const label = color === "white" ? tr("Bianco", "White") : tr("Nero", "Black");
  const accentColor =
    color === "white" ? "var(--color-text-soft)" : "var(--color-brand-soft)";

  const recognized = rows.filter((r) => r.recognized);
  const unknown = rows.filter((r) => !r.recognized);

  return (
    <div className="mb-5">
      <div className="label-eyebrow mb-2" style={{ color: accentColor }}>
        {label}
      </div>
      <div>
        {recognized.map((row) => {
          const key = `${row.eco}|${row.opening}|${row.my_color}`;
          return (
            <AperturaRow
              key={key}
              row={row}
              isOpen={openEco === key}
              onToggle={() => onToggleEco(key)}
              cadute={cadute}
            />
          );
        })}
        {unknown.map((row) => {
          const key = `${row.eco}|${row.opening}|${row.my_color}`;
          return (
            <AperturaRow
              key={key}
              row={row}
              isOpen={false}
              onToggle={() => {}}
              cadute={cadute}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── export principale ─────────────────────────────────────────────────────────

export function RepertorioPanel({
  repertoire,
  cadute,
}: {
  repertoire: RepertoireRow[] | undefined;
  cadute?: PositionExample[];
}) {
  const [openEco, setOpenEco] = useState<string | null>(null);

  function handleToggleEco(key: string) {
    setOpenEco((prev) => (prev === key ? null : key));
  }

  const allCadute: PositionExample[] = cadute ?? [];

  if (!repertoire || repertoire.length === 0) {
    return (
      <div className="text-sm leading-relaxed" style={{ color: "var(--color-faint)" }}>
        {tr("Ancora pochi dati per il repertorio.", "Not enough data for the repertoire yet.")}
      </div>
    );
  }

  const white = repertoire.filter((r) => r.my_color === "white");
  const black = repertoire.filter((r) => r.my_color === "black");

  const hasData = white.length > 0 || black.length > 0;
  if (!hasData) {
    return (
      <div className="text-sm leading-relaxed" style={{ color: "var(--color-faint)" }}>
        {tr("Ancora pochi dati per il repertorio.", "Not enough data for the repertoire yet.")}
      </div>
    );
  }

  return (
    <div>
      <div
        className="text-sm leading-relaxed mb-5"
        style={{ color: "var(--color-text-soft)", maxWidth: "54ch" }}
      >
        {tr("Dove perdi punti recuperabili in apertura. Clicca su un'apertura per vedere le posizioni critiche e capire se il problema è la teoria o cosa viene dopo.", "Where you lose recoverable points in the opening. Click an opening to see the critical positions and understand whether the problem is the theory or what comes after.")}
      </div>
      <ColorSection
        color="white"
        rows={white}
        openEco={openEco}
        onToggleEco={handleToggleEco}
        cadute={allCadute}
      />
      <ColorSection
        color="black"
        rows={black}
        openEco={openEco}
        onToggleEco={handleToggleEco}
        cadute={allCadute}
      />
    </div>
  );
}
