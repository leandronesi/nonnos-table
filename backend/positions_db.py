"""SPRINT 1 v2 — Schema SQLite `data/positions.db`.

Una sola tabella `positions` indicizzata, una riga per ogni MIA mossa.
Il DB è il "cuore queryabile" della v2: tutta l'analisi a valle (player model,
diagnosi, agente LLM con tool-use) si appoggia su query SQL contro questo file.

Principio: una mossa = un fatto taggato. Tutte le decisioni di coaching nascono
da SELECT su questa tabella, mai da JSON sparsi.

NB: questo file espone solo schema, connection helpers e query semplici.
La logica di estrazione feature è in `feature_extract.py`, il popolamento in
`build_positions_db.py`.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

# ----------------------------------------------------------------------------
# Schema
# ----------------------------------------------------------------------------

# Una sola tabella. Indici sui campi più filtrati: phase, motif, is_critical,
# time_class, end_time_epoch. Per la chat l'LLM farà SELECT con WHERE composti
# su questi.

SCHEMA_VERSION = 2  # v2 = aggiunte p_mine_plays_best_sf / p_target_plays_best_sf

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS positions (
    -- identità
    game_id            TEXT NOT NULL,
    ply                INTEGER NOT NULL,           -- 1-based, ply del MIO turno
    move_number        INTEGER NOT NULL,           -- full-move number
    san                TEXT NOT NULL,              -- mossa che HO giocato

    -- contesto partita (denormalizzato per query rapide senza JOIN)
    end_time_epoch     INTEGER,
    date               TEXT,                       -- YYYY-MM-DD UTC
    time_class         TEXT,                       -- bullet / blitz / rapid / daily
    time_control       TEXT,                       -- es. "180+2"
    rated              INTEGER,                    -- 0/1
    my_color           TEXT,                       -- white / black
    my_rating          INTEGER,
    opp_rating         INTEGER,
    result             TEXT,                       -- win / loss / draw
    eco                TEXT,
    opening            TEXT,
    num_moves          INTEGER,
    url                TEXT,

    -- posizione
    fen_before         TEXT NOT NULL,
    phase              TEXT NOT NULL,              -- opening / middlegame / endgame
    n_pieces           INTEGER,
    material_balance   INTEGER,                    -- dal MIO POV, in cp di pezzo (P=1, N=3, B=3, R=5, Q=9)

    -- struttura (semplice ora, espandibile dopo)
    has_iqp_mine       INTEGER,                    -- ho un pedone isolato di donna?
    has_iqp_opp        INTEGER,
    n_isolani_mine     INTEGER,
    n_isolani_opp      INTEGER,
    n_pawns_mine       INTEGER,
    n_pawns_opp        INTEGER,

    -- engine (Stockfish, v1)
    cp_before          INTEGER,                    -- dal MIO POV, cap a ±1000
    cp_after           INTEGER,
    cp_loss            INTEGER,                    -- max(0, cp_before - cp_after)
    category           TEXT,                       -- ok / inaccuracy / mistake / blunder
    best_san_sf        TEXT,                       -- mossa migliore Stockfish
    pv_san_sf          TEXT,                       -- primi 5 ply della PV separati da spazio

    -- engine (Maia, sprint 2) — null per ora, popolati dopo
    best_san_maia_mine     TEXT,
    best_san_maia_target   TEXT,
    p_maia_mine_top        REAL,                   -- P(top move) secondo Maia@mio rating
    p_maia_target_top      REAL,
    move_difficulty        REAL,                   -- 1 - P(top_move | Maia@target) ∈ [0,1]
    -- difficulty-as-money (sprint 3 v2): probabilità che la mossa GIUSTA (Stockfish)
    -- venga giocata dai due livelli. La punchline del drill:
    -- "il p_target_plays_best% dei 1600 la trova, al tuo livello p_mine_plays_best%"
    p_mine_plays_best_sf    REAL,
    p_target_plays_best_sf  REAL,

    -- finali (sprint 3) — null finché Syzygy non risponde
    tablebase_verdict      TEXT,                   -- win / draw / loss / unknown
    tablebase_dtz          INTEGER,

    -- motif tattico (v1, regole semplici)
    motif              TEXT,
    motif_label_it     TEXT,

    -- TEMPO (sprint 1) — parsato da PGN [%clk]
    clock_seconds      REAL,                       -- secondi rimasti DOPO la mia mossa
    seconds_spent      REAL,                       -- quanto tempo ho speso su questa mossa
    instant_move       INTEGER,                    -- 0/1, < 2 secondi
    zeitnot            INTEGER,                    -- 0/1, < 30 secondi rimasti

    -- FLAG fondamentali per il filtro "posizioni critiche"
    is_critical        INTEGER NOT NULL DEFAULT 0, -- cp_before in [-150,+150]
    is_book            INTEGER NOT NULL DEFAULT 0, -- mossa di apertura (semplificato: ply <= 16)
    is_decided         INTEGER NOT NULL DEFAULT 0, -- posizione già decisa (|cp_before| > 600)

    -- ULTIMA MOSSA AVVERSARIO (per renderizzare la freccia di contesto a stile Chess.com/Lichess)
    last_opp_from      TEXT,                       -- es. "e7"
    last_opp_to        TEXT,                       -- es. "e5"
    last_opp_san       TEXT,                       -- es. "e5"

    PRIMARY KEY (game_id, ply)
);

CREATE INDEX IF NOT EXISTS idx_positions_critical    ON positions(is_critical, category);
CREATE INDEX IF NOT EXISTS idx_positions_phase       ON positions(phase, is_critical);
CREATE INDEX IF NOT EXISTS idx_positions_motif       ON positions(motif, is_critical);
CREATE INDEX IF NOT EXISTS idx_positions_time_class  ON positions(time_class, end_time_epoch);
CREATE INDEX IF NOT EXISTS idx_positions_end_time    ON positions(end_time_epoch);
CREATE INDEX IF NOT EXISTS idx_positions_color       ON positions(my_color, eco);
CREATE INDEX IF NOT EXISTS idx_positions_difficulty  ON positions(move_difficulty);

-- Tabella di metadati per versioning schema + ultimo run.
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);

-- Tabella `games` denormalizzata per query rapide a livello partita
-- (i campi più usati sono già in `positions`, ma a volte serve un GROUP BY già pronto).
CREATE TABLE IF NOT EXISTS games (
    game_id            TEXT PRIMARY KEY,
    url                TEXT,
    end_time_epoch     INTEGER,
    date               TEXT,
    time_class         TEXT,
    time_control       TEXT,
    rated              INTEGER,
    my_color           TEXT,
    my_rating          INTEGER,
    opp_rating         INTEGER,
    result             TEXT,
    eco                TEXT,
    opening            TEXT,
    num_moves          INTEGER,
    acpl               REAL,
    n_blunders         INTEGER,
    n_mistakes         INTEGER,
    n_inaccuracies     INTEGER,
    n_critical_positions INTEGER,                  -- quante posizioni davvero "decisivi" nella partita
    initial_clock_sec  INTEGER                     -- base time del controllo, in secondi
);

CREATE INDEX IF NOT EXISTS idx_games_time_class ON games(time_class, end_time_epoch);
CREATE INDEX IF NOT EXISTS idx_games_result     ON games(result);
"""


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------


