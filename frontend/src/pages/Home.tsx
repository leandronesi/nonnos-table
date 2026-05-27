import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen, Brain, ChevronRight, PlayCircle, Target, TrendingUp, TrendingDown, Minus, Pencil,
  Dumbbell, Sparkles, Library,
} from "lucide-react";
import type { PlayerModel, RecentProgressionWindow } from "../types";
import { GuidedSession } from "../session/GuidedSession";
import { ThemeToggle } from "../components/ThemeToggle";
import { GoalEditor } from "../components/GoalEditor";
import { buildPatterns, formatSharePct, trendArrow, trendColor, trendLabel, categoryColor, categoryLabel, pickTodaysPatterns } from "../patterns";
import { PatternSparkline } from "../components/PatternSparkline";
import { timeClassLabel } from "../coaching";
import { loadStreak } from "../session/store";
import { todayRuns } from "../session/drillLog";
import { lastEntry } from "../session/journal";
import { getCachedLiveCoach } from "../liveCoach";

/**
 * Home (Tavolo) — la dashboard OOUX completa.
 *
 * Mostra a colpo d'occhio: chi sei (Player card), dove vuoi arrivare
 * (Obiettivo), cosa Nonno dice oggi, cosa hai fatto l'ultima volta, i 3
 * freni di oggi da allenare, e i 4 deep-dive (Freni, Quaderno, Repertorio,
 * Profilo) per andare in profondita`.
 *
 * Niente "Solo Nonno + 1 bottone" — quel paradigma nascondeva il valore.
 * Qui il prodotto si presenta intero in 1 schermata, e l'utente capisce
 * subito perche` sta usando l'app.
 */
