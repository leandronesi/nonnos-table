"""SPRINT 1 v2 — Build di `data/positions.db`.

Legge i payload v1 in data/analysis/*.json + i PGN raw in data/raw/*.json,
estrae feature ricche con `feature_extract.py`, popola SQLite.

Idempotente: INSERT OR REPLACE per partita+ply, quindi rilanciarlo dopo nuove
partite o nuova analisi semplicemente aggiorna le righe esistenti.
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

from tqdm import tqdm

from config_loader import load_config
from feature_extract import (
    extract_positions_for_game,
    initial_clock_from_time_control,
)
from positions_db import connect, init_schema, insert_games, insert_positions

log = logging.getLogger("build_positions_db")


def _load_pgn_map(raw_dir: Path) -> dict[str, str]:
    """game_id → PGN testo, leggendo tutti i mesi raw."""
    out: dict[str, str] = {}
    for jf in sorted(raw_dir.glob("*.json")):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log.warning("skip %s: %s", jf, e)
            continue
        for g in data.get("games", []):
            gid = g.get("uuid") or g.get("url")
            if gid and g.get("pgn"):
                out[gid] = g["pgn"]
    return out


def _game_row(payload: dict[str, Any], n_critical: int) -> dict[str, Any]:
    idx = payload.get("index") or {}
    summ = (payload.get("analysis") or {}).get("summary") or {}
    counts = summ.get("counts") or {}
    return {
        "game_id": payload["game_id"],
        "url": idx.get("url"),
        "end_time_epoch": idx.get("end_time_epoch"),
        "date": _date_from_epoch(idx.get("end_time_epoch")),
        "time_class": idx.get("time_class"),
        "time_control": idx.get("time_control"),
        "rated": 1 if idx.get("rated") else 0,
        "my_color": idx.get("my_color"),
        "my_rating": idx.get("my_rating"),
        "opp_rating": idx.get("opp_rating"),
        "result": idx.get("result"),
        "eco": idx.get("eco"),
        "opening": idx.get("opening"),
        "num_moves": idx.get("num_moves"),
        "acpl": summ.get("acpl"),
        "n_blunders": counts.get("blunder", 0),
        "n_mistakes": counts.get("mistake", 0),
        "n_inaccuracies": counts.get("inaccuracy", 0),
        "n_critical_positions": n_critical,
        "initial_clock_sec": initial_clock_from_time_control(idx.get("time_control")),
    }


def _date_from_epoch(epoch: int | None) -> str | None:
    if not epoch:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")


def run(cfg: dict[str, Any]) -> None:
    paths = cfg["paths"]
    analysis_dir = Path(paths["analysis_dir"])
    raw_dir = Path(paths["raw_dir"])
    db_path = Path(paths.get("positions_db") or "data/positions.db")

    if not analysis_dir.exists():
        raise SystemExit(f"{analysis_dir} non esiste — lancia prima `python backend/analyze.py`.")

    pgn_map = _load_pgn_map(raw_dir)
    log.info("Caricati %d PGN raw", len(pgn_map))

    conn = connect(db_path)
    init_schema(conn)

    payload_files = sorted(analysis_dir.glob("*.json"))
    log.info("Trovati %d payload v1 da elaborare", len(payload_files))

    total_positions = 0
    total_critical = 0
    games_inserted = 0

    for pf in tqdm(payload_files, desc="Partite"):
        try:
            payload = json.loads(pf.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log.warning("skip %s: %s", pf, e)
            continue
        gid = payload.get("game_id")
        pgn = pgn_map.get(gid) or payload.get("pgn") or ""
        if not pgn:
            log.debug("PGN mancante per %s, skip", gid)
            continue

        rows = extract_positions_for_game(payload, pgn)
        if not rows:
            continue

        n_critical = sum(1 for r in rows if r["is_critical"])
        insert_positions(conn, rows)
        insert_games(conn, [_game_row(payload, n_critical)])
        conn.commit()

        total_positions += len(rows)
        total_critical += n_critical
        games_inserted += 1

    # quick stats
    cursor = conn.execute("SELECT COUNT(*) FROM positions")
    n_pos = cursor.fetchone()[0]
    cursor = conn.execute("SELECT COUNT(*) FROM positions WHERE is_critical=1")
    n_crit = cursor.fetchone()[0]
    cursor = conn.execute("SELECT COUNT(*) FROM games")
    n_games = cursor.fetchone()[0]
    cursor = conn.execute(
        "SELECT COUNT(*) FROM positions WHERE is_critical=1 AND clock_seconds IS NOT NULL"
    )
    n_with_clock = cursor.fetchone()[0]

    log.info(
        "DB %s: %d partite, %d posizioni (%d critiche), %d con dato orologio",
        db_path,
        n_games,
        n_pos,
        n_crit,
        n_with_clock,
    )
    conn.close()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    cfg = load_config()
    run(cfg)


if __name__ == "__main__":
    main()
