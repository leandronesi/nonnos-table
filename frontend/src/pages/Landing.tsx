import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BoardView } from "../components/BoardView";

/**
 * Landing pubblica — la FACCIA. Registro del PITCH (la corda forte):
 * tipografia + scacchiera VERA inquadrata "tu vs il tuo target" + barre del
 * divario + alone caldo (atmosfera della lampada, non un disegno).
 * Valore in chiaro: scegli un Elo-target, ti misuro contro chi gioca gia' li'.
 * Voce di Nonno (io, una persona). Dark, oro solo per l'Obiettivo/target, mobile-first.
 */

// Posizione vera: pezzo in presa. Bianco muove, l'alfiere c5 e' attaccato da d4 e
// indifeso -> dxc5. La freccia oro mostra la mossa giusta.
const HERO_FEN = "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2BPP3/5N2/PPP2PPP/RNBQ1RK1 w - - 0 1";

function useIsWide(px: number): boolean {
  const [wide, setWide] = useState(typeof window !== "undefined" ? window.innerWidth >= px : true);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= px);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [px]);
  return wide;
}

function useFitSize(min: number, max: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(max);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? max;
      setSize(Math.max(min, Math.min(max, Math.floor(w))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [min, max]);
  return { ref, size };
}

export function Landing() {
  const wide = useIsWide(900);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--color-bg)" }}>
      {/* Topbar — nome presente */}
      <header
        style={{
          borderBottom: "1px solid var(--color-line)",
          background: "var(--header-bg)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          padding: "0 1.25rem",
          height: "3.75rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          zIndex: 20,
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem" }}>
          <LampMark />
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, letterSpacing: "-0.01em", color: "var(--color-text)", fontSize: "1.05rem" }}>
            il Tavolo del <span style={{ color: "var(--color-gold-soft)" }}>Nonno</span>
          </span>
        </span>
        <Link to="/login" className="btn btn-ghost btn-sm">Accedi</Link>
      </header>

      <main className="flex-1">
        {/* ============ HERO ============ */}
        <section style={{ position: "relative", overflow: "hidden" }}>
          {/* Atmosfera: l'alone caldo della lampada */}
          <div
            aria-hidden
            style={{
              position: "absolute", top: "-12%", right: "-6%",
              width: "min(640px, 82vw)", height: "min(640px, 82vw)",
              background: "radial-gradient(circle, rgba(246,198,74,0.15) 0%, rgba(124,92,255,0.07) 40%, transparent 68%)",
              pointerEvents: "none",
            }}
          />
          <div
            className="mx-auto px-5 sm:px-8"
            style={{ maxWidth: "1120px", paddingTop: "clamp(2.5rem, 6vw, 5rem)", paddingBottom: "clamp(2.5rem, 6vw, 4.5rem)", position: "relative" }}
          >
            <div style={{ display: "grid", alignItems: "center", gap: wide ? "3rem" : "2.5rem", gridTemplateColumns: wide ? "1.02fr 0.98fr" : "1fr" }}>

              {/* Colonna testo */}
              <div className="tt-reveal in" style={{ minWidth: 0 }}>
                <div className="tt-eyebrow tt-muted" style={{ marginBottom: "1.25rem" }}>Beta su invito</div>

                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "clamp(2.2rem, 4.8vw, 3.5rem)",
                    fontWeight: 800,
                    lineHeight: 1.04,
                    letterSpacing: "-0.025em",
                    color: "var(--color-text)",
                    margin: "0 0 1.2rem",
                  }}
                >
                  Scegli dove vuoi arrivare.
                  <span style={{ display: "block", color: "var(--color-gold-soft)", marginTop: "0.1em" }}>
                    Ti misuro contro chi gioca gia' li'.
                  </span>
                </h1>

                <p style={{ fontSize: "1.05rem", color: "var(--color-text-soft)", lineHeight: 1.6, maxWidth: "46ch", margin: "0 0 1.75rem" }}>
                  Non contro un motore che ti annienta. Contro un giocatore del tuo <b style={{ color: "var(--color-text)" }}>Elo-target</b>,
                  posizione per posizione. Quello e' il tuo vero divario, ed e' il piu' facile da chiudere.
                </p>

                <TargetPicker />

                <div className="tt-nonno" style={{ margin: "1.75rem 0 2rem", maxWidth: "46ch" }}>
                  <span className="who">Nonno</span>
                  Gli altri ti danno un'analisi e ti salutano. Io ti trovo le poche cose che al tuo livello ti
                  costano punti davvero, ti ci alleno, e torno ogni settimana a vedere se le hai chiuse.
                  Non un report: <b>un coach che resta.</b>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", alignItems: "flex-start" }}>
                  <Link to="/signup" className="btn btn-primary btn-lg" style={{ minWidth: "min(100%, 17rem)" }}>
                    Crea il tuo Tavolo
                  </Link>
                  <p style={{ fontSize: "0.72rem", color: "var(--color-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em", margin: 0 }}>
                    Serve un codice invito per entrare.
                  </p>
                </div>
              </div>

              {/* Colonna prodotto: scacchiera vera, inquadrata "tu vs target" */}
              <div className="tt-reveal in" style={{ minWidth: 0 }}>
                <MomentCard />
                <p style={{ margin: "1.1rem 0.25rem 0", fontSize: "0.85rem", color: "var(--color-text-soft)", lineHeight: 1.55 }}>
                  Ogni tua posizione, messa accanto a chi gioca al tuo target.{" "}
                  <span style={{ color: "var(--color-text)" }}>Dove lui trova la mossa e tu no, li' ci sono i tuoi punti.</span>{" "}
                  Il tuo divario, reso numero.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ COME FUNZIONA ============ */}
        <section style={{ borderTop: "1px solid var(--color-line)" }}>
          <div className="mx-auto px-5 sm:px-8" style={{ maxWidth: "1120px", paddingTop: "clamp(2.5rem, 6vw, 4rem)", paddingBottom: "clamp(2.5rem, 6vw, 4rem)" }}>
            <div className="tt-eyebrow" style={{ marginBottom: "2rem" }}>Come ci sediamo</div>
            <div className="grid gap-5 md:grid-cols-3">
              <Moment
                title="Ti guardo le partite"
                body="Parto dai tuoi errori veri su Chess.com, non da corsi preconfezionati."
                visual={
                  <svg viewBox="0 0 120 64" width="100%" height="64" role="img" aria-label="Le tue partite">
                    {Array.from({ length: 9 }).map((_, i) => (
                      <rect key={i} x={(i % 3) * 40 + 2} y={Math.floor(i / 3) * 20 + 2} width="36" height="16" rx="3"
                        fill={i === 4 ? "var(--color-brand)" : "rgba(255,255,255,0.05)"} stroke="var(--color-line)" />
                    ))}
                  </svg>
                }
              />
              <Moment
                title="Ti trovo le 3 ancore"
                body="Le cose che ti costano punti, pesate sul tuo livello e sul tuo target."
                visual={
                  <svg viewBox="0 0 220 64" width="100%" height="64" role="img" aria-label="Tu 37 percento, target 67 percento">
                    <text x="0" y="11" fontSize="8" fill="var(--color-muted)" fontFamily="var(--font-mono)">PEZZO IN PRESA</text>
                    <rect x="0" y="18" width="220" height="12" rx="4" fill="var(--color-surface-3)" />
                    <rect x="0" y="18" width="81" height="12" rx="4" fill="var(--color-brand)" />
                    <text x="86" y="28" fontSize="9" fill="var(--color-brand-soft)" fontFamily="var(--font-mono)">tu 37%</text>
                    <rect x="0" y="38" width="220" height="12" rx="4" fill="var(--color-surface-3)" />
                    <rect x="0" y="38" width="147" height="12" rx="4" fill="var(--color-gold)" />
                    <text x="152" y="48" fontSize="9" fill="var(--color-gold-soft)" fontFamily="var(--font-mono)">1500: 67%</text>
                  </svg>
                }
              />
              <Moment
                title="Torno ogni settimana"
                body="Ricordo cosa ti avevo detto, e ti mostro quanto sei avanzato."
                visual={
                  <svg viewBox="0 0 120 64" width="100%" height="64" role="img" aria-label="La tua crescita nel tempo">
                    <line x1="6" y1="10" x2="114" y2="10" stroke="var(--color-line)" strokeDasharray="3 3" />
                    <text x="92" y="8" fontSize="7" fill="var(--color-gold-soft)" fontFamily="var(--font-mono)">target</text>
                    <polyline points="8,52 44,42 80,30" fill="none" stroke="var(--color-brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <polyline points="80,30 114,12" fill="none" stroke="var(--color-brand-soft)" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />
                    <circle cx="8" cy="52" r="3" fill="var(--color-brand)" />
                    <circle cx="44" cy="42" r="3" fill="var(--color-brand)" />
                    <circle cx="80" cy="30" r="4" fill="var(--color-brand-soft)" stroke="var(--color-bg)" strokeWidth="1.5" />
                  </svg>
                }
              />
            </div>
          </div>
        </section>

        {/* ============ CHIUSURA ============ */}
        <section style={{ borderTop: "1px solid var(--color-line)" }}>
          <div className="mx-auto px-5 sm:px-8 text-center" style={{ maxWidth: "640px", paddingTop: "clamp(3rem, 7vw, 4.5rem)", paddingBottom: "clamp(3rem, 7vw, 5rem)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "clamp(1.6rem, 3.6vw, 2.3rem)", lineHeight: 1.15, letterSpacing: "-0.02em", color: "var(--color-text)", margin: "0 0 0.5rem" }}>
              Il tavolo e' apparecchiato.
            </h2>
            <p style={{ fontSize: "1.05rem", color: "var(--color-text-soft)", margin: "0 0 1.75rem" }}>Manca solo che ti siedi.</p>
            <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", gap: "0.7rem" }}>
              <Link to="/signup" className="btn btn-primary btn-lg" style={{ minWidth: "min(100%, 17rem)" }}>Crea il tuo Tavolo</Link>
              <p style={{ fontSize: "0.72rem", color: "var(--color-faint)", fontFamily: "var(--font-mono)", letterSpacing: "0.06em", margin: 0 }}>Serve un codice invito per entrare.</p>
            </div>
            <div className="tt-eyebrow tt-muted" style={{ marginTop: "2.5rem" }}>il Tavolo del Nonno · 2026</div>
          </div>
        </section>
      </main>
    </div>
  );
}

