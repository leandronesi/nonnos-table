import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../auth/supabaseClient";
import { AuthShell, Field, inputClass } from "./AuthShell";
import { tr } from "../../i18n/lang";
import { trackAcquisition, trackSignupStarted } from "../../lib/telemetry";

function signupFailureReason(message: string): string {
  const value = message.toLowerCase();
  if (value.includes("already") || value.includes("registered")) return "account_exists";
  if (value.includes("rate") || value.includes("too many")) return "rate_limited";
  if (value.includes("password")) return "password_rejected";
  if (value.includes("email")) return "email_rejected";
  return "auth_rejected";
}

/**
 * Signup — email + password + codice invito.
 * Email confirm OBBLIGATORIO (configurato lato Supabase Auth).
 * Dopo signup si naviga a /verify-email ("controlla la posta").
 */
export function Signup() {
  const nav = useNavigate();
  const [inviteCode, setInviteCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [profilePermissionConfirmed, setProfilePermissionConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackSignupStarted("signup_page");
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    trackAcquisition("signup_submitted", { surface: "signup_form" });
    setError(null);
    if (!profilePermissionConfirmed) {
      trackAcquisition("signup_failed", { surface: "signup_form", reason_code: "profile_permission_missing" });
      setError(tr(
        "Conferma di avere titolo o permesso per far analizzare il profilo Chess.com che selezionerai.",
        "Confirm that you own or have permission to analyze the Chess.com profile you will select.",
      ));
      return;
    }
    if (password.length < 8) {
      trackAcquisition("signup_failed", { surface: "signup_form", reason_code: "password_too_short" });
      setError(tr("La password deve essere lunga almeno 8 caratteri.", "Password must be at least 8 characters."));
      return;
    }
    if (!inviteCode.trim()) {
      trackAcquisition("signup_failed", { surface: "signup_form", reason_code: "invite_missing" });
      setError(tr("Inserisci il codice invito.", "Enter your invite code."));
      return;
    }
    setSubmitting(true);
    const { data: codeOk, error: codeErr } = await supabase.rpc("is_valid_invite_code", {
      p_code: inviteCode.trim(),
    });
    if (codeErr || !codeOk) {
      trackAcquisition("signup_failed", {
        surface: "signup_form",
        reason_code: codeErr ? "invite_check_failed" : "invite_invalid",
      });
      setSubmitting(false);
      setError(
        codeErr
          ? tr("Non riesco a validare il codice, riprova.", "Could not validate the code. Try again.")
          : tr("Codice invito non valido. Chiedi un codice a chi ti ha invitato.", "Invite code is not valid. Ask the person who invited you for a code.")
      );
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/onboarding`,
        data: { invite_code: inviteCode.trim() },
      },
    });
    setSubmitting(false);
    if (error) {
      trackAcquisition("signup_failed", {
        surface: "signup_form",
        reason_code: signupFailureReason(error.message),
      });
      setError(error.message);
      return;
    }
    trackAcquisition("signup_succeeded", { surface: "signup_form" });
    if (data.user && !data.session) {
      // Email confirm pending — caso atteso.
      nav("/verify-email", { state: { email: email.trim().toLowerCase() } });
      return;
    }
    // Progetto Supabase senza email confirm (dev): sessione attiva, vai a onboarding.
    nav("/onboarding");
  }

  return (
    <AuthShell
      title={tr("Sediamoci.", "Let's sit down.")}
      subtitle={tr("Crea un account per costruire il tuo Tavolo.", "Create an account to build your Table.")}
      footer={
        <>
          {tr("Hai gia' un account?", "Already have an account?")}{" "}
          <Link
            to="/login"
            style={{ color: "var(--color-brand-soft)", textDecoration: "underline" }}
          >
            {tr("Entra", "Sign in")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label={tr("Codice invito", "Invite code")}
          htmlFor="invite"
          hint={tr("Serve un codice per entrare in beta.", "You need a code to join the beta.")}
        >
          <input
            id="invite"
            type="text"
            required
            className={inputClass}
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="es. AMICI2026"
          />
        </Field>
        <Field label={tr("Email", "Email")} htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@example.com"
          />
        </Field>
        <Field label={tr("Password", "Password")} htmlFor="password" hint={tr("Almeno 8 caratteri.", "At least 8 characters.")}>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>

        {/* Consenso — piccolo, calmo, non invasivo */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.625rem",
            fontSize: "0.8125rem",
            color: "var(--color-text-soft)",
            marginBottom: "1.125rem",
            marginTop: "0.25rem",
            cursor: "pointer",
            lineHeight: 1.5,
          }}
        >
          <input
            type="checkbox"
            checked={profilePermissionConfirmed}
            onChange={(e) => setProfilePermissionConfirmed(e.target.checked)}
            style={{ marginTop: "0.15rem", flexShrink: 0, accentColor: "var(--color-brand)" }}
          />
          <span>
            {tr(
              "Confermo di avere titolo o permesso per far analizzare il profilo Chess.com che selezionero'. Nonno's Table usa solo partite pubbliche e non verifica tecnicamente la proprieta' del profilo.",
              "I confirm that I own or have permission to analyze the Chess.com profile I will select. Nonno's Table uses public games only and does not technically verify profile ownership."
            )}{" "}
            <Link
              to="/privacy"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              style={{ color: "var(--color-brand-soft)", textDecoration: "underline" }}
            >
              {tr("Privacy", "Privacy")}
            </Link>
          </span>
        </label>

        {error ? (
          <div
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-danger)",
              marginBottom: "0.875rem",
              padding: "0.625rem 0.75rem",
              background: "rgba(244,63,94,0.08)",
              border: "1px solid rgba(244,63,94,0.22)",
              borderRadius: "6px",
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          className="btn btn-primary btn-lg w-full"
          disabled={submitting}
        >
          {submitting ? tr("Creo l'account…", "Creating your account…") : tr("Crea il mio Tavolo", "Set up my Table")}
        </button>
        <p style={{ margin: "0.625rem 0 0", textAlign: "center", fontSize: "0.75rem", lineHeight: 1.45, color: "var(--color-faint)" }}>
          {tr(
            "Poi verifichi l'email e colleghi un profilo pubblico Chess.com.",
            "Next, verify your email and connect a public Chess.com profile.",
          )}
        </p>
      </form>
    </AuthShell>
  );
}
