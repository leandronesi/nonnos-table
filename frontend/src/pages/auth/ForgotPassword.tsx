import { useState } from "react";
import { Link } from "react-router-dom";
import { tr } from "../../i18n/lang";
import { sendPasswordReset } from "../../auth/accountData";
import { AuthShell, Field, inputClass } from "./AuthShell";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setSent(true);
    } catch {
      setError(tr("Non riesco a inviare l'email. Riprova tra poco.", "Could not send the email. Try again shortly."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={tr("Recupera l'accesso.", "Recover access.")}
      subtitle={tr(
        "Ti mandiamo un link per scegliere una nuova password.",
        "We will email you a link to choose a new password.",
      )}
      footer={<Link to="/login">{tr("Torna al login", "Back to sign in")}</Link>}
    >
      {sent ? (
        <div role="status" style={{ lineHeight: 1.6, color: "var(--color-text-soft)" }}>
          {tr(
            "Se l'indirizzo corrisponde a un account, l'email è in viaggio. Controlla anche lo spam.",
            "If the address matches an account, the email is on its way. Check spam too.",
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit}>
          <Field label={tr("Email", "Email")} htmlFor="reset-email" error={error ?? undefined}>
            <input
              id="reset-email"
              type="email"
              autoComplete="email"
              required
              className={inputClass}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting}>
            {submitting ? tr("Invio…", "Sending…") : tr("Invia il link", "Send reset link")}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
