import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LogIn } from "lucide-react";
import { BoardView } from "../components/BoardView";

// Posizione vera: Bianco muove, dxc5 vince l'alfiere in c5.
// Il valore non e' "la soluzione": e' il gap fra te e il tuo ELO target.
const HERO_FEN = "r1bq1rk1/pppp1ppp/2n2n2/2b1p3/2BPP3/5N2/PPP2PPP/RNBQ1RK1 w - - 0 1";

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

export function Landing() {
  const board = useFitSize(208, 304);

  return (
    <div className="public-home">
      <header className="public-topbar">
        <Link to="/" className="public-brand" aria-label="il Tavolo del Nonno">
          <span className="public-brand-mark" aria-hidden>
            N
          </span>
          <span>
            il Tavolo del <b>Nonno</b>
          </span>
        </Link>

        <Link to="/login" className="public-login">
          <LogIn size={16} strokeWidth={2.2} aria-hidden />
          Accedi
        </Link>
      </header>

      <main className="public-main">
        <section className="public-hero" aria-labelledby="home-title">
          <div className="public-copy">
            <div className="public-kicker">Beta su invito</div>

            <h1 id="home-title">
              il Tavolo del <span>Nonno</span>
            </h1>

            <p className="public-payoff">
              Scegli il tuo prossimo livello. Nonno si siede un passo piu' avanti.
            </p>

            <p className="public-lede">
              Come quella persona che ti aspettava per giocare: si metteva al tuo
              passo, ma vedeva sempre un poco piu' in la'. Qui ogni partita diventa
              una sera al tavolo, e ogni sera sai meglio dove guardare.
            </p>

            <TargetRail />

            <div className="public-nonno">
              <span>Nonno, quando ti siedi</span>
              Ti aspetto qui. Giochiamo al tuo passo, ma tengo la sedia appena piu'
              avanti. Non per farti sentire piccolo: per mostrarti, una mossa alla
              volta, dove andrai a sederti.
            </div>

            <div className="public-actions">
              <Link to="/signup" className="btn btn-primary btn-lg public-cta">
                Crea il tuo Tavolo
                <ArrowRight size={18} strokeWidth={2.3} aria-hidden />
              </Link>
              <p>Serve un codice invito per entrare.</p>
            </div>
          </div>

          <div className="public-stage" aria-label="Il tavolo serale di Nonno">
            <div className="public-wall" aria-hidden />
            <div className="public-lamp" aria-hidden>
              <span className="public-lamp-glow" />
              <span className="public-lamp-shade" />
              <span className="public-lamp-stem" />
              <span className="public-lamp-base" />
            </div>
            <div className="public-desk" aria-hidden />

            <div className="public-target-card">
              <span className="public-panel-label honey">Obiettivo</span>
              <div className="public-rating-line">
                <strong>1240</strong>
                <span />
                <b>1500</b>
              </div>
              <p>Il posto al tavolo che hai scelto.</p>
            </div>

            <div className="public-session-card">
              <span className="public-panel-label">Oggi al tavolo</span>
              <strong>Pezzo in presa</strong>
              <p>Rivediamo quella mano che parte un attimo troppo presto.</p>
            </div>

            <div className="public-board-card">
              <div ref={board.ref} className="public-board-wrap">
                <BoardView
                  fen={HERO_FEN}
                  size={board.size}
                  orientation="white"
                  arrows={[{ from: "d4", to: "c5", color: "#f6c64a" }]}
                  highlights={[{ square: "c5", color: "#f6c64a" }]}
                />
              </div>

              <div className="public-gap">
                <span className="public-panel-label muted">Pezzo in presa</span>
                <GapBar label="tu" value={37} color="brand" />
                <GapBar label="1500" value={67} color="gold" />
              </div>
            </div>

            <div className="public-notebook">
              <span className="public-panel-label muted">Quaderno</span>
              <div className="public-note-lines" aria-hidden>
                <span />
                <span />
                <span />
              </div>
              <p>
                Ce lo segniamo. Hai chiuso <b>21%</b> del gap, e la prossima
                sera ripartiamo da li'.
              </p>
            </div>
          </div>
        </section>

        <section className="public-story-grid" aria-label="Come si usa il Tavolo">
          <StoryCard
            label="01"
            kind="target"
            title="Il posto da raggiungere"
            body="Dici 1500 rapid, e il tavolo cambia misura. Nonno non ti confronta con il motore: ti confronta con la sedia accanto."
          />
          <StoryCard
            label="02"
            kind="moment"
            title="La mossa che ritorna"
            body="Non rivedi la stessa posizione a memoria. Rivedi la stessa idea, in un'altra sera, finche' la riconosci da solo."
          />
          <StoryCard
            label="03"
            kind="notebook"
            title="Il Quaderno ti riconosce"
            body="Quando torni, Nonno sa dove eravate rimasti. Non riparti da un report: riparti da una storia che continua."
          />
        </section>
      </main>
    </div>
  );
}

function TargetRail() {
  return (
    <div className="public-target-rail" aria-label="Selettore ELO target">
      <div>
        <span>oggi</span>
        <strong>1240</strong>
      </div>
      <div className="public-rail-track" aria-hidden>
        <span />
      </div>
      <div>
        <span>target</span>
        <strong>1500</strong>
      </div>
    </div>
  );
}

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

function StoryCard({
  label,
  kind,
  title,
  body,
}: {
  label: string;
  kind: "target" | "moment" | "notebook";
  title: string;
  body: string;
}) {
  return (
    <article className="public-story-card">
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
