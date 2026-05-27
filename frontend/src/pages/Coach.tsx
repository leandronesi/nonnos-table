import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Brain, BookOpen, Compass, TrendingUp, AlertCircle,
  Dumbbell, Flame, Award, Sparkles, ArrowDownCircle, Target as TargetIcon,
  Library, ChevronRight,
} from "lucide-react";
import type { PlayerModel } from "../types";
import { PageShell } from "./PageShell";
import { LiveBrief } from "../components/LiveBrief";
import { PatternSparkline } from "../components/PatternSparkline";
import { entriesByDate, type JournalKind } from "../session/journal";
import {
  buildPatterns, categoryColor, categoryLabel,
  formatSharePct, trendArrow, trendColor, trendLabel,
  pickTodaysPatterns, type Pattern,
} from "../patterns";

interface Props {
  pm: PlayerModel;
}

/**
 * Quaderno (/coach) — la "casa continua" dell'utente fuori dalla sessione.
 *
 * PRODUCT.md original era dogmatica ("backstage, solo se vuoi"); feedback
 * 2026-05-27 ha chiarito: questo è il posto dove l'utente ritrova le cose
 * discusse, le cose da migliorare, gli errori frequenti, i pattern. È
 * continuità, non lookup.
 *
 * Single scroll narrativo, niente tab. Ordine:
 *   1. Brief contestuale di oggi (LLM live)
 *   2. Cose da migliorare oggi (top 3 freni cliccabili)
 *   3. Diario auto (drill, streak, milestone)
 *   4. Cosa osserva ora (coach_brief: headline + diagnosis + this_week + avoid)
 *   5. La storia, il piano, i progressi (coach_artifacts)
 *   6. Esplora (4 link discreti: Pattern, Profilo, Repertorio, Diagnosi)
 */
