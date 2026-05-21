"""SPRINT 2 v2 — Inferenza Maia per arricchire positions.db.

Per ogni posizione CRITICA, chiede a Maia@mio_rating e a Maia@target_rating
cosa avrebbero giocato loro. Risultato in colonne dedicate del DB.

Decisioni:
  - Maia gira via lc0 (Leela Chess Zero) con i pesi `maia-XXX.pb.gz`.
  - Pesi a passi di 100: scelgo i due più vicini al mio livello e al target.
  - Inferenza policy-only (nodes=1, multipv=1) → molto veloce (~60ms/posizione).
  - Filtro: SOLO posizioni con is_critical=1 (3937 su 15868 nelle nostre 458 partite).
  - Idempotenza: skippa le righe già arricchite (best_san_maia_mine NOT NULL).

Output, per ogni posizione critica arricchita:
  best_san_maia_mine    — mossa che giocherebbe un giocatore del mio livello
  best_san_maia_target  — mossa che giocherebbe il livello a cui voglio arrivare
  (move_difficulty + p_maia_*_top arrivano in uno sprint successivo quando
   estrarremo la policy via VerboseMoveStats)

Cosa permette questo: distinguere "errore alla mia portata" da "errore che
neanche un giocatore del mio target avrebbe evitato facilmente". È il salto
chiave §1.1 della SPEC v2.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import chess
import chess.engine
from tqdm import tqdm

from config_loader import load_config
from positions_db import connect

log = logging.getLogger("maia")

# Pesi Maia disponibili (passo 100, da 1100 a 1900). Maiachess.com / CSSLab.
_AVAILABLE_MAIA = (1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900)


def nearest_maia(rating: int) -> int:
    return min(_AVAILABLE_MAIA, key=lambda x: abs(x - rating))


# ---------------------------------------------------------------------------
# Engine context manager
# ---------------------------------------------------------------------------


@contextmanager
def maia_engine(lc0_path: Path, weights_path: Path, threads: int = 1) -> Iterator[chess.engine.SimpleEngine]:
    """Apri lc0 con un peso Maia; chiudilo a fine blocco."""
    if not lc0_path.exists():
        raise FileNotFoundError(f"lc0 non trovato: {lc0_path}")
    if not weights_path.exists():
        raise FileNotFoundError(f"peso Maia non trovato: {weights_path}")

    eng = chess.engine.SimpleEngine.popen_uci(
        [
            str(lc0_path),
            "--backend=eigen",
            f"--weights={weights_path}",
            f"--threads={threads}",
        ],
        timeout=30,
    )
    try:
        yield eng
    finally:
        try:
            eng.quit()
        except Exception:  # noqa: BLE001
            pass


def ask_maia(eng: chess.engine.SimpleEngine, fen: str) -> str | None:
    """Chiedi a un'istanza Maia cosa giocherebbe in `fen`. Ritorna il SAN o None."""
    try:
        board = chess.Board(fen)
    except ValueError:
        return None
    if board.is_game_over():
        return None
    try:
        info = eng.analyse(board, chess.engine.Limit(nodes=1))
        pv = info.get("pv") or []
        if not pv:
            return None
        move = pv[0]
        if move not in board.legal_moves:
            return None
        return board.san(move)
    except (chess.engine.EngineError, chess.engine.EngineTerminatedError, BrokenPipeError) as e:
        log.debug("maia analyse fail: %s", e)
        return None


# ---------------------------------------------------------------------------
# Pipeline: enrich positions.db
# ---------------------------------------------------------------------------


def _positions_to_enrich(conn: sqlite3.Connection, force: bool) -> list[sqlite3.Row]:
    if force:
        sql = "SELECT game_id, ply, fen_before FROM positions WHERE is_critical=1"
    else:
        sql = (
            "SELECT game_id, ply, fen_before FROM positions "
            "WHERE is_critical=1 AND (best_san_maia_mine IS NULL OR best_san_maia_target IS NULL)"
        )
    return list(conn.execute(sql))


