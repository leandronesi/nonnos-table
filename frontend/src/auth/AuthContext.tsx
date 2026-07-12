/**
 * AuthContext — espone session + user + profile a tutto l'albero React.
 *
 * Carica:
 *   - sessione (token) da Supabase, persistita in localStorage
 *   - profile (riga `profiles` per user_id) — null fino a quando l'utente
 *     completa il primo step di onboarding (chess_com_username + goal)
 *
 * Espone `refresh()` per ri-fetchare il profile dopo INSERT/UPDATE remoto
 * senza aspettare il polling.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import type { ProfileRow } from "./db.types";
import { claimFirstAuthenticatedTelemetryEvent, setStorageUserScope } from "./userStorage";
import { telemetryEnabled, trackEvent } from "../lib/telemetry";
import { runBoundedAuthBootstrap } from "./authBootstrap";
import { createLatestRequestGate } from "./latestRequest";

const PROFILE_FETCH_TIMEOUT_MS = 8_000;

interface AuthCtx {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  /** True only while a profile SELECT is currently in flight. */
  profileLoading: boolean;
  /** Distinguishes a failed SELECT from a successful "profile not found". */
  profileError: boolean;
  /** Ricarica il profile dal DB (chiamalo dopo INSERT/UPDATE profiles). */
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(false);
  const profileRequests = useRef(createLatestRequestGate());
  const activeUserId = useRef<string | null>(null);

  const applyStorageScope = useCallback((nextUserId: string | null) => {
    // The namespace prevents cross-account reads. Keep the previous owner's
    // local journal/SRS so returning after a normal logout does not reset them.
    setStorageUserScope(nextUserId);
    if (nextUserId && telemetryEnabled() && claimFirstAuthenticatedTelemetryEvent()) {
      // Defer: onAuthStateChange runs while supabase-js may still hold its
      // internal auth lock; trackEvent reads the session.
      setTimeout(() => trackEvent("first_authenticated"), 0);
    }
  }, []);

  const fetchProfile = useCallback(async (
    userId: string | null,
    shouldApply: () => boolean = () => true,
  ) => {
    const isLatestRequest = profileRequests.current.begin();
    const canApply = () => (
      shouldApply()
      && isLatestRequest()
      && activeUserId.current === userId
    );
    if (!userId) {
      if (canApply()) {
        setProfile(null);
        setProfileLoading(false);
        setProfileError(false);
      }
      return;
    }

    if (canApply()) {
      // Preserve a usable profile on a same-account refresh failure, but never
      // expose the previous account's profile while a new user is loading.
      setProfile((current) => current?.user_id === userId ? current : null);
      setProfileLoading(true);
    }

    const result = await runBoundedAuthBootstrap(
      async () => await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      PROFILE_FETCH_TIMEOUT_MS,
    );

    if (!canApply()) return;
    setProfileLoading(false);
    if (!result.ok) {
      // Keep provider/transport details out of client logs. The operation's
      // rejection is consumed even if it arrives after the timeout.
      // eslint-disable-next-line no-console
      console.warn("[auth] profile_fetch_failed");
      setProfileError(true);
      return;
    }

    const { data, error } = result.value;
    if (error) {
      // Log only a fixed code: auth/database errors may contain identifiers.
      // eslint-disable-next-line no-console
      console.warn("[auth] profile_fetch_failed");
      setProfileError(true);
      return;
    }

    setProfile((data as ProfileRow | null) ?? null);
    setProfileError(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    let authEventSeen = false;

    void runBoundedAuthBootstrap(() => supabase.auth.getSession()).then(async (result) => {
      if (!mounted || authEventSeen) return;
      if (!result.ok) {
        // Fixed, non-sensitive diagnostic. Fail open as signed out so the app
        // never remains behind an infinite bootstrap loader.
        // eslint-disable-next-line no-console
        console.warn(`[auth] session_bootstrap_${result.reason}`);
        activeUserId.current = null;
        profileRequests.current.invalidate();
        applyStorageScope(null);
        setSession(null);
        setProfile(null);
        setProfileLoading(false);
        setProfileError(false);
        setLoading(false);
        return;
      }

      const nextSession = result.value.data.session;
      const userId = nextSession?.user.id ?? null;
      activeUserId.current = userId;
      applyStorageScope(userId);
      setSession(nextSession);
      await fetchProfile(userId, () => mounted && !authEventSeen && activeUserId.current === userId);
      if (mounted && !authEventSeen && activeUserId.current === userId) setLoading(false);
    });

    // ATTENZIONE: il callback di onAuthStateChange viene invocato MENTRE
    // supabase-js tiene il lock interno (navigator.locks). Se qui dentro
    // await-iamo una chiamata supabase (es. fetchProfile → .select()), quella
    // chiamata prova a prendere lo stesso lock → DEADLOCK, e da quel momento
    // OGNI chiamata supabase si blocca per sempre senza errore (è ciò che
    // bloccava "Salvo…" sull'insert in onboarding).
    // Fix raccomandato da Supabase: callback sincrono + defer fuori dal lock.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      authEventSeen = true;
      const userId = newSession?.user.id ?? null;
      const previousUserId = activeUserId.current;
      activeUserId.current = userId;
      if (previousUserId !== userId) {
        // Clear the previous account synchronously; the deferred query must not
        // leave another user's profile visible for even one render.
        profileRequests.current.invalidate();
        setProfile(null);
        setProfileLoading(userId !== null);
        setProfileError(false);
      }
      applyStorageScope(userId);
      setSession(newSession);
      setTimeout(() => {
        if (!mounted) return;
        void fetchProfile(userId, () => mounted && activeUserId.current === userId)
          .finally(() => {
            if (mounted && activeUserId.current === userId) setLoading(false);
          });
      }, 0);
    });

    return () => {
      mounted = false;
      profileRequests.current.invalidate();
      sub.subscription.unsubscribe();
    };
  }, [applyStorageScope, fetchProfile]);

  const refreshProfile = useCallback(async () => {
    await fetchProfile(session?.user.id ?? null);
  }, [fetchProfile, session]);

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } finally {
      activeUserId.current = null;
      profileRequests.current.invalidate();
      applyStorageScope(null);
      setSession(null);
      setProfile(null);
      setProfileLoading(false);
      setProfileError(false);
    }
  }, [applyStorageScope]);

  const value = useMemo<AuthCtx>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      profileLoading,
      profileError,
      refreshProfile,
      signOut,
    }),
    [loading, session, profile, profileLoading, profileError, refreshProfile, signOut]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth deve stare dentro <AuthProvider>");
  return ctx;
}
