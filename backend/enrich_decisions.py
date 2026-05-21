"""SPRINT 3 v2 — Conversion rate, Save rate, Turning points.

A livello PARTITA aggiunge nella tabella `games`:
  - reached_winning   : 1 se in un certo punto sono arrivato a >= +200 cp
  - reached_losing    : 1 se sono arrivato a <= -200 cp
  - converted_winning : 1 se reached_winning=1 AND result='win'
  - saved_losing      : 1 se reached_losing=1 AND result in ('win','draw')
  - first_winning_ply : ply in cui ho raggiunto per la prima volta vantaggio decisivo
  - first_losing_ply

A livello POSIZIONE aggiunge:
  - is_turning_point  : 1 se è una delle top-3 posizioni della partita per
                        |swing| di valutazione (in posizione critica)
  - swing_cp          : cp_loss firmato (sempre >=0 dal POV del MIO POV-loss)

Idempotente.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from config_loader import load_config
from positions_db import connect

log = logging.getLogger("enrich_decisions")

GAME_COLS_TO_ADD = [
    ("reached_winning", "INTEGER"),
    ("reached_losing", "INTEGER"),
    ("converted_winning", "INTEGER"),
    ("saved_losing", "INTEGER"),
    ("first_winning_ply", "INTEGER"),
    ("first_losing_ply", "INTEGER"),
]

POS_COLS_TO_ADD = [
    ("is_turning_point", "INTEGER"),
    ("swing_cp", "INTEGER"),
]

WINNING_CP = 200
LOSING_CP = -200


def _ensure_cols(conn, table: str, cols: list[tuple[str, str]]) -> None:
    existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
    for name, typ in cols:
        if name not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {typ}")
            log.info("ALTER TABLE %s ADD COLUMN %s %s", table, name, typ)
    conn.commit()


def run(db_path: Path) -> dict[str, int]:
    conn = connect(db_path)
    _ensure_cols(conn, "games", GAME_COLS_TO_ADD)
    _ensure_cols(conn, "positions", POS_COLS_TO_ADD)

    # 1. swing_cp: copy of cp_loss (renamed for semantica più chiara, e per eventuali
    #    future firme negative quando un avversario fa errore in mio favore).
    conn.execute("UPDATE positions SET swing_cp = cp_loss")
    conn.commit()

    # 2. reached_winning / reached_losing per ogni partita
    #    Una partita ha reached_winning=1 se IN UN PUNTO la valutazione DOPO la mia
    #    mossa o PRIMA della prossima è >= WINNING_CP. Usiamo MAX/MIN su cp_after.
    conn.execute(f"""
        UPDATE games SET
            reached_winning = (
                SELECT CASE WHEN MAX(p.cp_after) >= {WINNING_CP} THEN 1 ELSE 0 END
                FROM positions p WHERE p.game_id = games.game_id
            ),
            reached_losing = (
                SELECT CASE WHEN MIN(p.cp_after) <= {LOSING_CP} THEN 1 ELSE 0 END
                FROM positions p WHERE p.game_id = games.game_id
            )
    """)
    conn.execute(f"""
        UPDATE games SET
            first_winning_ply = (
                SELECT MIN(p.ply) FROM positions p
                WHERE p.game_id = games.game_id AND p.cp_after >= {WINNING_CP}
            ),
            first_losing_ply = (
                SELECT MIN(p.ply) FROM positions p
                WHERE p.game_id = games.game_id AND p.cp_after <= {LOSING_CP}
            )
    """)
    conn.execute("""
        UPDATE games SET
            converted_winning = CASE
                WHEN reached_winning = 1 AND result = 'win' THEN 1
                WHEN reached_winning = 1 THEN 0
                ELSE NULL END,
            saved_losing = CASE
                WHEN reached_losing = 1 AND result IN ('win', 'draw') THEN 1
                WHEN reached_losing = 1 THEN 0
                ELSE NULL END
    """)
    conn.commit()

    # 3. turning points: per ogni partita, le top-3 posizioni CRITICHE per swing_cp
    #    diventano turning_point=1. Tutte le altre 0.
    conn.execute("UPDATE positions SET is_turning_point = 0")
    conn.execute("""
        WITH ranked AS (
            SELECT game_id, ply,
                   ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY swing_cp DESC) AS rk
            FROM positions
            WHERE is_critical = 1 AND swing_cp >= 100
        )
        UPDATE positions
        SET is_turning_point = 1
        WHERE EXISTS (
            SELECT 1 FROM ranked
            WHERE ranked.game_id = positions.game_id
              AND ranked.ply = positions.ply
              AND ranked.rk <= 3
        )
    """)
    conn.commit()

    stats: dict[str, int] = {}
    for q, k in [
        ("SELECT COUNT(*) FROM games", "games"),
        ("SELECT COUNT(*) FROM games WHERE reached_winning=1", "reached_winning"),
        ("SELECT COUNT(*) FROM games WHERE converted_winning=1", "converted_winning"),
        ("SELECT COUNT(*) FROM games WHERE reached_winning=1 AND converted_winning=0", "blew_winning"),
        ("SELECT COUNT(*) FROM games WHERE reached_losing=1", "reached_losing"),
        ("SELECT COUNT(*) FROM games WHERE saved_losing=1", "saved_losing"),
        ("SELECT COUNT(*) FROM positions WHERE is_turning_point=1", "turning_points"),
    ]:
        stats[k] = conn.execute(q).fetchone()[0]
    conn.close()
    return stats


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s", stream=sys.stdout)
    cfg = load_config()
    repo_root = Path(__file__).resolve().parent.parent
    db_path = Path(cfg["paths"].get("positions_db", "data/positions.db"))
    if not db_path.is_absolute():
        db_path = repo_root / db_path
    stats = run(db_path)
    log.info("Decisions enrich done: %s", stats)


if __name__ == "__main__":
    main()
