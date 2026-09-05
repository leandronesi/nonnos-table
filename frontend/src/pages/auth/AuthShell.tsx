import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { tr } from "../../i18n/lang";
import "./auth-shell.css";

export function AuthShell({ eyebrow, title, subtitle, children, footer }: {
  eyebrow?: string; title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return <div className="auth-shell">
    <header className="auth-header">
      <Link to="/" className="coach-brand" aria-label={tr("Nonno, pagina iniziale", "Nonno, home")}>
        <span className="coach-brand-mark" aria-hidden="true">n.</span>
        <span><strong>Nonno</strong><small>{tr("IMPARA DAL TUO GIOCO", "LEARN FROM YOUR GAME")}</small></span>
      </Link>
      <Link to="/privacy">{tr("Privacy e dati", "Privacy and data")}</Link>
    </header>
    <main className="auth-layout">
      <aside className="auth-story">
        <span className="auth-kicker">{tr("IL TUO PROSSIMO PASSO", "YOUR NEXT STEP")}</span>
        <h2>{tr("Ogni partita racconta qualcosa. Insieme, raccontano il tuo gioco.", "Every game tells you something. Together, they tell your story.")}</h2>
        <p>{tr("Ritrova le abitudini che si ripetono, capisci dove dedicare più tempo e allenati sulle tue posizioni.", "Find recurring habits, see where to spend more time and practise your own positions.")}</p>
        <div className="auth-story-note"><span aria-hidden="true">◷</span><p>{tr("Anche il tempo è una scelta. Una mossa veloce può essere giusta: conta capire quando vale la pena fermarsi.", "Time is a choice, too. A quick move can be right: learn when it is worth pausing.")}</p></div>
      </aside>
      <section className="auth-panel" aria-labelledby="auth-title">
        <header>{eyebrow && <p className="auth-kicker">{eyebrow}</p>}<h1 id="auth-title">{title}</h1>{subtitle && <div className="auth-subtitle">{subtitle}</div>}</header>
        <div className="auth-form">{children}</div>
        {footer && <footer className="auth-footer">{footer}</footer>}
      </section>
    </main>
  </div>;
}

export function Field({ label, htmlFor, hint, error, children }: {
  label: string; htmlFor: string; hint?: string; error?: string | null; children: ReactNode;
}) {
  return <div className="auth-field">
    <label htmlFor={htmlFor}>{label}</label>{children}
    {hint && !error && <p className="auth-field-hint">{hint}</p>}
    {error && <p className="auth-field-error" role="alert">{error}</p>}
  </div>;
}
export const inputClass = "auth-input";
