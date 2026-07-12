/** First-party telemetry backed by Supabase. No advertising/analytics SDK. */

import { supabase } from "../auth/supabaseClient";
import type { FeedbackKind, Json, UserFeedbackRow } from "../auth/db.types";
import {
  safeBrowserLocalStorage,
  safeBrowserSessionStorage,
} from "../auth/browserStorage";

export type TelemetryProperties = Record<string, string | number | boolean | null | undefined>;
export type AcquisitionEvent =
  | "landing_view"
  | "signup_started"
  | "signup_submitted"
  | "signup_succeeded"
  | "signup_failed";

const ANON_ID_KEY = "mygotham:anonymous-id:v1";
const ANON_QUEUE_KEY = "mygotham:anonymous-telemetry-queue:v1";
const TAB_SESSION_KEY = "mygotham:tab-session:v1";
const CONSENT_KEY = "mygotham:telemetry-consent:v1";
const LEGACY_OPT_OUT_KEY = "mygotham:telemetry-opt-out:v1";
const PRIVATE_KEY_RE = /password|secret|token|authorization|email|username|pgn|fen/i;
const sentThisPage = new Set<string>();
export const AUTHENTICATED_EVENT_NAMES = [
  "first_authenticated", "feedback_submitted", "first_reading_viewed",
  "first_reading_opened", "session_started", "session_completed",
  "chess_profile_lookup_started", "chess_profile_unsupported",
  "chess_profile_lookup_succeeded", "chess_profile_lookup_failed",
  "chess_profile_selected", "onboarding_goal_saved", "analysis_started",
  "first_10_ready", "background_analysis_partial",
  "full_100_or_available_ready", "room_viewed",
  "table_viewed", "feedback_opened", "telemetry_opted_in", "account_exported",
  "opponent_move_selected",
] as const;

export const AUTHENTICATED_PROPERTY_KEYS = [
  "event_version", "source", "kind", "has_rating", "batch_size",
  "review_positions", "has_target", "reached_practice_game", "reason",
  "anchor_key", "reason_code", "has_rapid", "has_blitz", "time_class",
  "horizon_weeks", "weekly_minutes", "games_available", "games_analyzed",
  "games_selected", "games_failed", "completion_scope",
  "has_secondary_anchor", "corpus_fallback", "opponent_source",
  "fallback_reason", "unavailable_reason", "maia_domain", "target_rating",
  "analysis_completion_id",
] as const;

export type AuthenticatedEventName = typeof AUTHENTICATED_EVENT_NAMES[number];
export type AuthenticatedPropertyKey = typeof AUTHENTICATED_PROPERTY_KEYS[number];
export type AuthenticatedTelemetryProperties = Partial<
  Record<AuthenticatedPropertyKey, string | number | boolean | null>
>;

const AUTHENTICATED_EVENTS = new Set<string>(AUTHENTICATED_EVENT_NAMES);
const AUTHENTICATED_PROPERTIES = new Set<string>(AUTHENTICATED_PROPERTY_KEYS);

interface AnonymousQueueItem {
  anonymous_id: string;
  client_session_id: string;
  event_name: AcquisitionEvent;
  properties: Record<string, string>;
}

export function browserDoNotTrackEnabled(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1" || nav.msDoNotTrack === "1";
}

export type TelemetryConsentStatus = "unknown" | "granted" | "denied";

/** Stored choice for consent-first UI. Browser privacy signals suppress prompts. */
export function telemetryConsentStatus(): TelemetryConsentStatus {
  if (browserDoNotTrackEnabled()) return "denied";
  if (typeof window === "undefined") return "unknown";
  const storage = safeBrowserLocalStorage();
  if (!storage) return "unknown";
  try {
    const stored = storage.getItem(CONSENT_KEY);
    if (stored === "granted" || stored === "denied") return stored;
  } catch {
    // If storage is unavailable, stay unknown and keep telemetry disabled.
  }
  return "unknown";
}

