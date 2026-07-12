import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { updatePassword } from "../../auth/accountData";
import { useAuth } from "../../auth/AuthContext";
import { tr } from "../../i18n/lang";
import { AuthShell, Field, inputClass } from "./AuthShell";

export function UpdatePassword() {
  const navigate = useNavigate();
  const { loading, user } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(tr("Usa almeno 8 caratteri.", "Use at least 8 characters."));
      return;
    }
    if (password !== confirm) {
      setError(tr("Le password non coincidono.", "Passwords do not match."));
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(password);
      navigate("/", { replace: true });
    } catch {
      setError(tr("Il link è scaduto o non è più valido.", "The link has expired or is no longer valid."));
    } finally {
      setSubmitting(false);
    }
  }

  if (!loading && !user) {
    return (
      <AuthShell title={tr("Link non valido.", "Invalid link.")}>
        <Link to="/forgot-password">{tr("Richiedi un nuovo link", "Request a new link")}</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={tr("Scegli una nuova password.", "Choose a new password.")}
      subtitle={tr("Almeno 8 caratteri.", "At least 8 characters.")}
    >
      <form onSubmit={onSubmit}>
        <Field label={tr("Nuova password", "New password")} htmlFor="new-password">
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label={tr("Ripeti password", "Repeat password")} htmlFor="confirm-password" error={error ?? undefined}>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className={inputClass}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <button type="submit" className="btn btn-primary btn-lg w-full" disabled={submitting || loading}>
          {submitting ? tr("Salvo…", "Saving…") : tr("Aggiorna password", "Update password")}
        </button>
      </form>
    </AuthShell>
  );
}
