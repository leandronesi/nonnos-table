import { Suspense, lazy, Fragment } from "react";
import { tr, LangProvider, useLang } from "./i18n/lang";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { OnboardingRunProvider } from "./pipeline/OnboardingRunContext";
import { Signup } from "./pages/auth/Signup";
import { Login } from "./pages/auth/Login";
import { VerifyEmail } from "./pages/auth/VerifyEmail";
import { ForgotPassword } from "./pages/auth/ForgotPassword";
import { UpdatePassword } from "./pages/auth/UpdatePassword";
import { Onboarding } from "./pages/auth/Onboarding";
import { OnboardingWaiting } from "./pages/auth/OnboardingWaiting";
import { PatternHome } from "./pages/PatternHome";
import { PatternProgress } from "./pages/PatternProgress";
const PatternPreview = import.meta.env.DEV ? lazy(() => import("./pages/dev/PatternPreview")) : null;
import { Landing } from "./pages/Landing";
import { PatternLibrary } from "./pages/PatternLibrary";
import { PatternPractice } from "./pages/PatternPractice";
import { MaiaTest } from "./pages/MaiaTest";
import { AppShell } from "./components/AppShell";
import { PRODUCT_NAME } from "./coaching";
import { IncontroPreview } from "./pages/dev/IncontroPreview";
import { TeachTest } from "./pages/dev/TeachTest";
import { Settings } from "./pages/settings/Settings";
import { Privacy } from "./pages/Privacy";
import { isAnalyzedTimeClass } from "./pipeline/config";
// Lazy: the Stanza pulls in three.js — code-split so the main bundle never pays it.
const StanzaHome = lazy(() =>
  import("./pages/StanzaHome").then((m) => ({ default: m.StanzaHome })),
);

/**
 * Root router multi-utente per Nonno's Table.
 *
 * Flow:
 *   anon                       → Landing (con CTA a signup/login)
 *   logged, !emailConfirmed    → /verify-email
 *   logged, no profile         → /onboarding
 *   logged, profile != ready   → /onboarding/waiting
 *   logged, profile == ready   → / (TavoloHome — BENTO numeri-first)
 *
 * NOTA: le vecchie pagine `/cruscotto`, `/coach`, `/patterns`, `/storia`,
 * `/repertorio` sono temporaneamente sospese (legacy single-user). Verranno
 * rimontate man mano che il porting browser-side dei moduli backend matura
 * (vedi memory architecture-zero-worker).
 */

function FullScreenLoader({ label }: { label: string }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center text-[color:var(--color-muted)]"
      style={{ background: "var(--color-bg)" }}
    >
      <div className="text-center">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
          {PRODUCT_NAME}
        </div>
        <div className="text-sm mt-2">{label}</div>
      </div>
    </div>
  );
}

/** Smista in base a sessione + stato profile.
 *  La Stanza e' un'introduzione una-tantum; chi ritorna atterra sul Tavolo. */
function HomeGate() {
  const { loading, user, profile, profileLoading, profileError } = useAuth();
  if (loading || (!profile && profileLoading)) return <FullScreenLoader label={tr("Carico la sessione…", "One moment.")} />;
  if (!user) return <Landing />;
  if (!profile && profileError) return <Navigate to="/onboarding/waiting" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  if (!isAnalyzedTimeClass(profile.goal_time_class)) {
    return <Navigate to="/onboarding/waiting" replace />;
  }
  if (profile.onboarding_state !== "ready") {
    return <Navigate to="/onboarding/waiting" replace />;
  }
  return <Navigate to="/tavolo" replace />;
}

/** Wrapper per route che richiedono utente loggato (qualsiasi stato profile). */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <FullScreenLoader label={tr("Carico la sessione…", "One moment.")} />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Core product routes require a supported, completed analytical profile. */
function RequireReadyProfile({ children }: { children: React.ReactNode }) {
  const { loading, user, profile, profileLoading, profileError } = useAuth();
  if (loading || (!profile && profileLoading)) return <FullScreenLoader label={tr("Carico la sessione…", "One moment.")} />;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile && profileError) return <Navigate to="/onboarding/waiting" replace />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  if (!isAnalyzedTimeClass(profile.goal_time_class) || profile.onboarding_state !== "ready") {
    return <Navigate to="/onboarding/waiting" replace />;
  }
  return <>{children}</>;
}

