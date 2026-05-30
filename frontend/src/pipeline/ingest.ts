/**
 * Ingest browser-side: scarica le partite Chess.com per l'utente loggato, le
 * carica su Supabase Storage, indicizza ogni partita nella tabella `games`.
 *
 * Tier FREE: solo le ULTIME FREE_GAME_CAP partite (le più recenti). Scorre gli
 * archivi mensili dal più recente indietro e si ferma al cap — così non scarica
 * migliaia di partite (un utente attivo ne ha ~1500 in 6 mesi).
 *
 * Idempotente: se una partita esiste già in `games`, salta (ma conta verso il cap).
 * Resumable: lo stato è in `ingest_jobs.months_done` / `games_done`.
 *
 * Riferimento Chess.com API:
 *   GET /pub/player/{u}/games/archives  → lista URL mensili
 *   GET /pub/player/{u}/games/{YYYY}/{MM} → JSON con array `games[]`
 *
 * Ogni game ha: url, pgn, time_class, time_control, white{username,rating},
 * black{username,rating}, end_time (epoch s).
 */

import { supabase } from "../auth/supabaseClient";
import { pgnPath } from "../auth/storage";
import { STORAGE_BUCKET } from "../auth/supabaseClient";
import type { GameInsert, Color, Result } from "../auth/db.types";
import { FREE_GAME_CAP } from "./config";

const MONTHS_TO_PULL = 6;

interface ChessComArchives {
  archives: string[];
}

interface ChessComGameRaw {
  url: string;
  pgn: string;
  time_class: string;
  time_control: string;
  end_time: number;
  rated: boolean;
  rules: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
}

interface ChessComMonth {
  games: ChessComGameRaw[];
}

function chessComUuidFromUrl(url: string): string {
  // es. https://www.chess.com/game/live/12345678 → 12345678
  const m = url.match(/\/(\d+)\/?$/);
  return m ? m[1] : url;
}

function determineColorAndResult(
  game: ChessComGameRaw,
  username: string
): { color: Color; result: Result } {
  const isWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const myResult = isWhite ? game.white.result : game.black.result;
  let result: Result;
  if (myResult === "win") result = "win";
  else if (myResult === "agreed" || myResult === "stalemate" || myResult === "repetition" || myResult === "insufficient" || myResult === "50move" || myResult === "timevsinsufficient") {
    result = "draw";
  } else {
    result = "loss";
  }
  return { color: isWhite ? "white" : "black", result };
}

interface IngestProgress {
  status: "fetching" | "done" | "error";
  monthsTotal: number;
  monthsDone: number;
  gamesTotal: number;
  gamesDone: number;
  error?: string;
}

