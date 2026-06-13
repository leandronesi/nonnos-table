import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../auth/supabaseClient";
import { AuthShell, Field, inputClass } from "./AuthShell";
import { tr } from "../../i18n/lang";

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    setSubmitting(false);
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? tr("Email o password non corrette.", "Email or password is incorrect.")
          : error.message
      );
      return;
    }
    // AuthContext rileva il cambio sessione e le route guard portano
    // dove serve (onboarding o /coach).
    nav("/");
  }

  return (
    <AuthShell
      title={tr("Bentornato.", "There you are.")}
      subtitle={tr("Sediamoci di nuovo al Tavolo.", "Let's sit down again.")}
      footer={
        <>
          {tr("Nuovo qui?", "New here?")}{" "}
          <Link
            to="/signup"
            style={{ color: "var(--color-brand-soft)", textDecoration: "underline" }}
          >
            {tr("Crea un account", "Create an account")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit}>
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
        <Field label={tr("Password", "Password")} htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
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
          {submitting ? tr("Entro…", "Signing in…") : tr("Entra", "Sign in")}
        </button>
      </form>
    </AuthShell>
  );
}
