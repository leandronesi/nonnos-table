/**
 * AppShell — responsive chrome wrapping authenticated app pages.
 *
 * Desktop (>= 1024px): slim sidebar left (~232px) + scrollable content right.
 * Mobile (< 1024px): sticky top-bar + bottom tab bar + scrollable content.
 *
 * Navigation: Tavolo "/tavolo", Sessione "/sessione", Quaderno "/quaderno".
 * Active detection: startsWith each dest.path.
 *
 * Reads:
 *   - useLocation() for active tab
 *   - useAuth() for profile.chess_com_username + signOut
 *   - toggleTheme() / getCurrentTheme() from theme.ts
 */

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useOnboardingRun } from "../pipeline/OnboardingRunContext";
import { useTavoloActionsRef } from "../context/TavoloActionsContext";
import { toggleTheme, getCurrentTheme } from "../theme";
import { navigateWithTransition } from "../lib/motion";
import { tr } from "../i18n/lang";
import { LangToggle } from "../i18n/LangToggle";

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

function BookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3.5C3 3.5 5 3 9 3s6 0.5 6 0.5V15.5C15 15.5 13 15 9 15s-6 0.5-6 0.5V3.5z"/>
      <line x1="9" y1="3" x2="9" y2="15"/>
    </svg>
  );
}

// A pawn silhouette — sobrio, scacchistico, on-brand.
// Same viewBox and stroke weight as BoardIcon / BookIcon.
function SessioneIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Head */}
      <circle cx="9" cy="5" r="2.25"/>
      {/* Neck + body */}
      <path d="M6.5 14h5l-1-4.5C10.2 8.6 9.6 8 9 8s-1.2.6-1.5 1.5L6.5 14z"/>
      {/* Base */}
      <line x1="5" y1="14" x2="13" y2="14"/>
    </svg>
  );
}

// Order: Tavolo (enter), Sessione (play), Quaderno (review).
// Labels are resolved at render time via tr() so language switches propagate.
function buildNav(): NavDest[] {
  return [
    { label: tr("Tavolo",   "Table"),    path: "/tavolo",   icon: <BoardIcon /> },
    { label: tr("Sessione", "Session"),  path: "/sessione", icon: <SessioneIcon /> },
    { label: tr("Quaderno", "Notebook"), path: "/quaderno", icon: <BookIcon /> },
  ];
}

function isActive(dest: NavDest, pathname: string): boolean {
  return pathname.startsWith(dest.path);
}

// ── Brand mark: Nonno's face ───────────────────────────────────────────────────
// Asset lives in public/; BASE_URL keeps the GH Pages subpath (/nonnos-table/)
// without hardcoding it. Circular mask hides the navy corners of the portrait.

const NONNO_FACE = `${import.meta.env.BASE_URL}nonno-face.png`;

function NonnoMark({ size = 34 }: { size?: number }) {
  return (
    <img
      src={NONNO_FACE}
      alt="Nonno O."
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        flexShrink: 0,
        border: "1px solid color-mix(in srgb, var(--color-brand) 26%, var(--color-line))",
        background: "var(--color-surface-2)",
      }}
    />
  );
}

// ── Theme toggle ───────────────────────────────────────────────────────────────

