/**
 * StanzaHome — Onda P2: La Stanza Vera.
 *
 * Full-viewport scene. Wall + lamp above the horizon, wooden table below.
 * Six objects anchored by their base using the Gravity Law (see DESIGN spec).
 * All data from useTavoloData(); objects absent when their data is missing.
 *
 * Route: /stanza (authenticated, no AppShell). Preview only — home swap is Onda S.
 *
 * GRAVITY LAW — every object:
 *   position: absolute
 *   top: <baseline in vh>
 *   left: <x>%
 *   transform: translate(-50%, -100%) scale(<banda>)    ← base POGGiA sulla baseline
 *   transform-origin: bottom center
 *
 * Depth bands:
 *   FAR  : baseline ~52-56vh, scale 0.8,  z-index 2
 *   MID  : baseline ~62-68vh, scale 1.0,  z-index 3
 *   NEAR : baseline ~72-78vh, scale 1.15, z-index 4
 */

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTavoloData } from "./tavolo/useTavoloData";
import { selectMomento } from "../components/MomentoDelGiorno";
import { materialForGap } from "../pipeline/history";
import type { HistorySnapshot } from "../types";

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Piece unicode glyphs (white set — rendered in warm ivory via CSS). */
const GLIFI: Record<string, string> = {
  K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
  k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
};

/** Parse a FEN position string into an 8×8 array of piece codes or "". */
function parseFen(fen: string): string[][] {
  const position = fen.split(" ")[0];
  const ranks = position.split("/");
  return ranks.map((rank) => {
    const row: string[] = [];
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        for (let i = 0; i < parseInt(ch, 10); i++) row.push("");
      } else {
        row.push(ch);
      }
    }
    return row;
  });
}

/** Handicap step → piece glyphs and display. Step 1..5 from materialForGap. */
const HANDICAP_GLYPHS: Record<number, string> = {
  5: "♛", // queen
  4: "♜", // rook
  3: "♝", // bishop
  2: "♟♟", // two pawns
  1: "♟",  // one pawn
};

/** Build the handicap display from history snapshots. */
function buildHandicapDisplay(snapshots: HistorySnapshot[]): {
  initialStep: number;
  currentStep: number;
} | null {
  if (snapshots.length < 2) return null;
  const sorted = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const firstMw = first.maia_weighted;
  const lastMw = last.maia_weighted;
  if (firstMw.mine_pct == null || firstMw.target_pct == null) return null;
  if (lastMw.mine_pct == null || lastMw.target_pct == null) return null;

  const firstGap = firstMw.target_pct - firstMw.mine_pct;
  const initialMaterial = materialForGap(firstGap);
  if (!initialMaterial) return null;

  const lastGap = lastMw.target_pct - lastMw.mine_pct;
  const currentMaterial = materialForGap(lastGap);
  const currentStep = currentMaterial?.step ?? 0;

  // Only show if there was meaningful initial handicap AND player improved
  if (initialMaterial.step <= currentStep) return null;

  return { initialStep: initialMaterial.step, currentStep };
}

// ── CSS contact shadow (elliptic, below base) ──────────────────────────────────
// Applied via ::after in index.css (.scena-oggetto::after).

// ── Mini chess board ──────────────────────────────────────────────────────────

interface MiniArrow {
  from: string;
  to: string;
  color: string;
}

interface MiniBoardProps {
  fen: string;
  orientation: "white" | "black";
  arrows: MiniArrow[];
}

