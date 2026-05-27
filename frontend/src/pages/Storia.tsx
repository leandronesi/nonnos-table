import type { PlayerModel } from "../types";
import { PageShell } from "./PageShell";
import { Section } from "../components/Section";
import { PlayerCard } from "../components/PlayerCard";
import { WeeklyTrendCard } from "../components/WeeklyTrendCard";
import { RatingCurveChart } from "../components/RatingCurveChart";
import { CoachNarrative } from "../components/CoachNarrative";

/**
 * /storia - la progressione. Curva Elo, weekly trend dettagliato, coach diary.
 * È la "biografia" del giocatore: cosa è successo, cosa sta succedendo,
 * cosa il coach pensa del percorso.
 */
export function Storia({ pm }: { pm: PlayerModel }) {
  return (
    <PageShell title="Profilo" subtitle="Elo, curve e diario di training">
      {/* PLAYER CARD */}
      <Section index="01" eyebrow="Identita`" title="Chi sei adesso">
        <PlayerCard identity={pm.identity} kpi={pm.kpi} />
      </Section>

      {/* WEEKLY TREND */}
      {pm.trend_weekly && (
        <Section
          index="02"
          eyebrow="Trend settimanale"
          title="Come hai giocato questa settimana"
          sub="Risultati e precisione decidono le prossime posizioni da allenare."
        >
          <WeeklyTrendCard trend={pm.trend_weekly} />
        </Section>
      )}

      {/* CURVA ELO */}
      <Section
        index="03"
        eyebrow="Curva Elo"
        title="La strada verso il target"
        sub="Rating ufficiale e prestazione recente. Qui si vede se il gioco sta arrivando prima dell'Elo."
      >
        <RatingCurveChart ratingCurve={pm.rating_curve} goal={pm.identity.goal} />
      </Section>

      {/* COACH NARRATIVE */}
      {pm.coach_artifacts && (
        <Section
          index="04"
          eyebrow="Diario di training"
          title="Quello che il tuo storico sta dicendo"
          sub="Profilo, progressi e prossima linea di lavoro, scritti come una memoria del coach."
        >
          <CoachNarrative {...pm.coach_artifacts} />
        </Section>
      )}
    </PageShell>
  );
}
