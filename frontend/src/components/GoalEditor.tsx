import { useState } from "react";
import { X, Target } from "lucide-react";
import type { PlayerModel } from "../types";
import { saveGoalOverride, type TimeClass } from "../goalOverride";
import { writeEntry, bodyForGoalUpdated } from "../session/journal";
import { clearLiveCoachCache } from "../liveCoach";

interface Props {
  pm: PlayerModel;
  onClose: () => void;
  onSaved: () => void;
}

const TIME_CLASSES: { key: TimeClass; label: string }[] = [
  { key: "rapid",     label: "Rapid" },
  { key: "blitz",     label: "Blitz" },
  { key: "bullet",    label: "Bullet" },
  { key: "classical", label: "Classical" },
  { key: "daily",     label: "Daily" },
];

/**
 * Editor per l'obiettivo dichiarato dell'utente (target rating + time_class).
 * Salva in localStorage tramite goalOverride. Pre-popolato col valore attuale.
 */
export function GoalEditor({ pm, onClose, onSaved }: Props) {
  const initial = pm.identity.goal;
  const [target, setTarget] = useState<number>(initial.target);
  const [timeClass, setTimeClass] = useState<TimeClass>(
    (initial.time_class as TimeClass) || "rapid",
  );

  const ratingByTc = pm.identity.rating_by_time_class ?? {};
  const previewCurrent = ratingByTc[timeClass] ?? null;
  const gap = previewCurrent != null ? Math.max(0, target - previewCurrent) : null;

  function handleSave() {
    saveGoalOverride({ target, time_class: timeClass });
    // Il brief LLM dipende dal goal: invalido subito la cache così alla prossima
    // apertura di /coach il LiveBrief regenera col nuovo time_class.
    clearLiveCoachCache();
    writeEntry({
      kind: "goal_updated",
      body: bodyForGoalUpdated(target, timeClass),
      meta: { target, time_class: timeClass },
    });
    onSaved();
  }

  return (
    <div
      className="goal-editor-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-editor-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="goal-editor-panel">
        <button className="goal-editor-close" onClick={onClose} aria-label="Chiudi">
          <X size={20} />
        </button>
        <header className="goal-editor-head">
          <div className="goal-editor-icon" aria-hidden="true">
            <Target size={22} />
          </div>
          <div>
            <div className="label-eyebrow">Il tuo obiettivo dichiarato</div>
            <h2 id="goal-editor-title" className="display-small mt-1">
              Dove vuoi arrivare?
            </h2>
          </div>
        </header>

        <div className="goal-editor-section">
          <label className="label-eyebrow" htmlFor="goal-tc">Categoria di tempo</label>
          <div className="goal-editor-tc-grid">
            {TIME_CLASSES.map((tc) => {
              const r = ratingByTc[tc.key];
              const isAvailable = r != null;
              const isSelected = timeClass === tc.key;
              return (
                <button
                  key={tc.key}
                  type="button"
                  className={`goal-editor-tc-btn ${isSelected ? "selected" : ""} ${!isAvailable ? "unavailable" : ""}`}
                  onClick={() => setTimeClass(tc.key)}
                  disabled={!isAvailable}
                  title={isAvailable ? `Rating attuale: ${r}` : "Nessuna partita registrata"}
                >
                  <span className="goal-editor-tc-name">{tc.label}</span>
                  <span className="goal-editor-tc-rating">{r ?? "—"}</span>
                </button>
              );
            })}
          </div>
          <p className="goal-editor-hint">L'app allena la categoria che scegli qui.</p>
        </div>

        <div className="goal-editor-section">
          <label className="label-eyebrow" htmlFor="goal-target">Rating target</label>
          <div className="goal-editor-target-row">
            <input
              id="goal-target"
              type="number"
              min="600"
              max="3000"
              step="50"
              value={target}
              onChange={(e) => setTarget(parseInt(e.target.value, 10) || 1600)}
              className="goal-editor-target-input"
            />
            <input
              type="range"
              min="600"
              max="2800"
              step="50"
              value={target}
              onChange={(e) => setTarget(parseInt(e.target.value, 10))}
              className="goal-editor-target-slider"
              aria-label="Slider rating target"
            />
          </div>
        </div>

        {previewCurrent != null && (
          <div className="goal-editor-preview">
            <span>Da <strong>{previewCurrent}</strong> a <strong style={{ color: "var(--color-gold-soft)" }}>{target}</strong></span>
            {gap != null && (
              <span className="goal-editor-preview-gap">
                {gap} punti da fare
              </span>
            )}
          </div>
        )}

        <div className="goal-editor-actions">
          <button onClick={onClose} className="btn btn-ghost btn-lg">Annulla</button>
          <button onClick={handleSave} className="btn btn-primary btn-lg">
            Conferma obiettivo
          </button>
        </div>
      </div>
    </div>
  );
}
