import { useMemo, useState } from "react";

/**
 * Renderer minimale di markdown narrativo del coach.
 * Supporta:
 *   - `## Titolo` → h3 editoriale
 *   - paragrafi (riga vuota = separator)
 *   - **bold** e *italic*
 *   - liste `- ...` (rare, ma supportate)
 * Niente HTML inject. Tutto sanitizzato.
 */

interface Props {
  story?: string;
  progress?: string;
  roadmap?: string;
}

type Tab = "story" | "progress" | "roadmap";

const TABS: { id: Tab; label: string; eyebrow: string }[] = [
  { id: "story", label: "Chi sei", eyebrow: "Player story" },
  { id: "progress", label: "Stai migliorando?", eyebrow: "Check progressi" },
  { id: "roadmap", label: "Il piano", eyebrow: "Roadmap 90 giorni" },
];

export function CoachNarrative({ story, progress, roadmap }: Props) {
  // Se nessuno dei 3 c'è, non mostriamo nulla.
  const hasAny = story || progress || roadmap;
  const [tab, setTab] = useState<Tab>(story ? "story" : progress ? "progress" : "roadmap");
  if (!hasAny) return null;

  const content = { story, progress, roadmap }[tab];

  return (
    <div className="surface surface-padded fade-in fade-in-delay-2 relative overflow-hidden">
      <div
        className="absolute -top-12 -right-12 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(124,92,255,0.18), transparent 70%)" }}
      />
      <div className="relative">
        <div className="flex items-baseline justify-between gap-3 mb-5 flex-wrap">
          <div>
            <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
              Il tuo coach · {TABS.find((t) => t.id === tab)?.eyebrow}
            </div>
            <h2 className="display-small mt-2">{TABS.find((t) => t.id === tab)?.label}</h2>
          </div>
          <div className="segment">
            {TABS.map((t) => {
              const hasContent = { story, progress, roadmap }[t.id];
              return (
                <button
                  key={t.id}
                  disabled={!hasContent}
                  onClick={() => setTab(t.id)}
                  className={`segment-item ${tab === t.id ? "active" : ""} ${!hasContent ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="prose-coach">{content ? <Markdown text={content} /> : null}</div>
      </div>
    </div>
  );
}

/**
 * Markdown renderer minimale. NO dangerouslySetInnerHTML.
 * Splitto in blocchi, ogni blocco diventa un nodo React.
 */
function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => {
        if (b.type === "h2") {
          return (
            <h3 key={i} className="font-[var(--font-display)] text-xl font-semibold tracking-tight text-[color:var(--color-text)] mt-6 first:mt-0">
              {b.text}
            </h3>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="space-y-1.5 ml-1">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3 text-[color:var(--color-text-soft)] leading-relaxed">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[color:var(--color-brand-soft)]" />
                  <Inline text={it} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-[color:var(--color-text-soft)] leading-[1.7] text-[15px]">
            <Inline text={b.text} />
          </p>
        );
      })}
    </div>
  );
}

interface Block {
  type: "h2" | "p" | "ul";
  text: string;
  items: string[];
}

function parseBlocks(md: string): Block[] {
  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  function flushPara() {
    if (para.length) {
      blocks.push({ type: "p", text: para.join(" ").trim(), items: [] });
      para = [];
    }
  }
  function flushList() {
    if (list.length) {
      blocks.push({ type: "ul", text: "", items: [...list] });
      list = [];
    }
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushPara();
      flushList();
      blocks.push({ type: "h2", text: line.slice(3).trim(), items: [] });
      continue;
    }
    if (line.startsWith("# ")) {
      // raro, lo trattiamo come h2
      flushPara();
      flushList();
      blocks.push({ type: "h2", text: line.slice(2).trim(), items: [] });
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushPara();
      list.push(line.slice(2).trim());
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return blocks;
}

/**
 * Rendering inline: bold **x**, italic *x*. NO link/HTML.
 */
function Inline({ text }: { text: string }) {
  // Split su `**...**` e `*...*` mantenendo i delimitatori
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text))) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const tok = match[0];
    if (tok.startsWith("**")) {
      parts.push(<strong key={key++} className="text-[color:var(--color-text)] font-semibold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      parts.push(<code key={key++} className="font-mono text-[0.85em] text-[color:var(--color-brand-soft)]">{tok.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key++} className="text-[color:var(--color-text)] italic">{tok.slice(1, -1)}</em>);
    }
    lastIdx = match.index + tok.length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return <>{parts}</>;
}