export function Home({ pm }: { pm: PlayerModel }) {
  const [sessionOpen, setSessionOpen] = useState(false);
  const [goalEditorOpen, setGoalEditorOpen] = useState(false);

  const greeting = pickTavoloGreeting(pm);
  const briefHeadline = pm.coach_brief?.headline;
  const liveBrief = useMemo(() => getCachedLiveCoach(pm), [pm]);
  const journalLast = useMemo(() => lastEntry(), []);

  const nReview = Math.min(5, (pm.drills?.length ?? 0) + (pm.turning_points?.length ?? 0));
  const sessionSpec = `${nReview} momenti · 1 partita · ~15 minuti`;

  const allPatterns = useMemo(() => buildPatterns(pm), [pm]);
  const todaysPatterns = useMemo(() => pickTodaysPatterns(allPatterns, 3), [allPatterns]);

  const goal = pm.identity.goal;
  const currentRating = goal.current_rating ?? null;
  const targetRating = goal.target;
  const timeClass = timeClassLabel(goal.time_class);
  const recent = goal.recent_progression;
  const windowDays = pm.growth_delta?.window_days ?? 14;

  const streak = useMemo(() => loadStreak(), []);
  const drillsToday = useMemo(() => todayRuns(), []);
  const drilledPatternKeys = useMemo(
    () => new Set(drillsToday.map((r) => r.pattern_key)),
    [drillsToday],
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const ctaState: "todo" | "done" = streak.lastDate === todayIso ? "done" : "todo";

  return (
    <div className="home-page">
      <header className="home-topbar">
        <div className="home-topbar-brand">
          <Link to="/coach" className="home-topbar-coach">
            <Brain size={16} aria-hidden="true" /> Coach
          </Link>
        </div>
        <nav className="home-topbar-nav" aria-label="Navigazione principale">
          {streak.current > 0 && (
            <span
              className="home-topbar-streak"
              title={`Catena attuale: ${streak.current} ${streak.current === 1 ? "giorno" : "giorni"}, record ${streak.best}`}
              aria-label={`Catena ${streak.current} giorni`}
            >
              🔥 {streak.current}
            </span>
          )}
          <Link to="/patterns" className="home-topbar-link" title="Freni">
            <Target size={18} aria-hidden="true" />
            <span className="home-topbar-link-label">Freni</span>
          </Link>
          <Link to="/coach" className="home-topbar-link" title="Quaderno">
            <BookOpen size={18} aria-hidden="true" />
            <span className="home-topbar-link-label">Quaderno</span>
          </Link>
          <ThemeToggle compact />
        </nav>
      </header>

      <main className="home-main">
        {/* OBIETTIVO — north star, identita` del giocatore verso il target */}
        <section className="home-obiettivo">
          <div className="home-obiettivo-star" aria-hidden="true">★</div>
          <div className="home-obiettivo-content">
            <div className="home-obiettivo-eyebrow-row">
              <span className="label-eyebrow">L'obiettivo dichiarato</span>
              <button
                type="button"
                onClick={() => setGoalEditorOpen(true)}
                className="home-obiettivo-edit"
                aria-label="Modifica l'obiettivo"
                title="Modifica l'obiettivo"
              >
                <Pencil size={12} aria-hidden="true" /> Modifica
              </button>
            </div>
            <h1 className="home-obiettivo-headline">
              Da <span className="home-obiettivo-rating">{currentRating ?? "?"}</span> a{" "}
              <span className="home-obiettivo-target">{targetRating}</span>{" "}
              <span className="home-obiettivo-tc">{timeClass}</span>
            </h1>
            {currentRating != null && (
              <div className="home-obiettivo-sub">
                <strong>{Math.max(0, targetRating - currentRating)} punti da fare</strong>
                {goal.days_left != null && goal.days_left > 0 && (
                  <span> · entro {goal.deadline} ({goal.days_left} gg)</span>
                )}
                {goal.recent_progression?.last_30d?.delta != null && (
                  <span>
                    {" "} · ultimi 30gg{" "}
                    <strong style={{ color: (goal.recent_progression.last_30d.delta ?? 0) >= 0 ? "var(--color-ok)" : "var(--color-danger)" }}>
                      {goal.recent_progression.last_30d.delta > 0 ? "+" : ""}
                      {goal.recent_progression.last_30d.delta}
                    </strong>
                  </span>
                )}
              </div>
            )}
            {pm.goal_projection?.verdict && (
              <div className={`home-obiettivo-verdict verdict-${pm.goal_projection.verdict}`}>
                {verdictLabel(pm.goal_projection.verdict)}
              </div>
            )}
          </div>
        </section>

        {recent && (
          <section className="home-progression-strip">
            <ProgressionWindow label="10gg" w={recent.last_10d} />
            <ProgressionWindow label="30gg" w={recent.last_30d} />
            <ProgressionWindow label="90gg" w={recent.last_90d} />
          </section>
        )}

        {/* Nonno dice + Sediamoci affiancati */}
        <section className="home-coach-row">
          <div className="home-coach-quote">
            <div className="label-eyebrow flex items-center gap-1.5">
              {liveBrief
                ? <><Sparkles size={14} aria-hidden="true" /> Il coach · live</>
                : <><Brain size={14} aria-hidden="true" /> Il coach</>}
            </div>
            <h2 className="home-coach-headline">
              {liveBrief?.headline || briefHeadline || "Sediamoci, vediamo cosa hai fatto."}
            </h2>
            <p className="home-coach-text">{liveBrief?.body || greeting}</p>
            {journalLast && (
              <div className="home-journal-last">
                <span className="home-journal-last-label">L'ultima volta:</span>
                <span className="home-journal-last-body">{journalLast.body}</span>
              </div>
            )}
            <Link to="/coach" className="home-coach-more">
              Vedi il Quaderno completo <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </div>
          <div className={`home-session-cta home-session-cta-${ctaState}`}>
            <button className="home-session-btn" onClick={() => setSessionOpen(true)} type="button">
              <PlayCircle size={22} aria-hidden="true" />
              <span>{ctaState === "done" ? "Rivedi la sessione di oggi" : "Sediamoci"}</span>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <div className="home-session-spec">
              {ctaState === "done"
                ? `Fatto oggi · ${streak.current} ${streak.current === 1 ? "giorno" : "giorni"} di fila`
                : sessionSpec}
            </div>
            <div className="home-session-hint">
              {ctaState === "done"
                ? "Domani nuova sessione. Non rompere la catena."
                : `Allenamento per ${targetRating} ${timeClass}, parte dai freni qui sotto`}
            </div>
            {drilledPatternKeys.size > 0 && (
              <div className="home-session-drilled-today">
                <Dumbbell size={12} aria-hidden="true" />
                Freni allenati oggi: <strong>{drilledPatternKeys.size}</strong>
              </div>
            )}
          </div>
        </section>

        {/* Cosa ti propongo oggi — top 3 freni cliccabili */}
        {todaysPatterns.length > 0 && (
          <section className="home-section">
            <header className="home-section-head">
              <div>
                <div className="label-eyebrow flex items-center gap-1.5">
                  <Target size={14} aria-hidden="true" /> Freni di oggi
                </div>
                <h2 className="display-small mt-1">Cosa ti propongo oggi</h2>
                <p className="text-sm text-[color:var(--color-text-soft)] mt-1">
                  Verso {targetRating} {timeClass}, ruotano in base a quello che hai già allenato
                </p>
              </div>
              <Link to="/patterns" className="home-section-link">
                Tutti i freni <ChevronRight size={14} aria-hidden="true" />
              </Link>
            </header>
            <div className="home-pattern-grid">
              {todaysPatterns.map((p) => (
                <Link
                  key={p.key}
                  to={`/patterns/${encodeURIComponent(p.key)}`}
                  className={`home-pattern-card ${drilledPatternKeys.has(p.key) ? "home-pattern-card-drilled" : ""}`}
                >
                  <div className="home-pattern-cat" style={{ color: categoryColor(p.category) }}>
                    <span className="home-pattern-cat-dot" style={{ background: categoryColor(p.category) }} />
                    {categoryLabel(p.category)}
                    {drilledPatternKeys.has(p.key) && (
                      <span className="home-pattern-drilled-badge" title="Allenato oggi">
                        <Dumbbell size={11} aria-hidden="true" /> oggi
                      </span>
                    )}
                  </div>
                  <h3 className="home-pattern-name">{p.name}</h3>
                  <div className="home-pattern-row">
                    <div>
                      <div className="home-pattern-stat-val">{formatSharePct(p.current_share)}</div>
                      <div className="home-pattern-stat-lbl">delle partite {windowDays}gg</div>
                    </div>
                    <div className="home-pattern-trend" style={{ color: trendColor(p.trend) }}>
                      <span aria-hidden="true">{trendArrow(p.trend)}</span> {trendLabel(p.trend)}
                    </div>
                  </div>
                  <PatternSparkline
                    series={p.weekly_series}
                    width={240}
                    height={36}
                    color={trendColor(p.trend)}
                    ariaLabel={`andamento ${p.name}`}
                  />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Esplora — 4 deep-dive sempre raggiungibili */}
        <section className="home-footer-nav">
          <Link to="/patterns" className="home-footer-link">
            <Target size={16} aria-hidden="true" />
            <div>
              <div className="home-footer-link-title">I tuoi freni</div>
              <div className="home-footer-link-sub">{allPatterns.length} cose da sciogliere</div>
            </div>
          </Link>
          <Link to="/coach" className="home-footer-link">
            <BookOpen size={16} aria-hidden="true" />
            <div>
              <div className="home-footer-link-title">Il Quaderno</div>
              <div className="home-footer-link-sub">Cosa il coach pensa di te, in dettaglio</div>
            </div>
          </Link>
          <Link to="/repertorio" className="home-footer-link">
            <Library size={16} aria-hidden="true" />
            <div>
              <div className="home-footer-link-title">Repertorio</div>
              <div className="home-footer-link-sub">Le tue aperture</div>
            </div>
          </Link>
          <Link to="/profilo" className="home-footer-link">
            <TrendingUp size={16} aria-hidden="true" />
            <div>
              <div className="home-footer-link-title">Profilo</div>
              <div className="home-footer-link-sub">Tempo, fasi, decisioni</div>
            </div>
          </Link>
        </section>
      </main>

      {sessionOpen && <GuidedSession pm={pm} onClose={() => setSessionOpen(false)} />}
      {goalEditorOpen && (
        <GoalEditor
          pm={pm}
          onClose={() => setGoalEditorOpen(false)}
          onSaved={() => {
            setGoalEditorOpen(false);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

function verdictLabel(v: string): string {
  return ({
    on_track: "Sei sulla rotta giusta, continua così",
    in_ritardo: "Sei in ritardo sul piano, bisogna spingere",
    stagnante: "Stai fermo, i drill devono diventare quotidiani",
    regressione: "In regressione, rivedi i freni",
    raggiunto: "Obiettivo raggiunto, alza l'asticella",
  } as Record<string, string>)[v] ?? v;
}

function ProgressionWindow({ label, w }: { label: string; w: RecentProgressionWindow }) {
  if (!w.available || w.delta == null) {
    return (
      <div className="home-progress-window home-progress-window-na">
        <div className="home-progress-window-delta">—</div>
        <div className="home-progress-window-lbl">{label}</div>
      </div>
    );
  }
  const positive = w.delta > 0;
  const neutral = w.delta === 0;
  const color = positive ? "var(--color-ok)" : neutral ? "var(--color-muted)" : "var(--color-danger)";
  const Icon = positive ? TrendingUp : neutral ? Minus : TrendingDown;
  return (
    <div className="home-progress-window" style={{ color }}>
      <div className="home-progress-window-delta">
        <Icon size={14} aria-hidden="true" />
        <span>{positive ? "+" : ""}{w.delta}</span>
      </div>
      <div className="home-progress-window-lbl">{label} · {w.games} partite</div>
    </div>
  );
}

function pickTavoloGreeting(pm: PlayerModel): string {
  const fromSession = pm.coach_session?.open_tavolo;
  if (fromSession && fromSession.length > 30) return fromSession;
  const fromBrief = pm.coach_brief?.open_tavolo;
  if (fromBrief && fromBrief.length > 30) return fromBrief;
  const briefDiag = pm.coach_brief?.diagnosis_narrative;
  if (briefDiag && briefDiag.length > 30) return briefDiag;
  return "Oooh, eccolo. Sediamoci, vediamo insieme com'è andata.";
}
