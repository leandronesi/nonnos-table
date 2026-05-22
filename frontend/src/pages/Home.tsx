import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  TrendingUp,
} from "lucide-react";
import type { PlayerModel, PositionRow } from "../types";
import { GuidedSession } from "../session/GuidedSession";
import { loadSession, sessionIsTodayAndDone, loadStreak } from "../session/store";
import { BoardView } from "../components/BoardView";
import { ThemeToggle } from "../components/ThemeToggle";

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

  const featured = useMemo(() => pickFeaturedPosition(pm), [pm]);
  const focusName = normalizeFocusName(pm.weekly_focus?.headline || pm.diagnoses?.[0]?.title);
  const coachVoice = pickCoachVoice(pm, focusName);
  const goal = pm.identity.goal;
  const plan = pm.identity.plan_summary;
  const projection = pm.goal_projection;
  const proofCards = buildProofCards(pm, streakDays);
  const sessionSpec = buildSessionSpec(pm);

  return (
    <div className="home-page">
      <header className="home-topbar">
        <div className="home-brand">
          <div className="home-brand-mark" aria-hidden="true">♚</div>
          <div>
            <div className="home-brand-name">ChessPath</div>
            <div className="home-brand-sub">AI coach per {pm.identity.username}</div>
          </div>
        </div>

        <div className="home-top-actions">
          <div className="home-target-strip" aria-label={`Obiettivo ${goal.current_rating ?? "-"} verso ${goal.target}`}>
            <span>{goal.current_rating ?? "-"}</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>{goal.target}</strong>
          </div>
          <ThemeToggle compact />
        </div>
      </header>

      <main className="home-cockpit">
        <Panel className="home-hero-panel" tone="hero">
          <div className="home-status-line">
            <StatusPill projection={projection} goal={goal} />
            <span>{plan ? `+${plan.delta_since_plan ?? 0} Elo dal piano` : `${goal.points_needed} punti mancanti`}</span>
          </div>

          <h1 className="home-title">
            Il tuo gioco, misurato contro il giocatore che vuoi diventare.
          </h1>

          <p className="home-lede">{coachVoice}</p>

          <div className="home-action-row">
            <button
              type="button"
              onClick={() => setSessionOpen(true)}
              className="home-session-button"
              aria-label={sessionDoneToday ? "Riapri la sessione di oggi" : "Inizia la sessione di oggi"}
            >
              <PlayCircle size={22} aria-hidden="true" />
              <span>{sessionDoneToday ? "Sessione completata" : "Inizia sessione di oggi"}</span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>

            <div className="home-session-meta">
              <strong>{sessionSpec}</strong>
              <span>{streakDays > 0 ? `${streakDays} giorni di streak` : "primo giro del piano"}</span>
            </div>
          </div>

          <div className="home-proof-grid" aria-label="Prove numeriche del coach">
            {proofCards.map((card) => (
              <ProofCard key={card.label} {...card} />
            ))}
          </div>
        </Panel>

        <PositionPanel position={featured} />

        <GoalPanel pm={pm} />

        <CoachPanel focusName={focusName} pm={pm} />

        <NavigationPanel />
      </main>

      {sessionOpen && <GuidedSession pm={pm} onClose={closeSession} />}
    </div>
  );
}

function Panel({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "hero" | "quiet";
}) {
  return (
    <section className={`home-panel home-panel-${tone} ${className}`}>
      {children}
    </section>
  );
}

