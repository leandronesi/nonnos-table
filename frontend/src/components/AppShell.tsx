/**
 * AppShell — responsive chrome wrapping authenticated app pages.
 *
 * Desktop (>= 1024px): slim sidebar left (~232px) + scrollable content right.
 * Mobile (< 1024px): sticky top-bar + bottom tab bar + scrollable content.
 *
 * Navigation: Tavolo "/", Sessione "/sessione", Quaderno "/quaderno".
 * Active detection: pathname "/" = Tavolo; startsWith "/sessione"; startsWith "/quaderno".
 *
 * Reads:
 *   - useLocation() for active tab
 *   - useAuth() for profile.chess_com_username + signOut
 *   - toggleTheme() / getCurrentTheme() from theme.ts
 */

import { useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { toggleTheme, getCurrentTheme } from "../theme";

// ── Nav definition ─────────────────────────────────────────────────────────────

type NavDest = { label: string; path: string; icon: ReactNode };

function BoardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="14" height="14" rx="1.5"/>
      <line x1="7" y1="2" x2="7" y2="16"/>
      <line x1="11" y1="2" x2="11" y2="16"/>
      <line x1="2" y1="7" x2="16" y2="7"/>
      <line x1="2" y1="11" x2="16" y2="11"/>
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="9" r="7"/>
      <polygon points="7.5,6.5 12.5,9 7.5,11.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3.5C3 3.5 5 3 9 3s6 0.5 6 0.5V15.5C15 15.5 13 15 9 15s-6 0.5-6 0.5V3.5z"/>
      <line x1="9" y1="3" x2="9" y2="15"/>
    </svg>
  );
}

const NAV: NavDest[] = [
  { label: "Tavolo",   path: "/",         icon: <BoardIcon /> },
  { label: "Sessione", path: "/sessione",  icon: <PlayIcon /> },
  { label: "Quaderno", path: "/quaderno",  icon: <BookIcon /> },
];

function isActive(dest: NavDest, pathname: string): boolean {
  if (dest.path === "/") return pathname === "/";
  return pathname.startsWith(dest.path);
}

// ── Mini lamp SVG brand mark ───────────────────────────────────────────────────

function LampIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <ellipse cx="11" cy="16" rx="4.5" ry="2" fill="var(--color-gold)" opacity="0.25"/>
      <path d="M8 12 C8 8.5 11 6 11 6 C11 6 14 8.5 14 12 L13.5 14 H8.5 L8 12Z"
        fill="var(--color-gold)" opacity="0.85"/>
      <rect x="9.5" y="14" width="3" height="1.5" rx="0.5" fill="var(--color-gold-soft)"/>
      <line x1="11" y1="4" x2="11" y2="2" stroke="var(--color-gold)" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="5.5" y1="6" x2="4.2" y2="4.7" stroke="var(--color-gold)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
      <line x1="16.5" y1="6" x2="17.8" y2="4.7" stroke="var(--color-gold)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6"/>
    </svg>
  );
}

// ── Theme toggle ───────────────────────────────────────────────────────────────

function ThemeToggleButton({ onToggle }: { onToggle: () => void }) {
  const isDark = getCurrentTheme() === "dark";
  return (
    <button
      onClick={onToggle}
      aria-label={isDark ? "Passa a tema chiaro" : "Passa a tema scuro"}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "2rem",
        height: "2rem",
        borderRadius: "0.5rem",
        background: "transparent",
        border: "1px solid var(--color-line)",
        color: "var(--color-muted)",
        cursor: "pointer",
        transition: "border-color 140ms, color 140ms",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-line-strong)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-text)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-line)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--color-muted)";
      }}
    >
      {isDark ? (
        /* Sun */
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <circle cx="7.5" cy="7.5" r="2.5"/>
          <line x1="7.5" y1="1" x2="7.5" y2="0"/>
          <line x1="7.5" y1="15" x2="7.5" y2="14"/>
          <line x1="1" y1="7.5" x2="0" y2="7.5"/>
          <line x1="15" y1="7.5" x2="14" y2="7.5"/>
          <line x1="3.2" y1="3.2" x2="2.4" y2="2.4"/>
          <line x1="11.8" y1="11.8" x2="12.6" y2="12.6"/>
          <line x1="11.8" y1="3.2" x2="12.6" y2="2.4"/>
          <line x1="3.2" y1="11.8" x2="2.4" y2="12.6"/>
        </svg>
      ) : (
        /* Moon */
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M12 9A6 6 0 0 1 5 2a6 6 0 1 0 7 7z" fill="currentColor" stroke="none" opacity="0.3"/>
          <path d="M12 9A6 6 0 0 1 5 2a6 6 0 1 0 7 7z"/>
        </svg>
      )}
    </button>
  );
}

