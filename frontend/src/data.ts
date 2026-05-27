import type { PlayerModel } from "./types";
import { applyGoalOverride } from "./goalOverride";

export async function loadPlayerModel(): Promise<PlayerModel> {
  // v2 endpoint: player_model.json (sostituisce metrics.json della v1).
  const url = import.meta.env.VITE_PLAYER_URL || `${import.meta.env.BASE_URL}player_model.json`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(
      `Impossibile caricare ${url} (${resp.status}). Lancia 'python backend/player_model.py' per generarlo.`,
    );
  }
  const pm = (await resp.json()) as PlayerModel;
  // L'utente è l'autorità sul SUO obiettivo: override applicato sopra al
  // valore generato dal backend.
  return applyGoalOverride(pm);
}
