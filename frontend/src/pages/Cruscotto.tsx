import { useState } from "react";
import type { PlayerModel, PositionRow } from "../types";
import { PageShell } from "./PageShell";
import { Section } from "../components/Section";
import { WeeklyFocusCard } from "../components/WeeklyFocusCard";
import { DiagnosisList } from "../components/DiagnosisList";
import { DecisionsCard } from "../components/DecisionsCard";
import { TimeManagementChart } from "../components/TimeManagementChart";
import { TacticalBreakdownCard } from "../components/TacticalBreakdownCard";
import { BlindSpotsList } from "../components/BlindSpotsList";
import { Glossary } from "../components/Glossary";
import { PlaySession } from "../components/PlaySession";
import { maiaLevelForGoal } from "../coaching";

/**
 * /cruscotto - la "verita'" analitica. Diagnosi, motivi, time mgmt, decisioni.
 * Tutto cio' che spiega PERCHE' e QUANDO sbagli. La parte data-dense del prodotto.
 */
export function Cruscotto({ pm }: { pm: PlayerModel }) {
  return (
    <PageShell title="Profilo" subtitle="Tempo, fasi, decisioni: tutto quello che ti racconta come giochi">
      <CruscottoBody pm={pm} />
    </PageShell>
  );
}

/**
 * Body riusabile del cruscotto analitico. Esposto come componente per embed
 * nel Quaderno (/coach) come tab "Profilo".
 */
export function CruscottoBody({ pm }: { pm: PlayerModel }) {
  const [playPosition, setPlayPosition] = useState<PositionRow | null>(null);
  const maiaLevel = maiaLevelForGoal(pm);

  return (
    <>
      {/* FOCUS SETTIMANALE */}
      <Section
        index="01"
        eyebrow="Focus della settimana"
        title="L'una cosa da spostare nei prossimi 7 giorni"
        sub="Una sola priorita': il tema che tornera' nelle prossime posizioni."
      >
        <WeeklyFocusCard focus={pm.weekly_focus} brief={pm.coach_brief} />
      </Section>

      {/* DIAGNOSI */}
      <Section
        id="diagnoses"
        index="02"
        eyebrow="Diagnosi"
        title="Le tue debolezze, in ordine di impatto"
        sub="Ordinate per impatto, frequenza e allenabilita' immediata."
      >
        <DiagnosisList diagnoses={pm.diagnoses} />
      </Section>

      {/* MOTIVI TATTICI */}
      {pm.tactical_breakdown && pm.tactical_breakdown.length > 0 && (
        <Section
          id="patterns"
          index="03"
          eyebrow="Motivi tattici"
          title="In che tipo di tattica sbagli di piu'"
          sub={`Distribuzione dei motivi. Lo scarto misura quanto piu' spesso MAIA ${maiaLevel} trovava la mossa giusta.`}
        >
          <TacticalBreakdownCard items={pm.tactical_breakdown} />
        </Section>
      )}

      {/* BLIND SPOTS (outcome) */}
      <Section
        id="blindspots"
        index="04"
        eyebrow="Errori per conseguenza"
        title="Cosa succede quando sbagli"
        sub="Categoria OUTCOME-based (pezzo lasciato, vantaggio buttato, matto subito). Complementare ai motivi tattici."
      >
        <BlindSpotsList blind_spots={pm.blind_spots} />
      </Section>

      {/* DECISIONI */}
      <Section
        id="decisions"
        index="05"
        eyebrow="Decisioni vs risultato"
        title="Sai chiudere? Sai salvarti?"
        sub="Conversione, salvataggi e vantaggi buttati separano la tecnica dal risultato."
      >
        <DecisionsCard decisions={pm.decisions} />
      </Section>

      {/* TIME MANAGEMENT */}
      <Section
        id="time"
        index="06"
        eyebrow="Time management & tilt"
        title="Cosa succede quando l'orologio scende"
        sub="Precisione media per fascia di tempo RIMASTO sull'orologio. Tilt = quanto peggiori subito dopo un errore grave."
      >
        <TimeManagementChart time_management={pm.time_management} tilt={pm.tilt} />
      </Section>


      <div id="glossary" className="mt-16">
        <div className="label-eyebrow mb-3">Riferimenti</div>
        <Glossary />
      </div>

      {playPosition && (
        <PlaySessionOverlay position={playPosition} maiaLevel={maiaLevel} onClose={() => setPlayPosition(null)} />
      )}
    </>
  );
}

function PlaySessionOverlay({ position, maiaLevel, onClose }: { position: PositionRow; maiaLevel: number; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="min-h-full flex items-start justify-center p-4 lg:p-10">
        <div className="w-full max-w-[1100px]">
          <PlaySession
            startFen={position.fen_before}
            startSan={position.san}
            myColor={(position.my_color || "white") as "white" | "black"}
            maiaLevel={maiaLevel}
            context={{
              date: position.date ?? undefined,
              opp_rating: position.opp_rating,
              opening: position.opening,
              eco: position.eco,
            }}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