export function telemetryEnabled(): boolean {
  return telemetryConsentStatus() === "granted";
}

export function setTelemetryEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  const storage = safeBrowserLocalStorage();
  if (!storage) return;
  try {
    storage.removeItem(LEGACY_OPT_OUT_KEY);
    if (enabled) storage.setItem(CONSENT_KEY, "granted");
    else {
      storage.setItem(CONSENT_KEY, "denied");
      clearAnonymousTelemetryState();
    }
  } catch {
    // Privacy mode may make storage unavailable; telemetry remains best-effort.
    return;
  }
  // main.tsx may have run while consent was still unknown. Install immediately
  // after a successful opt-in instead of waiting for a page reload.
  if (enabled && telemetryEnabled()) installGlobalErrorTelemetry();
}

/** Clears linkage/queue for account deletion without setting a future opt-out. */
export function clearAnonymousTelemetryState(): void {
  if (typeof window === "undefined") return;
  const local = safeBrowserLocalStorage();
  const session = safeBrowserSessionStorage();
  try {
    local?.removeItem(ANON_ID_KEY);
    local?.removeItem(ANON_QUEUE_KEY);
  } catch {
    // Best effort on a disappearing account.
  }
  try {
    session?.removeItem(TAB_SESSION_KEY);
    sentThisPage.clear();
  } catch {
    // Best effort on a disappearing account.
  }
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 3) | 8).toString(16);
  });
}

function getOrCreate(storage: Storage, key: string): string {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const created = uuid();
    storage.setItem(key, created);
    return created;
  } catch {
    return uuid();
  }
}

function tabSessionId(): string {
  const storage = safeBrowserSessionStorage();
  return storage ? getOrCreate(storage, TAB_SESSION_KEY) : uuid();
}

function currentRoute(): string | null {
  return typeof window === "undefined" ? null : window.location.pathname.slice(0, 200);
}

