import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "../../auth/supabaseClient";
import { AuthShell } from "./AuthShell";

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
      title="Controlla la posta."
      subtitle={
        email ? (
          <>
            Ti abbiamo mandato un link di conferma a <span className="font-mono">{email}</span>.
            Cliccalo e torni qui.
          </>
        ) : (
          "Ti abbiamo mandato un link di conferma. Cliccalo per attivare l'account."
        )
      }
    >
      <p className="text-sm text-[color:var(--color-text-soft)] leading-relaxed">
        Se non lo vedi, controlla la cartella spam. Il link scade dopo qualche ora,
        se è già scaduto puoi richiederne uno nuovo.
      </p>
      {email ? (
        <button
          onClick={resend}
          className="btn btn-ghost mt-4 w-full"
          disabled={sending || resent}
        >
          {resent ? "Email rispedita." : sending ? "Invio…" : "Rispedisci email"}
        </button>
      ) : null}
      {error ? (
        <div className="text-sm text-[color:var(--color-danger)] mt-3">{error}</div>
      ) : null}
      <div className="mt-6 text-center text-xs text-[color:var(--color-muted)]">
        <Link to="/login" className="underline">
          Torna al login
        </Link>
      </div>
    </AuthShell>
  );
}