/** Scacchiera vera + barre del divario "tu vs il tuo target". Il prodotto, non un'illustrazione. */
function MomentCard() {
  const board = useFitSize(232, 360);
  return (
    <div
      style={{
        position: "relative",
        background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0)), var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: "16px",
        padding: "clamp(0.9rem, 2.5vw, 1.35rem)",
      }}
    >
      <div ref={board.ref} style={{ width: "100%", maxWidth: 360, margin: "0 auto" }}>
        <BoardView
          fen={HERO_FEN}
          size={board.size}
          orientation="white"
          arrows={[{ from: "d4", to: "c5", color: "#f6c64a" }]}
          highlights={[{ square: "c5", color: "#f6c64a" }]}
        />
      </div>

      {/* Le barre del divario — il differenziatore */}
      <div style={{ marginTop: "1.1rem", paddingTop: "1rem", borderTop: "1px solid var(--color-line)" }}>
        <div className="tt-eyebrow tt-muted" style={{ marginBottom: "0.6rem", fontSize: "0.6rem" }}>
          Pezzo in presa · trovi la mossa giusta
        </div>
        <GapBar label="tu" pct={37} color="var(--color-brand)" labelColor="var(--color-brand-soft)" />
        <div style={{ height: "0.5rem" }} />
        <GapBar label="il tuo 1500" pct={67} color="var(--color-gold)" labelColor="var(--color-gold-soft)" />
      </div>
    </div>
  );
}

