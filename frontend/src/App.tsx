import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { OnboardingRunProvider } from "./pipeline/OnboardingRunContext";
import { TavoloActionsProvider } from "./context/TavoloActionsContext";
import { Signup } from "./pages/auth/Signup";
import { Login } from "./pages/auth/Login";
import { VerifyEmail } from "./pages/auth/VerifyEmail";
import { Onboarding } from "./pages/auth/Onboarding";
import { OnboardingWaiting } from "./pages/auth/OnboardingWaiting";
import { TavoloHome } from "./pages/TavoloHome";
import { Landing } from "./pages/Landing";
import { Quaderno } from "./pages/quaderno/Quaderno";
import { Sessione } from "./pages/Sessione";
import { MaiaTest } from "./pages/MaiaTest";
import { AppShell } from "./components/AppShell";
import { PRODUCT_NAME } from "./coaching";
import { IncontroPreview } from "./pages/dev/IncontroPreview";
import { SecondaBattutaPopup } from "./components/SecondaBattutaPopup";

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

/** Smista in base a sessione + stato profile. */
function HomeGate() {
  const { loading, user, profile } = useAuth();
  if (loading) return <FullScreenLoader label="Carico la sessione…" />;
  if (!user) return <Landing />;
  if (!profile) return <Navigate to="/onboarding" replace />;
  if (profile.onboarding_state !== "ready") {
    return <Navigate to="/onboarding/waiting" replace />;
  }
  return (
    <AppShell>
      <TavoloHome />
    </AppShell>
  );
}

/** Wrapper per route che richiedono utente loggato (qualsiasi stato profile). */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { loading, user } = useAuth();
  if (loading) return <FullScreenLoader label="Carico la sessione…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const basename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || undefined;
  return (
    <AuthProvider>
      {/* OnboardingRunProvider vede useAuth e sopravvive alle route changes */}
      <OnboardingRunProvider>
      <TavoloActionsProvider>
      <BrowserRouter basename={basename}>
        {/* Popup globale: seconda battuta di Nonno al completamento del background */}
        <SecondaBattutaPopup />
        <Routes>
          {/* Pubbliche */}
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify-email" element={<VerifyEmail />} />

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

          {/* Home — smista in base a stato */}
          <Route path="/" element={<HomeGate />} />

          {/* Quaderno — hub a tab + deep-link via hash */}
          <Route path="/quaderno" element={<RequireAuth><AppShell><Quaderno /></AppShell></RequireAuth>} />
          {/* Legacy routes redirect into Quaderno tabs */}
          <Route path="/freni"  element={<Navigate to="/quaderno#percorso" replace />} />
          <Route path="/cadute" element={<Navigate to="/quaderno#cadute"     replace />} />

          {/* Sessione di coaching */}
          <Route path="/sessione" element={<RequireAuth><AppShell><Sessione /></AppShell></RequireAuth>} />

          {/* Maia smoke test (dev, pubblica) — da rimuovere dopo la verifica */}
          <Route path="/maia-test" element={<MaiaTest />} />

          {/* Anteprima dev scena onboarding — solo in sviluppo, nessun auth */}
          {import.meta.env.DEV && (
            <Route path="/dev/incontro" element={<IncontroPreview />} />
          )}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      </TavoloActionsProvider>
      </OnboardingRunProvider>
    </AuthProvider>
  );
}
