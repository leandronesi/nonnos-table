import type { Decisions } from "../types";

/**
 * Three big pillars: conversione, vantaggi buttati, salvataggi.
 * Niente "card grigie tutte uguali". Bordi luminescenti in base al tono.
 */
export function DecisionsCard({ decisions }: { decisions: Decisions }) {
  const conv = decisions.conversion_rate;
  const save = decisions.save_rate;
  const blow = decisions.blow_rate;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <Pillar
        tone={conv != null && conv >= 0.7 ? "good" : conv != null && conv < 0.55 ? "bad" : "mute"}
        label="Conversione"
        sub="partite arrivate a +2 -> vinte"
        value={conv != null ? `${Math.round(conv * 100)}%` : "-"}
        detail={`${decisions.converted_winning} / ${decisions.reached_winning}`}
      />
      <Pillar
        tone={blow != null && blow > 0.3 ? "bad" : blow != null && blow < 0.15 ? "good" : "mute"}
        label="Vittorie buttate"
        sub="da +2 a non-vittoria"
        value={blow != null ? `${Math.round(blow * 100)}%` : "-"}
        detail={`${decisions.blew_winning} partite`}
      />
      <Pillar
        tone={save != null && save >= 0.35 ? "good" : "mute"}
        label="Salvataggi"
        sub="partite a -2 -> salvate"
        value={save != null ? `${Math.round(save * 100)}%` : "-"}
        detail={`${decisions.saved_losing} / ${decisions.reached_losing}`}
      />
    </div>
  );
}

function Pillar({
  tone,
  label,
  sub,
  value,
  detail,
}: {
  tone: "good" | "bad" | "mute";
  label: string;
  sub: string;
  value: string;
  detail: string;
}) {
  const accentColor =
    tone === "good" ? "var(--color-ok)" : tone === "bad" ? "var(--color-danger)" : "var(--color-text-soft)";
  const glowClass = tone === "good" ? "glow-ok" : tone === "bad" ? "glow-bad" : "";

  return (
    <div className={`surface surface-padded relative overflow-hidden ${glowClass}`}>
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)` }}
      />
      <div className="label-eyebrow">{label}</div>
      <div className="text-xs text-[color:var(--color-muted)] mt-1">{sub}</div>
      <div
        className="display-medium tabular-nums mt-6"
        style={{ color: accentColor }}
      >
        {value}
      </div>
      <div className="text-sm text-[color:var(--color-text-soft)] mt-2 font-mono">{detail}</div>
    </div>
  );
}
