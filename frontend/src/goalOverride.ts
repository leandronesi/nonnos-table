/**
 * Goal override — l'utente decide il suo obiettivo dichiarato (target + time_class)
 * SENZA dipendere dal valore generato dal backend. Persistito in localStorage,
 * applicato sopra a `pm.identity.goal` quando carichiamo il modello.
 *
 * Razionale: il backend ricalcola `goal.time_class` / `target` ogni refresh
 * (logica euristica). L'utente deve poter sovrascrivere quella scelta
 * permanentemente. Questa è l'unica autorità sul "tuo obiettivo dichiarato".
 *
 * Quando aggiungeremo l'onboarding pre-login, l'override verrà popolato
 * direttamente lì. Per ora vive solo come setting accessibile da Home.
 */

import type { PlayerModel } from "./types";

const STORAGE_KEY = "mygotham_goal_override";

export type TimeClass = "rapid" | "blitz" | "bullet" | "classical" | "daily";

export interface GoalOverride {
  target: number;          // rating target dichiarato
  time_class: TimeClass;
  /** Quando l'utente ha (ultimo) confermato la scelta. */
  updated_at: number;
}

export function loadGoalOverride(): GoalOverride | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GoalOverride;
  } catch {
    return null;
  }
}

export function saveGoalOverride(o: Omit<GoalOverride, "updated_at">) {
  const full: GoalOverride = { ...o, updated_at: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
  } catch { /* ignore */ }
}

export function clearGoalOverride() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
}

/**
 * Applica l'override sopra il PlayerModel. Se non c'è override, il PM resta
 * intoccato. Se c'è, sovrascrive `identity.goal.target` e `time_class`, e
 * aggiorna `current_rating` leggendo `rating_by_time_class[time_class]`.
 */
export function applyGoalOverride(pm: PlayerModel): PlayerModel {
  const ov = loadGoalOverride();
  if (!ov) return pm;
  const tc = ov.time_class;
  const newCurrent =
    pm.identity.rating_by_time_class?.[tc] ?? pm.identity.goal.current_rating;
  const pointsNeeded = Math.max(0, ov.target - (newCurrent ?? 0));
  return {
    ...pm,
    identity: {
      ...pm.identity,
      goal: {
        ...pm.identity.goal,
        target: ov.target,
        time_class: tc,
        current_rating: newCurrent,
        points_needed: pointsNeeded,
      },
    },
  };
}
