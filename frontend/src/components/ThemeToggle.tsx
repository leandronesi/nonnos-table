import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { getCurrentTheme, toggleTheme, type Theme } from "../theme";

/**
 * Toggle dark/light. Click ciclico. Persistito in localStorage via theme.ts.
 *
 * Pattern accessibilita`:
 * - role implicito di <button>
 * - aria-pressed riflette lo stato
 * - aria-label esplicito
 * - icona aria-hidden (il label gia` dice tutto allo screen reader)
 * - hit area ≥ 36px, comunque sopra i 24px minimo Apple per icone
 */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setLocal] = useState<Theme>("dark");

  useEffect(() => {
    setLocal(getCurrentTheme());
  }, []);

  function onClick() {
    const next = toggleTheme();
    setLocal(next);
  }

  const isDark = theme === "dark";
  const label = isDark ? "Passa a modalità chiara" : "Passa a modalità scura";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={!isDark}
      title={label}
      className={`
        inline-flex items-center justify-center gap-2 rounded-md
        transition-colors motion-safe:hover:bg-[color:var(--bento-default-bg)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-brand-soft)]
        ${compact ? "h-9 w-9" : "h-9 px-3"}
      `}
      style={{
        color: "var(--color-text-soft)",
        border: "1px solid var(--bento-default-border)",
      }}
    >
      {isDark ? (
        <Sun size={16} aria-hidden="true" strokeWidth={2} />
      ) : (
        <Moon size={16} aria-hidden="true" strokeWidth={2} />
      )}
      {!compact && (
        <span className="text-xs tracking-wider uppercase">
          {isDark ? "Light" : "Dark"}
        </span>
      )}
    </button>
  );
}
