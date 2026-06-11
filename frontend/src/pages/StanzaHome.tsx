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

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTavoloData } from "./tavolo/useTavoloData";
import { selectMomento } from "../components/MomentoDelGiorno";
import { materialForGap } from "../pipeline/history";
import { prefersReducedMotion } from "../lib/motion";
import type { HistorySnapshot } from "../types";

const StanzaScene = lazy(() => import("./stanza/StanzaScene"));

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

  // A room must have a door: Escape leaves the scene.
  const nav = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") nav("/");
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

  const thorns = anchorTrails.slice(0, 3).map((t) => t.label_it.split(" ")[0]);
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
          <Link to="/">Torna al Tavolo</Link>
        </div>
      </div>
    );
  }

  // ── The room ─────────────────────────────────────────────────────────────────
  return (
    <div className="stanza-shell" role="main" aria-label="La stanza del Nonno">
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
          onLetterClick={() => nav("/")}
        />
      </Suspense>

      {/* Vignette above the canvas: screen edges fall into the dark */}
      <div className="scena-vignetta" aria-hidden="true" />

      {/* The door */}
      <Link to="/" className="scena-uscita" aria-label="Torna al Tavolo">
        Torna al Tavolo
      </Link>

      {/* The dialogue — arrives when the camera has sat down */}
      <div className={`scena-dialogo${spoken ? " scena-dialogo-in" : ""}`} aria-live="polite">
        {spoken && (
          <>
            <div className="scena-dialogo-eyebrow">Nonno</div>
            <p className="scena-dialogo-battuta">Oooh. Eccoti.</p>
            {memoriaVisibile && (
              <p className="scena-dialogo-memoria">{memoriaVisibile}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
