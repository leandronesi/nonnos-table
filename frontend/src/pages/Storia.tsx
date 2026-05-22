import type { PlayerModel } from "../types";
import { PageShell } from "./PageShell";
import { Section } from "../components/Section";
import { PlayerCard } from "../components/PlayerCard";
import { WeeklyTrendCard } from "../components/WeeklyTrendCard";
import { RatingCurveChart } from "../components/RatingCurveChart";
import { CoachNarrative } from "../components/CoachNarrative";

/**
 * /storia - la progressione. Curva Elo, weekly trend dettagliato, coach diary.
 * E` la "biografia" del giocatore: cosa e` successo, cosa sta succedendo,
 * cosa il coach pensa del percorso.
 */
export function Storia({ pm }: { pm: PlayerModel }) {
  return (
    <PageShell title="Profilo" subtitle="chi sei, trend, coach diary">
      {/* PLAYER CARD */}
      <Section index="01" eyebrow="Identita`" title="Chi sei adesso">
        <PlayerCard identity={pm.identity} kpi={pm.kpi} />
      </Section>

      {/* WEEKLY TREND */}
      {pm.trend_weekly && (
        <Section
          index="02"
          eyebrow="Trend settimanale"
          title="Ultimi 7gg vs precedenti"
          sub="Vincere piu`? Sbagliare meno? Confronto rolling con la settimana di prima."
        >
          <WeeklyTrendCard trend={pm.trend_weekly} />
        </Section>
      )}

      {/* CURVA ELO */}
      <Section
        index="03"
        eyebrow="Curva Elo"
        title="Rating ufficiale vs prestazioni reali"
        sub="Rolling 5 (volatile, ultimo momento) + rolling 20 (trend stabile) vs ufficiale (laggy). Se rolling 20 sta sopra ufficiale, il tuo rating sta inseguendo le tue prestazioni."
      >
        <RatingCurveChart ratingCurve={pm.rating_curve} goal={pm.identity.goal} />
      </Section>

      {/* COACH NARRATIVE */}
      {pm.coach_artifacts && (
        <Section
          index="04"
          eyebrow="Coach diary"
          title="Quello che il coach pensa del tuo percorso"
          sub="3 voci: la storia (cosa stai facendo), il progress (cosa sta cambiando), la roadmap (dove andare)."
        >
          <CoachNarrative {...pm.coach_artifacts} />
        </Section>
      )}
    </PageShell>
  );
}
