import { useEffect, useRef, useState } from "react";
import type { PlayerModel, PositionRow } from "./types";
import { loadPlayerModel } from "./data";

import { Sidebar } from "./components/Sidebar";
import { TodaySession } from "./components/TodaySession";
import { PlayerCard } from "./components/PlayerCard";
import { WeeklyFocusCard } from "./components/WeeklyFocusCard";
import { DecisionsCard } from "./components/DecisionsCard";
import { DiagnosisList } from "./components/DiagnosisList";
import { DrillPlan } from "./components/DrillPlan";
import { TimeManagementChart } from "./components/TimeManagementChart";
import { SpeedVsErrorsChart } from "./components/SpeedVsErrorsChart";
import { RatingCurveChart } from "./components/RatingCurveChart";
import { BlindSpotsList } from "./components/BlindSpotsList";
import { TacticalBreakdownCard } from "./components/TacticalBreakdownCard";
import { RepertoireCard } from "./components/RepertoireCard";
import { TurningPointsList } from "./components/TurningPointsList";
import { Glossary } from "./components/Glossary";
import { CoachNarrative } from "./components/CoachNarrative";
import { Section } from "./components/Section";
import { PlaySession } from "./components/PlaySession";
import { GuidedSession } from "./session/GuidedSession";

export function App() {
  const [pm, setPm] = useState<PlayerModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playPosition, setPlayPosition] = useState<PositionRow | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  // Incrementato ogni volta che chiudo la GuidedSession → forza TodaySession a ricaricare lo stato
  // dal localStorage (altrimenti vedrei sempre "Inizia sessione" anche dopo aver completato).
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const trainerRef = useRef<HTMLDivElement>(null);

  function closeSession() {
    setSessionOpen(false);
    setSessionRefreshKey((k) => k + 1);
  }

  useEffect(() => {
    loadPlayerModel().then(setPm).catch((e) => setError(String(e)));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="surface surface-padded max-w-xl">
          <div className="label-eyebrow text-rose-300 mb-2">Dati non disponibili</div>
          <p className="text-[color:var(--color-text-soft)] leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  if (!pm) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[color:var(--color-muted)]">
        <div className="text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Chess Coach</div>
          <div className="text-sm mt-2">Carico il player model…</div>
        </div>
      </div>
    );
  }

  const updated = new Date(pm.generated_at_epoch * 1000).toLocaleString("it-IT", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
  const topDiagnosis = pm.diagnoses[0];

  function startTrainer() {
    // ora il bottone primario apre la sessione guidata, non scrolla al trainer
    setSessionOpen(true);
  }

  return (
    <div className="app-shell">
      <Sidebar username={pm.identity.username} lastUpdate={updated} />

      <main className="main">
        {/* ============ TODAY: la cosa che vede appena apre ============ */}
        <TodaySession
          identity={pm.identity}
          kpi={pm.kpi}
          topDiagnosis={topDiagnosis}
          nDrills={pm.drills.length}
          nTurningPoints={pm.turning_points.length}
          onStartTrainer={startTrainer}
          onPlayTurningPoint={(p) => setPlayPosition(p)}
          firstTurningPoint={pm.turning_points[0]}
          refreshKey={sessionRefreshKey}
        />

        {/* ============ PLAYER CARD (compact stats sotto il hero) ============ */}
        <div className="mt-6">
          <PlayerCard identity={pm.identity} kpi={pm.kpi} />
        </div>

        {/* ============ STORYTELLING DEL COACH (story / progress / roadmap) ============ */}
        {pm.coach_artifacts && (
          <div className="mt-6">
            <CoachNarrative {...pm.coach_artifacts} />
          </div>
        )}

        {/* ============ TRAINER (IL prodotto interattivo) ============ */}
        <div id="trainer" ref={trainerRef} className="scroll-mt-8">
          <Section
            index="01"
            eyebrow="Trainer · drag & drop"
            title="Rifai i tuoi blunder. Stockfish ti giudica al volo."
            sub="Posizioni dove un giocatore della tua forza trovava la mossa giusta e tu no. Trascina il pezzo, l'engine valuta in tempo reale. Streak salvato in locale."
            delay={1}
          >
            <DrillPlan drills={pm.drills} />
          </Section>
        </div>

        {/* ============ PLAY: continua dal blunder contro Stockfish ============ */}
        <Section
          id="play"
          index="02"
          eyebrow="Gioca dal blunder"
          title="Continua la partita contro Stockfish"
          sub="Quando vedi un turning point e vuoi capire dove andava davvero quella posizione, clicca 'Continua qui contro Stockfish' su qualsiasi card sotto. Apre una partita vs engine partendo da quel FEN."
          delay={2}
        >
          <div className="surface surface-padded">
            <p className="text-[color:var(--color-text-soft)]">
              Scegli un turning point qui sotto e click "▶ Continua qui contro Stockfish".
              Si apre un overlay con scacchiera live, valutazione in tempo reale, suggerimento mossa.
            </p>
          </div>
        </Section>

        {/* ============ FOCUS SETTIMANALE ============ */}
        <Section
          id="focus"
          index="03"
          eyebrow="Focus della settimana"
          title="L'una cosa da spostare nei prossimi 7 giorni"
          sub="Una sola priorità, calcolata dal player model. Tutto il resto è contesto."
          delay={3}
        >
          <WeeklyFocusCard focus={pm.weekly_focus} brief={pm.coach_brief} />
        </Section>

        {/* ============ DIAGNOSI ============ */}
        <Section
          id="diagnoses"
          index="04"
          eyebrow="Diagnosi"
          title="Le tue debolezze, in ordine di impatto"
          sub="Calcolate come impatto × frequenza × allenabilità. Ogni voce porta la sua confidence statistica."
          delay={4}
        >
          <DiagnosisList diagnoses={pm.diagnoses} />
        </Section>

        {/* ============ DECISIONI vs RISULTATO ============ */}
        <Section
          id="decisions"
          index="05"
          eyebrow="Decisioni vs risultato"
          title="Sai chiudere? Sai salvarti?"
          sub="Si può vincere giocando male e perdere giocando bene. Conversion + save + blow rate separano la qualità dal risultato."
          delay={5}
        >
          <DecisionsCard decisions={pm.decisions} />
        </Section>

        {/* ============ GRAFICI: progressione + velocità ============ */}
        <Section
          id="grafici"
          index="06"
          eyebrow="Grafici"
          title="Stai migliorando? Sbagli quando muovi veloce?"
          sub="Due risposte visive. La curva Elo (rolling 5 + 20 vs ufficiale) ti dice se il rating sta inseguendo le tue prestazioni reali. Il grafico velocità ti dice quanto ti costano le mosse fatte senza pensare."
          delay={6}
        >
          <div className="space-y-5">
            <RatingCurveChart ratingCurve={pm.rating_curve} goal={pm.identity.goal} />
            <SpeedVsErrorsChart data={pm.time_management.spent_vs_accuracy} />
          </div>
        </Section>

        {/* ============ TIME MANAGEMENT (residuo orologio + tilt) ============ */}
        <Section
          id="time"
          index="07"
          eyebrow="Time management & tilt"
          title="Cosa succede quando l'orologio scende"
          sub="ACPL per fascia di tempo RIMASTO sull'orologio (≠ velocità della singola mossa). Tilt = quanto peggiori subito dopo un blunder."
          delay={7}
        >
          <TimeManagementChart time_management={pm.time_management} tilt={pm.tilt} />
        </Section>

        {/* ============ REPERTORIO: aperture deboli per colore ============ */}
        {((pm.repertoire_black && pm.repertoire_black.length > 0) ||
          (pm.repertoire_white && pm.repertoire_white.length > 0)) && (
          <Section
            id="repertoire"
            index="07b"
            eyebrow="Repertorio · le 3 posizioni che ti fregano"
            title="Aperture dove perdi partite"
            sub="Le aperture peggiori per colore, con le 3 posizioni incriminate per ognuna. Clicca per rigiocarle contro Stockfish e finalmente capire dove sbagli."
          >
            <div className="space-y-6">
              {pm.repertoire_black && pm.repertoire_black.length > 0 && (
                <div>
                  <div className="label-eyebrow mb-3">Col Nero</div>
                  <RepertoireCard openings={pm.repertoire_black} onPlay={(p) => setPlayPosition(p)} />
                </div>
              )}
              {pm.repertoire_white && pm.repertoire_white.length > 0 && (
                <div>
                  <div className="label-eyebrow mb-3">Col Bianco</div>
                  <RepertoireCard openings={pm.repertoire_white} onPlay={(p) => setPlayPosition(p)} />
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ============ MOTIVI TATTICI: distribuzione pattern ============ */}
        {pm.tactical_breakdown && pm.tactical_breakdown.length > 0 && (
          <Section
            id="patterns"
            index="08"
            eyebrow="Motivi tattici"
            title="In che tipo di tattica sbagli di piu`"
            sub="Distribuzione dei pattern tattici (forchetta, pezzo appeso, attacco scoperto...) tra i tuoi mistake/blunder critici. Il `gap +N%` ti dice quanto piu` spesso un 1600 trovava la mossa giusta."
          >
            <TacticalBreakdownCard items={pm.tactical_breakdown} />
          </Section>
        )}

        {/* ============ BLIND SPOTS (outcome-based) ============ */}
        <Section
          id="blindspots"
          index="09"
          eyebrow="Cosa succede quando sbagli"
          title="Errori per conseguenza"
          sub="Categoria OUTCOME-based (pezzo lasciato, vantaggio buttato, matto subito). Complementare ai motivi tattici sopra."
        >
          <BlindSpotsList blind_spots={pm.blind_spots} />
        </Section>

        {/* ============ TURNING POINTS ============ */}
        <Section
          id="turning"
          index="09"
          eyebrow="Turning points"
          title="I bivi che hanno deciso le tue partite"
          sub="Le posizioni con il maggior swing di valutazione. Clicca per rigiocarle contro Stockfish."
        >
          <TurningPointsList
            turning_points={pm.turning_points}
            onPlay={(p) => setPlayPosition(p)}
          />
        </Section>

        <div id="glossary" className="section scroll-mt-8">
          <div className="section-eyebrow">
            <span className="section-number">·</span>
            <span className="label-eyebrow">Riferimenti</span>
          </div>
          <Glossary />
        </div>

        <footer className="text-center text-[10px] text-[color:var(--color-faint)] mono mt-16 mb-6 tracking-[0.15em] uppercase">
          chess coach v2 · player model auto-generato · target {pm.identity.goal.target} {pm.identity.goal.time_class} entro {pm.identity.goal.deadline}
        </footer>
      </main>

      {/* GuidedSession overlay (sessione giornaliera) */}
      {sessionOpen && <GuidedSession pm={pm} onClose={closeSession} />}

      {/* PlaySession overlay (continua dal blunder) */}
      {playPosition && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPlayPosition(null);
          }}
        >
          <div className="min-h-full flex items-start justify-center p-4 lg:p-10">
            <div className="w-full max-w-[1100px]">
              <PlaySession
                startFen={playPosition.fen_before}
                startSan={playPosition.san}
                myColor={(playPosition.my_color || "white") as "white" | "black"}
                context={{
                  date: playPosition.date ?? undefined,
                  opp_rating: playPosition.opp_rating,
                  opening: playPosition.opening,
                  eco: playPosition.eco,
                }}
                onClose={() => setPlayPosition(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
