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

interface AuthCtx {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: ProfileRow | null;
  /** Ricarica il profile dal DB (chiamalo dopo INSERT/UPDATE profiles). */
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchingProfile = useRef(false);

  const fetchProfile = useCallback(async (userId: string | null) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    if (fetchingProfile.current) return;
    fetchingProfile.current = true;
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        // eslint-disable-next-line no-console
        console.warn("[auth] fetchProfile error:", error.message);
        setProfile(null);
        return;
      }
      setProfile((data as ProfileRow | null) ?? null);
    } finally {
      fetchingProfile.current = false;
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await fetchProfile(data.session?.user.id ?? null);
      setLoading(false);
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
      setSession(newSession);
      setTimeout(() => {
        if (!mounted) return;
        void fetchProfile(newSession?.user.id ?? null);
      }, 0);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const refreshProfile = useCallback(async () => {
    await fetchProfile(session?.user.id ?? null);
  }, [fetchProfile, session]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      refreshProfile,
      signOut,
    }),
    [loading, session, profile, refreshProfile, signOut]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth deve stare dentro <AuthProvider>");
  return ctx;
}