function GapBar({ label, pct, color, labelColor }: { label: string; pct: number; color: string; labelColor: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
      <div style={{ flex: 1, position: "relative", height: "1.4rem", borderRadius: "7px", background: "var(--color-surface-3)", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: color, borderRadius: "7px" }} />
      </div>
      <div style={{ width: "5.5rem", textAlign: "left", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "0.82rem", color: labelColor }}>
        {label} {pct}%
      </div>
    </div>
  );
}

/** Selettore del target Elo (statico: comunica "scegli dove arrivare"). */
function TargetPicker() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: "0.85rem",
        padding: "0.9rem 1.1rem",
        borderRadius: "12px",
        border: "1px solid var(--color-line)",
        background: "var(--color-surface)",
        maxWidth: "26rem",
      }}
    >
      <div>
        <div className="tt-eyebrow tt-muted" style={{ fontSize: "0.58rem" }}>oggi</div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "1.25rem", color: "var(--color-text)" }}>1240</div>
      </div>
      <div style={{ position: "relative", height: "0.5rem", borderRadius: "999px", background: "var(--color-surface-3)" }}>
        <div style={{ position: "absolute", inset: 0, width: "100%", borderRadius: "999px", background: "linear-gradient(90deg, var(--color-brand-soft), var(--color-gold-soft))" }} />
        <div style={{ position: "absolute", right: "-5px", top: "50%", transform: "translateY(-50%)", width: "16px", height: "16px", borderRadius: "999px", background: "var(--color-gold-soft)", border: "2px solid var(--color-bg)" }} />
      </div>
      <div style={{ textAlign: "right" }}>
        <div className="tt-eyebrow honey" style={{ fontSize: "0.58rem", color: "var(--color-gold-soft)" }}>obiettivo</div>
        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: "1.25rem", color: "var(--color-gold-soft)" }}>1500</div>
      </div>
    </div>
  );
}

/** Mini lampada nel logo. */
function LampMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M7 4 Q15 2 16 9" fill="none" stroke="var(--color-line-strong)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 9 h8 l-2 5 h-4 z" fill="var(--color-surface-3)" stroke="var(--color-line-strong)" strokeWidth="1" />
      <circle cx="16" cy="14.5" r="1.5" fill="var(--color-gold-soft)" />
      <rect x="5" y="20" width="6" height="2" rx="1" fill="var(--color-line-strong)" />
      <line x1="7" y1="4" x2="8" y2="20" stroke="var(--color-line-strong)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function Moment({ title, body, visual }: { title: string; body: string; visual: React.ReactNode }) {
  return (
    <div className="tt-reveal in" style={{ background: "var(--color-surface)", border: "1px solid var(--color-line)", borderRadius: "14px", padding: "1.25rem 1.375rem 1.5rem", display: "flex", flexDirection: "column", gap: "0.875rem" }}>
      <div style={{ height: "64px", display: "flex", alignItems: "center" }}>{visual}</div>
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: "1.0625rem", color: "var(--color-text)", marginBottom: "0.35rem" }}>{title}</div>
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-soft)", lineHeight: 1.55, margin: 0 }}>{body}</p>
      </div>
    </div>
  );
}
