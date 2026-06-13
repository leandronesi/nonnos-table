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
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { selectMomento } from "../components/MomentoDelGiorno";
import { materialForGap } from "../pipeline/history";
import { prefersReducedMotion } from "../lib/motion";
import type { HistorySnapshot } from "../types";
import { getLang, tr } from "../i18n/lang";
import { getAnchorLabel } from "../i18n/anchors";
import { LangToggle } from "../i18n/LangToggle";
// Type-only import: erased at build time, three.js stays in the lazy chunk.
import type { Focus } from "./stanza/StanzaScene";

const StanzaScene = lazy(() => import("./stanza/StanzaScene"));

/** Hint chip copy per focused object — the second tap enters. Must be a
 *  function so tr() is evaluated at render-time, not frozen at module load. */
function getFocusHints(): Record<Exclude<Focus, "tavolo">, string> {
  return {
    scacchiera: tr("Sediamoci su questa", "Let's sit down with this one"),
    quaderno: tr("Apri il Quaderno", "Open the Notebook"),
    scatola: tr("Vai alle Cadute", "Go to Stumbles"),
  };
}

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
          <p>{tr("Questa stanza chiede un dispositivo piu' recente.", "This room requires a more recent device.")}</p>
          <Link to="/tavolo">{tr("Vai al Tavolo", "Go to the Table")}</Link>
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

  // While the onboarding background is still chewing through the rest of the
  // games, Nonno says so in the room too (the foyer is the first screen after
  // entry) — so the wait feels like him working, not the app hanging.
  const { backgroundRunning } = useOnboardingRun();

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

  // Board affordance: breathing + invite label disappear after the first visit.
  // localStorage key so returning visitors never see it again (gate-once).
  const BOARD_VISITED_KEY = "nonno_board_visited_v1";
  const [boardVisited, setBoardVisited] = useState(() => {
    try {
      return localStorage.getItem(BOARD_VISITED_KEY) === "1";
    } catch {
      return false;
    }
  });
  function markBoardVisited() {
    if (boardVisited) return;
    setBoardVisited(true);
    try {
      localStorage.setItem(BOARD_VISITED_KEY, "1");
    } catch {
      // storage not available — degrade gracefully
    }
  }

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
  const lang = getLang();
  const notebookLines = improving.map((t) => {
    const label = getAnchorLabel(t.key, lang, t.label_it);
    return lang === "en"
      ? `${label}: you fall into this less often.`
      : `${label}: ci cadi meno spesso.`;
  });
  const notebookGold =
    targetRating > 0
      ? tr(`${targetRating}. Il posto che stai raggiungendo.`, `${targetRating}. Where you are headed.`)
      : null;

  // The box holds the canonical top-3 anchors (by weighted score, same as the
  // Tavolo section) — not the alphabetical trails.
  const thorns = (aggregates?.anchors ?? []).slice(0, 3).map((a) =>
    getAnchorLabel(a.type, lang, a.label_it)
  );
  const showLetter = !!(letterIdentity && !letterSeenBefore);

  // ── Loading / error ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="stanza-shell" aria-label={tr("La stanza sta apparecchiando", "The room is getting ready")}>
        <div className="stanza-attesa">{tr("La Stanza", "The Room")}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stanza-shell">
        <div className="stanza-errore">
          <p>{tr("Qualcosa si e’ inceppato.", "Something went wrong.")}</p>
          <Link to="/tavolo">{tr("Vai al Tavolo", "Go to the Table")}</Link>
        </div>
      </div>
    );
  }

  // ── The room ─────────────────────────────────────────────────────────────────
  return (
    <div className="stanza-shell" role="main" aria-label={tr("La stanza del Nonno", "Nonno's room")}>
      <SceneBoundary>
      <Suspense fallback={<div className="stanza-attesa">{tr("La Stanza", "The Room")}</div>}>
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
          boardBreathing={!boardVisited}
          onBoardClick={
            momento
              ? () => {
                  markBoardVisited();
                  nav("/sessione", {
                    state: { focusKey: `${momento.fen_before}:${momento.ply}` },
                  });
                }
              : undefined
          }
          onNotebookClick={() => nav("/quaderno")}
          onBoxClick={() => nav("/quaderno#cadute")}
          onLetterClick={() => nav("/tavolo")}
          focus={focus}
          onFocusRequest={(f) => {
            // First tap on the board also clears the affordance, even before
            // the second tap that would actually navigate.
            if (f === "scacchiera") markBoardVisited();
            setFocus(f);
          }}
        />
      </Suspense>
      </SceneBoundary>

      {/* Vignette above the canvas: screen edges fall into the dark */}
      <div className="scena-vignetta" aria-hidden="true" />

      {/* The brand moment: you have arrived at Nonno's table */}
      <div className="scena-marchio" aria-hidden="true">
        <b>Nonno&apos;s</b> Table
      </div>

      {/* The door to the working surface */}
      <Link to="/tavolo" className="scena-uscita" aria-label={tr("Vai al Tavolo", "Go to the Table")}>
        {tr("Il Tavolo", "The Table")}
      </Link>

      {/* Language switch — top-left, mirrors the exit link on the right. The
          Stanza has no AppShell, so without this the foyer has no toggle. */}
      <LangToggle
        style={{
          position: "fixed",
          top: "clamp(1rem, 3vh, 1.8rem)",
          left: "clamp(1.2rem, 3vw, 2.4rem)",
          zIndex: 60,
        }}
      />

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
          {getFocusHints()[focus]}
        </button>
      )}

      {/* Board invite label — fades in with the dialogue, disappears on first touch.
          Visible only before the first interaction (gate-once via localStorage).
          On reducedMotion the animation is suppressed via CSS but the text stays:
          it is information, not decoration. */}
      {momento && (
        <div
          className={`scena-board-invito${spoken && !boardVisited ? " scena-board-invito-in" : ""}`}
          aria-label="Invito a toccare la scacchiera"
        >
          {tr("Toccala: rivediamo la tua ultima partita", "Touch it: we look at your last game")}
        </div>
      )}

      {/* The dialogue — arrives when the camera has sat down */}
      <div className={`scena-dialogo${spoken ? " scena-dialogo-in" : ""}`} aria-live="polite">
        {spoken && (
          <>
            <div className="scena-dialogo-eyebrow">Nonno</div>
            <p className="scena-dialogo-battuta">{tr("Bentornato.", "There you are.")}</p>
            {memoriaVisibile && (
              <p className="scena-dialogo-memoria">{memoriaVisibile}</p>
            )}
            {backgroundRunning && (
              <p className="scena-dialogo-memoria">
                {tr(
                  "Mi sto ancora guardando le tue partite. Tu intanto siediti.",
                  "Still looking at your games. Sit down.",
                )}
              </p>
            )}
            {/* The one loud action of the foyer: walk to the table */}
            <button
              className="btn btn-primary scena-cta"
              onClick={() => nav("/tavolo")}
            >
              {tr("Vieni al Tavolo", "Come to the Table.")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
