import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const IP_HASH_SECRET = Deno.env.get("TELEMETRY_IP_HASH_SECRET") ?? "";
const TRUST_X_FORWARDED_FOR = Deno.env.get("TELEMETRY_TRUST_X_FORWARDED_FOR") === "true";
const MAX_BODY_BYTES = 12 * 1024;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  ...(Deno.env.get("TELEMETRY_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean),
]);

const ALLOWED_EVENTS = new Set([
  "landing_view",
  "signup_started",
  "signup_submitted",
  "signup_succeeded",
  "signup_failed",
]);
const ALLOWED_PROPERTY_KEYS = new Set([
  "locale",
  "referrer_host",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "surface",
  "variant",
  "reason_code",
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function cors(origin: string | null): HeadersInit {
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function allowedOrigin(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.has(origin.replace(/\/$/, ""));
}

function json(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
}

function scrubValue(value: string): string {
  const clean = value.trim();
  if (
    /Bearer\s+[A-Za-z0-9._-]+/i.test(clean) ||
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(clean) ||
    /\[(?:Event|White|Black|FEN)\s+"/i.test(clean) ||
    /\b(?:[prnbqkPRNBQK1-8]+\/){7}[prnbqkPRNBQK1-8]+\s+[wb]\s+/i.test(clean) ||
    /chess\.com\/(?:pub\/)?(?:player|member)\//i.test(clean)
  ) return "[redacted]";
  return clean.slice(0, 120);
}

function cleanProperties(eventName: string, value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const clean: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_PROPERTY_KEYS.has(key) || typeof raw !== "string") continue;
    if (key === "reason_code" && eventName !== "signup_failed") continue;
    const normalized = scrubValue(raw);
    if (normalized) clean[key] = normalized;
  }
  return clean;
}

function canonicalClientIp(req: Request): string | null {
  // Prefer proxy-owned single-value headers. Supabase documents
  // x-forwarded-for for client IP; trusting it is opt-in because a custom or
  // self-hosted proxy may pass a caller-supplied value through unchanged.
  const canonical = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip");
  if (canonical?.trim()) return canonical.trim().slice(0, 100);
  if (!TRUST_X_FORWARDED_FOR) return null;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded ? forwarded.slice(0, 100) : null;
}

async function hmacHex(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(IP_HASH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("body_too_large");
  if (!req.body) throw new Error("invalid_json");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("body_too_large");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = JSON.parse(new TextDecoder().decode(merged)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_json");
  return parsed as Record<string, unknown>;
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin")?.replace(/\/$/, "") ?? null;
  if (!allowedOrigin(origin)) return json({ error: "origin_not_allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405, origin);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "content_type_required" }, 415, origin);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || IP_HASH_SECRET.length < 32) {
    return json({ error: "service_unavailable" }, 503, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "body_too_large";
    return json({ error: tooLarge ? "body_too_large" : "invalid_json" }, tooLarge ? 413 : 400, origin);
  }

  const eventName = typeof body.event_name === "string" ? body.event_name : "";
  const anonymousId = typeof body.anonymous_id === "string" ? body.anonymous_id : "";
  const clientSessionId = typeof body.client_session_id === "string" ? body.client_session_id : null;
  if (!ALLOWED_EVENTS.has(eventName) || !UUID_RE.test(anonymousId)) {
    return json({ error: "invalid_event" }, 400, origin);
  }
  if (clientSessionId !== null && !UUID_RE.test(clientSessionId)) {
    return json({ error: "invalid_session" }, 400, origin);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const clientIp = canonicalClientIp(req);
  // If the deployment does not expose a trusted client-IP header, fall back to
  // the anonymous installation id. This is less abuse-resistant but still
  // bounded per browser; production should configure the documented proxy
  // header via TELEMETRY_TRUST_X_FORWARDED_FOR when appropriate.
  const rateMaterial = clientIp ? `ip:${clientIp}` : `anonymous:${anonymousId}`;
  const rateKey = await hmacHex(rateMaterial);
  const { data: accepted, error } = await service.rpc("record_anonymous_analytics_event", {
    p_rate_key: rateKey,
    p_anonymous_id: anonymousId,
    p_event_name: eventName,
    p_client_session_id: clientSessionId,
    p_properties: cleanProperties(eventName, body.properties),
  });
  if (error) return json({ error: "storage_unavailable" }, 503, origin);
  if (accepted !== true) return json({ error: "rate_limited" }, 429, origin);
  return json({ accepted: true }, 202, origin);
});
