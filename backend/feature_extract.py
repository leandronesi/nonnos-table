"""SPRINT 1 v2 — Estrazione feature per posizione.

Per ogni MIA mossa in una partita produce un record con TUTTE le feature
necessarie alla v2: struttura pedonale, materiale, fase, criticità,
flag "posizione critica vs decisa vs libro", tempo di orologio.

Le feature engine (Stockfish, Maia, Syzygy) qui non vengono RICALCOLATE:
le prendiamo dall'output v1 (data/analysis/*.json) per Stockfish, e Maia/Syzygy
verranno aggiunti negli sprint successivi popolando le colonne dedicate.

Input: PGN + payload v1 di analyze.py (con moves[]).
Output: list[dict] pronto per `positions_db.insert_positions`.
"""

from __future__ import annotations

import io
import re
from typing import Any

import chess
import chess.pgn

# Soglie per il filtro "posizioni critiche". Documentate qui per essere
# tweakkabili dalla config.yaml in futuro.
CRITICAL_CP_BAND = 150       # |cp_before| <= 150 → equilibrio (è qui che le decisioni contano)
DECIDED_CP_THRESHOLD = 600   # |cp_before| >= 600 → posizione già decisa (eval moves sono rumore)
BOOK_PLY_LIMIT = 16          # ply <= 16 → consideriamo "ancora libro" (semplificazione)
INSTANT_MOVE_SECONDS = 2.0
ZEITNOT_SECONDS = 30.0

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


# ---------------------------------------------------------------------------
# Parsing [%clk] dal PGN — Chess.com mette {[%clk 0:02:55.5]} dopo ogni mossa
# ---------------------------------------------------------------------------

_CLK_RE = re.compile(r"\[%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)\]")


def parse_clock_times(pgn_text: str) -> list[float | None]:
    """Ritorna i secondi rimasti DOPO ogni ply (lunghezza = numero di mosse della partita).

    Se il PGN non ha tag [%clk] (es. partite molto vecchie), tutti None.
    """
    pgn_io = io.StringIO(pgn_text)
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        return []

    out: list[float | None] = []
    node = game
    while node.variations:
        node = node.variation(0)
        comment = node.comment or ""
        m = _CLK_RE.search(comment)
        if m:
            h, mm, s = m.groups()
            total = int(h) * 3600 + int(mm) * 60 + float(s)
            out.append(total)
        else:
            out.append(None)
    return out


def initial_clock_from_time_control(time_control: str | None) -> int | None:
    """Estrae il base time in secondi da una stringa Chess.com (es. '180+2' → 180, '300' → 300)."""
    if not time_control:
        return None
    base = time_control.split("+")[0]
    try:
        return int(base)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Feature strutturali da una posizione
# ---------------------------------------------------------------------------


def _material_for(board: chess.Board, color: bool) -> int:
    s = 0
    for ptype, val in PIECE_VALUES.items():
        s += val * len(board.pieces(ptype, color))
    return s


def _pawn_files(board: chess.Board, color: bool) -> list[int]:
    return [chess.square_file(sq) for sq in board.pieces(chess.PAWN, color)]


def _count_isolani(pawn_files: list[int]) -> int:
    """Pedoni isolani = pedoni senza pedoni dello stesso colore sulle colonne adiacenti."""
    files_set = set(pawn_files)
    iso = 0
    for f in pawn_files:
        if (f - 1) not in files_set and (f + 1) not in files_set:
            iso += 1
    return iso


def _has_iqp(board: chess.Board, color: bool) -> bool:
    """Isolated Queen Pawn: un pedone sulla colonna d senza pedoni sulle colonne c o e (per il proprio colore)."""
    files = _pawn_files(board, color)
    if 3 not in files:  # colonna d = file 3 (0-indexed)
        return False
    return 2 not in files and 4 not in files


def position_features(board: chess.Board, my_color: bool) -> dict[str, Any]:
    """Dato `board` (la posizione PRIMA della mia mossa), estrae feature strutturali."""
    opp_color = not my_color

    pawns_mine = _pawn_files(board, my_color)
    pawns_opp = _pawn_files(board, opp_color)

    return {
        "n_pieces": chess.popcount(board.occupied),
        "material_balance": _material_for(board, my_color) - _material_for(board, opp_color),
        "n_pawns_mine": len(pawns_mine),
        "n_pawns_opp": len(pawns_opp),
        "n_isolani_mine": _count_isolani(pawns_mine),
        "n_isolani_opp": _count_isolani(pawns_opp),
        "has_iqp_mine": 1 if _has_iqp(board, my_color) else 0,
        "has_iqp_opp": 1 if _has_iqp(board, opp_color) else 0,
    }


# ---------------------------------------------------------------------------
# Flag "posizione critica / libro / decisa"
# ---------------------------------------------------------------------------


def critical_flags(cp_before: int, ply: int) -> dict[str, int]:
    """Calcola is_critical, is_book, is_decided dal cp_before e dal ply.

    Regole (documentate, tweakkabili):
      - is_book      : ply <= BOOK_PLY_LIMIT
      - is_decided   : |cp_before| >= DECIDED_CP_THRESHOLD
      - is_critical  : |cp_before| <= CRITICAL_CP_BAND e NON book e NON decided
    """
    is_book = 1 if ply <= BOOK_PLY_LIMIT else 0
    is_decided = 1 if abs(cp_before) >= DECIDED_CP_THRESHOLD else 0
    is_critical = (
        1 if (abs(cp_before) <= CRITICAL_CP_BAND and not is_book and not is_decided) else 0
    )
    return {"is_book": is_book, "is_decided": is_decided, "is_critical": is_critical}


# ---------------------------------------------------------------------------
# Estrazione completa per una partita
# ---------------------------------------------------------------------------