function MiniBoard({ fen, orientation, arrows }: MiniBoardProps) {
  const board = parseFen(fen);
  // Black orientation flips BOTH axes: ranks (rows) and files (columns).
  // sqToXY mirrors the same convention; flipping only rows would land the
  // arrows one cell off for every black-side momento.
  const rows =
    orientation === "black"
      ? [...board].reverse().map((row) => [...row].reverse())
      : board;

  // Build arrow paths for SVG overlay
  // Cell size = 100/8 = 12.5% of board width
  const CELL = 12.5;

  function sqToXY(sq: string): { x: number; y: number } {
    const file = sq.charCodeAt(0) - 97; // 0..7
    const rank = 8 - parseInt(sq[1], 10); // 0..7 (top = rank 8)
    // If flipped for black
    const displayFile = orientation === "black" ? 7 - file : file;
    const displayRank = orientation === "black" ? 7 - rank : rank;
    return {
      x: displayFile * CELL + CELL / 2,
      y: displayRank * CELL + CELL / 2,
    };
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "1",
        display: "grid",
        gridTemplate: "repeat(8, 1fr) / repeat(8, 1fr)",
        border: "8px solid #1b1410",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      {rows.flatMap((row, ri) =>
        row.map((piece, fi) => {
          const isDark = (ri + fi) % 2 !== 0;
          const glyph = piece ? GLIFI[piece] ?? "" : "";
          const isWhitePiece = piece === piece.toUpperCase() && piece !== "";
          return (
            <div
              key={`${ri}-${fi}`}
              style={{
                background: isDark ? "#2c3a55" : "#a7b2c7",
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "clamp(14px, 2.8vw, 22px)",
                lineHeight: 1,
              }}
            >
              {glyph && (
                <span
                  style={{
                    color: isWhitePiece ? "#f3efe4" : "#15131f",
                    textShadow: isWhitePiece
                      ? "0 1px 2px rgba(0,0,0,0.65)"
                      : "0 1px 1px rgba(255,255,255,0.14)",
                    userSelect: "none",
                    zIndex: 2,
                    position: "relative",
                  }}
                >
                  {glyph}
                </span>
              )}
            </div>
          );
        }),
      )}

      {/* SVG arrow overlay */}
      {arrows.length > 0 && (
        <svg
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            zIndex: 3,
            overflow: "visible",
          }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            {arrows.map((a, i) => (
              <marker
                key={`m${i}`}
                id={`arrowhead-${i}`}
                markerWidth="6"
                markerHeight="6"
                refX="3"
                refY="3"
                orient="auto"
              >
                <path d="M0,0 L0,6 L6,3 z" fill={a.color} />
              </marker>
            ))}
          </defs>
          {arrows.map((a, i) => {
            const { x: x1, y: y1 } = sqToXY(a.from);
            const { x: x2, y: y2 } = sqToXY(a.to);
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={a.color}
                strokeWidth="3.5"
                strokeLinecap="round"
                markerEnd={`url(#arrowhead-${i})`}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ── Contact shadow component (elliptic) ───────────────────────────────────────

function ContactShadow() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: -7,
        left: "6%",
        width: "88%",
        height: 14,
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.50) 0%, transparent 70%)",
        filter: "blur(4px)",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

// ── Glasses line-art (SVG) ─────────────────────────────────────────────────────

function OcchialiSvg() {
  return (
    <svg
      width="86"
      height="32"
      viewBox="0 0 92 34"
      aria-hidden="true"
      style={{ display: "block", opacity: 0.82 }}
    >
      <circle cx="20" cy="20" r="12" stroke="#c8b98f" strokeWidth="2.4" fill="none" />
      <circle cx="58" cy="20" r="12" stroke="#c8b98f" strokeWidth="2.4" fill="none" />
      <path d="M32 18 Q 39 13 46 18" stroke="#c8b98f" strokeWidth="2.4" fill="none" />
      {/* Both temple arms, folded — glasses resting on the notebook */}
      <path d="M70 18 Q 84 14 90 6" stroke="#c8b98f" strokeWidth="2.4" fill="none" />
      <path d="M8 18 Q 2 14 2 6" stroke="#c8b98f" strokeWidth="2.4" fill="none" />
    </svg>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StanzaHome() {
  const {
    aggregates,
    historySnapshots,
    memoriaVisibile,
    targetRating,
    letterIdentity,
    letterSeenBefore,
    anchorTrails,
    loading,
    error,
  } = useTavoloData();

  // Entrance animation: lampOn → FAR → MID → NEAR
  const [lampOn, setLampOn] = useState(false);
  const [farVisible, setFarVisible] = useState(false);
  const [midVisible, setMidVisible] = useState(false);
  const [nearVisible, setNearVisible] = useState(false);
  const startedRef = useRef(false);

  // A room must have a door: Escape leaves the scene.
  const nav = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") nav("/");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  useEffect(() => {
    if (loading || error || startedRef.current) return;
    startedRef.current = true;

    // Check reduced motion preference
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setLampOn(true);
      setFarVisible(true);
      setMidVisible(true);
      setNearVisible(true);
      return;
    }

    // Lamp ignites first
    const t1 = setTimeout(() => setLampOn(true), 80);
    // FAR objects settle
    const t2 = setTimeout(() => setFarVisible(true), 700);
    // MID objects settle
    const t3 = setTimeout(() => setMidVisible(true), 700 + 600);
    // NEAR objects settle
    const t4 = setTimeout(() => setNearVisible(true), 700 + 600 + 900);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [loading, error]);

  // ── Derive scene objects ─────────────────────────────────────────────────────

  // 1. Board momento
  const pool = aggregates?.cadute ?? aggregates?.examples ?? [];
  const momento = selectMomento(pool);

  // 2. Handicap
  const handicapData = historySnapshots ? buildHandicapDisplay(historySnapshots) : null;

  // 3. Quaderno milestones from anchorTrails (improving ones)
  const improvingTrails = anchorTrails
    .filter((t) => t.direction === "improving")
    .slice(0, 3);
  const showQuaderno = targetRating > 0;

  // 4. Tazza — always visible (Nonno's presence)
  const showTazza = true;

  // 5. Scatola spine — top anchors from anchorTrails
  const topAnchors = anchorTrails.slice(0, 3);
  const showScatola = topAnchors.length >= 1;

  // 6. Lettera — only if fresh
  const showLettera = !!(letterIdentity && !letterSeenBefore);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="scena" aria-label="La stanza sta apparecchiando">
        <div
          style={{
            position: "absolute",
            top: "48%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: "0.68rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--color-muted)",
            }}
          >
            La Stanza
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "var(--color-bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.2rem",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-voice)",
            fontSize: "1.1rem",
            color: "var(--color-text-soft)",
            margin: 0,
          }}
        >
          Qualcosa si è inceppato.
        </p>
        <Link
          to="/"
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: "0.72rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--color-brand-soft)",
            textDecoration: "none",
          }}
        >
          Torna al Tavolo
        </Link>
      </div>
    );
  }

  // ── Scene ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="scena"
      aria-label="La stanza del Nonno"
      role="main"
    >
      {/* ── PARETE (wall above horizon) ── */}
      <div className="scena-parete" aria-hidden="true" />

      {/* ── LAMPADA ── */}
      <div className="scena-lampada-filo" aria-hidden="true" />
      <div className="scena-lampada-corpo" aria-hidden="true" />
      <div
        className="scena-lampada-luce"
        aria-hidden="true"
        style={{ opacity: lampOn ? 1 : 0 }}
      />
      <div
        className="scena-lampada-cono"
        aria-hidden="true"
        style={{ opacity: lampOn ? 1 : 0 }}
      />

      {/* ── LEGNO (wooden table surface) ── */}
      <div className="scena-legno" aria-hidden="true" />

      {/* ══════════════════════════════════════════════════════════════════════
       * OGGETTI — each wrapped in .scena-oggetto, anchored by base
       * All use transform: translate(-50%, -100%) scale(<band>) so the BOTTOM
       * of each object sits exactly at top: <baseline>. Gravity Law.
       * ══════════════════════════════════════════════════════════════════════ */}

      {/* ── 5. SCATOLA SPINE — FAR, baseline 54vh, x 30%, scale 0.8, z-index 2 ── */}
      {showScatola && (
        <div
          className={`scena-oggetto scena-oggetto-far${farVisible ? " scena-in" : ""}`}
          style={{ top: "54vh", left: "30%" }}
          aria-label="Le tue spine"
        >
          <div style={{ position: "relative" }}>
            <ContactShadow />
            <div className="scena-scatola">
              {topAnchors.map((a, i) => (
                <div key={a.key} className="scena-scatola-carta" data-i={i}>
                  {a.label_it.split(" ")[0]}
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              marginTop: "0.6rem",
              textAlign: "center",
              fontFamily: "var(--font-mono)",
              fontSize: "0.58rem",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--color-faint)",
            }}
          >
            le tue spine
          </div>
        </div>
      )}

      {/* ── 4. TAZZA — FAR-MID, baseline 58vh, x 68%, scale 0.9, z-index 2 ── */}
      {showTazza && (
        <div
          className={`scena-oggetto scena-oggetto-farmid${farVisible ? " scena-in" : ""}`}
          style={{ top: "58vh", left: "68%" }}
          aria-label="La tazza del Nonno"
        >
          <div style={{ position: "relative" }}>
            <ContactShadow />
            <div className="scena-tazza">
              <svg
                className="scena-vapore"
                viewBox="0 0 40 70"
                aria-hidden="true"
              >
                <path d="M14 64 C 8 52, 22 46, 16 34 C 11 24, 21 18, 18 8" />
                <path d="M27 62 C 22 52, 33 44, 27 34 C 22 26, 30 18, 26 10" />
              </svg>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. HANDICAP — MID, baseline 66vh, x 17%, scale 1.0, z-index 3 ── */}
      {handicapData && (
        <div
          className={`scena-oggetto scena-oggetto-mid${midVisible ? " scena-in" : ""}`}
          style={{ top: "66vh", left: "17%" }}
          aria-label="Progresso handicap"
        >
          <div style={{ position: "relative" }}>
            <ContactShadow />
            <div
              className="scena-handicap-pezzi"
              aria-label={
                handicapData.currentStep === 0
                  ? "Giochiamo quasi alla pari."
                  : "Pezzi del vantaggio che ti davo"
              }
            >
              {/* Render steps from initialStep down to 1 */}
              {Array.from({ length: handicapData.initialStep }, (_, i) => {
                const step = handicapData.initialStep - i; // initialStep..1
                const returned = step > handicapData.currentStep;
                const glyph = HANDICAP_GLYPHS[step] ?? "♟";
                return (
                  <span
                    key={step}
                    className={returned ? "scena-handicap-reso" : "scena-handicap-pieno"}
                    title={returned ? "restituito" : "ancora dovuto"}
                  >
                    {glyph}
                  </span>
                );
              })}
            </div>
          </div>
          <div
            className="scena-handicap-dida"
          >
            {handicapData.currentStep === 0
              ? "Giochiamo quasi alla pari."
              : "Quel che resta del vantaggio che ti davo."}
          </div>
        </div>
      )}

      {/* ── 6. LETTERA — NEAR, baseline 75vh, x 60%, scale 1.15, z-index 4 ── */}
      {showLettera && (
        <div
          className={`scena-oggetto scena-oggetto-near${nearVisible ? " scena-in" : ""}`}
          style={{ top: "75vh", left: "60%" }}
          aria-label="Una lettera per te"
        >
          <div style={{ position: "relative" }}>
            <ContactShadow />
            <div className="scena-lettera">
              <em
                style={{
                  fontFamily: "var(--font-voice)",
                  fontSize: "0.72rem",
                  fontStyle: "italic",
                  color: "#6b5638",
                }}
              >
                Per te.
              </em>
            </div>
          </div>
        </div>
      )}

      {/* ── 1. SCACCHIERA — NEAR, baseline 74vh, x 47%, scale 1.15, z-index 4 ── */}
      {momento && (
        <div
          className={`scena-oggetto scena-oggetto-near${nearVisible ? " scena-in" : ""}`}
          style={{ top: "74vh", left: "47%" }}
          aria-label={`Posizione dal ${momento.phase}`}
        >
          <div style={{ position: "relative" }}>
            <ContactShadow />
            {/* Board inclined toward viewer */}
            <div className="scena-board-wrap">
              <div className="scena-board-inner">
                <MiniBoard
                  fen={momento.fen_before}
                  orientation={momento.color}
                  arrows={[
                    momento.played_uci
                      ? { from: momento.played_uci.slice(0, 2), to: momento.played_uci.slice(2, 4), color: "rgba(239,68,68,0.85)" }
                      : null,
                    momento.best_uci
                      ? { from: momento.best_uci.slice(0, 2), to: momento.best_uci.slice(2, 4), color: "rgba(34,197,94,0.85)" }
                      : null,
                  ].filter(Boolean) as MiniArrow[]}
                />
              </div>
            </div>
          </div>
          {/* Caption mono */}
          <div className="scena-board-dida">
            {[
              momento.phase,
              momento.spent_seconds != null ? `in ${momento.spent_seconds} secondi` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}

      {/* ── 3. QUADERNO — NEAR, baseline 76vh, x 80%, scale 1.15, z-index 4 ── */}
      {showQuaderno && (
        <div
          className={`scena-oggetto scena-oggetto-near${nearVisible ? " scena-in" : ""}`}
          style={{ top: "76vh", left: "80%" }}
          aria-label="Il quaderno del viaggio"
        >
          <div style={{ position: "relative" }}>
            <ContactShadow />
            {/* Glasses resting on top of the notebook */}
            <div className="scena-occhiali" aria-hidden="true">
              <OcchialiSvg />
            </div>
            <div className="scena-quaderno">
              <h4
                style={{
                  fontFamily: "var(--font-voice)",
                  fontWeight: 600,
                  fontSize: "0.9rem",
                  marginBottom: "0.6rem",
                  color: "#3a2f1d",
                }}
              >
                Il nostro viaggio
              </h4>
              <ul className="scena-viaggio-mini">
                {improvingTrails.length > 0
                  ? improvingTrails.map((t) => (
                    <li key={t.key}>
                      {t.label_it}: ci cadi meno spesso.
                    </li>
                  ))
                  : (
                    <li>Stiamo lavorando sui tuoi freni.</li>
                  )}
                {/* Gold line: target */}
                <li
                  style={{
                    color: "#8a6508",
                    listStyle: "none",
                    paddingLeft: "1rem",
                    position: "relative",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      left: 0,
                      top: "0.34em",
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#b8860b",
                      display: "inline-block",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontWeight: 600,
                      fontSize: "0.75rem",
                      color: "#8a6508",
                    }}
                  >
                    {targetRating}.
                  </span>{" "}
                  Il posto che stai raggiungendo.
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ══ L'USCITA — quiet, top right. A room must have a door. ══ */}
      <Link
        to="/"
        className="scena-uscita"
        aria-label="Torna al Tavolo"
      >
        Torna al Tavolo
      </Link>

      {/* ══ IL DIALOGO — fixed bottom-left, z-index 50.
          Text mounts only when the scene reaches it, so a screen reader hears
          the line at the moment it is spoken, not before the lamp is on. ══ */}
      <div
        className={`scena-dialogo${nearVisible ? " scena-dialogo-in" : ""}`}
        aria-live="polite"
      >
        {nearVisible && (
          <>
            <div
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: "0.66rem",
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--color-brand-soft)",
                marginBottom: "0.4rem",
              }}
            >
              Nonno
            </div>
            <p
              style={{
                fontFamily: "var(--font-voice)",
                fontWeight: 500,
                fontSize: "clamp(1.05rem, 2.4vw, 1.5rem)",
                lineHeight: 1.4,
                color: "var(--color-text)",
                margin: 0,
              }}
            >
              Oooh. Eccoti.
            </p>
            {memoriaVisibile && (
              <p
                style={{
                  fontFamily: "var(--font-voice)",
                  fontSize: "0.82rem",
                  color: "var(--color-muted)",
                  margin: "0.45rem 0 0",
                  lineHeight: 1.5,
                }}
              >
                {memoriaVisibile}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