function ThemeToggleButton({ onToggle }: { onToggle: () => void }) {
  const isDark = getCurrentTheme() === "dark";
  return (
    <button
      onClick={onToggle}
      aria-label={isDark ? tr("Passa a tema chiaro", "Switch to light theme") : tr("Passa a tema scuro", "Switch to dark theme")}
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
  onRefresh,
  onReanalyze,
  reanalyzeConfirming,
  onNavigate,
}: {
  pathname: string;
  username: string | null;
  onSignOut: () => void;
  onThemeToggle: () => void;
  onRefresh: (() => void) | null;
  onReanalyze: (() => void) | null;
  reanalyzeConfirming: boolean;
  onNavigate: (path: string) => void;
}) {
  return (
    // Wall nav: transparent column, no border-right, no background box.
    // The nav items are pure eyebrow text with an ink underline on hover/active.
    <nav
      aria-label={tr("Navigazione principale", "Main navigation")}
      className="sidebar-wall-nav"
    >
      {/* Brand */}
      <div style={{ padding: "1.5rem 1rem 1.25rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <NonnoMark size={32} />
          <div style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: "0.82rem",
            lineHeight: 1.2,
            color: "var(--color-text)",
            letterSpacing: "-0.01em",
          }}>
            <span style={{ color: "var(--color-gold-soft)" }}>Nonno&apos;s</span> Table
          </div>
        </div>
      </div>

      {/* Nav items — eyebrow text, ink underline */}
      <div style={{ padding: "0 0.25rem", display: "flex", flexDirection: "column", gap: "2px" }}>
        {buildNav().map((dest) => {
          const active = isActive(dest, pathname);
          return (
            <Link
              key={dest.path}
              to={dest.path}
              className={`sidebar-wall-item${active ? " active" : ""}`}
              onClick={(e) => {
                // Only hijack plain left-clicks: keep ctrl/cmd/middle-click "open in new tab".
                if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                onNavigate(dest.path);
              }}
            >
              {dest.label}
            </Link>
          );
        })}
      </div>

      {/* Footer: theme + user + signout — quiet, no box */}
      <div style={{
        marginTop: "auto",
        padding: "1rem 1rem 1.25rem",
        borderTop: "1px solid var(--color-line)",
        display: "flex",
        flexDirection: "column",
        gap: "0.625rem",
      }}>
        {/* Username */}
        {username && (
          <div style={{
            fontSize: "0.68rem",
            fontFamily: "var(--font-mono)",
            color: "var(--color-faint)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {username}
          </div>
        )}
        {/* Quiet action links: Aggiorna / Rianalizza — only shown on Tavolo */}
        {(onRefresh || onReanalyze) && (
          <div style={{
            fontSize: "0.68rem",
            color: "var(--color-faint)",
            display: "flex",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}>
            {onRefresh && (
              <button
                onClick={onRefresh}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: "var(--color-faint)",
                  fontSize: "inherit",
                  fontFamily: "inherit",
                  textDecoration: "underline",
                  textDecorationColor: "color-mix(in srgb, var(--color-faint) 50%, transparent)",
                  textUnderlineOffset: "2px",
                  transition: "color 140ms cubic-bezier(0.23,1,0.32,1)",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-muted)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--color-faint)"; }}
              >
                {tr("Aggiorna le partite", "Sync your games")}
              </button>
            )}
            {onRefresh && onReanalyze && (
              <span style={{ color: "var(--color-faint)", userSelect: "none" }}> · </span>
            )}
            {onReanalyze && (
              <button
                onClick={onReanalyze}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  color: reanalyzeConfirming ? "var(--color-warn)" : "var(--color-faint)",
                  fontSize: "inherit",
                  fontFamily: "inherit",
                  textDecoration: "underline",
                  textDecorationColor: "color-mix(in srgb, var(--color-faint) 50%, transparent)",
                  textUnderlineOffset: "2px",
                  transition: "color 200ms ease",
                }}
                onMouseEnter={(e) => { if (!reanalyzeConfirming) (e.currentTarget as HTMLButtonElement).style.color = "var(--color-muted)"; }}
                onMouseLeave={(e) => { if (!reanalyzeConfirming) (e.currentTarget as HTMLButtonElement).style.color = "var(--color-faint)"; }}
              >
                {reanalyzeConfirming
                  ? tr("Sicuro? Ricomincio da zero", "Are you sure? This resets everything.")
                  : tr("Rianalizza da capo", "Reanalyze from scratch.")}
              </button>
            )}
          </div>
        )}
        {/* Row: theme toggle + sign out */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <LangToggle />
          <ThemeToggleButton onToggle={onThemeToggle} />
          <button
            onClick={onSignOut}
            className="btn btn-ghost btn-sm"
            style={{ flex: 1, fontSize: "0.72rem" }}
          >
            {tr("Esci", "Sign out")}
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
        <NonnoMark size={30} />
        <span style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: "0.8125rem",
          color: "var(--color-text)",
          letterSpacing: "-0.01em",
          flexShrink: 0,
        }}>
          <span style={{ color: "var(--color-gold-soft)" }}>Nonno&apos;s</span> Table
        </span>
        {silentRefreshing && <SilentRefreshPill />}
      </div>
      {/* Actions right */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
        <LangToggle />
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

function MobileTabBar({ pathname, onNavigate }: { pathname: string; onNavigate: (path: string) => void }) {
  return (
    <nav
      aria-label={tr("Navigazione principale", "Main navigation")}
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
      {buildNav().map((dest) => {
        const active = isActive(dest, pathname);
        return (
          <Link
            key={dest.path}
            to={dest.path}
            onClick={(e) => {
              // Only hijack plain left-clicks: keep ctrl/cmd/middle-click "open in new tab".
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onNavigate(dest.path);
            }}
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
      aria-label={tr("Elaborazione partite in corso", "Processing your games")}
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
      {tr("Guardo le ultime partite...", "Still looking at your games.")}
    </div>
  );
}

// ── AppShell ───────────────────────────────────────────────────────────────────

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { silentRefreshing } = useOnboardingRun();
  const tavoloActionsRef = useTavoloActionsRef();
  // Local state to force icon re-render on toggle
  const [_theme, setThemeState] = useState(() => getCurrentTheme());

  function handleThemeToggle() {
    const next = toggleTheme();
    setThemeState(next);
  }

  function handleSignOut() {
    void signOut();
  }

  /** Navigate with View Transition crossfade when available. */
  function handleNavigate(path: string) {
    navigateWithTransition(() => navigate(path));
  }

  const username = profile?.chess_com_username ?? null;

  // Two-step confirm gate for "Rianalizza da capo" in the sidebar.
  // Mirrors the same gate in TavoloHome — the sidebar must be equally safe.
  const [reanalyzeConfirming, setReanalyzeConfirming] = useState(false);
  const reanalyzeConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleReanalyzeConfirm() {
    if (!reanalyzeConfirming) {
      setReanalyzeConfirming(true);
      reanalyzeConfirmTimerRef.current = setTimeout(() => {
        setReanalyzeConfirming(false);
        reanalyzeConfirmTimerRef.current = null;
      }, 4000);
    } else {
      if (reanalyzeConfirmTimerRef.current !== null) {
        clearTimeout(reanalyzeConfirmTimerRef.current);
        reanalyzeConfirmTimerRef.current = null;
      }
      setReanalyzeConfirming(false);
      tavoloActionsRef.current?.handleFullReanalyze();
    }
  }

  // Only show quiet action links when on the Tavolo and callbacks are registered.
  const isTavolo = pathname.startsWith("/tavolo");
  const onRefresh = isTavolo ? (() => { tavoloActionsRef.current?.handleRefresh(); }) : null;
  const onReanalyze = isTavolo ? handleReanalyzeConfirm : null;

  // Leaving the Tavolo cancels a pending confirm: the "Sicuro?" gate must not
  // survive navigation (else returning within 4s shows a primed button that
  // executes on the first click).
  useEffect(() => {
    if (isTavolo) return;
    if (reanalyzeConfirmTimerRef.current !== null) {
      clearTimeout(reanalyzeConfirmTimerRef.current);
      reanalyzeConfirmTimerRef.current = null;
    }
    setReanalyzeConfirming(false);
  }, [isTavolo]);

  // Unmount-only safety net: AppShell unmounts when navigating to a surface that
  // does not wrap in it (e.g. the Stanza at "/"), and the [isTavolo] effect above
  // early-returns while still on the Tavolo. Always clear the pending timer here
  // so it never fires setState on a dead component.
  useEffect(() => {
    return () => {
      if (reanalyzeConfirmTimerRef.current !== null) {
        clearTimeout(reanalyzeConfirmTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      {/* ── DESKTOP layout (>= 1024px) — hidden on mobile via CSS ──────── */}
      <div className="appshell-desktop">
        <DesktopSidebar
          pathname={pathname}
          username={username}
          onSignOut={handleSignOut}
          onThemeToggle={handleThemeToggle}
          onRefresh={onRefresh}
          onReanalyze={onReanalyze}
          reanalyzeConfirming={reanalyzeConfirming}
          onNavigate={handleNavigate}
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
          <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "0 1.5rem" }}>
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
        <MobileTabBar pathname={pathname} onNavigate={handleNavigate} />
      </div>
    </>
  );
}
