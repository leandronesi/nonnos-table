/**
 * lang.tsx — minimal i18n infrastructure for il Tavolo del Nonno.
 *
 * Design goals:
 *  - Zero dependencies (no react-i18next, no i18next).
 *  - Synchronous `tr()` usable in both React components and plain TS modules
 *    (e.g. coaching.ts, phrase banks).
 *  - A module-level mirror (`currentLang`) so non-React code can call
 *    `tr(it, en)` and always get the current language without hooks.
 *  - A `LangProvider` that owns the React state and keeps the mirror in sync.
 *  - A `useLang()` hook for components that need to react to language changes.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type Lang = "it" | "en";

// ── Module-level mirror ────────────────────────────────────────────────────────
// Initialised once at module load. Used by `tr()` so plain TS modules can
// translate without hooks.

function detectInitialLang(): Lang {
  // 1. Persisted preference.
  try {
    const stored = localStorage.getItem("nonno_lang");
    if (stored === "it" || stored === "en") return stored;
  } catch {
    // localStorage unavailable (SSR / privacy mode) — fall through.
  }

  // 2. Browser language.
  try {
    const nav = navigator.language ?? "";
    if (nav.startsWith("en")) return "en";
  } catch {
    // navigator unavailable — fall through.
  }

  // 3. Default.
  return "it";
}

let currentLang: Lang = detectInitialLang();

// ── Public API — usable outside React ─────────────────────────────────────────

/** Returns the current active language. Safe to call anywhere. */
export function getLang(): Lang {
  return currentLang;
}

/**
 * Translate a string pair. Returns the Italian string when lang is "it",
 * the English string when lang is "en".
 *
 * Usage (components and plain TS modules alike):
 *   tr("Sediamoci", "Let's sit down")
 */
export function tr(it: string, en: string): string {
  return currentLang === "en" ? en : it;
}

// ── React context ──────────────────────────────────────────────────────────────

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

const LangContext = createContext<LangContextValue | null>(null);

// ── LangProvider ───────────────────────────────────────────────────────────────

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang);

  function setLang(l: Lang) {
    // Keep the module mirror in sync so non-React callers see the new language.
    currentLang = l;
    try {
      localStorage.setItem("nonno_lang", l);
    } catch {
      // Ignore write failures (private mode, storage full).
    }
    setLangState(l);
  }

  function toggle() {
    setLang(lang === "it" ? "en" : "it");
  }

  // Keep <html lang="…"> in sync with the active language.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  return (
    <LangContext.Provider value={{ lang, setLang, toggle }}>
      {children}
    </LangContext.Provider>
  );
}

// ── useLang ────────────────────────────────────────────────────────────────────

/** Must be called inside a <LangProvider>. */
export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) {
    throw new Error("useLang() must be used inside a <LangProvider>.");
  }
  return ctx;
}
