import { useEffect, useState } from "react";
import "./settings.css";
import { useLocation, useNavigate } from "react-router-dom";
import {
  deleteAccount,
  downloadAccountExport,
  exportAccountData,
  sendPasswordReset,
} from "../../auth/accountData";
import { useAuth } from "../../auth/AuthContext";
import {
  claimFirstAuthenticatedTelemetryEvent,
  clearUserLocalStorage,
  setStorageUserScope,
} from "../../auth/userStorage";
import { FeedbackForm } from "../../components/FeedbackForm";
import { tr } from "../../i18n/lang";
import { LangToggle } from "../../i18n/LangToggle";
import {
  browserDoNotTrackEnabled,
  clearAnonymousTelemetryState,
  installGlobalErrorTelemetry,
  setTelemetryEnabled,
  telemetryEnabled,
  trackEvent,
} from "../../lib/telemetry";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="settings-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { user, profile, signOut } = useAuth();
  const [telemetryOn, setTelemetryOn] = useState(() => telemetryEnabled());
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const dnt = browserDoNotTrackEnabled();

  useEffect(() => {
    if (!hash) return;
    const id = decodeURIComponent(hash.slice(1));
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, [hash]);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setStatus(null);
    try {
      await action();
    } catch {
      setStatus(tr("Operazione non riuscita. Riprova.", "Operation failed. Try again."));
    } finally {
      setBusy(null);
    }
  }

  const email = user?.email ?? "";

  return (
    <div className="settings-page">
      <p className="label-eyebrow" style={{ color: "var(--color-brand-soft)" }}>{tr("Il tuo account", "Your account")}</p>
      <h1>
        {tr("Il tuo profilo", "Your profile")}
      </h1>
      <p style={{ color: "var(--color-muted)", marginBottom: "1.5rem" }}>{email}</p>

      {status ? <div role="status" style={{ marginBottom: "1rem", color: "var(--color-brand-soft)" }}>{status}</div> : null}

      <Section id="obiettivo" title={tr("Il livello di riferimento", "Your reference level")}>
        <div className="settings-goal"><strong>{profile?.goal_rating ?? "?"}</strong><span>{profile?.goal_time_class ?? ""}</span></div>
        <p>{tr("? il livello scelto per confrontare le decisioni con Maia. I pattern nascono dalle tue partite; il confronto aiuta a orientare l?allenamento.", "This is the level you chose for comparing decisions with Maia. Patterns come from your games; the comparison helps guide practice.")}</p>
        <dl className="settings-facts"><div><dt>{tr("Impegno scelto", "Chosen commitment")}</dt><dd>{profile?.weekly_minutes ?? "?"} min/{tr("settimana", "week")}</dd></div><div><dt>{tr("Orizzonte personale", "Personal horizon")}</dt><dd>{profile?.goal_horizon_weeks ?? "?"} {tr("settimane", "weeks")}</dd></div></dl>
      </Section>

      <Section title={tr("Profilo analizzato", "Analysed profile")}>
        <p style={{ margin: 0, color: "var(--color-text-soft)", lineHeight: 1.6 }}>
          <strong>{profile?.chess_com_username ?? "—"}</strong><br />
          {tr(
            "È un profilo pubblico Chess.com scelto come fonte delle partite. Non verifichiamo che l'account Chess.com ti appartenga e più persone possono analizzare lo stesso profilo.",
            "This is a public Chess.com profile selected as the game source. We do not verify ownership, and more than one person can analyse the same profile.",
          )}
        </p>
      </Section>

      <Section title={tr("Lingua", "Language")}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
          <LangToggle touch />
        </div>
      </Section>

      <Section title={tr("Privacy e misurazione", "Privacy and measurement")}>
        <p style={{ color: "var(--color-text-soft)", lineHeight: 1.6 }}>
          {tr(
            "Raccogliamo eventi tecnici first-party per capire dove il prodotto si blocca e se l'allenamento funziona. Non usiamo tracker pubblicitari. Non inviamo password, token, email, username, PGN o FEN negli eventi.",
            "We collect first-party technical events to understand product friction and whether training works. We use no advertising trackers. Passwords, tokens, email, usernames, PGNs and FENs are excluded from events.",
          )}
        </p>
        <label style={{ display: "flex", gap: "0.65rem", alignItems: "flex-start" }}>
          <input
            type="checkbox"
            checked={telemetryOn && !dnt}
            disabled={dnt}
            onChange={(event) => {
              setTelemetryEnabled(event.target.checked);
              setTelemetryOn(event.target.checked);
              if (event.target.checked) {
                installGlobalErrorTelemetry();
                if (claimFirstAuthenticatedTelemetryEvent()) {
                  trackEvent("first_authenticated");
                }
                trackEvent("telemetry_opted_in");
              }
            }}
          />
          <span>
            {tr("Condividi dati tecnici e di utilizzo", "Share technical and usage data")}
            {dnt ? <small style={{ display: "block", color: "var(--color-muted)" }}>{tr("Disattivato dal segnale Do Not Track del browser.", "Disabled by the browser's Do Not Track signal.")}</small> : null}
          </span>
        </label>
        <p style={{ color: "var(--color-muted)", fontSize: "0.75rem", lineHeight: 1.55 }}>
          {tr(
            "Le partite pubbliche vengono elaborate nel browser e salvate nel tuo spazio Supabase privato. Per generare spiegazioni, fatti scacchistici della posizione e aggregati del coach passano dalla nostra funzione server a OpenAI; la chiave del servizio non entra mai nel browser.",
            "Public games are processed in the browser and saved in your private Supabase area. To generate explanations, position facts and coach aggregates pass through our server function to OpenAI; the service key never enters the browser.",
          )}
        </p>
      </Section>

      <Section title={tr("Sicurezza e dati", "Security and data")}>
        <p style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
          {tr(
            "L'export è un JSON con account, righe database e manifest dei file privati. Non include il contenuto dei PGN e delle analisi.",
            "The export is a JSON containing account data, database rows and a manifest of private files. It does not contain PGN and analysis file contents.",
          )}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.625rem" }}>
          <button
            type="button"
            className="btn"
            disabled={!email || busy !== null}
            onClick={() => void run("password", async () => {
              await sendPasswordReset(email);
              setStatus(tr("Email per la password inviata.", "Password email sent."));
            })}
          >
            {tr("Cambia password", "Change password")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy !== null}
            onClick={() => void run("export", async () => {
              const data = await exportAccountData();
              downloadAccountExport(data);
              trackEvent("account_exported");
            })}
          >
            {busy === "export" ? tr("Preparo…", "Preparing…") : tr("Scarica JSON + manifest", "Download JSON + manifest")}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!user}
            onClick={() => {
              if (!user || !window.confirm(tr("Rimuovere da questo dispositivo sessione, diario e ripassi locali? I dati cloud restano.", "Remove local session, journal and reviews from this device? Cloud data stays."))) return;
              clearUserLocalStorage(user.id);
              setStorageUserScope(user.id);
              setStatus(tr("Dati locali rimossi.", "Local data removed."));
            }}
          >
            {tr("Pulisci questo dispositivo", "Clear this device")}
          </button>
        </div>
      </Section>

      <Section id="feedback" title={tr("Dicci la verità", "Tell us the truth")}>
        <FeedbackForm kind="product" subject="tavolo-diagnosis" />
      </Section>

      <Section title={tr("Elimina account", "Delete account")}>
        <p style={{ color: "var(--color-muted)", lineHeight: 1.6 }}>
          {tr(
            "Blocca l'accesso ai file privati, poi cancella file, dati di analisi, allenamenti e account. Se si interrompe, ritenta questa azione. Non è reversibile. Scrivi la tua email per confermare.",
            "Blocks private-file access, then deletes files, analysis data, training history and the account. If interrupted, retry this action. This cannot be undone. Type your email to confirm.",
          )}
        </p>
        <input
          type="email"
          aria-label={tr("Email per confermare l?eliminazione", "Email to confirm deletion")}
          value={deleteConfirmation}
          onChange={(event) => setDeleteConfirmation(event.target.value)}
          placeholder={email}
          style={{ width: "100%", maxWidth: "24rem", padding: "0.65rem", marginBottom: "0.65rem" }}
        />
        <div>
          <button
            type="button"
            className="btn"
            disabled={!user || !email || deleteConfirmation.trim().toLowerCase() !== email.toLowerCase() || busy !== null}
            style={{ color: "var(--color-danger)" }}
            onClick={() => void run("delete", async () => {
              if (!user) return;
              await deleteAccount(deleteConfirmation);
              clearUserLocalStorage(user.id);
              clearAnonymousTelemetryState();
              await signOut();
              navigate("/login", { replace: true });
            })}
          >
            {busy === "delete" ? tr("Elimino…", "Deleting…") : tr("Elimina definitivamente", "Delete permanently")}
          </button>
        </div>
      </Section>
    </div>
  );
}