export function Coach({ pm }: Props) {
  const brief = pm.coach_brief;
  const artifacts = pm.coach_artifacts ?? {};
  const opening =
    brief?.open_tavolo ||
    brief?.diagnosis_narrative ||
    pm.coach_session?.open_tavolo ||
    "Oooh, eccoti. Vediamo insieme come stai andando.";
  const journalGroups = entriesByDate();
  const todaysFreni = useMemo(() => {
    const all = buildPatterns(pm);
    return pickTodaysPatterns(all, 3);
  }, [pm]);
  const windowDays = pm.growth_delta?.window_days ?? 14;
  const targetLabel = `${pm.identity.goal.target} ${(pm.identity.goal.time_class ?? "rapid").toLowerCase()}`;

  return (
    <PageShell title="Quaderno" subtitle="Quello che Nonno tiene per te, da quando vi siete conosciuti">
      <section className="coach-hero">
        <div className="coach-hero-id">
          <div className="coach-hero-avatar" aria-hidden="true">
            <Brain size={28} />
          </div>
          <div className="coach-hero-name">
            <div className="label-eyebrow">Nonno O.</div>
            <p className="coach-hero-opening">{opening}</p>
          </div>
        </div>
      </section>

      <LiveBrief pm={pm} autoLoad />

      {todaysFreni.length > 0 && (
        <section className="coach-section">
          <div className="coach-section-head">
            <TargetIcon size={20} aria-hidden="true" />
            <h2 className="display-small">Le cose da migliorare</h2>
          </div>
          <p className="text-sm text-[color:var(--color-text-soft)] mt-1 mb-4 max-w-xl">
            I tre freni che oggi ti separano da {targetLabel}. Clicca per allenarli.
          </p>
          <div className="coach-freni-list">
            {todaysFreni.map((p) => (
              <FrenoTile key={p.key} pattern={p} windowDays={windowDays} />
            ))}
          </div>
          <Link to="/patterns" className="coach-freni-all">
            Vedi tutti i freni <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </section>
      )}

      {journalGroups.length > 0 && (
        <section className="coach-section">
          <div className="coach-section-head">
            <BookOpen size={20} aria-hidden="true" />
            <h2 className="display-small">Diario</h2>
          </div>
          <p className="text-sm text-[color:var(--color-text-soft)] mt-1 mb-4 max-w-xl">
            Voci automatiche su quello che fai. Cronologico, dal più recente.
          </p>
          <div className="coach-journal">
            {journalGroups.slice(0, 14).map((g) => (
              <div key={g.date} className="coach-journal-day">
                <div className="coach-journal-date">{formatJournalDate(g.date)}</div>
                <ul className="coach-journal-entries">
                  {g.entries.map((e, i) => (
                    <li key={i} className="coach-journal-entry">
                      <span className="coach-journal-icon" aria-hidden="true">{iconForKind(e.kind)}</span>
                      <span className="coach-journal-body">{e.body}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      {brief && (
        <section className="coach-section">
          <div className="coach-section-head">
            <Compass size={20} aria-hidden="true" />
            <h2 className="display-small">Cosa osserva ora</h2>
          </div>
          {brief.headline && <h3 className="coach-brief-headline">{brief.headline}</h3>}
          {brief.diagnosis_narrative && (
            <p className="coach-brief-narrative">{brief.diagnosis_narrative}</p>
          )}
          {brief.this_week && brief.this_week.length > 0 && (
            <div className="coach-brief-actions">
              <div className="label-eyebrow">Questa settimana</div>
              <ul>
                {brief.this_week.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {brief.avoid && (
            <div className="coach-brief-avoid">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <div className="label-eyebrow">Da evitare</div>
                <p>{brief.avoid}</p>
              </div>
            </div>
          )}
        </section>
      )}

      {artifacts.story && (
        <CoachArticle
          icon={<BookOpen size={20} aria-hidden="true" />}
          title="La storia di come giochi"
          body={artifacts.story}
        />
      )}
      {artifacts.roadmap && (
        <CoachArticle
          icon={<Compass size={20} aria-hidden="true" />}
          title="Il piano dei prossimi passi"
          body={artifacts.roadmap}
        />
      )}
      {artifacts.progress && (
        <CoachArticle
          icon={<TrendingUp size={20} aria-hidden="true" />}
          title="I progressi che ho visto"
          body={artifacts.progress}
        />
      )}

      <section className="coach-esplora">
        <div className="coach-esplora-head">
          <span className="label-eyebrow">Se vuoi rovistare</span>
          <h2 className="display-small mt-1">Esplora</h2>
        </div>
        <div className="coach-esplora-grid">
          <Link to="/patterns" className="coach-esplora-card">
            <TargetIcon size={18} aria-hidden="true" />
            <div>
              <div className="coach-esplora-title">I tuoi freni</div>
              <div className="coach-esplora-sub">Tutti, con filtri e queue di allenamento</div>
            </div>
          </Link>
          <Link to="/profilo" className="coach-esplora-card">
            <TrendingUp size={18} aria-hidden="true" />
            <div>
              <div className="coach-esplora-title">Profilo</div>
              <div className="coach-esplora-sub">Tempo, fasi, decisioni, motivi tattici</div>
            </div>
          </Link>
          <Link to="/repertorio" className="coach-esplora-card">
            <Library size={18} aria-hidden="true" />
            <div>
              <div className="coach-esplora-title">Repertorio</div>
              <div className="coach-esplora-sub">Aperture, posizioni deboli, bivi</div>
            </div>
          </Link>
          <Link to="/diagnoses" className="coach-esplora-card">
            <AlertCircle size={18} aria-hidden="true" />
            <div>
              <div className="coach-esplora-title">Diagnosi</div>
              <div className="coach-esplora-sub">Le narrazioni cross-pattern di Nonno</div>
            </div>
          </Link>
        </div>
      </section>

      {brief?.generated_at && (
        <p className="text-xs text-[color:var(--color-faint)] mt-6 font-mono text-center">
          Aggiornato il {brief.generated_at}{brief.model ? ` · ${brief.model}` : ""}
        </p>
      )}
    </PageShell>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function FrenoTile({ pattern, windowDays }: { pattern: Pattern; windowDays: number }) {
  const cColor = categoryColor(pattern.category);
  const tColor = trendColor(pattern.trend);
  return (
    <Link
      to={`/patterns/${encodeURIComponent(pattern.key)}`}
      className="coach-freno-tile"
    >
      <div className="coach-freno-cat" style={{ color: cColor }}>
        <span className="coach-freno-cat-dot" style={{ background: cColor }} />
        {categoryLabel(pattern.category)}
      </div>
      <h3 className="coach-freno-name">{pattern.name}</h3>
      <div className="coach-freno-row">
        <div>
          <div className="coach-freno-val">{formatSharePct(pattern.current_share)}</div>
          <div className="coach-freno-sub">delle partite {windowDays}gg</div>
        </div>
        <div className="coach-freno-trend" style={{ color: tColor }}>
          <span aria-hidden="true">{trendArrow(pattern.trend)}</span> {trendLabel(pattern.trend)}
        </div>
      </div>
      <PatternSparkline
        series={pattern.weekly_series}
        width={240}
        height={32}
        color={tColor}
        ariaLabel={`andamento ${pattern.name}`}
      />
    </Link>
  );
}

function CoachArticle({
  icon, title, body,
}: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <section className="coach-section">
      <div className="coach-section-head">
        {icon}
        <h2 className="display-small">{title}</h2>
      </div>
      <CoachProse text={body} />
    </section>
  );
}

function CoachProse({ text }: { text: string }) {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  return (
    <div className="coach-prose">
      {paragraphs.map((p, i) => {
        if (p.startsWith("## ")) {
          return <h3 key={i} className="coach-prose-h3">{p.replace(/^##\s+/, "")}</h3>;
        }
        if (p.startsWith("# ")) {
          return <h2 key={i} className="coach-prose-h2">{p.replace(/^#\s+/, "")}</h2>;
        }
        return <p key={i}>{p}</p>;
      })}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatJournalDate(iso: string): string {
  const today = new Date().toISOString().slice(0, 10);
  if (iso === today) return "Oggi";
  const y = new Date();
  y.setUTCDate(y.getUTCDate() - 1);
  const yIso = y.toISOString().slice(0, 10);
  if (iso === yIso) return "Ieri";
  return iso;
}

function iconForKind(kind: JournalKind): React.ReactNode {
  switch (kind) {
    case "drill_completed": return <Dumbbell size={14} />;
    case "session_done": return <Sparkles size={14} />;
    case "streak_up": return <Flame size={14} />;
    case "streak_milestone": return <Award size={14} />;
    case "streak_broken": return <ArrowDownCircle size={14} />;
    case "pattern_mastered": return <Award size={14} />;
    case "pattern_regressed": return <AlertCircle size={14} />;
    case "first_drill": return <TargetIcon size={14} />;
    case "goal_updated": return <TargetIcon size={14} />;
    default: return <BookOpen size={14} />;
  }
}
