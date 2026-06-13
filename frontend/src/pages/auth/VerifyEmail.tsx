import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../../auth/supabaseClient";
import { AuthShell } from "./AuthShell";
import { tr } from "../../i18n/lang";

interface LocationState {
  email?: string;
}

export function VerifyEmail() {
  const loc = useLocation();
  const email = (loc.state as LocationState | null)?.email ?? null;
  const [sending, setSending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setSending(true);
    setError(null);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/$/, "")}/onboarding`,
      },
    });
    setSending(false);
    if (error) setError(error.message);
    else setResent(true);
  }

  return (
    <AuthShell
      title={tr("Controlla la posta.", "Check your email.")}
      subtitle={
        email ? (
          <>
            {tr("Ti abbiamo mandato un link di conferma a ", "We sent a confirmation link to ")}
            <span className="font-mono">{email}</span>
            {tr(". Cliccalo e torni qui.", ". Click it and come back.")}
          </>
        ) : (
          tr(
            "Ti abbiamo mandato un link di conferma. Cliccalo per attivare l'account.",
            "We sent you a confirmation link. Click it to activate your account."
          )
        )
      }
    >
      <p className="text-sm text-[color:var(--color-text-soft)] leading-relaxed">
        {tr(
          "Se non lo vedi, controlla la cartella spam. Il link scade dopo qualche ora, se è già scaduto puoi richiederne uno nuovo.",
          "If you do not see it, check your spam folder. The link expires after a few hours. If it has expired, you can request a new one."
        )}
      </p>
      {email ? (
        <button
          onClick={resend}
          className="btn btn-ghost mt-4 w-full"
          disabled={sending || resent}
        >
          {resent
            ? tr("Email rispedita.", "Email sent.")
            : sending
            ? tr("Invio…", "Sending…")
            : tr("Rispedisci email", "Resend email")}
        </button>
      ) : null}
      {error ? (
        <div className="text-sm text-[color:var(--color-danger)] mt-3">{error}</div>
      ) : null}
      <div className="mt-6 text-center text-xs text-[color:var(--color-muted)]">
        <Link to="/login" className="underline">
          {tr("Torna al login", "Back to sign in")}
        </Link>
      </div>
    </AuthShell>
  );
}