def connect(db_path: str | Path) -> sqlite3.Connection:
    """Apre la connessione, abilita foreign keys e row_factory dict-like."""
    p = Path(db_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(p))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(CREATE_SQL)
    _migrate(conn)
    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('schema_version', ?)",
                 (str(SCHEMA_VERSION),))
    conn.commit()


def _migrate(conn: sqlite3.Connection) -> None:
    """Migrazioni idempotenti per DB esistenti.

    SQLite non supporta `ADD COLUMN IF NOT EXISTS`, quindi controllo via
    PRAGMA table_info prima di tentare l'ALTER.
    """
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(positions)")}
    additions = [
        ("p_mine_plays_best_sf", "REAL"),
        ("p_target_plays_best_sf", "REAL"),
    ]
    for col, ctype in additions:
        if col not in existing:
            conn.execute(f"ALTER TABLE positions ADD COLUMN {col} {ctype}")


# Le colonne nello stesso ordine dell'INSERT (lo riusiamo da build_positions_db.py)
POSITION_COLS: tuple[str, ...] = (
    "game_id", "ply", "move_number", "san",
    "end_time_epoch", "date", "time_class", "time_control", "rated",
    "my_color", "my_rating", "opp_rating", "result",
    "eco", "opening", "num_moves", "url",
    "fen_before", "phase", "n_pieces", "material_balance",
    "has_iqp_mine", "has_iqp_opp",
    "n_isolani_mine", "n_isolani_opp", "n_pawns_mine", "n_pawns_opp",
    "cp_before", "cp_after", "cp_loss", "category",
    "best_san_sf", "pv_san_sf",
    "best_san_maia_mine", "best_san_maia_target",
    "p_maia_mine_top", "p_maia_target_top", "move_difficulty",
    "p_mine_plays_best_sf", "p_target_plays_best_sf",
    "tablebase_verdict", "tablebase_dtz",
    "motif", "motif_label_it",
    "clock_seconds", "seconds_spent", "instant_move", "zeitnot",
    "is_critical", "is_book", "is_decided",
    "last_opp_from", "last_opp_to", "last_opp_san",
)

