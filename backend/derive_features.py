"""SPRINT 2C v2 — Flag derivati.

Aggiunge colonne calcolate al DB:
  - i_played_maia_mine        : ho giocato quello che giocherebbe Maia@mio livello
  - i_played_maia_target      : ho giocato quello che giocherebbe Maia@target
  - maia_mine_finds_best      : Maia@mio livello trova la mossa Stockfish (= la migliore)
  - maia_target_finds_best    : Maia@target trova la migliore
  - avoidable_at_my_level     : errore evitabile alla mia forza
        cp_loss >= 100 AND maia_mine_finds_best=1 AND san != best_san_sf
  - unavoidable_at_target     : neanche Maia@target trovava la giusta
        cp_loss >= 100 AND maia_target_finds_best=0
  - move_difficulty_proxy     : 0/1 — 0=facile (Maia@mio trova best), 1=non ovvia
        (placeholder finché non abbiamo la policy distribution)

Idempotente: ricomputa tutto da scratch ogni volta.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from config_loader import load_config
from positions_db import connect

log = logging.getLogger("derive_features")

# Colonne da aggiungere (se non esistono già nello schema)
EXTRA_COLS = [
    ("i_played_maia_mine", "INTEGER"),
    ("i_played_maia_target", "INTEGER"),
    ("maia_mine_finds_best", "INTEGER"),
    ("maia_target_finds_best", "INTEGER"),
    ("avoidable_at_my_level", "INTEGER"),
    ("unavoidable_at_target", "INTEGER"),
    ("move_difficulty_proxy", "REAL"),
]


def ensure_columns(conn) -> None:
    existing = {r["name"] for r in conn.execute("PRAGMA table_info(positions)")}
    for name, sqltype in EXTRA_COLS:
        if name not in existing:
            conn.execute(f"ALTER TABLE positions ADD COLUMN {name} {sqltype}")
            log.info("ALTER TABLE positions ADD COLUMN %s %s", name, sqltype)
    conn.commit()


def run(db_path: Path) -> dict[str, int]:
    conn = connect(db_path)
    ensure_columns(conn)

    # Update in un singolo statement SQL — molto più veloce di un loop Python.
    conn.execute("""
        UPDATE positions
        SET i_played_maia_mine =
                CASE WHEN best_san_maia_mine IS NULL THEN NULL
                     WHEN san = best_san_maia_mine THEN 1 ELSE 0 END,
            i_played_maia_target =
                CASE WHEN best_san_maia_target IS NULL THEN NULL
                     WHEN san = best_san_maia_target THEN 1 ELSE 0 END,
            maia_mine_finds_best =
                CASE WHEN best_san_maia_mine IS NULL OR best_san_sf IS NULL THEN NULL
                     WHEN best_san_maia_mine = best_san_sf THEN 1 ELSE 0 END,
            maia_target_finds_best =
                CASE WHEN best_san_maia_target IS NULL OR best_san_sf IS NULL THEN NULL
                     WHEN best_san_maia_target = best_san_sf THEN 1 ELSE 0 END
        WHERE is_critical = 1
    """)

    conn.execute("""
        UPDATE positions
        SET avoidable_at_my_level =
                CASE WHEN cp_loss >= 100
                          AND maia_mine_finds_best = 1
                          AND san != best_san_sf
                     THEN 1 ELSE 0 END,
            unavoidable_at_target =
                CASE WHEN cp_loss >= 100
                          AND maia_target_finds_best = 0
                     THEN 1 ELSE 0 END,
            move_difficulty_proxy =
                CASE WHEN maia_mine_finds_best = 1 THEN 0.0
                     WHEN maia_target_finds_best = 1 THEN 0.5
                     WHEN maia_mine_finds_best = 0 AND maia_target_finds_best = 0 THEN 1.0
                     ELSE NULL END
        WHERE is_critical = 1
    """)
    conn.commit()

    stats: dict[str, int] = {}
    for q, k in [
        ("SELECT COUNT(*) FROM positions WHERE is_critical=1", "critical"),
        ("SELECT COUNT(*) FROM positions WHERE avoidable_at_my_level=1", "avoidable"),
        ("SELECT COUNT(*) FROM positions WHERE unavoidable_at_target=1", "unavoidable_at_target"),
        ("SELECT COUNT(*) FROM positions WHERE i_played_maia_mine=1", "agree_with_my_level"),
        ("SELECT COUNT(*) FROM positions WHERE i_played_maia_target=1", "agree_with_target"),
        ("SELECT COUNT(*) FROM positions WHERE category='blunder' AND is_critical=1", "blunder_critical"),
        ("SELECT COUNT(*) FROM positions WHERE category='blunder' AND avoidable_at_my_level=1", "blunder_avoidable"),
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
    log.info("Derive done: %s", stats)


if __name__ == "__main__":
    main()
