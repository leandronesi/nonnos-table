import type { ReactNode } from "react";

/**
 * Layout condiviso per le pagine pre-login (signup, login, verifica email,
 * onboarding wizard, waiting).
 *
 * Colonna stretta centrata. Sfondo notte. Nessun ornamento.
 * Anima: "un tavolo a cui ti siedi" — calmo, diretto, una voce.
 */
export function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-5 py-10"
      style={{ background: "var(--color-bg)" }}
    >
      {/* Wordmark */}
      <div
        className="tt-eyebrow"
        style={{
          color: "var(--color-brand-soft)",
          marginBottom: "2.5rem",
          letterSpacing: "0.16em",
        }}
      >
        Nonno&apos;s Table
      </div>

      <div
        className="tt-reveal in w-full"
        style={{ maxWidth: "26rem" }}
      >
        {/* Intestazione */}
        <div style={{ marginBottom: "1.75rem" }}>
          {eyebrow ? (
            <div
              className="tt-eyebrow tt-muted"
              style={{ marginBottom: "0.625rem" }}
            >
              {eyebrow}
            </div>
          ) : null}
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: "clamp(1.75rem, 5vw, 2.25rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "var(--color-text)",
              margin: 0,
            }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              style={{
                color: "var(--color-text-soft)",
                fontSize: "0.9rem",
                lineHeight: 1.65,
                marginTop: "0.625rem",
                maxWidth: "42ch",
              }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>

        {/* Contenuto del form */}
        <div
          style={{
            background: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: "12px",
            padding: "1.75rem",
          }}
        >
          {children}
        </div>

        {/* Footer link */}
        {footer ? (
          <div
            className="text-center mt-5"
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-muted)",
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Wrapper label + input con hint/errore opzionale.
 * Label come eyebrow mono uppercase per coerenza col design system.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block mb-4" style={{ cursor: "default" }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "0.625rem",
          fontWeight: 600,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--color-muted)",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </div>
      {children}
      {hint && !error ? (
        <div
          style={{
            fontSize: "0.6875rem",
            color: "var(--color-faint)",
            marginTop: "0.375rem",
            lineHeight: 1.4,
          }}
        >
          {hint}
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            fontSize: "0.6875rem",
            color: "var(--color-danger)",
            marginTop: "0.375rem",
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      ) : null}
    </label>
  );
}

/** Classe base per tutti gli input testuali nelle pagine auth. */
export const inputClass =
  "w-full px-3.5 py-2.5 text-sm " +
  "bg-[color:var(--color-surface-2)] " +
  "border border-[color:var(--color-line)] " +
  "rounded-[8px] " +
  "focus:outline-none focus:border-[color:var(--color-brand)] " +
  "text-[color:var(--color-text)] " +
  "placeholder:text-[color:var(--color-faint)] " +
  "transition-colors duration-150";