GAME_COLS: tuple[str, ...] = (
    "game_id", "url", "end_time_epoch", "date",
    "time_class", "time_control", "rated",
    "my_color", "my_rating", "opp_rating", "result",
    "eco", "opening", "num_moves",
    "acpl", "n_blunders", "n_mistakes", "n_inaccuracies",
    "n_critical_positions", "initial_clock_sec",
)


def insert_positions(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    placeholders = ",".join(["?"] * len(POSITION_COLS))
    sql = f"INSERT OR REPLACE INTO positions ({','.join(POSITION_COLS)}) VALUES ({placeholders})"
    values = [tuple(r.get(c) for c in POSITION_COLS) for r in rows]
    conn.executemany(sql, values)
    return len(values)


def insert_games(conn: sqlite3.Connection, rows: list[dict[str, Any]]) -> int:
    if not rows:
        return 0
    placeholders = ",".join(["?"] * len(GAME_COLS))
    sql = f"INSERT OR REPLACE INTO games ({','.join(GAME_COLS)}) VALUES ({placeholders})"
    values = [tuple(r.get(c) for c in GAME_COLS) for r in rows]
    conn.executemany(sql, values)
    return len(values)


# ----------------------------------------------------------------------------
# Query d'esempio (utili in chat futura e per smoke test)
# ----------------------------------------------------------------------------

EXAMPLE_QUERIES = {
    "critical_blunders_middlegame": """
        SELECT date, opening, my_color, move_number, san, best_san_sf, cp_loss, motif_label_it
        FROM positions
        WHERE is_critical = 1 AND phase = 'middlegame' AND category = 'blunder'
        ORDER BY end_time_epoch DESC
        LIMIT 20;
    """,
    "blunders_by_motif": """
        SELECT motif_label_it, COUNT(*) AS n
        FROM positions
        WHERE is_critical = 1 AND category = 'blunder' AND motif IS NOT NULL
        GROUP BY motif
        ORDER BY n DESC;
    """,
    "accuracy_under_time_pressure": """
        SELECT
          CASE WHEN clock_seconds < 30 THEN '<30s'
               WHEN clock_seconds < 60 THEN '30-60s'
               WHEN clock_seconds < 120 THEN '60-120s'
               ELSE '>120s' END AS clock_bucket,
          COUNT(*) AS positions,
          AVG(cp_loss) AS avg_cp_loss,
          SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders
        FROM positions
        WHERE is_critical = 1 AND clock_seconds IS NOT NULL
        GROUP BY clock_bucket
        ORDER BY clock_bucket;
    """,
    "worst_opening_for_color": """
        SELECT eco, opening, my_color, COUNT(*) AS games,
               AVG(acpl) AS avg_acpl,
               1.0 * SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) / COUNT(*) AS win_rate
        FROM games
        WHERE eco IS NOT NULL
        GROUP BY eco, opening, my_color
        HAVING games >= 3
        ORDER BY win_rate ASC, avg_acpl DESC
        LIMIT 10;
    """,
}
