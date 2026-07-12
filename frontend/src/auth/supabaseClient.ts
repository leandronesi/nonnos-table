import { createClient } from "@supabase/supabase-js";
import type { Database } from "./db.types";
import { safeBrowserLocalStorage } from "./browserStorage";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const authStorage = safeBrowserLocalStorage();

if (!url || !anonKey) {
  // Falliamo presto e in modo leggibile: la SPA si carica solo con un progetto
  // Supabase configurato. Niente fallback nascosti su mock.
  // eslint-disable-next-line no-console
  console.error(
    "[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY mancanti. " +
      "Locale: vedi frontend/.env.example (copia in .env.local). " +
      "Su GitHub Pages: impostali come repo secret (Settings > Secrets > Actions), " +
      "il workflow li inietta nel build."
  );
}

export const supabase = createClient<Database>(url ?? "", anonKey ?? "", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,    // serve per email-confirm redirect
    // Vitest/SSR e i browser che bloccano localStorage devono poter importare
    // il client: in quei casi supabase-js usa il suo fallback in memoria.
    ...(authStorage ? { storage: authStorage } : {}),
  },
});

export const STORAGE_BUCKET = "user-data";