// ── Desktop Sidebar ────────────────────────────────────────────────────────────

function DesktopSidebar({
  pathname,
  username,
  onSignOut,
  onThemeToggle,
}: {
  pathname: string;
  username: string | null;
  onSignOut: () => void;
  onThemeToggle: () => void;
}) {
  return (
    <nav
      aria-label="Navigazione principale"
      style={{
        position: "sticky",
        top: 0,
        height: "100vh",
        width: "232px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--color-line)",
        background: "var(--color-bg)",
        overflowY: "auto",
        zIndex: 30,
      }}
    >
      {/* Brand */}
      <div style={{ padding: "1.5rem 1.25rem 1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <LampIcon />
          <div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: "0.875rem",
              lineHeight: 1.2,
              color: "var(--color-text)",
              letterSpacing: "-0.01em",
            }}>
              il Tavolo del{" "}
              <span style={{ color: "var(--color-gold-soft)" }}>Nonno</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <div style={{ padding: "0 0.75rem", display: "flex", flexDirection: "column", gap: "2px" }}>
        {NAV.map((dest) => {
          const active = isActive(dest, pathname);
          return (
            <Link
              key={dest.path}
              to={dest.path}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.625rem",
                padding: "0.5rem 0.625rem",
                borderRadius: "0.5rem",
                fontSize: "0.8125rem",
                fontWeight: active ? 600 : 500,
                color: active ? "var(--color-brand-soft)" : "var(--color-text-soft)",
                textDecoration: "none",
                background: active
                  ? "color-mix(in srgb, var(--color-brand) 10%, transparent)"
                  : "transparent",
                border: "1px solid",
                borderColor: active
                  ? "color-mix(in srgb, var(--color-brand) 22%, transparent)"
                  : "transparent",
                transition: "background 120ms, color 120ms, border-color 120ms",
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.03)";
                  (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-text)";
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                  (e.currentTarget as HTMLAnchorElement).style.color = "var(--color-text-soft)";
                }
              }}
            >
              <span style={{ opacity: active ? 1 : 0.65, flexShrink: 0 }}>{dest.icon}</span>
              <span>{dest.label}</span>
            </Link>
          );
        })}
      </div>

      {/* Footer: theme + user + signout */}
      <div style={{
        marginTop: "auto",
        padding: "1rem 1.25rem 1.25rem",
        borderTop: "1px solid var(--color-line)",
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
      }}>
        {/* Username */}
        {username && (
          <div style={{
            fontSize: "0.72rem",
            fontFamily: "var(--font-mono)",
            color: "var(--color-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {username}
          </div>
        )}
        {/* Row: theme toggle + sign out */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <ThemeToggleButton onToggle={onThemeToggle} />
          <button
            onClick={onSignOut}
            className="btn btn-ghost btn-sm"
            style={{ flex: 1, fontSize: "0.75rem" }}
          >
            Esci
          </button>
        </div>
      </div>
    </nav>
  );
}

// ── Mobile Top Bar ─────────────────────────────────────────────────────────────

function MobileTopBar({
  onSignOut,
  onThemeToggle,
  silentRefreshing,
}: {
  onSignOut: () => void;
  onThemeToggle: () => void;
  silentRefreshing?: boolean;
}) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 1rem",
        height: "3rem",
        background: "var(--header-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--color-line)",
      }}
    >
      {/* Brand left + optional silent-refresh pill */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.625rem", minWidth: 0 }}>
        <LampIcon />
        <span style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "0.8125rem",
          color: "var(--color-text)",
          letterSpacing: "-0.01em",
          flexShrink: 0,
        }}>
          il Tavolo del{" "}
          <span style={{ color: "var(--color-gold-soft)" }}>Nonno</span>
        </span>
        {silentRefreshing && <SilentRefreshPill />}
      </div>
      {/* Actions right */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
        <ThemeToggleButton onToggle={onThemeToggle} />
        <button
          onClick={onSignOut}
          className="btn btn-ghost btn-sm"
          style={{ fontSize: "0.72rem", padding: "0.25rem 0.625rem" }}
        >
          Esci
        </button>
      </div>
    </header>
  );
}

