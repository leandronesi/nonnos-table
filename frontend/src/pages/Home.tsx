import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  Brain,
  ChevronRight,
  Database,
  Flame,
  Layers,
  Library,
  PlayCircle,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { PlayerModel } from "../types";
import { GuidedSession } from "../session/GuidedSession";
import { loadSession, sessionIsTodayAndDone, loadStreak } from "../session/store";
import { ThemeToggle } from "../components/ThemeToggle";

/**
 * Home Bento — UNA SOLA viewport. Niente scroll.
 *
 * Pattern: SaaS daily-ritual (Headspace / Strava / Apple Fitness). Una sola
 * decisione obbligata (la missione di oggi), tutto il resto come segnali
 * AMBIENT che provano che dietro c'e` profondita`. Le 3 destinazioni in
 * fondo (cruscotto/storia/repertorio) sono la promessa di iceberg.
 *
 * Accessibility:
 *  - focus ring esplicito su tutti gli interactive (vedi index.css *:focus-visible)
 *  - transizioni 180ms (entro 150-300 raccomandato)
 *  - prefers-reduced-motion rispettato (nessuna animazione decorativa)
 *  - contrasto testo >= 4.5:1 verificato sui colori usati
 *  - target hit area >= 44x44px (Apple HIG)
 *  - responsive: 375/640/1024/1440 testati
 */
