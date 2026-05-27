"""Calcola `waiting_moves` per le posizioni in cui la mossa giusta e` oggettivamente
troppo difficile per il giocatore (p_maia_mine_top < 0.20) e la posizione non
e` forzante.

Usa Stockfish multi-PV (go depth N multipv 5) per trovare 2-3 alternative con
cp_loss < 50 che non aprono complicazioni (no cattura, no scacco, no promozione).

Filtri applicati:
  - Solo posizioni con priority_score >= 2 (drill/turning_point), non tutte le 3937.
  - Solo se p_maia_mine_top < 0.20.
  - Risultato scritto nella colonna `waiting_moves` (JSON TEXT) in positions.

Idempotente: salta le righe gia` popolate (waiting_moves IS NOT NULL), salvo
--recompute per forzare il ricalcolo.

Eseguire DOPO aver installato Stockfish:
  python backend/compute_waiting_moves.py
  python backend/compute_waiting_moves.py --recompute   # forza ricalcolo
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

import chess
import chess.engine

from config_loader import load_config, resolve_stockfish_path
from positions_db import connect

log = logging.getLogger("compute_waiting_moves")

MULTIPV = 5
DEPTH = 14          # Profondita` ragionevole; non troppo alta per non rallentare
CP_LOSS_MAX = 50    # Soglia massima cp_loss per una "mossa di attesa"
MAX_WAITING_MOVES = 3


def _is_forcing(san: str) -> bool:
    """True se la mossa e` forzante: cattura (x), scacco (+/# ), promozione (=)."""
    return "x" in san or "+" in san or "#" in san or "=" in san


def compute_for_fen(
    board: chess.Board,
    engine: chess.engine.SimpleEngine,
    best_cp_white: int,  # eval white cp per la mossa migliore (best_san_sf)
    my_is_white: bool,
) -> list[dict[str, str | int]] | None:
    """Ritorna lista di mosse di attesa oppure None se non ce ne sono.

    best_cp_white: centipawn (dal POV bianco) della posizione DOPO la mossa Stockfish-best.
    Usiamo questa come baseline: un'alternativa e` "di attesa" se la sua valutazione
    post-mossa non peggiora di piu` di CP_LOSS_MAX rispetto alla best.
    """
    try:
        infos = engine.analyse(board, chess.engine.Limit(depth=DEPTH), multipv=MULTIPV)
    except Exception as e:  # noqa: BLE001
        log.warning("Stockfish multi-PV error: %s", e)
        return None

    if not infos:
        return None

    # Baseline: eval della mossa migliore (infos[0])
    def _cp(info: dict) -> int | None:
        score = info.get("score")
        if score is None:
            return None
        white_score = score.white()
        if white_score.is_mate():
            m = white_score.mate() or 0
            return 1000 if m > 0 else -1000
        cp = white_score.score()
        return cp

    baseline_cp = _cp(infos[0])
    if baseline_cp is None:
        return None

    waiting: list[dict[str, str | int]] = []
    for info in infos[1:]:  # Salta la prima (= mossa migliore Stockfish)
        pv = info.get("pv") or []
        if not pv:
            continue
        move = pv[0]
        if move not in board.legal_moves:
            continue
        san = board.san(move)

        # Salta mosse forzanti
        if _is_forcing(san):
            continue

        alt_cp = _cp(info)
        if alt_cp is None:
            continue

        # cp_loss dal POV del giocatore: quanto perdiamo rispetto alla best
        if my_is_white:
            cp_loss = max(0, baseline_cp - alt_cp)
        else:
            cp_loss = max(0, alt_cp - baseline_cp)  # per nero: best = piu` negativo

        if cp_loss <= CP_LOSS_MAX:
            waiting.append({"san": san, "cp_loss": cp_loss})
        if len(waiting) >= MAX_WAITING_MOVES:
            break

    return waiting if waiting else None