// ── Mobile Bottom Tab Bar ──────────────────────────────────────────────────────

function MobileTabBar({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Navigazione principale"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        height: "calc(62px + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "var(--header-bg)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderTop: "1px solid var(--color-line)",
        display: "flex",
        alignItems: "stretch",
      }}
    >
      {NAV.map((dest) => {
        const active = isActive(dest, pathname);
        return (
          <Link
            key={dest.path}
            to={dest.path}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.25rem",
              minHeight: "48px",
              textDecoration: "none",
              color: active ? "var(--color-brand-soft)" : "var(--color-muted)",
              transition: "color 140ms",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ opacity: active ? 1 : 0.6 }}>{dest.icon}</span>
            <span style={{
              fontSize: "0.625rem",
              fontWeight: active ? 700 : 500,
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}>
              {dest.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

// ── Silent-refresh indicator ───────────────────────────────────────────────────
// Shown only when silentRefreshing is true. Discrete: a pulsing dot + quiet text.

function SilentRefreshPill() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.375rem",
        fontSize: "0.68rem",
        color: "var(--color-muted)",
        lineHeight: 1,
        userSelect: "none",
        flexShrink: 0,
      }}
      aria-live="polite"
      aria-label="Elaborazione partite in corso"
    >
      {/* Pulsing dot */}
      <span
        style={{
          display: "inline-block",
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: "var(--color-brand-soft)",
          opacity: 0.7,
          animation: "nt-pulse 1.8s ease-in-out infinite",
        }}
        aria-hidden="true"
      />
      Guardo le ultime partite...
    </div>
  );
}

// ── AppShell ───────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const { silentRefreshing } = useOnboardingRun();
  // Local state to force icon re-render on toggle
  const [_theme, setThemeState] = useState(() => getCurrentTheme());

  function handleThemeToggle() {
    const next = toggleTheme();
    setThemeState(next);
  }

  function handleSignOut() {
    void signOut();
  }

  const username = profile?.chess_com_username ?? null;

  return (
    <>
      {/* ── DESKTOP layout (>= 1024px) — hidden on mobile via CSS ──────── */}
      <div className="appshell-desktop">
        <DesktopSidebar
          pathname={pathname}
          username={username}
          onSignOut={handleSignOut}
          onThemeToggle={handleThemeToggle}
        />
        {/* Content */}
        <main className="appshell-content">
          {/* Silent-refresh indicator: sits just above content, full width, quiet */}
          {silentRefreshing && (
            <div
              style={{
                padding: "0.375rem 1.5rem",
                borderBottom: "1px solid var(--color-line)",
                background: "transparent",
              }}
            >
              <SilentRefreshPill />
            </div>
          )}
          <div style={{ maxWidth: "960px", margin: "0 auto", padding: "0 1.5rem" }}>
            {children}
          </div>
        </main>
      </div>

      {/* ── MOBILE layout (< 1024px) — hidden on desktop via CSS ──────── */}
      <div className="appshell-mobile">
        <MobileTopBar onSignOut={handleSignOut} onThemeToggle={handleThemeToggle} silentRefreshing={silentRefreshing} />
        <main className="appshell-mobile-main">
          {children}
        </main>
        <MobileTabBar pathname={pathname} />
      </div>
    </>
  );
}