export function Home({ pm }: { pm: PlayerModel }) {
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionDoneToday, setSessionDoneToday] = useState(false);
  const [streakDays, setStreakDays] = useState(0);

  useEffect(() => {
    setSessionDoneToday(sessionIsTodayAndDone(loadSession()));
    setStreakDays(loadStreak().current);
  }, []);

  function closeSession() {
    setSessionOpen(false);
    setSessionDoneToday(sessionIsTodayAndDone(loadSession()));
    setStreakDays(loadStreak().current);
  }

  const identity = pm.identity;
  const goal = identity.goal;
  const proj = pm.goal_projection;
  const trend = pm.trend_weekly;

  // "Voce" del coach: estraggo la prima frase forte dal coach narrative se c'e`,
  // altrimenti compongo una frase dal top diagnosis. Mai vuoto.
  const coachVoice = pickCoachVoice(pm);

  // 4 micro-stat per Bento: trend winrate / blunder / SRS box max / money drill count
  const stats = buildStats(pm, streakDays);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--color-bg)" }}
    >
      {/* ============ TOP BAR ============ */}
      <header className="flex items-center justify-between px-6 lg:px-10 py-4 border-b border-[color:var(--color-line)]">
        <div className="flex items-center gap-3">
          <span className="text-2xl">♚</span>
          <span className="font-semibold tracking-tight">chesspath</span>
        </div>
        <div className="flex items-center gap-4 text-sm tabular-nums">
          <span className="hidden sm:inline text-[color:var(--color-text-soft)]">{identity.username}</span>
          <span className="font-semibold">{goal.current_rating ?? "—"}</span>
          <span className="text-[color:var(--color-faint)]">→</span>
          <span className="text-[color:var(--color-brand-soft)] font-semibold">{goal.target}</span>
          <ThemeToggle compact />
        </div>
      </header>

      {/* ============ BENTO GRID ============ */}
      <main className="flex-1 flex items-center justify-center p-4 lg:p-6">
        <div className="w-full max-w-[1200px] grid gap-3 md:gap-4 grid-cols-1 md:grid-cols-12 md:grid-rows-[auto_auto_auto] auto-rows-min">
          {/* PLAN  (col 1-7) — header missione + sparkline progressione */}
          <BentoCell className="md:col-span-7 md:row-span-1">
            <PlanBlock pm={pm} />
          </BentoCell>

          {/* PROJECTION  (col 8-12) — proiezione + risk */}
          <BentoCell className="md:col-span-5 md:row-span-1" tone="elevated">
            <ProjectionBlock proj={proj} goal={goal} />
          </BentoCell>

          {/* MISSION CTA (col 1-7, riga 2) — il cuore */}
          <BentoCell className="md:col-span-7 md:row-span-1" tone="hero">
            <MissionBlock
              pm={pm}
              done={sessionDoneToday}
              streakDays={streakDays}
              onStart={() => setSessionOpen(true)}
            />
          </BentoCell>

          {/* COACH VOICE (col 8-12, riga 2) */}
          <BentoCell className="md:col-span-5 md:row-span-1">
            <CoachBlock voice={coachVoice} />
          </BentoCell>

          {/* STATS STRIP (12 col, riga 3) — 4 micro-numeri */}
          <BentoCell className="md:col-span-12 md:row-span-1" tone="flat">
            <StatsStrip stats={stats} trend={trend} />
          </BentoCell>

          {/* DESTINATIONS (12 col, riga 4) — l'iceberg promesso */}
          <BentoCell className="md:col-span-12 md:row-span-1" tone="flat">
            <DestinationsRow />
          </BentoCell>
        </div>
      </main>

      {/* ============ GUIDED SESSION OVERLAY ============ */}
      {sessionOpen && <GuidedSession pm={pm} onClose={closeSession} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bento atom
// ---------------------------------------------------------------------------

function BentoCell({
  className = "",
  tone = "default",
  children,
}: {
  className?: string;
  tone?: "default" | "hero" | "elevated" | "flat";
  children: React.ReactNode;
}) {
  const styleByTone: Record<string, React.CSSProperties> = {
    default:  { background: "var(--bento-default-bg)",  border: "1px solid var(--bento-default-border)" },
    elevated: { background: "var(--bento-elevated-bg)", border: "1px solid var(--bento-elevated-border)" },
    hero:     { background: "var(--bento-hero-bg)",     border: "1px solid var(--bento-hero-border)" },
    flat:     { background: "var(--bento-flat-bg)",     border: "1px solid var(--bento-flat-border)" },
  };
  return (
    <section
      className={`rounded-2xl p-5 lg:p-6 transition-colors ${className}`}
      style={styleByTone[tone]}
    >
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function PlanBlock({ pm }: { pm: PlayerModel }) {
  const goal = pm.identity.goal;
  const daysTotal = goal.days_since_start + goal.days_left;
  const dayNum = goal.days_since_start;
  const series = pm.rating_curve?.[goal.time_class] ?? [];
  const ratings = series.map((p) => p.rating).filter((r): r is number => r != null);

  return (
    <div className="flex flex-col h-full justify-between gap-3">
      <div>
        <div className="label-eyebrow text-[11px] tracking-[0.18em]">
          Piano · giorno {dayNum} di {daysTotal}
        </div>
        <h1
          className="mt-3 font-semibold tracking-tight leading-none"
          style={{ fontSize: "clamp(2rem, 3.4vw, 2.6rem)" }}
        >
          {goal.current_rating ?? "—"}
          <span className="text-[color:var(--color-faint)] mx-3">→</span>
          <span className="text-[color:var(--color-brand-soft)]">{goal.target}</span>
        </h1>
        <p className="text-sm text-[color:var(--color-text-soft)] mt-2">
          {goal.days_left} giorni alla deadline ({goal.deadline}) · {goal.time_class}
        </p>
      </div>
      <Sparkline values={ratings} height={48} />
    </div>
  );
}

function ProjectionBlock({
  proj,
  goal,
}: {
  proj: PlayerModel["goal_projection"];
  goal: PlayerModel["identity"]["goal"];
}) {
  if (!proj || !proj.available) {
    return (
      <div className="flex flex-col h-full justify-between">
        <div className="label-eyebrow text-[11px] flex items-center gap-2">
          <Target size={12} aria-hidden="true" /> Proiezione
        </div>
        <p className="text-sm text-[color:var(--color-text-soft)] mt-3">
          Servono almeno 30 partite con perf_20 popolato per calcolare la
          proiezione del goal.
        </p>
      </div>
    );
  }

  const riskColor =
    (proj.risk_pct ?? 0) >= 70 ? "#fda4af" : (proj.risk_pct ?? 0) >= 40 ? "#fcd34d" : "#86efac";

  const slack = proj.slack_days ?? 0;
  const verdict = proj.verdict;
  const verdictLabel: Record<NonNullable<typeof verdict>, string> = {
    on_track: "in carreggiata",
    in_ritardo: "in ritardo",
    stagnante: "stagnante",
    regressione: "in regressione",
    raggiunto: "raggiunto",
  };

  return (
    <div className="flex flex-col h-full justify-between gap-3">
      <div className="label-eyebrow text-[11px] flex items-center gap-2">
        <Target size={12} aria-hidden="true" /> Proiezione · {verdict ? verdictLabel[verdict] : ""}
      </div>

      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular-nums">
            {proj.projected_at ? formatItalianDate(proj.projected_at) : "—"}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded tabular-nums"
            style={{
              color: riskColor,
              border: `1px solid ${riskColor}55`,
              background: `${riskColor}10`,
            }}
          >
            rischio {proj.risk_pct ?? "?"}%
          </span>
        </div>
        <p className="text-xs text-[color:var(--color-text-soft)] mt-1 leading-relaxed">
          Al ritmo attuale (+{proj.slope_elo_per_day?.toFixed(2)} Elo/g).
          {slack !== 0 && slack !== null && (
            <>
              {" "}
              Slack:{" "}
              <span style={{ color: slack >= 0 ? "#86efac" : "#fda4af" }}>
                {slack > 0 ? "+" : ""}
                {slack}gg
              </span>{" "}
              vs deadline.
            </>
          )}
        </p>
      </div>

      {proj.projected_at_with_daily_session && proj.delta_with_daily_session_days && (
        <div className="text-[11px] text-[color:var(--color-text-soft)] border-t border-[color:var(--color-line)] pt-2 leading-relaxed">
          Con una sessione/giorno: <span className="text-[color:var(--color-brand-soft)] font-semibold">{formatItalianDate(proj.projected_at_with_daily_session)}</span> (−{proj.delta_with_daily_session_days} giorni).
        </div>
      )}
    </div>
  );
}

function MissionBlock({
  pm,
  done,
  streakDays,
  onStart,
}: {
  pm: PlayerModel;
  done: boolean;
  streakDays: number;
  onStart: () => void;
}) {
  const goal = pm.identity.goal;
  const dayNum = goal.days_since_start;
  const focusLabel = pm.weekly_focus?.headline?.replace(/^"|"$/g, "") || "training tattico";
  const nDrills = Math.min(5, pm.drills?.length || 0);
  const nBivi = Math.min(2, pm.turning_points?.length || 0);

  return (
    <div className="flex flex-col h-full justify-between gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="label-eyebrow text-[11px] flex items-center gap-2">
            <Flame size={12} aria-hidden="true" /> Missione {dayNum}
          </div>
          <p className="text-sm text-[color:var(--color-text-soft)] mt-2">
            {nDrills} drill · {nBivi} bivi · 1 partita · ~22 min
          </p>
          <p className="text-xs text-[color:var(--color-faint)] mt-1">
            focus: {focusLabel.toLowerCase()}
          </p>
        </div>
        {streakDays > 0 && (
          <div className="text-right">
            <div className="text-2xl font-semibold tabular-nums leading-none">{streakDays}</div>
            <div className="text-[10px] text-[color:var(--color-faint)] tracking-wider uppercase">streak</div>
          </div>
        )}
      </div>

      <button
        onClick={onStart}
        className="group flex items-center justify-center gap-3 w-full rounded-xl py-5 px-6 font-semibold tracking-tight transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-brand-soft)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-bg)] motion-safe:hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: done
            ? "color-mix(in srgb, var(--color-ok) 20%, transparent)"
            : "var(--cta-gradient)",
          border: done
            ? "1px solid color-mix(in srgb, var(--color-ok) 50%, transparent)"
            : "1px solid color-mix(in srgb, var(--color-text) 18%, transparent)",
          color: done ? "var(--color-ok)" : "#ffffff",
          minHeight: 64,
          boxShadow: done ? "none" : "var(--cta-shadow)",
        }}
        aria-label={done ? "Sessione di oggi gia` completata. Riapri la sessione." : "Inizia la sessione di oggi"}
      >
        <PlayCircle size={22} aria-hidden="true" />
        <span className="text-lg">
          {done ? "Sessione completata · rivedi" : "Inizia sessione di oggi"}
        </span>
        <ChevronRight size={18} className="opacity-70 motion-safe:group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
      </button>
    </div>
  );
}

function CoachBlock({ voice }: { voice: string }) {
  return (
    <div className="flex flex-col h-full gap-3">
      <div className="label-eyebrow text-[11px] flex items-center gap-2">
        <Brain size={12} aria-hidden="true" /> Coach
      </div>
      <p className="text-sm leading-relaxed text-[color:var(--color-text-soft)] italic">
        «{voice}»
      </p>
    </div>
  );
}

function StatsStrip({
  stats,
  trend,
}: {
  stats: { label: string; value: string; sub: string; tone: "good" | "bad" | "neutral" }[];
  trend?: PlayerModel["trend_weekly"];
}) {
  return (
    <div>
      <div className="label-eyebrow text-[11px] flex items-center gap-2 mb-3">
        <Activity size={12} aria-hidden="true" /> Cosa sta succedendo sul tuo profilo
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => {
          const toneColor =
            s.tone === "good" ? "#86efac" : s.tone === "bad" ? "#fda4af" : "var(--color-text)";
          return (
            <div
              key={s.label}
              className="rounded-lg px-4 py-3"
              style={{
                background: "var(--bento-stat-bg)",
                border: "1px solid var(--bento-stat-border)",
              }}
            >
              <div className="text-[10px] tracking-wider uppercase text-[color:var(--color-muted)]">
                {s.label}
              </div>
              <div className="text-2xl font-semibold tabular-nums mt-1" style={{ color: toneColor }}>
                {s.value}
              </div>
              <div className="text-[10px] text-[color:var(--color-faint)] mt-0.5">{s.sub}</div>
            </div>
          );
        })}
      </div>
      {trend && trend.last_7d.n_games >= 3 && trend.prev_7d.n_games >= 3 && (
        <p className="text-[11px] text-[color:var(--color-faint)] mt-3 leading-relaxed">
          Settimana: {trend.last_7d.n_games} partite, {trend.last_7d.n_blunders} blunder critici.{" "}
          {(trend.delta.win_rate ?? 0) > 0 ? (
            <span style={{ color: "#86efac" }} className="inline-flex items-center gap-1">
              <TrendingUp size={11} aria-hidden="true" /> +
              {Math.round((trend.delta.win_rate ?? 0) * 100)}pt vs settimana prima
            </span>
          ) : (
            <span style={{ color: "#fda4af" }} className="inline-flex items-center gap-1">
              <TrendingDown size={11} aria-hidden="true" />{" "}
              {Math.round((trend.delta.win_rate ?? 0) * 100)}pt vs settimana prima
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function DestinationsRow() {
  const items = [
    {
      to: "/cruscotto",
      icon: <Layers size={18} aria-hidden="true" />,
      label: "Cruscotto",
      sub: "diagnosi, motivi tattici, time management, decisioni",
    },
    {
      to: "/storia",
      icon: <Sparkles size={18} aria-hidden="true" />,
      label: "Storia",
      sub: "curva Elo, weekly trend, narrativa del coach",
    },
    {
      to: "/repertorio",
      icon: <Library size={18} aria-hidden="true" />,
      label: "Repertorio",
      sub: "aperture deboli, turning points, drill explorer",
    },
  ];
  return (
    <div>
      <div className="label-eyebrow text-[11px] flex items-center gap-2 mb-3">
        <Database size={12} aria-hidden="true" /> Esplora la profondita`
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {items.map((it) => (
          <Link
            key={it.to}
            to={it.to}
            className="rounded-lg px-4 py-3 transition-all flex items-start gap-3 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-brand-soft)] motion-safe:hover:brightness-110"
            style={{
              background: "var(--bento-default-bg)",
              border: "1px solid var(--bento-default-border)",
              minHeight: 44,
            }}
          >
            <span className="text-[color:var(--color-brand-soft)] mt-0.5">{it.icon}</span>
            <span className="flex-1">
              <span className="block font-semibold text-sm">{it.label}</span>
              <span className="block text-[11px] text-[color:var(--color-text-soft)] mt-0.5 leading-snug">
                {it.sub}
              </span>
            </span>
            <ChevronRight
              size={16}
              className="text-[color:var(--color-faint)] motion-safe:group-hover:translate-x-0.5 transition-transform mt-1"
              aria-hidden="true"
            />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atoms & helpers
// ---------------------------------------------------------------------------

function Sparkline({ values, height = 40 }: { values: number[]; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 100 - ((v - min) / range) * 100;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      width="100%"
      height={height}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-label={`Andamento rating: minimo ${min}, massimo ${max}, ${values.length} partite`}
      role="img"
    >
      <polyline
        fill="none"
        stroke="var(--color-brand-soft)"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  );
}

function pickCoachVoice(pm: PlayerModel): string {
  // Cerca una frase forte nello storytelling: prima frase del story o progress.
  const text = pm.coach_artifacts?.story || pm.coach_artifacts?.progress || "";
  if (text) {
    // Trova la prima frase che termina con . ! o ? e che sia sopra-soglia per "forza".
    const sentences = text
      .replace(/\n+/g, " ")
      .replace(/##? [^.\n]*\.?/g, "") // togli header markdown
      .split(/(?<=[.!?])\s+/);
    for (const s of sentences) {
      const trimmed = s.trim();
      if (trimmed.length > 30 && trimmed.length < 200) return trimmed.replace(/^["«»]+|["«»]+$/g, "");
    }
  }
  // Fallback dalla top diagnosis.
  const d = pm.diagnoses?.[0];
  if (d) return `Priorità di oggi: ${d.title.toLowerCase()}. ${d.trainable}.`;
  return "oggi inizia. domani ti dico cosa ho visto.";
}

function buildStats(
  pm: PlayerModel,
  streakDays: number,
): { label: string; value: string; sub: string; tone: "good" | "bad" | "neutral" }[] {
  const tw = pm.trend_weekly;
  const winDelta = tw ? Math.round((tw.delta.win_rate ?? 0) * 100) : null;
  const blunderDelta = tw ? tw.delta.n_blunders : null;

  // Drill money disponibili
  const money = (pm.drills || []).filter((d) => (d.priority_score ?? 0) >= 3).length;

  // Aperture deboli
  const repB = pm.repertoire_black?.length ?? 0;
  const repW = pm.repertoire_white?.length ?? 0;

  return [
    {
      label: "Win rate 7gg",
      value: winDelta != null ? `${winDelta > 0 ? "+" : ""}${winDelta}pt` : "—",
      sub: "vs settimana prima",
      tone: winDelta == null ? "neutral" : winDelta > 0 ? "good" : winDelta < 0 ? "bad" : "neutral",
    },
    {
      label: "Blunder critici 7gg",
      value: blunderDelta != null ? `${blunderDelta > 0 ? "+" : ""}${blunderDelta}` : "—",
      sub: "vs settimana prima",
      tone:
        blunderDelta == null
          ? "neutral"
          : blunderDelta < 0
          ? "good"
          : blunderDelta > 0
          ? "bad"
          : "neutral",
    },
    {
      label: "Drill money",
      value: `${money}`,
      sub: "gap target ≥ 15pt",
      tone: money > 0 ? "neutral" : "neutral",
    },
    {
      label: "Streak",
      value: `${streakDays}g`,
      sub: streakDays > 0 ? "non rompere la catena" : "comincia oggi",
      tone: streakDays >= 3 ? "good" : "neutral",
    },
  ];
}

function formatItalianDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}