/** Remounts the visual tree on language change so every tr() re-evaluates.
 *  Sits BELOW the stateful providers, so a language switch does NOT remount
 *  AuthProvider / OnboardingRunProvider (the session and orchestrator run survive). */
function VisualRemountBoundary({ children }: { children: React.ReactNode }) {
  const { lang } = useLang();
  return <Fragment key={lang}>{children}</Fragment>;
}

export function App() {
  const basename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || undefined;
  return (
    <LangProvider>
    <AuthProvider>
      {/* OnboardingRunProvider vede useAuth e sopravvive alle route changes */}
      <OnboardingRunProvider>
      <BrowserRouter basename={basename}>
        {/* Room grain — static SVG noise layer, covers every page, pointer-events none */}
        <div className="room-grain" aria-hidden="true" />
        {/* Remount the visual tree on language change (providers above stay mounted) */}
        <VisualRemountBoundary>
        <Routes>
          {/* Pubbliche */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/privacy" element={<Privacy />} />

          {/* Onboarding (richiede auth, gestisce stato profile dentro) */}
          <Route
            path="/onboarding"
            element={
              <RequireAuth>
                <Onboarding />
              </RequireAuth>
            }
          />
          <Route
            path="/onboarding/waiting"
            element={
              <RequireAuth>
                <OnboardingWaiting />
              </RequireAuth>
            }
          />

          {/* Home — primo ingresso in Stanza, ritorni direttamente al Tavolo */}
          <Route path="/" element={<HomeGate />} />

          {/* Il Tavolo — la superficie operativa, raggiunta dalla Stanza */}
          <Route path="/tavolo" element={<RequireReadyProfile><AppShell><PatternHome /></AppShell></RequireReadyProfile>} />
          {PatternPreview && <Route path="/dev/patterns" element={<Suspense fallback={<div>Caricamento…</div>}><PatternPreview /></Suspense>} />}

          {/* Account, privacy, export/delete and first-party feedback. */}
          <Route path="/settings" element={<RequireAuth><AppShell><Settings /></AppShell></RequireAuth>} />

          {/* Quaderno — hub a tab + deep-link via hash */}
          <Route path="/quaderno" element={<RequireReadyProfile><AppShell><PatternLibrary /></AppShell></RequireReadyProfile>} />
          {/* Legacy routes redirect into Quaderno tabs */}
          <Route path="/freni"  element={<Navigate to="/quaderno#percorso" replace />} />
          <Route path="/cadute" element={<Navigate to="/quaderno#cadute"     replace />} />

          {/* Sessione di coaching */}
          <Route path="/sessione" element={<RequireReadyProfile><AppShell><PatternPractice /></AppShell></RequireReadyProfile>} />
          <Route path="/progressi" element={<RequireReadyProfile><AppShell><PatternProgress /></AppShell></RequireReadyProfile>} />

          {/* La Stanza resta riapribile esplicitamente dopo l'introduzione. */}
          <Route
            path="/stanza"
            element={
              <RequireReadyProfile>
                <Suspense fallback={<div className="stanza-shell"><div className="stanza-attesa">{tr("La Stanza", "The Room")}</div></div>}>
                  <StanzaHome />
                </Suspense>
              </RequireReadyProfile>
            }
          />

          {/* Maia smoke test — dev only (hidden from production build) */}
          {import.meta.env.DEV && (
            <Route path="/maia-test" element={<MaiaTest />} />
          )}

          {/* Anteprima dev scena onboarding — solo in sviluppo, nessun auth */}
          {import.meta.env.DEV && (
            <Route path="/dev/incontro" element={<IncontroPreview />} />
          )}

          {/* Diagnosi voce maestro — solo in sviluppo, richiede login */}
          {import.meta.env.DEV && (
            <Route path="/dev/teach" element={<TeachTest />} />
          )}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </VisualRemountBoundary>
      </BrowserRouter>
      </OnboardingRunProvider>
    </AuthProvider>
    </LangProvider>
  );
}
