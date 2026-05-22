import { useState } from "react";
import type { PlayerModel, PositionRow } from "../types";
import { PageShell } from "./PageShell";
import { Section } from "../components/Section";
import { DrillPlan } from "../components/DrillPlan";
import { RepertoireCard } from "../components/RepertoireCard";
import { TurningPointsList } from "../components/TurningPointsList";
import { PlaySession } from "../components/PlaySession";

/**
 * /repertorio - la "libreria" delle posizioni. Trainer drill + aperture deboli
 * + turning points. Tutto cio` che e` DRILLABLE direttamente.
 */
export function Repertorio({ pm }: { pm: PlayerModel }) {
  const [playPosition, setPlayPosition] = useState<PositionRow | null>(null);

  return (
    <PageShell title="Repertorio" subtitle="trainer · aperture · turning points">
      {/* TRAINER */}
      <Section
        id="trainer"
        index="01"
        eyebrow="Trainer · drag & drop"
        title="Rifai i tuoi blunder. Stockfish ti giudica al volo."
        sub="Posizioni dove un 1600 trovava la mossa giusta e tu no. Drill ordinati per drill_value (gap target-vs-mine). SRS attivo: i ripassi tornano in cima."
      >
        <DrillPlan drills={pm.drills} />
      </Section>

      {/* APERTURE */}
      {((pm.repertoire_black && pm.repertoire_black.length > 0) ||
        (pm.repertoire_white && pm.repertoire_white.length > 0)) && (
        <Section
          id="repertoire"
          index="02"
          eyebrow="Aperture deboli"
          title="Le 3 posizioni che ti fregano per ogni apertura"
          sub="Clicca per rigiocare contro Stockfish la posizione incriminata."
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

      {/* TURNING POINTS */}
      <Section
        id="turning"
        index="03"
        eyebrow="Turning points"
        title="I bivi che hanno deciso le tue partite"
        sub="Posizioni con il maggior swing di valutazione. Clicca per rigiocarle."
      >
        <TurningPointsList
          turning_points={pm.turning_points}
          onPlay={(p) => setPlayPosition(p)}
        />
      </Section>

      {playPosition && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-auto"
          onClick={(e) => { if (e.target === e.currentTarget) setPlayPosition(null); }}
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
    </PageShell>
  );
}
