import type { StepKey } from "./store";

interface Props {
  step: StepKey;
  points: number;
  onExit: () => void;
  onRestart?: () => void;
}

const STEPS: { key: StepKey; label: string; sub: string }[] = [
  { key: "intro",          label: "Intro",   sub: "il pattern di oggi" },
  { key: "tema",           label: "Tema",    sub: "osserva la posizione" },
  { key: "warmup_guidato", label: "Warm-up", sub: "muovi con hint" },
  { key: "drill",          label: "Drill",   sub: "muovi senza hint" },
  { key: "play",           label: "Partita", sub: "1 round vs Stockfish" },
  { key: "outro",          label: "Recap",   sub: "punti + streak" },
];

export function SessionHeader({ step, points, onExit, onRestart }: Props) {
  const currentIndex = STEPS.findIndex((s) => s.key === step);
  return (
    <div className="px-6 lg:px-10 py-5 border-b border-[color:var(--color-line)] backdrop-blur bg-[color:var(--color-bg)]/80 sticky top-0 z-10">
      <div className="flex items-center justify-between gap-4 max-w-[1200px] mx-auto">
        <div className="flex items-center gap-3">
          <div className="brand-mark">♚</div>
          <div>
            <div className="label-eyebrow">Sessione di oggi</div>
            <div className="display-tiny mt-0.5">{STEPS[currentIndex]?.label || "Sessione"}</div>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-1.5 flex-1 max-w-xl mx-auto">
          {STEPS.map((s, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <div key={s.key} className="flex-1 flex items-center gap-1.5">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className={
                      "h-1 rounded-full w-full transition-all duration-500 " +
                      (done
                        ? "bg-[color:var(--color-brand)]"
                        : active
                        ? "bg-gradient-to-r from-[color:var(--color-brand)] to-[color:var(--color-brand-soft)]"
                        : "bg-white/[0.06]")
                    }
                  />
                  <div className={"text-[10px] font-mono uppercase tracking-widest " + (active ? "text-[color:var(--color-brand-soft)]" : done ? "text-[color:var(--color-text-soft)]" : "text-[color:var(--color-faint)]")}>
                    {s.label}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="label-eyebrow">Punti</div>
            <div className="display-small tabular-nums mt-0.5">{points}</div>
          </div>
          {onRestart && (
            <button onClick={onRestart} className="btn btn-ghost btn-sm" title="Ricomincia la sessione di oggi">
              Ricomincia
            </button>
          )}
          <button onClick={onExit} className="btn btn-ghost btn-sm" title="Esci dalla sessione">
            Esci
          </button>
        </div>
      </div>
    </div>
  );
}
