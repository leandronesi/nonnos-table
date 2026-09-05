import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Clock3, Layers3, Target, TrendingUp } from "lucide-react";
import { LangToggle } from "../i18n/LangToggle";
import { tr } from "../i18n/lang";
import { setTelemetryEnabled, telemetryConsentStatus, trackEvent, trackLandingView, type TelemetryConsentStatus } from "../lib/telemetry";
import "./landing.css";

export function Landing() {
  const [telemetryChoice, setTelemetryChoice] = useState<TelemetryConsentStatus>(() => telemetryConsentStatus());
  const [example, setExample] = useState<"reserve" | "pressure">("reserve");
  useEffect(() => { trackLandingView(); }, []);
  function chooseTelemetry(enabled: boolean) {
    setTelemetryEnabled(enabled);
    setTelemetryChoice(enabled ? "granted" : "denied");
    if (enabled) trackLandingView();
  }
  const reserve = example === "reserve";
  return <div className="nonno-landing">
    <header className="landing-header">
      <Link to="/" className="coach-brand" aria-label="Nonno">
        <span className="coach-brand-mark" aria-hidden="true">n.</span>
        <span><strong>Nonno</strong><small>{tr("IMPARA DAL TUO GIOCO", "LEARN FROM YOUR GAME")}</small></span>
      </Link>
      <nav aria-label={tr("Accesso e lingua", "Access and language")}><LangToggle touch /><Link to="/login">{tr("Accedi", "Sign in")} <ArrowRight size={16} aria-hidden="true" /></Link></nav>
    </header>
    <main id="landing-main">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-intro">
          <p className="landing-kicker">{tr("PER CHI VUOLE CRESCERE SENZA UN COACH", "FOR PLAYERS LEARNING WITHOUT A COACH")}</p>
          <h1 id="landing-title">{tr("Il tuo gioco ha delle abitudini. Impara a riconoscerle.", "Your game has habits. Learn to recognise them.")}</h1>
          <p className="landing-lead">{tr("Nonno mette insieme le tue partite Chess.com: trova le scelte che ritornano, guarda come usi il tempo e ti aiuta a lavorare sul prossimo passo.", "Nonno brings your Chess.com games together: find recurring decisions, explore how you use your time and work on your next step.")}</p>
          <Link to="/signup" className="landing-primary" onClick={() => trackEvent("landing_signup_clicked", { source: "hero" })}>{tr("Inizia dalle tue partite", "Start with your games")} <ArrowRight size={20} aria-hidden="true" /></Link>
          <p className="landing-access">{tr("Beta gratuita su invito · Rapid e blitz", "Free invite-only beta · Rapid and blitz")}</p>
        </div>
        <figure className="landing-example">
          <figcaption>{tr("COME SI LEGGE UN PATTERN · ESEMPIO ILLUSTRATIVO", "READING A PATTERN · ILLUSTRATIVE EXAMPLE")}</figcaption>
          <div className="landing-example-tabs" role="group" aria-label={tr("Situazione temporale", "Clock situation")}>
            <button type="button" aria-pressed={reserve} onClick={() => setExample("reserve")}>{tr("Tempo a disposizione", "Time to spare")}</button>
            <button type="button" aria-pressed={!reserve} onClick={() => setExample("pressure")}>{tr("Sotto pressione", "Under pressure")}</button>
          </div>
          <div className="landing-example-content" aria-live="polite" aria-atomic="true">
            <div className="landing-clock"><Clock3 size={24} aria-hidden="true" /><span>{tr("Prima della mossa", "Before the move")}<strong>{reserve ? "06:42" : "00:12"}</strong></span><span>{tr("Tempo usato", "Time spent")}<strong>{reserve ? "2 s" : "3 s"}</strong></span></div>
            <h2>{reserve ? tr("Avevi tempo. La scelta è arrivata subito.", "You had time. The decision came immediately.") : tr("Qui il tempo era quasi finito.", "Here, time was running out.")}</h2>
            <p>{reserve ? tr("Una mossa rapida può essere buona. Cerchiamo se gli errori si ripetono quando decidi in fretta, anche con minuti ancora disponibili.", "A quick move can be good. We look for errors that recur when you decide quickly, even with minutes to spare.") : tr("Questo è un contesto diverso. Separiamo gli errori in affanno da quelli commessi con una buona riserva di tempo.", "This is a different context. We separate errors under time pressure from errors made with plenty of time left.")}</p>
            <div className="landing-game-strip" aria-label={tr("Tre partite illustrative con lo stesso contesto", "Three illustrative games sharing this context")}>
              {["A", "B", "C"].map((label, i) => <div key={label}><span>{tr("Partita", "Game")} {label}</span><strong>{reserve ? ["06:42", "04:18", "05:31"][i] : ["00:12", "00:08", "00:15"][i]}</strong><small>{tr("prima della scelta", "before choosing")}</small></div>)}
            </div>
          </div>
          <p className="landing-example-note">{tr("Numeri inventati per spiegare la lettura. Nel tuo profilo, ogni esempio rimanda alla partita da cui proviene.", "Made-up numbers to explain the reading. In your profile, every example links back to its source game.")}</p>
        </figure>
      </section>
      <section className="landing-method" aria-labelledby="method-title">
        <div className="landing-section-intro"><p className="landing-kicker">{tr("DALLE PARTITE ALLA PRATICA", "FROM GAMES TO PRACTICE")}</p><h2 id="method-title">{tr("Un lavoro sul tuo modo di giocare.", "Work on the way you play.")}</h2></div>
        <div className="landing-method-grid">
          <article><Layers3 aria-hidden="true" /><span>01</span><h3>{tr("Guarda cosa ritorna", "See what keeps happening")}</h3><p>{tr("La lettura cresce fino a 100 partite della cadenza scelta. Errori e scelte riuscite aiutano a distinguere un episodio da un’abitudine.", "The reading grows to cover up to 100 games of your chosen time control. Mistakes and successful choices help distinguish an episode from a habit.")}</p></article>
          <article><Target aria-hidden="true" /><span>02</span><h3>{tr("Scegli il prossimo passo", "Choose your next step")}</h3><p>{tr("Maia confronta le scelte al tuo livello e a quello che vuoi raggiungere, per esempio 200 Elo più su. Un riferimento per le priorità, senza promesse di punti.", "Maia compares choices at your level and the level you want to reach, such as 200 Elo higher. A reference for priorities, with no rating promises.")}</p></article>
          <article><TrendingUp aria-hidden="true" /><span>03</span><h3>{tr("Allenati. Poi torna a giocare.", "Practise. Then play again.")}</h3><p>{tr("Lavora sulle tue posizioni, osservando anche il tempo della scelta. Nelle partite successive controlliamo se lo stesso pattern cambia, mostrando quante occasioni abbiamo osservato.", "Work on your positions and the time you take to choose. In later games, check whether the pattern changes, with the number of observed opportunities always visible.")}</p></article>
        </div>
      </section>
      <section className="landing-invitation">
        <img src={`${import.meta.env.BASE_URL}nonno-face.png`} alt="" width="80" height="80" loading="lazy" />
        <div><p className="landing-kicker">{tr("UN POSTO AL TAVOLO", "A PLACE AT THE TABLE")}</p><h2>{tr("Partiamo da come giochi tu.", "Let's start with how you play.")}</h2><p>{tr("Scegli il tuo profilo pubblico Chess.com e una cadenza. La prima lettura parte da 10 partite, o da quelle disponibili.", "Choose your public Chess.com profile and a time control. Your first reading starts with 10 games, or those available.")}</p></div>
        <Link to="/signup" className="landing-primary" onClick={() => trackEvent("landing_signup_clicked", { source: "footer" })}>{tr("Entra nella beta", "Join the beta")} <ArrowRight size={20} aria-hidden="true" /></Link>
      </section>
      {telemetryChoice === "unknown" && <aside className="landing-consent" aria-label={tr("Scelta telemetria", "Telemetry choice")}><p>{tr("Vuoi aiutarci a migliorare Nonno? Con il tuo consenso misuriamo visite e passaggi essenziali. Username, PGN e FEN sono esclusi dagli eventi.", "Help us improve Nonno? With your consent we measure visits and essential product steps. Usernames, PGNs and FENs are excluded from events.")} <Link to="/privacy">{tr("Privacy e dati", "Privacy and data")}</Link></p><div><button type="button" onClick={() => chooseTelemetry(false)}>{tr("Continua senza telemetria", "Continue without telemetry")}</button><button type="button" onClick={() => chooseTelemetry(true)}>{tr("Consenti", "Allow")}</button></div></aside>}
    </main>
    <footer className="landing-footer"><span>Nonno</span><p>{tr("Uno spazio per capire il tuo gioco.", "A space to understand your game.")}</p><Link to="/privacy">{tr("Privacy e dati", "Privacy and data")}</Link></footer>
  </div>;
}
