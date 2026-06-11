/**
 * StanzaHome — Onda P4: the WebGL room.
 *
 * The scene itself is real-time three.js (see stanza/StanzaScene.tsx),
 * lazy-loaded so the main bundle never pays for it. This component:
 *   - derives every scene prop from real user data (useTavoloData)
 *   - renders the DOM layer: dialogue, exit link, vignette, loading/error
 *   - owns the Escape key (a room must have a door)
 *
 * Route: /stanza (authenticated, no AppShell). Home swap is Onda S.
 */

import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTavoloData } from "./tavolo/useTavoloData";
import { selectMomento } from "../components/MomentoDelGiorno";
import { materialForGap } from "../pipeline/history";
import { prefersReducedMotion } from "../lib/motion";
import type { HistorySnapshot } from "../types";
// Type-only import: erased at build time, three.js stays in the lazy chunk.
import type { Focus } from "./stanza/StanzaScene";

const StanzaScene = lazy(() => import("./stanza/StanzaScene"));

/** Hint chip copy per focused object — the second tap enters. */
const FOCUS_HINTS: Record<Exclude<Focus, "tavolo">, string> = {
  scacchiera: "Sediamoci su questa",
  quaderno: "Apri il Quaderno",
  scatola: "Vai alle Cadute",
};

// ── Handicap derivation (same guards as buildHandicapLine) ────────────────────

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

  const initialMaterial = materialForGap(firstMw.target_pct - firstMw.mine_pct);
  if (!initialMaterial) return null;
  const currentStep = materialForGap(lastMw.target_pct - lastMw.mine_pct)?.step ?? 0;

  if (initialMaterial.step <= currentStep) return null;
  return { initialStep: initialMaterial.step, currentStep };
}

/** "e2e4" → ["e2","e4"]; null-safe. */
function uciToPair(uci: string | null | undefined): [string, string] | null {
  if (!uci || uci.length < 4) return null;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

/**
 * WebGL safety net: if the scene throws (no WebGL, driver loss, old device),
 * the user gets a door instead of a black screen.
 */
class SceneBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  state = { broken: false };
  static getDerivedStateFromError() {
    return { broken: true };
  }
  render() {
    if (this.state.broken) {
      return (
        <div className="stanza-errore">
          <p>Questa stanza chiede un dispositivo piu&apos; recente.</p>
          <Link to="/tavolo">Vai al Tavolo</Link>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

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

  const reduced = prefersReducedMotion();

  // The dialogue arrives after the camera has sat down (~3s dolly + a breath).
  const [spoken, setSpoken] = useState(reduced);
  const startedRef = useRef(false);
  useEffect(() => {
    if (loading || error || startedRef.current) return;
    startedRef.current = true;
    if (reduced) {
      setSpoken(true);
      return;
    }
    const t = setTimeout(() => setSpoken(true), 3600);
    return () => clearTimeout(t);
  }, [loading, error, reduced]);

  // Gli sguardi: which object the camera leans over. StanzaHome owns it so
  // Escape and the DOM chip can drive it alongside the in-canvas clicks.
  const [focus, setFocus] = useState<Focus>("tavolo");

  // A room must have a door: Escape steps back from an object first,
  // then walks to the Tavolo (the working surface).
  const nav = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setFocus((f) => {
        if (f !== "tavolo") return "tavolo";
        nav("/tavolo");
        return f;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  // ── Scene props from real data ───────────────────────────────────────────────
  const pool = aggregates?.cadute ?? aggregates?.examples ?? [];
  const momento = selectMomento(pool);
  const handicap = historySnapshots ? buildHandicapDisplay(historySnapshots) : null;

  const improving = anchorTrails.filter((t) => t.direction === "improving").slice(0, 3);
  const notebookLines = improving.map((t) => `${t.label_it}: ci cadi meno spesso.`);
  const notebookGold =
    targetRating > 0 ? `${targetRating}. Il posto che stai raggiungendo.` : null;

  // The box holds the canonical top-3 anchors (by weighted score, same as the
  // Tavolo section) — not the alphabetical trails.
  const thorns = (aggregates?.anchors ?? []).slice(0, 3).map((a) => a.label_it);
  const showLetter = !!(letterIdentity && !letterSeenBefore);

  // ── Loading / error ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="stanza-shell" aria-label="La stanza sta apparecchiando">
        <div className="stanza-attesa">La Stanza</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stanza-shell">
        <div className="stanza-errore">
          <p>Qualcosa si e&apos; inceppato.</p>
          <Link to="/tavolo">Vai al Tavolo</Link>
        </div>
      </div>
    );
  }

  // ── The room ─────────────────────────────────────────────────────────────────
  return (
    <div className="stanza-shell" role="main" aria-label="La stanza del Nonno">
      <SceneBoundary>
      <Suspense fallback={<div className="stanza-attesa">La Stanza</div>}>
        <StanzaScene
          fen={momento?.fen_before ?? null}
          playedMove={uciToPair(momento?.played_uci)}
          bestMove={uciToPair(momento?.best_uci)}
          orientation={momento?.color === "black" ? "black" : "white"}
          handicap={handicap}
          notebookLines={notebookLines}
          notebookGold={notebookGold}
          showNotebook={targetRating > 0}
          thorns={thorns}
          showLetter={showLetter}
          reducedMotion={reduced}
          onBoardClick={
            momento
              ? () =>
                  nav("/sessione", {
                    state: { focusKey: `${momento.fen_before}:${momento.ply}` },
                  })
              : undefined
          }
          onNotebookClick={() => nav("/quaderno")}
          onBoxClick={() => nav("/quaderno#cadute")}
          onLetterClick={() => nav("/tavolo")}
          focus={focus}
          onFocusRequest={setFocus}
        />
      </Suspense>
      </SceneBoundary>

      {/* Vignette above the canvas: screen edges fall into the dark */}
      <div className="scena-vignetta" aria-hidden="true" />

      {/* The brand moment: you have arrived at Nonno's table */}
      <div className="scena-marchio" aria-hidden="true">
        il Tavolo del <b>Nonno</b>
      </div>

      {/* The door to the working surface */}
      <Link to="/tavolo" className="scena-uscita" aria-label="Vai al Tavolo">
        Il Tavolo
      </Link>

      {/* The focus chip: leaning over an object, one more tap enters it */}
      {focus !== "tavolo" && (
        <button
          className="scena-focus-chip"
          onClick={() => {
            if (focus === "scacchiera" && momento) {
              nav("/sessione", {
                state: { focusKey: `${momento.fen_before}:${momento.ply}` },
              });
            } else if (focus === "quaderno") {
              nav("/quaderno");
            } else if (focus === "scatola") {
              nav("/quaderno#cadute");
            }
          }}
        >
          {FOCUS_HINTS[focus]}
        </button>
      )}

      {/* The dialogue — arrives when the camera has sat down */}
      <div className={`scena-dialogo${spoken ? " scena-dialogo-in" : ""}`} aria-live="polite">
        {spoken && (
          <>
            <div className="scena-dialogo-eyebrow">Nonno</div>
            <p className="scena-dialogo-battuta">Oooh. Eccoti.</p>
            {memoriaVisibile && (
              <p className="scena-dialogo-memoria">{memoriaVisibile}</p>
            )}
            {/* The one loud action of the foyer: walk to the table */}
            <button
              className="btn btn-primary scena-cta"
              onClick={() => nav("/tavolo")}
            >
              Vieni al Tavolo
            </button>
          </>
        )}
      </div>
    </div>
  );
}