function StatusPill({
  projection,
  goal,
}: {
  projection?: PlayerModel["goal_projection"];
  goal: PlayerModel["identity"]["goal"];
}) {
  if (goal.on_track) {
    return (
      <span className="home-pill home-pill-good">
        <Target size={13} aria-hidden="true" />
        in traiettoria
      </span>
    );
  }

  const label = projection?.verdict ? projection.verdict.replaceAll("_", " ") : "goal da recuperare";
  return (
    <span className="home-pill home-pill-risk">
      <Target size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

function PositionPanel({ position }: { position: PositionRow | null }) {
  if (!position) {
    return (
      <Panel className="home-position-panel">
        <div className="home-panel-heading">
          <span><Database size={14} aria-hidden="true" /> Posizione reale</span>
          <strong>in arrivo</strong>
        </div>
        <p className="home-muted">Nessun drill disponibile nel player model corrente.</p>
      </Panel>
    );
  }

  const pMine = position.p_mine_plays_best_sf;
  const pTarget = position.p_target_plays_best_sf;
  const targetPct = pTarget == null ? null : Math.round(pTarget * 100);
  const minePct = pMine == null ? null : Math.round(pMine * 100);
  const gapPct = targetPct != null && minePct != null ? targetPct - minePct : null;
  const orientation = position.my_color || "white";

  return (
    <Panel className="home-position-panel">
      <div className="home-panel-heading">
        <span><Database size={14} aria-hidden="true" /> Caso reale</span>
        <strong>{position.eco ?? position.phase}</strong>
      </div>

      <div className="home-board-frame">
        <div className="home-board-scale">
          <BoardView
            fen={position.fen_before}
            orientation={orientation}
            size={304}
            resetKey={`${position.game_id}:${position.ply}:home`}
            arrows={buildPreviewArrows(position)}
            highlights={buildPreviewHighlights(position)}
          />
        </div>
      </div>

      <div className="home-position-copy">
        <div>
          <span className="home-mini-label">mossa giocata</span>
          <strong>{position.san}</strong>
        </div>
        <div>
          <span className="home-mini-label">mossa target</span>
          <strong>{position.best_san_sf ?? position.best_san_maia_target ?? "-"}</strong>
        </div>
      </div>

      {gapPct != null && targetPct != null && minePct != null && (
        <div className="home-gap-box">
          <div className="home-gap-title">Gap target sulla mossa</div>
          <div className="home-gap-grid">
            <Metric label="target 1600" value={`${targetPct}%`} />
            <Metric label="tuo livello" value={`${minePct}%`} />
            <Metric label="gap allenabile" value={`+${gapPct}pp`} tone="hot" />
          </div>
        </div>
      )}

      <p className="home-position-insight">
        Non è una review generica: è il confronto fra la tua scelta reale e la probabilità
        che un giocatore target trovi la mossa giusta nella stessa posizione.
      </p>
    </Panel>
  );
}

function GoalPanel({ pm }: { pm: PlayerModel }) {
  const goal = pm.identity.goal;
  const plan = pm.identity.plan_summary;
  const start = plan?.rating_at_plan ?? goal.start_rating ?? goal.current_rating ?? goal.target;
  const current = goal.current_rating ?? start;
  const total = Math.max(1, goal.target - start);
  const gained = current - start;
  const progressPct = clamp((gained / total) * 100, 0, 100);
  const projection = pm.goal_projection;

  return (
    <Panel className="home-goal-panel" tone="quiet">
      <div className="home-panel-heading">
        <span><TrendingUp size={14} aria-hidden="true" /> Piano 1600</span>
        <strong>{goal.days_left} giorni</strong>
      </div>

      <div className="home-goal-numbers">
        <span>{start}</span>
        <ChevronRight size={16} aria-hidden="true" />
        <strong>{current}</strong>
        <ChevronRight size={16} aria-hidden="true" />
        <span>{goal.target}</span>
      </div>

      <div className="home-progress-track" aria-label={`Progresso ${Math.round(progressPct)}%`}>
        <div className="home-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="home-goal-detail">
        <Metric label="mancano" value={`${goal.points_needed}`} sub="punti Elo" />
        <Metric
          label="ritmo richiesto"
          value={goal.rate_per_day_needed == null ? "-" : `${goal.rate_per_day_needed.toFixed(1)}/g`}
          sub="fino alla deadline"
        />
        <Metric
          label="proiezione"
          value={projection?.projected_at ? formatItalianDate(projection.projected_at) : "-"}
          sub={projection?.risk_pct != null ? `rischio ${projection.risk_pct}%` : undefined}
          tone={projection?.risk_pct != null && projection.risk_pct >= 70 ? "hot" : "default"}
        />
      </div>
    </Panel>
  );
}

function CoachPanel({ focusName, pm }: { focusName: string; pm: PlayerModel }) {
  const focus = pm.weekly_focus;
  const firstAction = focus?.actions?.[0]?.replace(/^[^\wÀ-ÿ]+/u, "") || pm.diagnoses?.[0]?.trainable;
  const topTactic = pm.tactical_breakdown?.[0];

  return (
    <Panel className="home-coach-panel" tone="quiet">
      <div className="home-panel-heading">
        <span><Brain size={14} aria-hidden="true" /> Coach verdict</span>
        <strong>{focus?.confidence ?? "medium"}</strong>
      </div>

      <div className="home-coach-main">
        <span className="home-mini-label">focus della settimana</span>
        <strong>{focusName}</strong>
        {focus?.evidence && <p>{focus.evidence}</p>}
      </div>

      <div className="home-coach-bottom">
        <div>
          <span className="home-mini-label">azione</span>
          <p>{firstAction}</p>
        </div>
        {topTactic && (
          <div>
            <span className="home-mini-label">pattern</span>
            <p>{topTactic.label_it}: {topTactic.n} casi, cp loss medio {Math.round(topTactic.avg_cp_loss)}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function NavigationPanel() {
  const items = [
    {
      to: "/storia",
      icon: <Sparkles size={18} aria-hidden="true" />,
      label: "Profilo",
      question: "Chi sono come giocatore?",
      detail: "rating, trend, storia del coach",
    },
    {
      to: "/cruscotto",
      icon: <Layers size={18} aria-hidden="true" />,
      label: "Pattern",
      question: "Dove perdo punti?",
      detail: "diagnosi, tattica, decisioni",
    },
    {
      to: "/repertorio",
      icon: <Library size={18} aria-hidden="true" />,
      label: "Trainer",
      question: "Dove mi alleno?",
      detail: "drill, aperture, turning point",
    },
  ];

  return (
    <Panel className="home-nav-panel">
      <div className="home-panel-heading">
        <span><Activity size={14} aria-hidden="true" /> Approfondisci</span>
        <strong>3 viste</strong>
      </div>

      <div className="home-nav-grid">
        {items.map((item) => (
          <Link key={item.to} to={item.to} className="home-nav-card">
            <span className="home-nav-icon">{item.icon}</span>
            <span>
              <strong>{item.label}</strong>
              <em>{item.question}</em>
              <small>{item.detail}</small>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function ProofCard({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "good" | "hot";
}) {
  return (
    <div className={`home-proof-card home-proof-${tone}`}>
      <span className="home-proof-icon">{icon}</span>
      <span className="home-mini-label">{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "hot" | "good";
}) {
  return (
    <div className={`home-metric home-metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}

function buildProofCards(pm: PlayerModel, streakDays: number) {
  const planDelta = pm.identity.plan_summary?.delta_since_plan;
  const winDelta = pm.trend_weekly?.delta.win_rate;

  return [
    {
      icon: <Database size={16} aria-hidden="true" />,
      label: "campione reale",
      value: `${pm.kpi.games_analyzed}`,
      sub: `${pm.kpi.critical_positions} posizioni critiche`,
    },
    {
      icon: <Target size={16} aria-hidden="true" />,
      label: "gap allenabile",
      value: `${pm.kpi.avoidable_blunders}`,
      sub: "blunder evitabili al tuo livello",
      tone: "hot" as const,
    },
    {
      icon: <Flame size={16} aria-hidden="true" />,
      label: "piano attivo",
      value: planDelta == null ? `${streakDays}g` : `+${planDelta}`,
      sub: planDelta == null ? "streak corrente" : "Elo dal kick-off",
      tone: "good" as const,
    },
    {
      icon: <TrendingUp size={16} aria-hidden="true" />,
      label: "ultimi 7 giorni",
      value: winDelta == null ? "-" : `${winDelta >= 0 ? "+" : ""}${Math.round(winDelta * 100)}pp`,
      sub: `${pm.trend_weekly?.last_7d.n_games ?? 0} partite recenti`,
      tone: winDelta != null && winDelta > 0 ? "good" as const : "default" as const,
    },
  ];
}

function buildSessionSpec(pm: PlayerModel): string {
  const drills = Math.min(5, pm.drills?.length || 0);
  const turning = Math.min(2, pm.turning_points?.length || 0);
  return `${drills} drill, ${turning} bivi, 1 partita`;
}

function pickFeaturedPosition(pm: PlayerModel): PositionRow | null {
  const ranked = [...(pm.drills || [])].sort((a, b) => (b.drill_value ?? 0) - (a.drill_value ?? 0));
  return ranked.find((d) => d.fen_before && d.p_target_plays_best_sf != null && d.p_mine_plays_best_sf != null)
    ?? ranked[0]
    ?? pm.turning_points?.[0]
    ?? null;
}

function normalizeFocusName(input?: string | null): string {
  if (!input) return "la mossa critica della settimana";
  return input
    .replace(/^Blind spot:\s*/i, "")
    .replace(/^Pattern dominante:\s*/i, "")
    .replace(/^Sbagli più nel\s*/i, "")
    .trim();
}

function pickCoachVoice(pm: PlayerModel, focusName: string): string {
  const avoidable = pm.kpi.avoidable_blunders;
  const critical = pm.kpi.critical_positions;
  const target = pm.identity.goal.target;
  return `Confronto ${critical} posizioni critiche con il tuo livello e con il target ${target}: non ti mostro uno scroll di errori, isolo i ${avoidable} gap allenabili e li trasformo nella sessione di oggi. Primo tema: ${focusName.toLowerCase()}.`;
}

function buildPreviewArrows(position: PositionRow) {
  if (position.last_opp_from && position.last_opp_to) {
    return [{ from: position.last_opp_from, to: position.last_opp_to, color: "#f4c95d" }];
  }
  return [];
}

function buildPreviewHighlights(position: PositionRow) {
  if (position.last_opp_from && position.last_opp_to) {
    return [
      { square: position.last_opp_from, color: "#f4c95d44" },
      { square: position.last_opp_to, color: "#f4c95d88" },
    ];
  }
  return [];
}

function formatItalianDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
