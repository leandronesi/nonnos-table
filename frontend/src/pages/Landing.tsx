import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LogIn } from "lucide-react";
import { Chess } from "chess.js";
import { BoardView } from "../components/BoardView";
import { prefersReducedMotion, useInkDraw } from "../lib/motion";
import { LangToggle } from "../i18n/LangToggle";
import { tr } from "../i18n/lang";

// ── Demo board: the moment the payoff describes ───────────────────────────────
//
// Position: the Greek Gift. White plays Bxh7+ — a true sacrifice, the kind
// of move the payoff claims ("solo 1 su 8 al tuo livello l'avrebbe trovata").
// A trivial free-piece capture here would undercut the copy for any chess
// player reading the page. Verified legal with chess.js at module load time.
//
// If the move derivation fails at runtime, DemoBoard never starts the loop
// and shows the static before-position without arrows (safe fallback).

const DEMO_FEN_BEFORE = "r1bq1rk1/pppn1ppp/4pn2/3p2B1/2PP4/2NB1N2/PP3PPP/R2QK2R w KQ - 0 1";
const DEMO_MOVE = { from: "d3", to: "h7" } as const;

function deriveDemoFenAfter(): string | null {
  try {
    const chess = new Chess(DEMO_FEN_BEFORE);
    const result = chess.move({ from: DEMO_MOVE.from, to: DEMO_MOVE.to });
    if (!result) return null;
    return chess.fen();
  } catch {
    return null;
  }
}

const DEMO_FEN_AFTER = deriveDemoFenAfter();

// Nonno's portrait. Asset in public/; BASE_URL keeps the GH Pages subpath.
const NONNO_FACE = `${import.meta.env.BASE_URL}nonno-face.png`;

// ── Board resize helper ───────────────────────────────────────────────────────

