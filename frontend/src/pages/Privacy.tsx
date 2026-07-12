import { useState } from "react";
import { Link } from "react-router-dom";
import { claimFirstAuthenticatedTelemetryEvent } from "../auth/userStorage";
import { tr } from "../i18n/lang";
import {
  browserDoNotTrackEnabled,
  installGlobalErrorTelemetry,
  setTelemetryEnabled,
  telemetryEnabled,
  trackEvent,
} from "../lib/telemetry";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ padding: "1.1rem 0", borderTop: "1px solid var(--color-line)" }}>
      <h2 style={{ fontSize: "1.05rem", margin: "0 0 0.5rem" }}>{title}</h2>
      <div style={{ color: "var(--color-text-soft)", lineHeight: 1.7 }}>{children}</div>
    </section>
  );
}

export function Privacy() {
  const [telemetryOn, setTelemetryOn] = useState(() => telemetryEnabled());
  const dnt = browserDoNotTrackEnabled();
  const contact = (import.meta.env.VITE_PRIVACY_CONTACT_EMAIL as string | undefined)?.trim();

  return (
    <main style={{ maxWidth: "46rem", margin: "0 auto", padding: "3rem 1.25rem 5rem" }}>
      <p className="label-eyebrow" style={{ color: "var(--color-brand-soft)" }}>Nonno's Table</p>
      <h1 style={{ fontSize: "clamp(2rem, 7vw, 3rem)", margin: "0.25rem 0 0.75rem" }}>
        {tr("Privacy, in parole chiare", "Privacy, in plain language")}
      </h1>
      <p style={{ color: "var(--color-muted)", lineHeight: 1.7 }}>
        {tr(
          "Questa è una descrizione operativa del prodotto, non una dichiarazione di conformità legale.",
          "This is an operational description of the product, not a claim of legal compliance.",
        )}
      </p>

      <Block title={tr("Quali dati usiamo", "Data we use")}>
        <p>{tr(
          "Leggiamo le partite pubbliche del profilo Chess.com scelto: PGN, mosse, rating, cadenza e clock quando disponibile. Lo username è una fonte pubblica e non verifichiamo che il profilo ti appartenga.",
          "We read public games from the selected Chess.com profile: PGN, moves, ratings, time control and clocks when available. The username is a public source and we do not verify ownership.",
        )}</p>
        <p>{tr(
          "Nelle sessioni guidate e nei drill salviamo nel tuo spazio privato l'ancora cloud dell'esercizio, la posizione FEN, la mossa, il tempo impiegato e l'eventuale aiuto usato. Sono dati funzionali necessari per adattare i ripassi e il sistema SRS: vengono salvati anche se rifiuti la telemetria e non dipendono dal consenso analytics.",
          "During guided sessions and drills we save the exercise cloud anchor, FEN position, move, time spent and any hint used in your private space. This is functional data required to adapt reviews and the SRS: it is saved even if you decline telemetry and does not depend on analytics consent.",
        )}</p>
      </Block>

      <Block title={tr("Dove avviene l'analisi", "Where analysis happens")}>
        <p>{tr(
          "Stockfish, Maia e la maggior parte dell'analisi girano nel tuo browser. Account, indice delle partite, PGN, analisi e quaderno vengono salvati in Supabase con accesso privato isolato per utente.",
          "Stockfish, Maia and most analysis run in your browser. Account data, the game index, PGNs, analyses and notebook are saved in Supabase with private per-user isolation.",
        )}</p>
      </Block>

      <Block title={tr("Spiegazioni generate", "Generated explanations")}>
        <p>{tr(
          "Quando chiediamo una spiegazione a Nonno, fatti scacchistici della posizione e aggregati del coach passano dalla nostra funzione server a OpenAI. La chiave OpenAI non viene mai inviata al browser. Non inviamo password o token.",
          "When Nonno generates an explanation, chess facts about the position and coach aggregates pass through our server function to OpenAI. The OpenAI key is never sent to the browser. Passwords and tokens are not sent.",
        )}</p>
      </Block>

      <Block title={tr("Telemetria", "Telemetry")}>
        <p>{tr(
          "La telemetria first-party è disattivata finché non dai un consenso esplicito. Se la attivi, misuriamo funnel, errori tecnici ed efficacia dell'allenamento; escludiamo email, username, password, token, PGN e FEN. Solo dopo il consenso, prima del login usiamo un identificatore casuale pseudonimo nel browser. Non usiamo tracker pubblicitari.",
          "First-party telemetry is off until you explicitly consent. If enabled, we measure the funnel, technical errors and training effectiveness; email, usernames, passwords, tokens, PGNs and FENs are excluded. Only after consent, before sign-in we use a random pseudonymous browser identifier. We use no advertising trackers.",
        )}</p>
        <label style={{ display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={telemetryOn && !dnt}
            disabled={dnt}
            onChange={(event) => {
              setTelemetryEnabled(event.target.checked);
              setTelemetryOn(event.target.checked);
              if (event.target.checked) {
                installGlobalErrorTelemetry();
                if (claimFirstAuthenticatedTelemetryEvent()) trackEvent("first_authenticated");
                trackEvent("telemetry_opted_in");
              }
            }}
          />
          <span>
            {tr("Consenti telemetria tecnica e di utilizzo", "Allow technical and usage telemetry")}
            {dnt ? <small style={{ display: "block" }}>{tr("Il browser ha attivato Do Not Track.", "Your browser enabled Do Not Track.")}</small> : null}
          </span>
        </label>
      </Block>

      <Block title={tr("Conservazione e controllo", "Retention and control")}>
        <p>{tr(
          "Per il corpus scacchistico conserviamo a rotazione le 100 partite più recenti della cadenza obiettivo: righe, PGN e analisi più vecchi, e dati di cadenze non più scelte, entrano in una coda di cancellazione ritentabile. Profilo, quaderno, cronologia di progresso e tentativi di allenamento restano finché esiste l'account. Dalle Impostazioni puoi esportare un JSON con le righe del database e il manifest dei file privati; il file non contiene i file binari. Puoi cancellare account, database e Storage privato in modo definitivo.",
          "For the chess corpus we keep a rolling window of the 100 most recent games in the target time control: older rows, PGNs and analyses, plus data from time controls no longer selected, enter a retryable deletion queue. Your profile, notebook, progress history and training attempts remain while the account exists. Settings lets you export a JSON containing database rows and a manifest of private files; it does not include binary files. You can permanently delete the account, database and private Storage.",
        )}</p>
        <p>{tr(
          "Quando confermi la cancellazione dell'account, blocchiamo subito nuove operazioni sui file privati, poi svuotiamo e verifichiamo lo Storage prima di eliminare l'account. Se la richiesta si interrompe, il blocco resta attivo e puoi ritentare la cancellazione senza riaprire gli upload.",
          "When you confirm account deletion, we immediately block new operations on private files, then empty and verify Storage before deleting the account. If the request is interrupted, the block remains active and you can retry deletion without reopening uploads.",
        )}</p>
        <p><strong>{tr("Prima del lancio pubblico", "Before public launch")}:</strong>{" "}{tr(
          "va configurata e verificata una cancellazione programmata degli eventi anonimi secondo il periodo di conservazione deciso dal titolare.",
          "scheduled deletion of anonymous events must be configured and verified for the retention period chosen by the data controller.",
        )}</p>
      </Block>

      <Block title={tr("Contatti", "Contact")}>
        {contact ? (
          <a href={`mailto:${contact}`}>{contact}</a>
        ) : (
          <p style={{ color: "var(--color-danger)" }}>
            {tr(
              "CONTATTO PRIVACY NON CONFIGURATO: impostare VITE_PRIVACY_CONTACT_EMAIL prima del lancio pubblico.",
              "PRIVACY CONTACT NOT CONFIGURED: set VITE_PRIVACY_CONTACT_EMAIL before public launch.",
            )}
          </p>
        )}
      </Block>

      <p><Link to="/">{tr("Torna all'inizio", "Back to home")}</Link></p>
    </main>
  );
}
