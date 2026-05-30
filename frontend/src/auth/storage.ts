/**
 * Helper su Supabase Storage per layout per-utente.
 *
 * Bucket: 'user-data' (privato, RLS first-segment = auth.uid()).
 *
 * Layout:
 *   <user_id>/raw/<YYYY-MM>/<chess_com_uuid>.pgn
 *   <user_id>/analysis/<chess_com_uuid>.json
 *   <user_id>/quaderno/coach_brief.json
 *   <user_id>/quaderno/coach_journal.md
 *   <user_id>/quaderno/aggregates.json
 *
 * Tutti i path qui sotto sono relativi al bucket (NO bucket id davanti).
 */

import { supabase, STORAGE_BUCKET } from "./supabaseClient";

export function userRoot(userId: string): string {
  return userId; // primo segmento del path — combacia con RLS policy
}

export function pgnPath(userId: string, yearMonth: string, chessComUuid: string): string {
  return `${userRoot(userId)}/raw/${yearMonth}/${chessComUuid}.pgn`;
}

export function analysisPath(userId: string, chessComUuid: string): string {
  return `${userRoot(userId)}/analysis/${chessComUuid}.json`;
}

export function quadernoPath(userId: string, fileName: string): string {
  return `${userRoot(userId)}/quaderno/${fileName}`;
}

export async function uploadText(path: string, body: string, contentType: string): Promise<void> {
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, new Blob([body], { type: contentType }), {
      upsert: true,
      contentType,
    });
  if (error) throw error;
}

export async function uploadJson(path: string, value: unknown): Promise<void> {
  await uploadText(path, JSON.stringify(value), "application/json");
}

export async function downloadText(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path);
  if (error) {
    // 404 → file non c'è (normale); altri errori → rilancia
    if ((error as { statusCode?: string }).statusCode === "404") return null;
    if (/not.?found/i.test(error.message)) return null;
    throw error;
  }
  return await data.text();
}

export async function downloadJson<T>(path: string): Promise<T | null> {
  const txt = await downloadText(path);
  if (txt == null) return null;
  try {
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

export async function fileExists(path: string): Promise<boolean> {
  // Supabase non ha HEAD diretto: facciamo list sulla cartella padre.
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash);
  const name = slash < 0 ? path : path.slice(slash + 1);
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .list(dir, { limit: 1, search: name });
  if (error) return false;
  return (data ?? []).some((f) => f.name === name);
}
