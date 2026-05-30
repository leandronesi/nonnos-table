import { createClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  // Falliamo presto e in modo leggibile: la SPA si carica solo con un progetto
  // Supabase configurato. Niente fallback nascosti su mock.
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY mancanti — vedi frontend/.env.example"
  );
}

export const supabase = createClient<Database>(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,    // serve per email-confirm redirect
    storage: window.localStorage,
  },
});

export const STORAGE_BUCKET = "user-data";
