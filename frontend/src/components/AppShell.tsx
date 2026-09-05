import { useState, type ReactNode } from "react";
import { NavLink, Link } from "react-router-dom";
import { BookOpen, Target, LayoutGrid, Settings, Sun, Moon, LogOut, TrendingUp } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { getCurrentTheme, toggleTheme } from "../theme";
import { LangToggle } from "../i18n/LangToggle";
import { tr } from "../i18n/lang";
import "./coach-shell.css";

export interface CoachShellProps {
  children: ReactNode;
  username: string | null;
  processing?: boolean;
  onSignOut: () => Promise<void>;
}

/** One content tree across breakpoints: resizing never mounts a second session. */
export function CoachShell({ children, username, processing, onSignOut }: CoachShellProps) {
  const [theme, setTheme] = useState(getCurrentTheme);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState(false);
  const destinations = [
    { path: "/tavolo", label: tr("Il tuo gioco", "Your game"), icon: LayoutGrid },
    { path: "/sessione", label: tr("Allenamento", "Practice"), icon: Target },
    { path: "/quaderno", label: tr("Quaderno", "Notebook"), icon: BookOpen },
    { path: "/progressi", label: tr("Progressi", "Progress"), icon: TrendingUp },
    { path: "/settings", label: tr("Profilo", "Profile"), icon: Settings },
  ];
  async function signOut() {
    setSigningOut(true);
    setError(false);
    try { await onSignOut(); }
    catch { setError(true); }
    finally { setSigningOut(false); }
  }
  return <div className="coach-shell">
    <a href="#coach-content" className="coach-skip">{tr("Vai al contenuto", "Skip to content")}</a>
    <header className="coach-header">
      <Link to="/tavolo" className="coach-brand" aria-label={tr("Nonno, il tuo gioco", "Nonno, your game")}>
        <span className="coach-brand-mark" aria-hidden="true">n.</span>
        <span><strong>Nonno</strong><small>{tr("IL TUO PROSSIMO PASSO", "YOUR NEXT STEP")}</small></span>
      </Link>
      <div className="coach-header-actions">
        {processing && <span className="coach-processing" role="status"><span aria-hidden="true" />{tr("Analisi in corso", "Analyzing")}</span>}
        <button type="button" onClick={() => setTheme(toggleTheme())}
          aria-label={theme === "dark" ? tr("Passa al tema chiaro", "Use light theme") : tr("Passa al tema scuro", "Use dark theme")}>
          {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
        </button>
        <details className="coach-account">
          <summary aria-label={tr("Menu account", "Account menu")}>{username?.slice(0, 1).toUpperCase() ?? "N"}</summary>
          <div className="coach-account-panel">
            <strong>{username ?? tr("Il tuo profilo", "Your profile")}</strong>
            <LangToggle />
            <Link to="/settings">{tr("Impostazioni e dati", "Settings and data")}</Link>
            <button type="button" onClick={() => void signOut()} disabled={signingOut}><LogOut size={18} />{tr("Esci", "Sign out")}</button>
            {error && <p role="alert">{tr("Uscita non riuscita. Riprova.", "Sign out failed. Try again.")}</p>}
          </div>
        </details>
      </div>
    </header>
    <nav className="coach-nav" aria-label={tr("Navigazione principale", "Main navigation")}>
      <p>{tr("IL TUO PERCORSO", "YOUR JOURNEY")}</p>
      {destinations.map(({ path, label, icon: Icon }) => <NavLink key={path} to={path}
        className={({ isActive }) => isActive ? "coach-nav-link active" : "coach-nav-link"}>
        <Icon size={21} strokeWidth={1.6} aria-hidden="true" /><span>{label}</span>
      </NavLink>)}
      <div className="coach-nav-note">{tr("Le tue partite. Il tuo ritmo. Una cosa da imparare alla volta.", "Your games. Your pace. One thing to learn at a time.")}</div>
    </nav>
    <main id="coach-content" tabIndex={-1} className="coach-content">{children}</main>
  </div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { silentRefreshing, backgroundRunning } = useOnboardingRun();
  return <CoachShell username={profile?.chess_com_username ?? null}
    processing={silentRefreshing || backgroundRunning} onSignOut={signOut}>{children}</CoachShell>;
}
