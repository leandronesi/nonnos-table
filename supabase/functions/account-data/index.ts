import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const STORAGE_BUCKET = "user-data";
const PAGE_SIZE = 1000;
const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
  ...(Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean),
]);

function cors(origin: string | null): HeadersInit {
  return {
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function response(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json; charset=utf-8" },
  });
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

async function selectAllForUser(
  service: SupabaseClient,
  table: string,
  userId: string,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`Could not export ${table}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function anonymousIdsForUser(service: SupabaseClient, userId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service
      .from("analytics_events")
      .select("id,anonymous_id,created_at")
      .eq("user_id", userId)
      .not("anonymous_id", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error("Could not resolve linked acquisition events");
    for (const row of data ?? []) {
      if (typeof row.anonymous_id === "string") ids.add(row.anonymous_id);
    }
    if (!data || data.length < PAGE_SIZE) return [...ids];
  }
}

async function linkedAnonymousEvents(service: SupabaseClient, anonymousIds: string[]): Promise<unknown[]> {
  if (anonymousIds.length === 0) return [];
  const rows: unknown[] = [];
  for (let index = 0; index < anonymousIds.length; index += 100) {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await service
        .from("anonymous_analytics_events")
        .select("*")
        .in("anonymous_id", anonymousIds.slice(index, index + 100))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new Error("Could not export linked acquisition events");
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

async function deleteLinkedAnonymousEvents(service: SupabaseClient, anonymousIds: string[]): Promise<void> {
  for (let index = 0; index < anonymousIds.length; index += 100) {
    const { error } = await service
      .from("anonymous_analytics_events")
      .delete()
      .in("anonymous_id", anonymousIds.slice(index, index + 100));
    if (error) throw new Error("Could not delete linked acquisition events");
  }
}

interface StorageManifestEntry {
  path: string;
  size: number | null;
  content_type: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ErrorShape {
  code?: unknown;
  status?: unknown;
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as ErrorShape).code;
  return typeof code === "string" ? code : null;
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const status = (error as ErrorShape).status;
  return typeof status === "number" ? status : null;
}

function isVerifiedUserNotFoundError(error: unknown): boolean {
  return errorStatus(error) === 404 || errorCode(error) === "user_not_found";
}

async function adminUserIsMissing(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) return isVerifiedUserNotFoundError(error);
  return !data.user;
}

async function waitForAdminUserMissing(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await adminUserIsMissing(service, userId)) return true;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  return false;
}

async function stageAccountDeletionFence(
  service: SupabaseClient,
  userId: string,
): Promise<"staged" | "already_deleted"> {
  const { error } = await service
    .from("account_deletion_fences")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (!error) return "staged";

  // A concurrent request can delete auth.users between this request's verified
  // getUser() and the FK-backed fence insert. Treat only that verified race as
  // an idempotent success; network/permission failures remain failures.
  if (error.code === "23503" && await waitForAdminUserMissing(service, userId)) {
    return "already_deleted";
  }
  throw new Error("Could not stage account deletion fence");
}

async function deleteAuthUserIdempotently(
  service: SupabaseClient,
  userId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (!error) return attempt > 0;
    if (isVerifiedUserNotFoundError(error) || await adminUserIsMissing(service, userId)) {
      return true;
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw new Error("Could not delete auth user");
}

async function listStorageFiles(
  service: SupabaseClient,
  directory: string,
): Promise<StorageManifestEntry[]> {
  const result: StorageManifestEntry[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await service.storage.from(STORAGE_BUCKET).list(directory, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error("Could not list account storage");
    for (const entry of data ?? []) {
      const path = `${directory}/${entry.name}`;
      if (!entry.id && !entry.metadata) {
        result.push(...await listStorageFiles(service, path));
      } else {
        result.push({
          path,
          size: typeof entry.metadata?.size === "number" ? entry.metadata.size : null,
          content_type: typeof entry.metadata?.mimetype === "string" ? entry.metadata.mimetype : null,
          created_at: entry.created_at ?? null,
          updated_at: entry.updated_at ?? null,
        });
      }
    }
    if (!data || data.length < PAGE_SIZE) return result;
  }
}

async function removeStorageFilesCompletely(
  service: SupabaseClient,
  userId: string,
): Promise<number> {
  let removedFiles = 0;
  // A second delete request or an upload already in flight can change the
  // listing. Re-list after every pass and accept success only when verified
  // empty while the server-owned fence blocks every new browser operation.
  for (let pass = 0; pass < 5; pass += 1) {
    const files = await listStorageFiles(service, userId);
    if (files.length === 0) return removedFiles;
    for (let index = 0; index < files.length; index += 100) {
      const paths = files.slice(index, index + 100).map((file) => file.path);
      const { error } = await service.storage.from(STORAGE_BUCKET).remove(paths);
      if (error) break;
      removedFiles += paths.length;
    }
  }
  const remaining = await listStorageFiles(service, userId);
  if (remaining.length > 0) throw new Error("Could not empty account storage");
  return removedFiles;
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin")?.replace(/\/$/, "") ?? null;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return response({ error: "origin_not_allowed" }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return response({ error: "method_not_allowed" }, 405, origin);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return response({ error: "content_type_required" }, 415, origin);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return response({ error: "service_unavailable" }, 503, origin);

  const authorization = req.headers.get("authorization") ?? "";
  const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!jwt) return response({ error: "authentication_required" }, 401, origin);

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await service.auth.getUser(jwt);
  const user = authData.user;
  if (authError || !user) return response({ error: "authentication_failed" }, 401, origin);

  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "body_too_large";
    return response({ error: tooLarge ? "body_too_large" : "invalid_json" }, tooLarge ? 413 : 400, origin);
  }

  // `user_id` from the request body is intentionally never read. The verified
  // JWT above is the sole account selector for export and deletion.
  if (body.action === "export") {
    try {
      const tableNames = [
        "profiles",
        "games",
        "ingest_jobs",
        "analytics_events",
        "client_errors",
        "coach_invocations",
        "user_feedback",
        "training_attempts",
        "anchor_mastery",
        "anchor_transfer_observations",
        "corpus_prune_batches",
        "account_deletion_fences",
      ];
      const tableEntries = await Promise.all(
        tableNames.map(async (table) => [table, await selectAllForUser(service, table, user.id)] as const),
      );
      const anonymousIds = await anonymousIdsForUser(service, user.id);
      const anonymousEvents = await linkedAnonymousEvents(service, anonymousIds);
      const storageManifest = await listStorageFiles(service, user.id);
      return response({
        export_version: 1,
        exported_at: new Date().toISOString(),
        account: {
          id: user.id,
          email: user.email ?? null,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at ?? null,
        },
        tables: {
          ...Object.fromEntries(tableEntries),
          anonymous_analytics_events: anonymousEvents,
        },
        storage_manifest: storageManifest,
        storage_note: "Manifest only; game files remain downloadable through the authenticated private bucket.",
        anonymous_link_note: "Acquisition events are linked by a browser identifier. On a shared browser they can include pre-auth events not uniquely attributable to this account.",
      }, 200, origin);
    } catch {
      return response({ error: "export_failed" }, 500, origin);
    }
  }

  if (body.action === "delete") {
    const confirmation = typeof body.confirmation === "string" ? body.confirmation.trim() : "";
    const expected = user.email?.trim().toLowerCase() ?? "DELETE MY ACCOUNT";
    if (confirmation.toLowerCase() !== expected.toLowerCase()) {
      return response({ error: "confirmation_mismatch" }, 400, origin);
    }
    try {
      const fenceState = await stageAccountDeletionFence(service, user.id);
      if (fenceState === "already_deleted") {
        return response({ deleted: true, removed_files: 0, idempotent_replay: true }, 200, origin);
      }
      const anonymousIds = await anonymousIdsForUser(service, user.id);
      await deleteLinkedAnonymousEvents(service, anonymousIds);
      const removedFiles = await removeStorageFilesCompletely(service, user.id);
      // The fence stays in place through the auth transaction. Successful
      // auth deletion cascades profile, user rows and the fence together; a
      // failed deletion leaves the fence for an authenticated retry.
      const idempotentReplay = await deleteAuthUserIdempotently(service, user.id);
      return response({
        deleted: true,
        removed_files: removedFiles,
        idempotent_replay: idempotentReplay,
      }, 200, origin);
    } catch {
      return response({ error: "delete_failed" }, 500, origin);
    }
  }

  return response({ error: "invalid_action" }, 400, origin);
});
