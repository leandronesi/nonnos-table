import type { SessionState, DailyStreak } from "./store";

interface Props {
  session: SessionState;
  streak: DailyStreak;
  onClose: () => void;
}

export function RecapStep({ session, streak, onClose }: Props) {
  const drillsTotal = session.drills.length;
  const perfect = session.drills.filter((d) => d.verdict === "perfect").length;
  const ok = session.drills.filter((d) => d.verdict === "ok").length;
  const wrong = session.drills.filter((d) => d.verdict === "wrong").length;
  const bivi = session.bivi.filter((b) => b.revealed).length;
  const playOutcome = session.play?.outcome;
  const durationMin = session.finishedAt
    ? Math.round((session.finishedAt - session.startedAt) / 1000 / 60)
    : null;

  return (
    <div className="max-w-3xl mx-auto py-10">
      <div className="text-center">
        <div className="label-eyebrow text-[color:var(--color-brand-soft)]">Sessione completata</div>
        <h2 className="display-medium mt-3">Bravo · +{session.points} punti</h2>
        <div className="text-sm text-[color:var(--color-text-soft)] mt-2">
          {drillsTotal} puzzle · {bivi}/{session.bivi.length} bivi · 1 partita ·{" "}
          {durationMin != null ? `${durationMin} min` : ""}
        </div>
      </div>

      {/* Streak ring + numero */}
      <div className="surface surface-padded mt-8 text-center">
        <div className="label-eyebrow">Streak giornaliero</div>
        <div className="flex items-baseline justify-center gap-3 mt-3">
          <span className="display-rating leading-none">{streak.current}</span>
          <span className="text-2xl text-[color:var(--color-text-soft)] font-mono">
            giorni
          </span>
        </div>
        <div className="text-xs text-[color:var(--color-muted)] font-mono mt-2">
          best: {streak.best} · {streak.totalSessions} sessioni lifetime ·{" "}
          {streak.totalPoints} pt totali
        </div>
      </div>

      {/* Breakdown puzzle */}
      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="Perfetti" value={perfect.toString()} color="#34d399" />
        <Stat label="Giocabili" value={ok.toString()} color="#facc15" />
        <Stat label="Errori" value={wrong.toString()} color="#f43f5e" />
      </div>

      {/* Risultato partita */}
      {playOutcome && (
        <div className="surface surface-padded mt-6">
          <div className="label-eyebrow">Partita finale</div>
          <div
            className="display-small mt-2"
            style={{
              color:
                playOutcome === "win"
                  ? "#34d399"
                  : playOutcome === "loss"
                  ? "#f43f5e"
                  : "#94a3b8",
            }}
          >
            {{
              win: "Vittoria · +20",
              draw: "Patta · +8",
              loss: "Sconfitta · +3",
              abandoned: "Abbandonata · 0",
            }[playOutcome]}
          </div>
          {session.play?.moves_played != null && (
            <div className="text-xs text-[color:var(--color-muted)] mt-1 font-mono">
              {session.play.moves_played} mosse
            </div>
          )}
        </div>
      )}

      {/* CTA */}
      <div className="text-center mt-10">
        <button onClick={onClose} className="btn btn-primary btn-lg">
          Chiudi · ci vediamo domani
        </button>
        <div className="text-xs text-[color:var(--color-muted)] mt-4 font-mono">
          la prossima sessione sarà disponibile dopo le 00:00 UTC
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="border border-[color:var(--color-line)] rounded-lg p-4 text-center">
      <div className="display-medium tabular-nums" style={{ color }}>{value}</div>
      <div className="label-eyebrow mt-1">{label}</div>
    </div>
  );
}
