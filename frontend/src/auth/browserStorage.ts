export type BrowserStorageHost = {
  readonly localStorage: Storage;
  readonly sessionStorage: Storage;
};

type BrowserStorageKind = keyof BrowserStorageHost;

/**
 * Accessing a Window storage getter can itself throw (for example in privacy
 * mode or when storage is disabled). Keep that failure out of application and
 * telemetry initialization.
 */
export function safeBrowserStorage(
  kind: BrowserStorageKind,
  browser: BrowserStorageHost | undefined =
    typeof window === "undefined" ? undefined : window,
): Storage | undefined {
  if (!browser) return undefined;

  try {
    return browser[kind];
  } catch {
    return undefined;
  }
}

export function safeBrowserLocalStorage(
  browser?: BrowserStorageHost,
): Storage | undefined {
  return safeBrowserStorage("localStorage", browser);
}

export function safeBrowserSessionStorage(
  browser?: BrowserStorageHost,
): Storage | undefined {
  return safeBrowserStorage("sessionStorage", browser);
}