def run(db_path: Path, sf_path: str, *, recompute: bool = False) -> None:
    conn = connect(db_path)

    # Ensure column exists (migration)
    existing_cols = {r["name"] for r in conn.execute("PRAGMA table_info(positions)")}
    if "waiting_moves" not in existing_cols:
        conn.execute("ALTER TABLE positions ADD COLUMN waiting_moves TEXT")
        conn.commit()
        log.info("Aggiunta colonna waiting_moves a positions")

    # Posizioni candidate: priority_score >= 2 AND p_maia_mine_top < 0.20
    # priority_score >= 2 = avoidable_at_my_level=1 OR p_target_plays_best_sf>0.40
    filter_already = "" if recompute else "AND p.waiting_moves IS NULL"
    candidates = [
        dict(r) for r in conn.execute(f"""
            SELECT p.game_id, p.ply, p.fen_before, p.best_san_sf,
                   p.my_color, p.cp_before
            FROM positions p
            WHERE p.p_maia_mine_top < 0.20
              AND p.is_critical = 1
              AND p.fen_before IS NOT NULL
              AND (p.avoidable_at_my_level = 1
                   OR (p.p_target_plays_best_sf > 0.40
                       AND (p.p_target_plays_best_sf - COALESCE(p.p_mine_plays_best_sf,0)) > 0.15)
                   OR p.is_turning_point = 1)
              {filter_already}
        """)
    ]
    log.info("Candidate per waiting_moves: %d (recompute=%s)", len(candidates), recompute)
    if not candidates:
        log.info("Niente da calcolare.")
        conn.close()
        return

    engine = chess.engine.SimpleEngine.popen_uci(sf_path)
    log.info("Stockfish avviato: %s", sf_path)

    updated = 0
    null_count = 0
    try:
        for c in candidates:
            try:
                board = chess.Board(c["fen_before"])
            except Exception as e:  # noqa: BLE001
                log.debug("FEN invalido per %s/%s: %s", c["game_id"], c["ply"], e)
                continue

            my_is_white = c["my_color"] == "white"

            # Ottieni eval della mossa migliore (best_san_sf) per la baseline
            if c.get("best_san_sf"):
                try:
                    info_best = engine.analyse(board, chess.engine.Limit(depth=DEPTH))
                    score = info_best.get("score")
                    best_cp_white: int
                    if score:
                        ws = score.white()
                        if ws.is_mate():
                            best_cp_white = 1000 if (ws.mate() or 0) > 0 else -1000
                        else:
                            best_cp_white = ws.score() or 0
                    else:
                        best_cp_white = 0
                except Exception:  # noqa: BLE001
                    best_cp_white = 0
            else:
                best_cp_white = 0

            waiting = compute_for_fen(board, engine, best_cp_white, my_is_white)

            wm_json = json.dumps(waiting, ensure_ascii=False) if waiting else None
            conn.execute(
                "UPDATE positions SET waiting_moves=? WHERE game_id=? AND ply=?",
                (wm_json, c["game_id"], c["ply"]),
            )
            if waiting:
                updated += 1
            else:
                null_count += 1
    finally:
        engine.quit()
        conn.commit()
        conn.close()

    log.info(
        "waiting_moves calcolate: %d con mosse, %d NULL (forzanti/nessuna idonea)",
        updated,
        null_count,
    )


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    parser = argparse.ArgumentParser(description="Calcola waiting_moves via Stockfish multi-PV")
    parser.add_argument("--recompute", action="store_true", help="Ricalcola anche righe gia` popolate")
    args = parser.parse_args()

    cfg = load_config()
    repo_root = Path(__file__).resolve().parent.parent
    db_path = Path(cfg["paths"].get("positions_db", "data/positions.db"))
    if not db_path.is_absolute():
        db_path = repo_root / db_path

    sf_path = resolve_stockfish_path(cfg)
    run(db_path, str(sf_path), recompute=args.recompute)


if __name__ == "__main__":
    main()
