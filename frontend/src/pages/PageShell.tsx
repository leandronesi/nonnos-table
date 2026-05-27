import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "../components/ThemeToggle";
import { PRODUCT_NAME } from "../coaching";

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
    <div className="min-h-screen" style={{ background: "var(--color-bg)" }}>
      <header className="sticky top-0 z-30 backdrop-blur-lg border-b border-[color:var(--color-line)]" style={{ background: "var(--header-bg)" }}>
        <div className="max-w-[1400px] mx-auto flex items-center gap-4 px-4 lg:px-8 py-3">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-brand-soft)] motion-safe:hover:bg-[color:var(--bento-default-bg)]"
            aria-label="Torna alla home"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span className="hidden sm:inline">Home</span>
          </Link>
          <span className="text-[color:var(--color-faint)]">-</span>
          <span className="text-lg font-semibold tracking-tight">{title}</span>
          {subtitle && (
            <span className="hidden lg:inline text-sm text-[color:var(--color-text-soft)] truncate">
              {subtitle}
            </span>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-[color:var(--color-faint)]">{PRODUCT_NAME}</span>
            <ThemeToggle compact />
          </div>
        </div>
      </header>
      <main className="max-w-[1400px] mx-auto px-4 lg:px-8 py-6 lg:py-10">
        {children}
      </main>
    </div>
  );
}
