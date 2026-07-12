/**
 * Ingest browser-side: scarica le partite Chess.com per l'utente loggato, le
 * carica su Supabase Storage, indicizza ogni partita nella tabella `games`.
 *
 * Tier FREE: solo le ULTIME FREE_GAME_CAP partite della goal_time_class scelta
 * (rapid O blitz). Scorre gli archivi mensili dal più recente indietro e non
 * conta mai l'altra cadenza verso il cap.
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
import type { GameInsert, Color, Result, IngestJobRow, Json } from "../auth/db.types";
import { FREE_GAME_CAP, completedGameProgress } from "./config";
import type { AnalyzedTimeClass } from "./config";
import { classifyInsertOutcome } from "./ingestSemantics";
import { LeaseOwnershipLostError } from "./jobLease";

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

async function updateIngestJobRequired(
  jobId: string,
  leaseToken: string,
  patch: Partial<IngestJobRow>,
  code: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("patch_ingest_job_lease", {
    p_job_id: jobId,
    p_lease_token: leaseToken,
    p_patch: patch as unknown as Json,
  });
  if (error) throw new Error(`${code}:${error.message}`);
  if (data !== true) throw new LeaseOwnershipLostError();
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
  /** Unica cadenza inclusa nella quota free (rapid O blitz). */
  goalTimeClass: AnalyzedTimeClass;
  /** Cap di questo passaggio: 10 per la prima lettura, 100 per il corpus. */
  gameCap: number;
  /** Nel secondo passaggio conserva analyzing_rest per rendere il resume sicuro. */
  markJobFetching?: boolean;
  /** L'onboarding iniziale non puo' pubblicare un profilo senza partite. */
  requireAtLeastOne?: boolean;
  jobId: string;
  leaseToken: string;
  guardLease: () => Promise<void>;
  refreshAfter?: string; // ISO timestamp — se presente, modalità refresh (solo partite nuove)
  onProgress?: (p: IngestProgress) => void;
}): Promise<void> {
  const {
    userId,
    chessComUsername,
    goalTimeClass,
    gameCap: requestedGameCap,
    markJobFetching = true,
    requireAtLeastOne = false,
    jobId,
    leaseToken,
    guardLease,
    refreshAfter,
    onProgress,
  } = opts;
  if (!Number.isFinite(requestedGameCap) || requestedGameCap <= 0) {
    throw new Error(`invalid_ingest_game_cap:${requestedGameCap}`);
  }
  const gameCap = Math.min(FREE_GAME_CAP, Math.floor(requestedGameCap));
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

  // 1. Mark job started. Nel secondo passaggio non cambiare lo status:
  // analyzing_rest e' anche il checkpoint di resume dell'ingest di fondo.
  await guardLease();
  if (markJobFetching) {
    await updateIngestJobRequired(
      jobId,
      leaseToken,
      { status: "fetching" },
      "ingest_start_checkpoint_failed",
    );
  }

  // 2. List archives → scorri serialmente dal mese PIÙ RECENTE indietro,
  // fermandoti appena trovi gameCap partite della cadenza scelta.
  await guardLease();
  const archResp = await fetch(
    `https://api.chess.com/pub/player/${encodeURIComponent(chessComUsername)}/games/archives`
  );
  if (!archResp.ok) throw new Error(`Chess.com archives ${archResp.status}`);
  const { archives } = (await archResp.json()) as ChessComArchives;
  await guardLease();
  // Mesi più recenti per primi. Nessun limite temporale nascosto: un utente
  // poco attivo puo' richiedere archivi piu' vecchi per arrivare al cap.
  const recentArchives = archives.slice().reverse();

  // Durante la scansione il massimo noto e' gameCap; a fine scansione
  // games_total viene sostituito dal totale effettivamente trovato.
  await updateIngestJobRequired(
    jobId,
    leaseToken,
    { months_total: recentArchives.length, games_total: gameCap },
    "ingest_scan_checkpoint_failed",
  );
  await guardLease();

  let monthsDone = 0;
  let successfulArchiveFetches = 0;
  let selectedGamesSeen = 0;

  const assertRequiredCorpus = (indexedGames: number): void => {
    if (recentArchives.length > 0 && successfulArchiveFetches === 0) {
      throw new Error("archive_fetch_failed_all");
    }
    if (!requireAtLeastOne || indexedGames > 0) return;
    if (selectedGamesSeen > 0) {
      throw new Error("games_index_failed_for_goal_time_class");
    }
    throw new Error("no_games_found_for_goal_time_class");
  };

  if (isRefresh) {
    // ---- MODALITÀ REFRESH: scarica SOLO le partite più nuove di refreshAfter ----
    // Le partite gia' presenti nel delta contano: cosi' retry e secondo passaggio
    // riprendono lo stesso insieme senza superare il cap complessivo.
    let newGames = 0;
    let done = false;

    for (const archUrl of recentArchives) {
      if (done || newGames >= gameCap) break;
      const m = archUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
      const yearMonth = m ? `${m[1]}-${m[2]}` : "unknown";

      await guardLease();
      const monResp = await fetch(archUrl);
      await guardLease();
      if (!monResp.ok) {
        monthsDone++;
        await updateIngestJobRequired(
          jobId,
          leaseToken,
          { months_done: monthsDone },
          "ingest_month_checkpoint_failed",
        );
        continue;
      }
      successfulArchiveFetches++;
      const mon = (await monResp.json()) as ChessComMonth;
      // Più recenti per prime.
      const monthGames = (mon.games ?? []).slice().reverse();

      for (const g of monthGames) {
        if (newGames >= gameCap) { done = true; break; }

        const gameMs = g.end_time * 1000;
        if (gameMs <= refreshAfterMs) {
          // Partita più vecchia o uguale a refreshAfter → tutte le seguenti lo sono → esci.
          done = true;
          break;
        }

        // La quota appartiene a UNA sola cadenza scelta. Le altre non contano
        // verso il cap e non vengono persistite da questo run.
        if (g.time_class !== goalTimeClass) continue;
        selectedGamesSeen++;

        const uuid = chessComUuidFromUrl(g.url);
        // Salta se già presente (senza contarla verso il cap).
        const { data: existing } = await supabase
          .from("games")
          .select("id")
          .eq("user_id", userId)
          .eq("chess_com_uuid", uuid)
          .maybeSingle();
        if (existing) {
          newGames++;
          update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: gameCap, gamesDone: newGames });
          continue;
        }

        // Upload PGN su Storage.
        const path = pgnPath(userId, yearMonth, uuid);
        await guardLease();
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, new Blob([g.pgn], { type: "application/x-chess-pgn" }), {
            upsert: true,
            contentType: "application/x-chess-pgn",
          });
        await guardLease();
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
        await guardLease();
        const { error: insErr } = await supabase.from("games").insert(row);
        await guardLease();
        const insertOutcome = classifyInsertOutcome(insErr);
        if (insertOutcome === "failed") {
          // Non dichiarare la quota piena con una riga assente. Rimuove anche il
          // PGN appena caricato per non lasciare un orfano best-effort.
          console.warn("[ingest] insert error", uuid, insErr?.message ?? "unknown");
          const { error: cleanupErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([path]);
          if (cleanupErr) console.warn("[ingest] orphan PGN cleanup failed", uuid);
          continue;
        }
        newGames++;

        await updateIngestJobRequired(
          jobId,
          leaseToken,
          { games_done: newGames },
          "ingest_game_checkpoint_failed",
        );
        update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: gameCap, gamesDone: newGames });
      }
      monthsDone++;
      await updateIngestJobRequired(
        jobId,
        leaseToken,
        { months_done: monthsDone, games_done: newGames },
        "ingest_month_checkpoint_failed",
      );
    }

    assertRequiredCorpus(newGames);
    const completed = completedGameProgress(newGames, gameCap);
    await guardLease();
    await updateIngestJobRequired(
      jobId,
      leaseToken,
      {
        months_done: monthsDone,
        games_total: completed.gamesTotal,
        games_done: completed.gamesDone,
      },
      "ingest_final_checkpoint_failed",
    );
    update({
      status: "done",
      monthsTotal: recentArchives.length,
      monthsDone,
      ...completed,
    });
  } else {
    // ---- MODALITÀ NORMALE (onboarding): le prime FREE_GAME_CAP partite recenti ----
    // Idempotente: le esistenti contano verso il cap (comportamento originale).
    let indexed = 0; // partite considerate verso il cap (esistenti o nuove)

    for (const archUrl of recentArchives) {
      if (indexed >= gameCap) break;
      const m = archUrl.match(/\/(\d{4})\/(\d{2})\/?$/);
      const yearMonth = m ? `${m[1]}-${m[2]}` : "unknown";

      await guardLease();
      const monResp = await fetch(archUrl);
      await guardLease();
      if (!monResp.ok) {
        monthsDone++;
        await updateIngestJobRequired(
          jobId,
          leaseToken,
          { months_done: monthsDone },
          "ingest_month_checkpoint_failed",
        );
        continue;
      }
      successfulArchiveFetches++;
      const mon = (await monResp.json()) as ChessComMonth;
      const monthGames = (mon.games ?? []).slice().reverse();

      for (const g of monthGames) {
        if (indexed >= gameCap) break;

        // Rapid e blitz non vanno mescolati: conta solo la goal_time_class.
        if (g.time_class !== goalTimeClass) continue;
        selectedGamesSeen++;

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
          update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: gameCap, gamesDone: indexed });
          continue;
        }

        // Upload PGN su Storage.
        const path = pgnPath(userId, yearMonth, uuid);
        await guardLease();
        const { error: upErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(path, new Blob([g.pgn], { type: "application/x-chess-pgn" }), {
            upsert: true,
            contentType: "application/x-chess-pgn",
          });
        await guardLease();
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
        await guardLease();
        const { error: insErr } = await supabase.from("games").insert(row);
        await guardLease();
        const insertOutcome = classifyInsertOutcome(insErr);
        if (insertOutcome === "failed") {
          console.warn("[ingest] insert error", uuid, insErr?.message ?? "unknown");
          const { error: cleanupErr } = await supabase.storage
            .from(STORAGE_BUCKET)
            .remove([path]);
          if (cleanupErr) console.warn("[ingest] orphan PGN cleanup failed", uuid);
          continue;
        }
        indexed++;

        await updateIngestJobRequired(
          jobId,
          leaseToken,
          { games_done: indexed },
          "ingest_game_checkpoint_failed",
        );
        update({ status: "fetching", monthsTotal: recentArchives.length, monthsDone, gamesTotal: gameCap, gamesDone: indexed });
      }
      monthsDone++;
      await updateIngestJobRequired(
        jobId,
        leaseToken,
        { months_done: monthsDone, games_done: indexed },
        "ingest_month_checkpoint_failed",
      );
    }

    assertRequiredCorpus(indexed);
    const completed = completedGameProgress(indexed, gameCap);
    await updateIngestJobRequired(
      jobId,
      leaseToken,
      {
        months_done: monthsDone,
        games_total: completed.gamesTotal,
        games_done: completed.gamesDone,
      },
      "ingest_final_checkpoint_failed",
    );
    await guardLease();
    update({
      status: "done",
      monthsTotal: recentArchives.length,
      monthsDone,
      ...completed,
    });
  }
  await guardLease();
}
