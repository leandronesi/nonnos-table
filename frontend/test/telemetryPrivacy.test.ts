import { describe, expect, it } from "vitest";
import {
  safeBrowserLocalStorage,
  safeBrowserSessionStorage,
  type BrowserStorageHost,
} from "../src/auth/browserStorage";
import {
  clearAnonymousTelemetryState,
  scrubTelemetryText,
  setTelemetryEnabled,
  telemetryConsentStatus,
  trackAcquisition,
} from "../src/lib/telemetry";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

function withFakeWindow(fakeWindow: object, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
}

describe("telemetry privacy scrubber", () => {
  it("removes FEN positions", () => {
    const input = "Failed on rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    expect(scrubTelemetryText(input)).not.toContain("rnbqkbnr");
    expect(scrubTelemetryText(input)).toContain("[fen]");
  });

  it("drops PGN headers and movetext", () => {
    expect(scrubTelemetryText('[Event "Private"]\n[White "alice"]\n1. e4 e5 2. Nf3')).toBe("[chess-data redacted]");
    expect(scrubTelemetryText("Parse failed: 1. e4 e5 2. Nf3 Nc6")).toBe("[chess-data redacted]");
  });

  it("redacts Chess.com player identifiers", () => {
    const api = scrubTelemetryText("GET https://api.chess.com/pub/player/private_name/games/2026/01");
    const page = scrubTelemetryText("https://www.chess.com/member/private_name");
    expect(api).not.toContain("private_name");
    expect(page).not.toContain("private_name");
  });
});

describe("browser storage privacy fallback", () => {
  it("returns undefined outside a browser", () => {
    expect(safeBrowserLocalStorage(undefined)).toBeUndefined();
  });

  it("does not crash when the localStorage getter is blocked", () => {
    const blockedStorage = Object.defineProperties({}, {
      localStorage: {
        get() {
          throw new Error("local storage access blocked");
        },
      },
      sessionStorage: {
        get() {
          throw new Error("session storage access blocked");
        },
      },
    });

    expect(
      safeBrowserLocalStorage(blockedStorage as BrowserStorageHost),
    ).toBeUndefined();
    expect(
      safeBrowserSessionStorage(blockedStorage as BrowserStorageHost),
    ).toBeUndefined();
  });

  it("keeps telemetry best-effort when storage getters become unavailable", () => {
    const consentStorage = memoryStorage({
      "mygotham:telemetry-consent:v1": "granted",
    });
    let localReads = 0;
    const unstableWindow = Object.defineProperties(
      { location: { pathname: "/" } },
      {
        localStorage: {
          get() {
            localReads += 1;
            if (localReads === 1) return consentStorage;
            throw new Error("local storage access revoked");
          },
        },
        sessionStorage: {
          get() {
            throw new Error("session storage access blocked");
          },
        },
      },
    );

    withFakeWindow(unstableWindow, () => {
      expect(() => trackAcquisition("landing_view")).not.toThrow();
      expect(() => clearAnonymousTelemetryState()).not.toThrow();
      expect(() => setTelemetryEnabled(true)).not.toThrow();
    });
  });

  it("installs global error handlers immediately after opt-in", () => {
    const listenerTypes: string[] = [];
    const fakeWindow = {
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
      location: { pathname: "/" },
      addEventListener(type: string) {
        listenerTypes.push(type);
      },
    };

    withFakeWindow(fakeWindow, () => {
      expect(telemetryConsentStatus()).toBe("unknown");
      setTelemetryEnabled(true);
      expect(telemetryConsentStatus()).toBe("granted");
    });

    expect(listenerTypes).toEqual(["error", "unhandledrejection"]);
  });
});