export async function runIngest(opts: {
  userId: string;
  chessComUsername: string;
  jobId: string;
  refreshAfter?: string; // ISO timestamp — se presente, modalità refresh (solo partite nuove)
  onProgress?: (p: IngestProgress) => void;
}): Promise<void> {
  const { userId, chessComUsername, jobId, refreshAfter, onProgress } = opts;
  const isRefresh = refreshAfter !== undefined;
  // Epoch ms corrispondente a refreshAfter (0 se assente = nessun filtro).
  const refreshAfterMs = isRefresh ? Date.parse(refreshAfter!) : 0;

  const update = (patch: Partial<IngestProgress> & Pick<IngestProgress, "status">) =>
    onProgress?.({
      monthsTotal: 0,
      monthsDone: 0,
      gamesTotal: 0,
      gamesDone: 0,
      ...patch,
    });

  // 1. Mark job started.
  await supabase
    .from("ingest_jobs")
    .update({ status: "fetching", started_at: new Date().toISOString() })
    .eq("id", jobId);

  // 2. List archives → scorri dal mese PIÙ RECENTE indietro, fermandoti al cap.
  const archResp = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(chessComUsername)}/games/archives`
  );
  if (!archResp.ok) throw new Error(`Chess.com archives ${archResp.status}`);
  const { archives } = (await archResp.json()) as ChessComArchives;
  // Mesi più recenti per primi; non scorriamo oltre MONTHS_TO_PULL mesi.
  const recentArchives = archives.slice(-MONTHS_TO_PULL).reverse();

  // Tier free: solo le ULTIME FREE_GAME_CAP partite. Un utente attivo ha
  // centinaia/migliaia di partite in 6 mesi; per estrarre valore ne bastano
  // poche e recenti. Il progress mostra avanzamento su FREE_GAME_CAP.
  await supabase
    .from("ingest_jobs")
    .update({ months_total: recentArchives.length, games_total: FREE_GAME_CAP })
    .eq("id", jobId);

  let monthsDone = 0;

  if (isRefresh) {
    // ---- MODALITÀ REFRESH: scarica SOLO le partite più nuove di refreshAfter ----
    // Non contiamo le esistenti verso il cap; ci fermiamo su FREE_GAME_CAP nuove.
    let newGames = 0;
    let done = false;

    for (const archUrl of recentArchives) {
      if (done || newGames >= FREE_GAME_CAP) break;
      const m = archUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
      const yearMonth = m ? `${m[1]}-${m[2]}` : "unknown";

      const monResp = await fetch(archUrl);
      if (!monResp.ok) {
        monthsDone++;
        await supabase.from("ingest_jobs").update({ months_done: monthsDone }).eq("id", jobId);
        continue;
      }
      const mon = (await monResp.json()) as ChessComMonth;
      // Più recenti per prime.
      const monthGames = (mon.games ?? []).slice().reverse();

      for (const g of monthGames) {
        if (newGames >= FREE_GAME_CAP) { done = true; break; }

        const gameMs = g.end_time * 1000;
        if (gameMs <= refreshAfterMs) {
          // Partita più vecchia o uguale a refreshAfter → tutte le seguenti lo sono → esci.
          done = true;
          break;
        }

        const uuid = chessComUuidFromUrl(g.url);
        // Salta se già presente (senza contarla verso il cap).
        const { data: existing } = await supabase
          .from("games")
          .select("id")
          .eq("user_id", userId)
          .eq("chess_com_uuid", uuid)
          .maybeSingle();
        if (existing) continue;

        // Upload PGN su Storage.
        const path = pgnPath(userId, yearMonth, uuid);
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, new Blob([g.pgn], { type: "application/x-chess-pgn" }), {
            upsert: true,
            contentType: "application/x-chess-pgn",
          });
        if (upErr) {
          // eslint-disable-next-line no-console
          console.warn("[ingest] upload error", uuid, upErr.message);
          continue;
        }

        const { color, result } = determineColorAndResult(g, chessComUsername);
        const row: GameInsert = {
          user_id: userId,
          chess_com_uuid: uuid,
          played_at: new Date(gameMs).toISOString(),
          time_class: g.time_class,
          time_control: g.time_control ?? null,
          color,
          result,
          player_rating: color === "white" ? g.white.rating : g.black.rating,
          opponent_rating: color === "white" ? g.black.rating : g.white.rating,
          pgn_path: path,
          analysis_status: "pending",
        };
        const { error: insErr } = await supabase.from("games").insert(row);
        if (insErr && !/duplicate key|unique/i.test(insErr.message)) {
          // eslint-disable-next-line no-console
          console.warn("[ingest] insert error", uuid, insErr.message);
        }
        newGames++;

        await supabase.from("ingest_jobs").update({ games_done: newGames }).eq("id", jobId);
        update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: FREE_GAME_CAP, gamesDone: newGames });
      }
      monthsDone++;
      await supabase
        .from("ingest_jobs")
        .update({ months_done: monthsDone, games_done: newGames })
        .eq("id", jobId);
    }

    update({
      status: "done",
      monthsTotal: recentArchives.length,
      monthsDone,
      gamesTotal: FREE_GAME_CAP,
      gamesDone: newGames,
    });
  } else {
    // ---- MODALITÀ NORMALE (onboarding): le prime FREE_GAME_CAP partite recenti ----
    // Idempotente: le esistenti contano verso il cap (comportamento originale).
    let indexed = 0; // partite considerate verso il cap (esistenti o nuove)

    for (const archUrl of recentArchives) {
      if (indexed >= FREE_GAME_CAP) break;
      const m = archUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
      const yearMonth = m ? `${m[1]}-${m[2]}` : "unknown";

      const monResp = await fetch(archUrl);
      if (!monResp.ok) {
        monthsDone++;
        await supabase.from("ingest_jobs").update({ months_done: monthsDone }).eq("id", jobId);
        continue;
      }
      const mon = (await monResp.json()) as ChessComMonth;
      const monthGames = (mon.games ?? []).slice().reverse();

      for (const g of monthGames) {
        if (indexed >= FREE_GAME_CAP) break;
        const uuid = chessComUuidFromUrl(g.url);
        // Skip se già presente (conta verso il cap).
        const { data: existing } = await supabase
          .from("games")
          .select("id")
          .eq("user_id", userId)
          .eq("chess_com_uuid", uuid)
          .maybeSingle();
        if (existing) {
          indexed++;
          update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: FREE_GAME_CAP, gamesDone: indexed });
          continue;
        }

        // Upload PGN su Storage.
        const path = pgnPath(userId, yearMonth, uuid);
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, new Blob([g.pgn], { type: "application/x-chess-pgn" }), {
            upsert: true,
            contentType: "application/x-chess-pgn",
          });
        if (upErr) {
          // eslint-disable-next-line no-console
          console.warn("[ingest] upload error", uuid, upErr.message);
          continue;
        }

        const { color, result } = determineColorAndResult(g, chessComUsername);
        const row: GameInsert = {
          user_id: userId,
          chess_com_uuid: uuid,
          played_at: new Date(g.end_time * 1000).toISOString(),
          time_class: g.time_class,
          time_control: g.time_control ?? null,
          color,
          result,
          player_rating: color === "white" ? g.white.rating : g.black.rating,
          opponent_rating: color === "white" ? g.black.rating : g.white.rating,
          pgn_path: path,
          analysis_status: "pending",
        };
        const { error: insErr } = await supabase.from("games").insert(row);
        if (insErr && !/duplicate key|unique/i.test(insErr.message)) {
          // eslint-disable-next-line no-console
          console.warn("[ingest] insert error", uuid, insErr.message);
        }
        indexed++;

        await supabase.from("ingest_jobs").update({ games_done: indexed }).eq("id", jobId);
        update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: FREE_GAME_CAP, gamesDone: indexed });
      }
      monthsDone++;
      await supabase
        .from("ingest_jobs")
        .update({ months_done: monthsDone, games_done: indexed })
        .eq("id", jobId);
    }

    update({
      status: "done",
      monthsTotal: recentArchives.length,
      monthsDone,
      gamesTotal: FREE_GAME_CAP,
      gamesDone: indexed,
    });
  }
}