function useFitSize(min: number, max: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(max);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? max;
      setSize(Math.max(min, Math.min(max, Math.floor(width))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [min, max]);

  return { ref, size };
}

// ── Landing ───────────────────────────────────────────────────────────────────

export function Landing() {
  const board = useFitSize(208, 304);

  return (
    <div className="public-home">
      <header className="public-topbar">
        <Link to="/" className="public-brand" aria-label="Nonno's Table">
          <img src={NONNO_FACE} alt="" className="public-brand-face" aria-hidden />
          {/* §2d — wordmark topbar: font-voice 600 */}
          <span className="public-brand-wordmark">
            <b>Nonno&apos;s</b> Table
          </span>
        </Link>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <LangToggle />
          <Link to="/login" className="public-login">
            <LogIn size={16} strokeWidth={2.2} aria-hidden />
            {tr("Accedi", "Sign in")}
          </Link>
        </div>
      </header>

      <main className="public-main">
        <section className="public-hero" aria-labelledby="home-title">
          {/* ── Copy column — stagger settle-in on each child ── */}
          <div className="public-copy">
            {/* §1c — stagger delays via explicit classes */}
            <div className="public-kicker public-copy-c0">{tr("Beta su invito", "Invite-only beta")}</div>

            {/* §2a — h1: font-voice 700, "Nonno" stays gold */}
            <h1 id="home-title" className="public-copy-c1">
              <span>Nonno&apos;s</span> Table
            </h1>

            {/* §2b — payoff: font-voice 600 — la voce */}
            <p className="public-payoff public-copy-c2">
              {tr(
                "Solo 1 su 8 al tuo livello l’avrebbe trovata. Ce la rivediamo insieme.",
                "One in eight players at your level finds that. We look at it together."
              )}
            </p>

            {/* §2c — lede: sans weight 500, claim editoriale */}
            <p className="public-lede public-copy-c3">
              {tr(
                "Non analizzi le tue partite. Ti siedi col Nonno a rivederle.",
                "You do not analyze your games. You sit down with Nonno and look at them."
              )}
            </p>

            <div className="public-copy-c4">
              <TargetRail />
            </div>

            {/* §2e — figcaption: font-voice 500 italic */}
            <figure className="public-nonno public-copy-c5">
              <img src={NONNO_FACE} alt="Nonno O." className="public-nonno-face" />
              <figcaption>
                <span>{tr("Nonno, quando ti siedi", "Nonno, when you sit down")}</span>
                {tr(
                  "Ti aspetto qui. Giochiamo al tuo passo. Ma tengo la sedia un passo più avanti: per mostrarti, una mossa alla volta, dove stai andando.",
                  "I am here. We play at your pace. But I keep my chair one step ahead: to show you, one move at a time, where you are going."
                )}
              </figcaption>
            </figure>

            <div className="public-actions public-copy-c6">
              <Link to="/signup" className="btn btn-primary btn-lg public-cta">
                {tr("Crea il tuo Tavolo", "Set up your Table")}
                <ArrowRight size={18} strokeWidth={2.3} aria-hidden />
              </Link>
              <p>{tr("Serve un codice invito per entrare.", "You need an invite code to join.")}</p>
            </div>
          </div>

          {/* ── Stage — 4 cards settle after lamp glow ── */}
          <div className="public-stage" aria-label={tr("Il tavolo serale di Nonno", "Nonno's evening table")}>
            <div className="public-wall" aria-hidden />

            {/* §1a — lamp: glow fades in one-shot, shade/stem/base visibili subito */}
            <div className="public-lamp" aria-hidden>
              <span className="public-lamp-glow" />
              <span className="public-lamp-shade" />
              <span className="public-lamp-stem" />
              <span className="public-lamp-base" />
            </div>

            <div className="public-desk" aria-hidden />

            {/* §1b — cards settle-in with stagger */}
            <div className="public-target-card settle-in" style={{ animationDelay: "350ms" }}>
              <span className="public-panel-label honey">{tr("Obiettivo", "Target")}</span>
              <div className="public-rating-line">
                <strong>1240</strong>
                <span />
                <b>1500</b>
              </div>
              <p>{tr("Il posto che stai raggiungendo.", "Where you are headed.")}</p>
            </div>

            <div className="public-session-card settle-in" style={{ animationDelay: "500ms" }}>
              <span className="public-panel-label">{tr("Oggi al tavolo", "Today at the Table")}</span>
              <strong>{tr("Pezzo in presa", "Piece left hanging")}</strong>
              <p>{tr("Perdi un pezzo muovendo in meno di 8 secondi. Guarda prima di muovere.", "You give the piece away moving in under 8 seconds. Look before you move.")}</p>
            </div>

            <div className="public-board-card settle-in" style={{ animationDelay: "650ms" }}>
              <div ref={board.ref} className="public-board-wrap">
                <DemoBoard size={board.size} />
              </div>

              <div className="public-gap">
                <span className="public-panel-label muted">{tr("Pezzo in presa", "Piece left hanging")}</span>
                <GapBar label={tr("tu", "you")} value={37} color="brand" />
                <GapBar label="1500" value={67} color="gold" />
              </div>
            </div>

            <div className="public-notebook settle-in" style={{ animationDelay: "800ms" }}>
              <span className="public-panel-label muted">{tr("Quaderno", "Notebook")}</span>
              <div className="public-note-lines" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <p>
                {tr("Ce lo segniamo. Hai chiuso ", "We note it down. You closed ")}
                <b>21%</b>
                {tr(" della distanza, e la prossima sera ripartiamo da li'.", " of the gap, and next time we pick it up from there.")}
              </p>
            </div>
          </div>
        </section>

        {/* §4a — story cards: scroll reveal with settle stagger, 80ms between cards */}
        <section className="public-story-grid" aria-label={tr("Come si usa il Tavolo", "How the Table works")}>
          <StoryCard
            label="01"
            kind="target"
            revealDelay={0}
            title={tr("Il posto da raggiungere", "Where you are going")}
            body={tr(
              "Dici 1500 rapid, e il tavolo cambia misura. Nonno non ti confronta con il motore: ti confronta con la sedia accanto.",
              "You say 1500 rapid, and the Table takes measure. Nonno does not compare you to an engine. He compares you to the chair next to yours."
            )}
          />
          <StoryCard
            label="02"
            kind="moment"
            revealDelay={80}
            title={tr("La mossa che ritorna", "The move that comes back")}
            body={tr(
              "Non rivedi la stessa posizione a memoria. Rivedi la stessa idea, in un'altra sera, finche' la riconosci da solo.",
              "You do not memorize the same position. You see the same idea again, on another evening, until you recognize it on your own."
            )}
          />
          <StoryCard
            label="03"
            kind="notebook"
            revealDelay={160}
            title={tr("Il Quaderno ti riconosce", "The Notebook knows you")}
            body={tr(
              "Quando torni, Nonno sa dove eravate rimasti. Non riparti da un report: riparti da una storia che continua.",
              "When you come back, Nonno knows where you left off. You do not start from a report. You pick up a story that continues."
            )}
          />
        </section>
      </main>
    </div>
  );
}

// ── DemoBoard — the board that plays the payoff move in a calm loop ───────────
//
// State machine (§3b):
//   fen_before (1400ms) → mossa plana + freccia verde (2400ms hold) → reset
//   MAX 6 cycles, then static with arrow.
//   Starts only in viewport (IntersectionObserver once).
//   No animation with reduced-motion.

type DemoScene = "before" | "after" | "rest";

function DemoBoard({ size }: { size: number }) {
  const [scene, setScene] = useState<DemoScene>("before");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);
  const disposedRef = useRef(false);
  const cycleRef = useRef(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const MAX_CYCLES = 6;

  function clearAll() {
    for (const id of timeoutsRef.current) clearTimeout(id);
    timeoutsRef.current = [];
  }

  function push(id: ReturnType<typeof setTimeout>) {
    timeoutsRef.current.push(id);
  }

  // Cleanup on unmount — mirrors MomentoDelGiorno pattern exactly.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      clearAll();
      cycleRef.current = 0;
      startedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start animation on viewport entry (once, no reduced-motion).
  // Uses useEffect + containerRef, same as MomentoDelGiorno.
  useEffect(() => {
    if (!DEMO_FEN_AFTER || prefersReducedMotion()) return;
    const container = containerRef.current;
    if (!container) return;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          io.disconnect();
          runCycle();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(container);
    return () => io.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runCycle() {
    if (disposedRef.current) return;
    if (cycleRef.current >= MAX_CYCLES) {
      if (!disposedRef.current) setScene("rest");
      return;
    }
    // fen_before visible 1400ms, then fen_after + green arrow 2400ms hold.
    setScene("before");
    const safeSet = (s: DemoScene) => { if (!disposedRef.current) setScene(s); };
    push(setTimeout(() => safeSet("after"), 1400));
    push(setTimeout(() => {
      cycleRef.current += 1;
      runCycle();
    }, 1400 + 2400));
  }

  const showArrow = scene === "after" || scene === "rest";
  const fen = showArrow && DEMO_FEN_AFTER ? DEMO_FEN_AFTER : DEMO_FEN_BEFORE;

  return (
    <div ref={containerRef}>
      <BoardView
        fen={fen}
        size={size}
        orientation="white"
        // Green arrow lands with the sacrifice — the move 1-in-8 would find.
        arrows={showArrow ? [{ from: DEMO_MOVE.from, to: DEMO_MOVE.to, color: "rgba(34,197,94,0.88)" }] : []}
        highlights={showArrow ? [{ square: DEMO_MOVE.to, color: "rgba(34,197,94,0.25)" }] : []}
        // animate stays true with a stable resetKey: toggling it would swap the
        // board key and remount, and the piece would snap instead of glide.
        animate={true}
        resetKey="demo-board"
      />
    </div>
  );
}

// ── TargetRail — ink-draw on scroll entry ────────────────────────────────────
//
// §4b — the rail track draws as an SVG line when it enters the viewport.
// The gold dot (current position marker) is always visible.

function TargetRail() {
  const { ref: inkRef, drawn } = useInkDraw();

  return (
    <div className="public-target-rail" aria-label={tr("Selettore ELO target", "Target rating selector")}>
      <div>
        <span>{tr("oggi", "today")}</span>
        <strong>1240</strong>
      </div>

      {/* Track as SVG line so ink-path / ink-drawn work correctly */}
      <div className="public-rail-track" aria-hidden>
        <svg
          className={drawn ? "ink-drawn" : ""}
          width="100%"
          height="9"
          viewBox="0 0 100 9"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            ref={inkRef as React.RefCallback<SVGLineElement>}
            x1="0" y1="4.5" x2="100" y2="4.5"
            stroke="url(#rail-grad)"
            strokeWidth="9"
            pathLength={1}
            className="ink-path"
            strokeLinecap="round"
          />
          <defs>
            {/* userSpaceOnUse: a perfectly horizontal line has a zero-height
                bounding box, so the default objectBoundingBox gradient is
                undefined and the stroke is not painted at all. */}
            <linearGradient
              id="rail-grad"
              gradientUnits="userSpaceOnUse"
              x1="0" y1="4.5" x2="100" y2="4.5"
            >
              <stop offset="0%" stopColor="var(--color-brand-soft)" />
              <stop offset="100%" stopColor="var(--color-gold-soft)" />
            </linearGradient>
          </defs>
          {/* Gold dot: always visible, at the 1240/1500 proportion ~45% */}
          <circle cx="45" cy="4.5" r="3.5" fill="var(--color-gold-soft)" />
        </svg>
      </div>

      <div>
        <span>{tr("dove vai", "where you're going")}</span>
        <strong>1500</strong>
      </div>
    </div>
  );
}

// ── GapBar ────────────────────────────────────────────────────────────────────

function GapBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "brand" | "gold";
}) {
  return (
    <div className="public-gap-row">
      <div className="public-gap-track">
        <span
          className={color === "gold" ? "public-gap-fill gold" : "public-gap-fill"}
          style={{ width: `${value}%` }}
        />
      </div>
      <strong className={color === "gold" ? "honey" : undefined}>
        {label} {value}%
      </strong>
    </div>
  );
}

// ── StoryCard — settle on scroll entry ───────────────────────────────────────
//
// §4a — each card gets an IntersectionObserver; when it enters, .in is added
// to trigger the settle animation. Stagger is managed by incrementing delay.

function StoryCard({
  label,
  kind,
  title,
  body,
  revealDelay = 0,
}: {
  label: string;
  kind: "target" | "moment" | "notebook";
  title: string;
  body: string;
  revealDelay?: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const cardCb = useCallback((node: HTMLElement | null) => {
    // Disconnect any previous observer when node detaches or changes.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    cardRef.current = node;
    if (!node) return;
    if (prefersReducedMotion()) {
      setRevealed(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          io.disconnect();
          observerRef.current = null;
          setRevealed(true);
        }
      },
      { threshold: 0.2 },
    );
    io.observe(node);
    observerRef.current = io;
  }, []);

  return (
    <article
      ref={cardCb}
      className={`public-story-card settle${revealed ? " in" : ""}`}
      style={revealed ? { animationDelay: `${revealDelay}ms` } : undefined}
    >
      <div className={`public-story-visual ${kind}`} aria-hidden>
        <span className="v-board" />
        <span className="v-line one" />
        <span className="v-line two" />
        <span className="v-dot" />
      </div>
      <span className="public-story-num">{label}</span>
      <h2>{title}</h2>
      <p>{body}</p>
    </article>
  );
}
