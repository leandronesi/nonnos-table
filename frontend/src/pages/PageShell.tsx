import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

/**
 * Wrapper di pagina per le destinazioni secondarie (/cruscotto, /storia,
 * /repertorio). Top bar con link "back home" + brand + sottotitolo.
 *
 * a11y: link "torna alla home" come primo focusable, ARIA landmark <main>.
 */
export function PageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ background: "var(--color-bg, #0a0c18)" }}>
      <header className="sticky top-0 z-30 backdrop-blur-lg border-b border-[color:var(--color-line)]" style={{ background: "rgba(10,12,24,0.85)" }}>
        <div className="max-w-[1400px] mx-auto flex items-center gap-4 px-4 lg:px-8 py-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-brand-soft)] motion-safe:hover:bg-white/[0.04]"
            aria-label="Torna alla home"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <span className="text-[color:var(--color-faint)]">·</span>
          <span className="text-lg font-semibold tracking-tight">{title}</span>
          {subtitle && (
            <span className="hidden lg:inline text-sm text-[color:var(--color-text-soft)] truncate">
              {subtitle}
            </span>
          )}
          <span className="ml-auto text-xs text-[color:var(--color-faint)]">♚ chesspath</span>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 lg:py-10">
        {children}
      </main>
    </div>
  );
}
