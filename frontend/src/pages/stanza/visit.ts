import { scopedStorage } from "../../auth/userStorage";

const STANZA_INTRO_SEEN_KEY = "stanza_intro_seen_v1";

export function hasSeenStanzaIntro(): boolean {
  return scopedStorage.getItem(STANZA_INTRO_SEEN_KEY) === "1";
}

export function markStanzaIntroSeen(): void {
  scopedStorage.setItem(STANZA_INTRO_SEEN_KEY, "1");
}