export function scrubTelemetryText(value: string, max = 1000): string {
  const looksLikePgn = /\[(?:Event|Site|Date|Round|White|Black|Result|FEN|SetUp|TimeControl|ECO)\s+"/i.test(value)
    || /\b1\.\s*\S+\s+\S+[\s\S]{0,500}\b2\.\s*\S+/i.test(value);
  if (looksLikePgn) return "[chess-data redacted]";
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[token]")
    .replace(/\b(?:[prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+\s+[wb]\s+(?:K?Q?k?q?|-)+\s+(?:[a-h][36]|-)\s+\d+\s+\d+\b/g, "[fen]")
    .replace(/(https?:\/\/(?:(?:api|www)\.)?chess\.com\/(?:pub\/)?(?:player|member|stats|games\/archive)\/)[^/?#\s]+/gi, "$1[redacted]")
    .replace(/(\/(?:player|member)\/)[A-Za-z0-9_-]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|key|code|username)=)[^&#\s]+/gi, "$1[redacted]")
    .slice(0, max);
}

function clientErrorCode(message: string): string {
  const value = message.toLowerCase();
  if (value.includes("timeout") || value.includes("timed out")) return "timeout";
  if (value.includes("network") || value.includes("failed to fetch")) return "network_error";
  if (value.includes("auth") || value.includes("session") || value.includes("jwt")) return "auth_error";
  if (value.includes("storage") || value.includes("upload") || value.includes("download")) return "storage_error";
  if (value.includes("quota") || value.includes("rate limit")) return "quota_error";
  return "client_error";
}

function safeProperties(input: TelemetryProperties = {}): Record<string, Json> {
  const result: Record<string, Json> = {};
  for (const [key, value] of Object.entries(input)) {
    if (PRIVATE_KEY_RE.test(key) || value === undefined) continue;
    const safeKey = key.slice(0, 80);
    if (typeof value === "string") result[safeKey] = scrubTelemetryText(value, 240);
    else if (typeof value === "number" && Number.isFinite(value)) result[safeKey] = value;
    else if (typeof value === "boolean" || value === null) result[safeKey] = value;
  }
  return result;
}

function safeAuthenticatedProperties(
  input: AuthenticatedTelemetryProperties = {},
): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(safeProperties(input)).filter(([key]) =>
      AUTHENTICATED_PROPERTIES.has(key),
    ),
  );
}

async function authenticatedUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

function anonymousId(): string | null {
  if (typeof window === "undefined" || !telemetryEnabled()) return null;
  const storage = safeBrowserLocalStorage();
  return storage ? getOrCreate(storage, ANON_ID_KEY) : null;
}

/** Stable API used by product surfaces. Calls are best-effort and non-blocking. */
export function trackEvent(
  event: AuthenticatedEventName,
  properties?: AuthenticatedTelemetryProperties,
): void;
export function trackEvent(
  event: "landing_view" | "landing_signup_clicked" | "signup_started",
  properties?: { source?: string },
): void;
export function trackEvent(
  event: AuthenticatedEventName | "landing_view" | "landing_signup_clicked" | "signup_started",
  properties: TelemetryProperties = {},
): void {
  if (!telemetryEnabled()) return;
  if (event === "landing_view") {
    trackLandingView();
    return;
  }
  if (event === "landing_signup_clicked" || event === "signup_started") {
    trackSignupStarted(typeof properties.source === "string" ? properties.source : "signup");
    return;
  }
  void track(event, properties);
}

/** Authenticated events are allowlisted and rate-limited by a DB RPC. */
export async function track(
  eventName: AuthenticatedEventName,
  properties: AuthenticatedTelemetryProperties = {},
): Promise<void> {
  if (!telemetryEnabled()) return;
  if (!AUTHENTICATED_EVENTS.has(eventName)) return;
  if (!await authenticatedUserId()) return;
  const { data: accepted, error } = await supabase.rpc("record_authenticated_analytics_event", {
    p_event_name: eventName,
    p_anonymous_id: anonymousId(),
    p_client_session_id: tabSessionId(),
    p_route: currentRoute(),
    p_properties: safeAuthenticatedProperties(properties),
  });
  if ((error || accepted !== true) && import.meta.env.DEV) console.warn("[telemetry] event not stored");
}

export async function reportClientError(
  error: unknown,
  options: {
    severity?: "warning" | "error" | "fatal";
    component?: string;
    context?: TelemetryProperties;
  } = {},
): Promise<void> {
  if (!telemetryEnabled()) return;
  const userId = await authenticatedUserId();
  if (!userId) return;
  const normalized = error instanceof Error ? error : new Error(String(error));
  const knownNames = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "DOMException"]);
  const stackWithoutMessage = normalized.stack?.split("\n").slice(1).join("\n") ?? null;
  const { error: insertError } = await supabase.from("client_errors").insert({
    user_id: userId,
    error_name: knownNames.has(normalized.name) ? normalized.name : "Error",
    message: clientErrorCode(normalized.message || ""),
    stack: stackWithoutMessage ? scrubTelemetryText(stackWithoutMessage, 6000) : null,
    severity: options.severity ?? "error",
    route: currentRoute(),
    component: options.component?.slice(0, 160) ?? null,
    context: safeProperties(options.context),
    occurred_at: new Date().toISOString(),
  });
  if (insertError && import.meta.env.DEV) console.warn("[telemetry] client error not stored");
}

let globalErrorsInstalled = false;

export function installGlobalErrorTelemetry(): void {
  if (globalErrorsInstalled || typeof window === "undefined" || !telemetryEnabled()) return;
  try {
    window.addEventListener("error", (event) => {
      void reportClientError(event.error ?? event.message, { component: "window.error" });
    });
    window.addEventListener("unhandledrejection", (event) => {
      void reportClientError(event.reason, { component: "unhandledrejection" });
    });
    globalErrorsInstalled = true;
  } catch {
    // Telemetry must never prevent the product from starting or accepting consent.
    globalErrorsInstalled = false;
  }
}

export async function submitFeedback(input: {
  kind: FeedbackKind;
  rating?: number | null;
  subject?: string | null;
  message?: string | null;
  context?: TelemetryProperties;
}): Promise<UserFeedbackRow> {
  const userId = await authenticatedUserId();
  if (!userId) throw new Error("Authentication required");
  const rating = input.rating == null ? null : Math.max(1, Math.min(5, Math.round(input.rating)));
  const { data, error } = await supabase.from("user_feedback").insert({
    user_id: userId,
    kind: input.kind,
    rating,
    subject: input.subject?.trim().slice(0, 160) || null,
    message: input.message?.trim().slice(0, 4000) || null,
    context: safeProperties(input.context),
  }).select("*").single();
  if (error) throw error;
  return data;
}

function acquisitionProperties(input: Record<string, string | undefined>): Record<string, string> {
  const allowed = new Set([
    "locale", "referrer_host", "utm_source", "utm_medium", "utm_campaign", "surface", "variant", "reason_code",
  ]);
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && value?.trim()) result[key] = scrubTelemetryText(value.trim(), 120);
  }
  return result;
}

