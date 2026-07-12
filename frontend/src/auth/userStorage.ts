/**
 * Browser storage for authenticated, user-owned state.
 *
 * Never put training/session data in a global localStorage key: browsers can
 * keep it after logout and a second account on the same device would inherit
 * it. AuthContext sets the active scope before protected routes render. A
 * normal logout only detaches that scope; explicit device/account cleanup is
 * what removes the owned keys.
 */

import { safeBrowserLocalStorage } from "./browserStorage";

const USER_PREFIX = "mygotham:user";
const LEGACY_CLEARED_KEY = "mygotham:legacy-storage-cleared:v1";

let activeUserId: string | null = null;

const LEGACY_PERSONAL_KEYS = [
  "mygotham_goal_override",
  "mygotham_drill_log",
  "mygotham_drill_queue",
  "mygotham_journal",
  "mygotham_srs_v1",
  "mygotham_srs_pattern_v1",
  "mygotham_session",
  "mygotham_daily_streak",
  "nonno_board_visited_v1",
  "mygotham_momento_rise_seen",
  "nonno_letter_seen",
] as const;

const LEGACY_PERSONAL_PREFIXES = ["nonno_lesson_v1_"] as const;

function browserStorage(): Storage | null {
  return safeBrowserLocalStorage() ?? null;
}

function normalizeUserId(userId: string | null | undefined): string | null {
  const value = userId?.trim();
  return value ? value : null;
}

export function scopedStorageKey(key: string, userId = activeUserId): string | null {
  const owner = normalizeUserId(userId);
  if (!owner || !key) return null;
  return `${USER_PREFIX}:${owner}:${key}`;
}

/** Called by AuthContext whenever the authenticated user changes. */
export function setStorageUserScope(userId: string | null): void {
  activeUserId = normalizeUserId(userId);
  // Old builds wrote personal data globally. It cannot be attributed safely
  // on a shared browser, so invalidate it instead of assigning it to whoever
  // happens to log in first after this release.
  clearLegacyPersonalStorage();
}

export function getStorageUserScope(): string | null {
  return activeUserId;
}

/**
 * Atomically-enough claims the per-user first-auth telemetry marker in this
 * browser. Call only after consent/privacy signals allow telemetry.
 */
export function claimFirstAuthenticatedTelemetryEvent(): boolean {
  if (!activeUserId || scopedStorage.getItem("telemetry:first_authenticated") === "1") {
    return false;
  }
  return scopedStorage.setItem("telemetry:first_authenticated", "1");
}

export const scopedStorage = {
  getItem(key: string): string | null {
    const storage = browserStorage();
    const scopedKey = scopedStorageKey(key);
    if (!storage || !scopedKey) return null;
    try {
      return storage.getItem(scopedKey);
    } catch {
      return null;
    }
  },

  setItem(key: string, value: string): boolean {
    const storage = browserStorage();
    const scopedKey = scopedStorageKey(key);
    if (!storage || !scopedKey) return false;
    try {
      storage.setItem(scopedKey, value);
      return true;
    } catch {
      return false;
    }
  },

  removeItem(key: string): void {
    const storage = browserStorage();
    const scopedKey = scopedStorageKey(key);
    if (!storage || !scopedKey) return;
    try {
      storage.removeItem(scopedKey);
    } catch {
      // Storage can be unavailable in privacy mode.
    }
  },

  /** Logical (un-prefixed) keys for the active user, optionally filtered. */
  keys(prefix = ""): string[] {
    const storage = browserStorage();
    const owner = getStorageUserScope();
    const scopedRoot = owner ? `${USER_PREFIX}:${owner}:` : null;
    if (!storage || !scopedRoot) return [];
    const result: string[] = [];
    try {
      for (let i = 0; i < storage.length; i += 1) {
        const storedKey = storage.key(i);
        if (!storedKey?.startsWith(scopedRoot)) continue;
        const logicalKey = storedKey.slice(scopedRoot.length);
        if (logicalKey.startsWith(prefix)) result.push(logicalKey);
      }
    } catch {
      return [];
    }
    return result;
  },
};

export function clearUserLocalStorage(userId = activeUserId): void {
  const owner = normalizeUserId(userId);
  const storage = browserStorage();
  if (!storage || !owner) return;
  const prefix = `${USER_PREFIX}:${owner}:`;
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
    // This older throttle key was already user-specific, but not namespaced.
    storage.removeItem(`nt_newgames_check_${owner}`);
  } catch {
    // Best effort: auth logout must still complete if storage is unavailable.
  }
  if (activeUserId === owner) activeUserId = null;
}

export function clearLegacyPersonalStorage(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    if (storage.getItem(LEGACY_CLEARED_KEY) === "1") return;
    for (const key of LEGACY_PERSONAL_KEYS) storage.removeItem(key);
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && LEGACY_PERSONAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        storage.removeItem(key);
      }
    }
    storage.setItem(LEGACY_CLEARED_KEY, "1");
  } catch {
    // Best effort only.
  }
}