def enrich(
    db_path: Path,
    lc0_path: Path,
    weights_mine: Path,
    weights_target: Path,
    *,
    force: bool = False,
    limit: int | None = None,
) -> dict[str, int]:
    conn = connect(db_path)
    rows = _positions_to_enrich(conn, force=force)
    if limit:
        rows = rows[:limit]
    log.info("Posizioni critiche da arricchire: %d", len(rows))
    if not rows:
        return {"enriched": 0, "total": 0}

    log.info("Avvio engine: mine=%s target=%s", weights_mine.name, weights_target.name)
    enriched = 0
    with maia_engine(lc0_path, weights_mine) as eng_mine, maia_engine(lc0_path, weights_target) as eng_target:
        # Riusiamo la stessa istanza per tutte le posizioni → niente fork-bomb
        for r in tqdm(rows, desc="Maia", unit="pos"):
            fen = r["fen_before"]
            san_mine = ask_maia(eng_mine, fen)
            san_target = ask_maia(eng_target, fen)
            conn.execute(
                "UPDATE positions SET best_san_maia_mine=?, best_san_maia_target=? "
                "WHERE game_id=? AND ply=?",
                (san_mine, san_target, r["game_id"], r["ply"]),
            )
            enriched += 1
            if enriched % 200 == 0:
                conn.commit()
        conn.commit()

    log.info("Maia: arricchite %d posizioni critiche", enriched)
    conn.close()
    return {"enriched": enriched, "total": len(rows)}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("--mine", type=int, default=None, help="Rating per Maia 'mio livello'. Default: dal player corrente.")
    parser.add_argument("--target", type=int, default=1600, help="Rating per Maia 'target' (default 1600)")
    parser.add_argument("--force", action="store_true", help="ri-elabora anche posizioni già arricchite")
    parser.add_argument("--limit", type=int, default=None, help="limita a N posizioni (smoke test)")
    args = parser.parse_args()

    cfg = load_config()
    repo_root = Path(__file__).resolve().parent.parent
    lc0_dir = repo_root / "engine" / "lc0"
    # Auto-detect binario: lc0.exe (Windows), lc0 (Linux/macOS)
    explicit = cfg.get("maia", {}).get("lc0_path")
    if explicit:
        lc0_path = Path(explicit)
    elif (lc0_dir / "lc0.exe").exists():
        lc0_path = lc0_dir / "lc0.exe"
    elif (lc0_dir / "lc0").exists():
        lc0_path = lc0_dir / "lc0"
    else:
        lc0_path = lc0_dir / "lc0"  # fallback per messaggio d'errore chiaro
    maia_dir = Path(cfg.get("maia", {}).get("weights_dir") or repo_root / "engine" / "maia")

    db_path = Path(cfg["paths"].get("positions_db", "data/positions.db"))
    if not db_path.is_absolute():
        db_path = repo_root / db_path

    # Determina il rating "mio" dal DB se non specificato
    mine_rating = args.mine
    if mine_rating is None:
        conn = connect(db_path)
        target_tc = cfg.get("goal", {}).get("time_class") or "blitz"
        row = conn.execute(
            "SELECT my_rating FROM positions WHERE time_class=? AND my_rating IS NOT NULL "
            "ORDER BY end_time_epoch DESC LIMIT 1",
            (target_tc,),
        ).fetchone()
        conn.close()
        mine_rating = row["my_rating"] if row else 1200
        log.info("Rating 'mio' auto-rilevato (%s): %d", target_tc, mine_rating)

    mine_w = nearest_maia(mine_rating)
    target_w = nearest_maia(args.target)
    weights_mine = maia_dir / f"maia-{mine_w}.pb.gz"
    weights_target = maia_dir / f"maia-{target_w}.pb.gz"
    log.info("Pesi: mio=maia-%d, target=maia-%d", mine_w, target_w)

    stats = enrich(
        db_path, lc0_path, weights_mine, weights_target,
        force=args.force, limit=args.limit,
    )
    print(stats)


if __name__ == "__main__":
    main()