function readAnonymousQueue(): AnonymousQueueItem[] {
  if (typeof window === "undefined") return [];
  const storage = safeBrowserLocalStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(ANON_QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.slice(-20) : [];
  } catch {
    return [];
  }
}

function writeAnonymousQueue(queue: AnonymousQueueItem[]): void {
  if (typeof window === "undefined") return;
  const storage = safeBrowserLocalStorage();
  if (!storage) return;
  try {
    if (queue.length === 0) storage.removeItem(ANON_QUEUE_KEY);
    else storage.setItem(ANON_QUEUE_KEY, JSON.stringify(queue.slice(-20)));
  } catch {
    // Telemetry never blocks the product.
  }
}

export async function flushAnonymousTelemetry(): Promise<void> {
  if (!telemetryEnabled()) return;
  const remaining = readAnonymousQueue();
  while (remaining.length > 0) {
    const { error } = await supabase.functions.invoke("telemetry", { body: remaining[0] });
    if (error) break;
    remaining.shift();
    writeAnonymousQueue(remaining);
  }
}

export function trackAcquisition(
  eventName: AcquisitionEvent,
  properties: Record<string, string | undefined> = {},
): void {
  if (typeof window === "undefined" || !telemetryEnabled()) return;
  const reasonKey = eventName === "signup_failed" ? `:${properties.reason_code ?? "unknown"}` : "";
  const dedupeKey = `${tabSessionId()}:${eventName}${reasonKey}`;
  if (sentThisPage.has(dedupeKey)) return;
  sentThisPage.add(dedupeKey);
  const item: AnonymousQueueItem = {
    anonymous_id: anonymousId() ?? uuid(),
    client_session_id: tabSessionId(),
    event_name: eventName,
    properties: acquisitionProperties(properties),
  };
  writeAnonymousQueue([...readAnonymousQueue(), item]);
  void flushAnonymousTelemetry();
}

export function trackLandingView(): void {
  let referrerHost: string | undefined;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname : undefined;
  } catch {
    referrerHost = undefined;
  }
  const query = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  trackAcquisition("landing_view", {
    locale: typeof navigator === "undefined" ? undefined : navigator.language,
    referrer_host: referrerHost,
    utm_source: query?.get("utm_source") ?? undefined,
    utm_medium: query?.get("utm_medium") ?? undefined,
    utm_campaign: query?.get("utm_campaign") ?? undefined,
    surface: "landing",
  });
}

export function trackSignupStarted(surface = "signup"): void {
  trackAcquisition("signup_started", {
    locale: typeof navigator === "undefined" ? undefined : navigator.language,
    surface,
  });
}
