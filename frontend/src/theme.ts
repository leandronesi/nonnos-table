/**
 * Theme system — dark / light con persistenza localStorage e fallback su
 * prefers-color-scheme.
 *
 * Setta l'attributo `data-theme` sul `<html>` element. Il CSS in index.css
 * usa selettori `:root[data-theme="dark"]` e `:root[data-theme="light"]`
 * per applicare i token corrispondenti.
 *
 * Esposto a livello globale (non Context) per evitare re-render inutili —
 * il theme switch tocca solo il DOM tramite document.documentElement.
 */

export type Theme = "dark" | "light";

const STORAGE_KEY = "chesspath_theme";

export function detectInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch { /* ignore */ }
  if (window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark";
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
  // hint al browser per UA-rendered controls (scrollbars, form controls)
  document.documentElement.style.colorScheme = theme;
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch { /* ignore */ }
}

export function getCurrentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return (document.documentElement.getAttribute("data-theme") as Theme) || "dark";
}

export function toggleTheme(): Theme {
  const next: Theme = getCurrentTheme() === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

/**
 * Listener per cambi del prefers-color-scheme di sistema (utile se l'utente
 * non ha mai scelto manualmente — manteniamo l'auto-follow).
 */
export function watchSystemTheme(onChange: (t: Theme) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: light)");
  const listener = (e: MediaQueryListEvent) => {
    // Solo se l'utente NON ha scelto manualmente
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
    } catch { /* ignore */ }
    onChange(e.matches ? "light" : "dark");
  };
  mql.addEventListener?.("change", listener);
  return () => mql.removeEventListener?.("change", listener);
}
