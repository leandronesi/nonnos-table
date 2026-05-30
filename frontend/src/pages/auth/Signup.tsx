import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../auth/supabaseClient";
import { AuthShell, Field, inputClass } from "./AuthShell";

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
  const [tos, setTos] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tos) {
      setError("Devi accettare i termini per continuare.");
      return;
    }
    if (password.length < 8) {
      setError("La password deve essere lunga almeno 8 caratteri.");
      return;
    }
    if (!inviteCode.trim()) {
      setError("Inserisci il codice invito.");
      return;
    }
    setSubmitting(true);
    const { data: codeOk, error: codeErr } = await supabase.rpc("is_valid_invite_code", {
      p_code: inviteCode.trim(),
    });
    if (codeErr || !codeOk) {
      setSubmitting(false);
      setError(
        codeErr
          ? "Non riesco a validare il codice, riprova."
          : "Codice invito non valido. Chiedi un codice a chi ti ha invitato."
      );
      return;
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/onboarding`,
      },
    });
    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
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
      title="Sediamoci."
      subtitle="Crea un account per costruire il tuo Tavolo."
      footer={
        <>
          Hai gia' un account?{" "}
          <Link
            to="/login"
            style={{ color: "var(--color-brand-soft)", textDecoration: "underline" }}
          >
            Entra
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        <Field
          label="Codice invito"
          htmlFor="invite"
          hint="Serve un codice per entrare in beta."
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
        <Field label="Email" htmlFor="email">
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
        <Field label="Password" htmlFor="password" hint="Almeno 8 caratteri.">
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
            checked={tos}
            onChange={(e) => setTos(e.target.checked)}
            style={{ marginTop: "0.15rem", flexShrink: 0, accentColor: "var(--color-brand)" }}
          />
          <span>
            Accetto che Nonno's Table legga le mie partite pubbliche da Chess.com
            per costruire il mio Tavolo.
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
          {submitting ? "Creo l'account…" : "Crea il mio Tavolo"}
        </button>
      </form>
    </AuthShell>
  );
}
