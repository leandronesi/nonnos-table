/**
 * LangToggle — shared IT/EN language switch.
 *
 * One exported component used everywhere (AppShell, Landing, Stanza) so the
 * toggle can never be lost again when a surface is rewritten. Two explicit
 * buttons (IT / EN) rather than a single flip, so the user always sees both
 * options. Themed via CSS vars, so it reads on the dark Stanza scene too.
 */

import type { CSSProperties } from "react";
import { useLang, type Lang } from "./lang";

function itemStyle(active: boolean): CSSProperties {
  return {
    fontFamily: "var(--font-mono)",
    fontSize: "0.66rem",
    letterSpacing: "0.06em",
    lineHeight: 1,
    cursor: "pointer",
    color: active ? "var(--color-brand-soft)" : "var(--color-muted)",
    fontWeight: active ? 700 : 400,
    background: "none",
    border: "none",
    padding: 0,
    transition: "color 140ms",
  };
}

export function LangToggle({ style }: { style?: CSSProperties }) {
  const { lang, setLang } = useLang();

  const pick = (l: Lang) => () => {
    if (l !== lang) setLang(l);
  };

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        ...style,
      }}
    >
      <button
        type="button"
        aria-label="Italiano"
        aria-pressed={lang === "it"}
        style={itemStyle(lang === "it")}
        onClick={pick("it")}
      >
        IT
      </button>
      <span style={{ color: "var(--color-faint)", fontSize: "0.58rem" }} aria-hidden="true">
        /
      </span>
      <button
        type="button"
        aria-label="English"
        aria-pressed={lang === "en"}
        style={itemStyle(lang === "en")}
        onClick={pick("en")}
      >
        EN
      </button>
    </div>
  );
}
