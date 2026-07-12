export type AuthBootstrapResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "rejected" | "timeout" };

export const AUTH_BOOTSTRAP_TIMEOUT_MS = 8_000;

/**
 * Settles an auth bootstrap operation within a bounded time.
 *
 * The rejection handler is attached before the race, so an operation that
 * rejects after the timeout is still consumed and cannot become unhandled.
 */
export async function runBoundedAuthBootstrap<T>(
  operation: () => Promise<T>,
  timeoutMs = AUTH_BOOTSTRAP_TIMEOUT_MS,
): Promise<AuthBootstrapResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const operationResult = Promise.resolve()
    .then(operation)
    .then<AuthBootstrapResult<T>, AuthBootstrapResult<T>>(
      (value): AuthBootstrapResult<T> => ({ ok: true, value }),
      (): AuthBootstrapResult<T> => ({ ok: false, reason: "rejected" }),
    );
  const timeoutResult = new Promise<AuthBootstrapResult<T>>((resolve) => {
    timeoutId = setTimeout(
      () => resolve({ ok: false, reason: "timeout" }),
      Math.max(1, timeoutMs),
    );
  });

  try {
    return await Promise.race([operationResult, timeoutResult]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}