def extract_positions_for_game(
    payload: dict[str, Any],
    pgn_text: str,
) -> list[dict[str, Any]]:
    """Per UNA partita (payload v1 + PGN raw) ritorna la lista di record per `positions`.

    Una riga per ogni MIA mossa con loss > 0 OPPURE in posizione critica.
    Per ora teniamo tutte le mie mosse (anche le ok), così il DB supporta
    qualsiasi query a valle.
    """
    idx = payload.get("index") or {}
    analysis = payload.get("analysis") or {}
    moves = analysis.get("moves") or []
    if not moves:
        return []

    my_color_str = idx.get("my_color") or "white"
    my_is_white = my_color_str == "white"

    # Parse PGN per orologio + ricostruzione board posizione-per-posizione
    pgn_io = io.StringIO(pgn_text)
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        return []

    clock_per_ply = parse_clock_times(pgn_text)  # secondi rimasti DOPO ply i

    # Pre-calcolo dei board PRIMA di ogni mossa
    boards_before: list[chess.Board] = []
    board = game.board()
    nodes = list(game.mainline())
    for node in nodes:
        boards_before.append(board.copy())
        board.push(node.move)

    # Genere mappa ply (1-based) → mia mossa nel payload
    my_moves_by_ply: dict[int, dict[str, Any]] = {m["ply"]: m for m in moves}

    initial_clock = initial_clock_from_time_control(idx.get("time_control"))

    rows: list[dict[str, Any]] = []
    for ply_1based, m in sorted(my_moves_by_ply.items()):
        i = ply_1based - 1  # zero-based per indexare boards_before / clock
        if i < 0 or i >= len(boards_before):
            continue
        board_before = boards_before[i]

        # Tempo: clock_per_ply[i] è il tempo RIMASTO dopo la mia mossa (ply_1based).
        # Per il tempo speso devo prendere il tempo PRIMA della mia mossa (= clock dopo l'ultima
        # mossa avversaria = clock_per_ply[i-2] per la stessa parte, perché alternati),
        # e sottrarre clock_per_ply[i] + increment.
        clock_now = clock_per_ply[i] if i < len(clock_per_ply) else None
        clock_two_ago = clock_per_ply[i - 2] if i - 2 >= 0 and i - 2 < len(clock_per_ply) else None

        seconds_spent: float | None = None
        if clock_now is not None and clock_two_ago is not None:
            increment = 0
            tc = idx.get("time_control") or ""
            if "+" in tc:
                try:
                    increment = int(tc.split("+")[1])
                except ValueError:
                    increment = 0
            seconds_spent = max(0.0, clock_two_ago - clock_now + increment)
        elif clock_now is not None and clock_two_ago is None and i < 2:
            # Prima mossa: tempo speso = initial_clock - clock_now
            if initial_clock is not None:
                seconds_spent = max(0.0, initial_clock - clock_now)

        # Feature strutturali
        my_color_bool = chess.WHITE if my_is_white else chess.BLACK
        struct = position_features(board_before, my_color_bool)

        cp_before = int(m.get("cp_before", 0))
        flags = critical_flags(cp_before, ply_1based)

        rows.append(
            {
                # identità
                "game_id": payload["game_id"],
                "ply": ply_1based,
                "move_number": m["move_number"],
                "san": m["san"],
                # contesto partita
                "end_time_epoch": idx.get("end_time_epoch"),
                "date": _date_from_epoch(idx.get("end_time_epoch")),
                "time_class": idx.get("time_class"),
                "time_control": idx.get("time_control"),
                "rated": 1 if idx.get("rated") else 0,
                "my_color": my_color_str,
                "my_rating": idx.get("my_rating"),
                "opp_rating": idx.get("opp_rating"),
                "result": idx.get("result"),
                "eco": idx.get("eco"),
                "opening": idx.get("opening"),
                "num_moves": idx.get("num_moves"),
                "url": idx.get("url"),
                # posizione
                "fen_before": m.get("fen_before") or board_before.fen(),
                "phase": m["phase"],
                **struct,
                # Stockfish
                "cp_before": cp_before,
                "cp_after": int(m.get("cp_after", 0)),
                "cp_loss": int(m.get("cp_loss", 0)),
                "category": m.get("category"),
                "best_san_sf": m.get("best_san"),
                "pv_san_sf": " ".join((m.get("pv_san") or [])[:5]),
                # Maia / Syzygy → sprint successivi
                "best_san_maia_mine": None,
                "best_san_maia_target": None,
                "p_maia_mine_top": None,
                "p_maia_target_top": None,
                "move_difficulty": None,
                "tablebase_verdict": None,
                "tablebase_dtz": None,
                # motif
                "motif": m.get("motif"),
                "motif_label_it": _motif_label_it(m.get("motif")),
                # tempo
                "clock_seconds": clock_now,
                "seconds_spent": seconds_spent,
                "instant_move": 1 if (seconds_spent is not None and seconds_spent < INSTANT_MOVE_SECONDS) else 0,
                "zeitnot": 1 if (clock_now is not None and clock_now < ZEITNOT_SECONDS) else 0,
                # flag
                **flags,
            }
        )
    return rows


_MOTIF_LABELS_IT = {
    "allowed_mate": "Matto subìto",
    "material_loss": "Pezzo lasciato",
    "winning_to_lost": "Da vincente a perso",
    "winning_advantage_thrown": "Vantaggio buttato",
    "positional_blunder": "Errore posizionale",
}


def _motif_label_it(motif: str | None) -> str | None:
    if not motif:
        return None
    return _MOTIF_LABELS_IT.get(motif, motif)


def _date_from_epoch(epoch: int | None) -> str | None:
    if not epoch:
        return None
    from datetime import datetime, timezone

    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")
