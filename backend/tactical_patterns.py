"""SPRINT 5 v2 — Detection di motivi tattici.

Per ogni posizione CRITICA in cui ho sbagliato (mistake | blunder), analizziamo
la mossa GIUSTA (Stockfish best_san_sf) e identifichiamo che PATTERN tattico
sfruttava. La tabella positions guadagna 5 colonne booleane:

  motif_fork              — best_move attacca ≥2 pezzi avversari di pari/maggior valore
  motif_hanging_piece     — best_move cattura un pezzo non difeso, o c'era un mio
                            pezzo en-prise che non ho difeso
  motif_removed_defender  — best_move toglie il difensore di un pezzo, esponendolo
  motif_back_rank         — best_move sfrutta o crea matto sull'ottava traversa
  motif_discovered_attack — muovendo, scopre un attacco da un pezzo dietro

Filosofia: vogliamo che il drill possa dire "questo era un FORK" cosi` il
training si organizza per TIPO di errore, non solo per cp_loss. Spaced
repetition naturale: ti escono piu` fork-puzzle finche` non smetti di
sbagliarli.

NB: detection conservativa — preferiamo MISS che FALSI positivi. Meglio dire
"no pattern" che etichettare male e confondere l'apprendimento.
"""

from __future__ import annotations

import argparse
import logging
import sqlite3
import sys
from pathlib import Path

import chess
from tqdm import tqdm

from config_loader import load_config
from positions_db import connect, init_schema

log = logging.getLogger("patterns")

PIECE_VALUES = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 100,  # solo per confronti relativi
}


# ---------------------------------------------------------------------------
# Detectors — ciascuno ritorna bool. Conservativo per design.
# ---------------------------------------------------------------------------


def _piece_value(p: chess.Piece | None) -> int:
    return PIECE_VALUES.get(p.piece_type, 0) if p else 0


def detect_hanging_piece(board: chess.Board, best_move: chess.Move) -> bool:
    """True se best_move cattura un pezzo avversario indifeso, o se MOSSE/CATTURE
    avrebbero salvato un mio pezzo en-prise.

    Caso A (cattura un appeso): la casa di destinazione di best_move ha un pezzo
    avversario, e nessun pezzo avversario attacca quella casa (= nessun
    ricattura possibile).

    Caso B (salva un mio appeso): esiste un mio pezzo che PRIMA della mossa
    era attaccato + non difeso (gli attaccanti avversari sono >= ai miei
    difensori e ci sarebbe perdita di materiale netta), e best_move o lo
    sposta o blocca/cattura l'attaccante.
    """
    me = board.turn
    them = not me

    # Caso A: best_move cattura un pezzo avversario indifeso
    target = board.piece_at(best_move.to_square)
    if target and target.color == them:
        defenders = board.attackers(them, best_move.to_square)
        attackers_mine = board.attackers(me, best_move.to_square)
        # appeso = nessun difensore
        if not defenders and attackers_mine:
            return True
        # caso: attaccanti > difensori (SEE positivo basico, non perfetto ma
        # filtra il rumore)
        if len(attackers_mine) > len(defenders) and _piece_value(target) >= 3:
            return True

    # Caso B: c'era un mio pezzo en-prise di valore ≥ 3 (non pedone) e
    # best_move lo "salva" (lo sposta o cattura l'attaccante).
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if not p or p.color != me:
            continue
        if _piece_value(p) < 3:
            continue
        attackers_opp = board.attackers(them, sq)
        defenders_mine = board.attackers(me, sq)
        if not attackers_opp:
            continue
        # en-prise se attaccanti > difensori (semplificato, niente SEE)
        if len(attackers_opp) > len(defenders_mine):
            # best_move salva? Casi:
            #   1. sposta il pezzo en-prise
            #   2. cattura l'attaccante
            #   3. blocca la linea (lo trattiamo solo per tower/bishop attaccanti)
            if best_move.from_square == sq:
                return True
            if best_move.to_square in attackers_opp:
                return True

    return False


def detect_fork(board: chess.Board, best_move: chess.Move) -> bool:
    """True se DOPO best_move il pezzo mosso attacca >=2 pezzi avversari
    di valore >= cavallo (no pawn forks su singolo pedone).

    Caso speciale: il pezzo mosso e` un pedone → forchetta di pedone se
    attacca 2 pezzi non-pedoni.
    """
    me = board.turn
    them = not me

    after = board.copy()
    after.push(best_move)

    moved_piece = after.piece_at(best_move.to_square)
    if not moved_piece:
        return False

    attacked = after.attacks(best_move.to_square)
    targets: list[chess.Piece] = []
    for sq in attacked:
        p = after.piece_at(sq)
        if not p or p.color != them:
            continue
        # ignora pedoni (non e` una "forchetta" se attacchi 2 pedoni con la donna)
        if p.piece_type == chess.PAWN and moved_piece.piece_type != chess.PAWN:
            continue
        # il pezzo che forka non deve poter essere catturato e basta
        targets.append(p)

    if len(targets) < 2:
        return False

    # Almeno uno dei target deve avere valore >= pezzo mosso (sennò non e`
    # un vero "guadagno"). Eccezione: re catturabile = sempre fork.
    moved_val = _piece_value(moved_piece)
    has_king = any(t.piece_type == chess.KING for t in targets)
    if has_king:
        return True
    return any(_piece_value(t) >= moved_val for t in targets)


def detect_removed_defender(board: chess.Board, best_move: chess.Move) -> bool:
    """True se best_move cattura un pezzo avversario il cui ruolo era DIFENDERE
    un altro pezzo che ora rimane en-prise (e che ho gia` il modo di
    catturare).
    """
    me = board.turn
    them = not me

    # best_move deve essere una cattura
    if not board.is_capture(best_move):
        return False

    captured_sq = best_move.to_square
    # Cosa difendeva il pezzo catturato? Pezzi avversari che ora hanno
    # un difensore in meno.
    captured = board.piece_at(captured_sq)
    if not captured or captured.color != them:
        return False

    # Simula la cattura
    after = board.copy()
    after.push(best_move)

    # Per ogni pezzo avversario, era difeso da captured_sq prima e ora
    # ha meno difensori dei suoi attaccanti?
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if not p or p.color != them or sq == captured_sq:
            continue
        if _piece_value(p) < 3:
            continue
        # era difeso da captured_sq?
        defenders_before = board.attackers(them, sq)
        if captured_sq not in defenders_before:
            continue
        # Adesso: gli attaccanti miei superano i difensori avversari?
        attackers_after = after.attackers(me, sq)
        defenders_after = after.attackers(them, sq)
        if attackers_after and len(attackers_after) > len(defenders_after):
            return True

    return False


def detect_back_rank(board: chess.Board, best_move: chess.Move) -> bool:
    """True se best_move sfrutta una debolezza dell'ultima traversa avversaria:
    re intrappolato (pedoni davanti, no fuga) + minaccia di matto via
    pezzo pesante sull'ottava.
    """
    me = board.turn
    them = not me

    # Re avversario su 1a/8a traversa con pedoni davanti?
    king_sq = board.king(them)
    if king_sq is None:
        return False
    king_rank = chess.square_rank(king_sq)
    expected_back = 7 if them == chess.WHITE else 0
    if king_rank != expected_back:
        return False
    # ha vie di fuga?
    pawn_rank = 6 if them == chess.WHITE else 1
    escapes = 0
    for f in (chess.square_file(king_sq) - 1, chess.square_file(king_sq), chess.square_file(king_sq) + 1):
        if not (0 <= f <= 7):
            continue
        front_sq = chess.square(f, pawn_rank)
        front_piece = board.piece_at(front_sq)
        if not front_piece or front_piece.piece_type != chess.PAWN or front_piece.color != them:
            escapes += 1
    if escapes >= 2:
        return False  # ha aria, non e` davvero back-rank weakness

    # best_move e` un pezzo pesante (torre / donna) sulla traversa
    # del re avversario?
    moved = board.piece_at(best_move.from_square)
    if not moved or moved.piece_type not in (chess.ROOK, chess.QUEEN):
        return False
    if chess.square_rank(best_move.to_square) != expected_back:
        return False

    # dopo la mossa: e` scacco/matto?
    after = board.copy()
    after.push(best_move)
    return after.is_check() or after.is_checkmate()


def detect_discovered_attack(board: chess.Board, best_move: chess.Move) -> bool:
    """True se muovendo, best_move scopre un attacco da un pezzo dietro
    contro un pezzo avversario di valore alto (≥ torre) o contro il re.
    """
    me = board.turn
    them = not me

    moved_piece = board.piece_at(best_move.from_square)
    if not moved_piece:
        return False

    # Quali pezzi miei a lunga gittata sono dietro best_move.from_square e
    # ora con la mossa scoprono un attacco?
    after = board.copy()
    after.push(best_move)

    # Cerco ogni mio pezzo a lunga gittata (B, R, Q) — non il pezzo mosso —
    # e vedo se ora attacca un pezzo avversario di valore >= 5 (torre+) o
    # il re.
    for sq in chess.SQUARES:
        p = after.piece_at(sq)
        if not p or p.color != me:
            continue
        if p.piece_type not in (chess.BISHOP, chess.ROOK, chess.QUEEN):
            continue
        # non considerare il pezzo mosso
        if sq == best_move.to_square:
            continue
        # nuovi attacchi da questo pezzo
        for target_sq in after.attacks(sq):
            target = after.piece_at(target_sq)
            if not target or target.color != them:
                continue
            if target.piece_type == chess.KING or _piece_value(target) >= 5:
                # era gia` attaccato PRIMA della mossa da questo stesso pezzo?
                if sq in board.attackers(me, target_sq):
                    continue  # non e` "scoperto", attaccava gia`
                return True
    return False


_DETECTORS = {
    "motif_hanging_piece": detect_hanging_piece,
    "motif_fork": detect_fork,
    "motif_removed_defender": detect_removed_defender,
    "motif_back_rank": detect_back_rank,
    "motif_discovered_attack": detect_discovered_attack,
}


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def _positions_to_tag(conn: sqlite3.Connection, force: bool) -> list[sqlite3.Row]:
    if force:
        sql = (
            "SELECT game_id, ply, fen_before, best_san_sf "
            "FROM positions "
            "WHERE is_critical=1 AND category IN ('mistake','blunder') "
            "  AND best_san_sf IS NOT NULL"
        )
    else:
        sql = (
            "SELECT game_id, ply, fen_before, best_san_sf "
            "FROM positions "
            "WHERE is_critical=1 AND category IN ('mistake','blunder') "
            "  AND best_san_sf IS NOT NULL "
            "  AND motif_hanging_piece IS NULL"
        )
    return list(conn.execute(sql))


def tag_all(db_path: Path, *, force: bool = False, limit: int | None = None) -> dict[str, int]:
    conn = connect(db_path)
    init_schema(conn)

    rows = _positions_to_tag(conn, force=force)
    if limit:
        rows = rows[:limit]
    log.info("Posizioni da taggare: %d", len(rows))
    if not rows:
        conn.close()
        return {"tagged": 0, "total": 0}

    counts = {k: 0 for k in _DETECTORS}
    counts["any"] = 0
    tagged = 0

    for r in tqdm(rows, desc="Patterns", unit="pos"):
        try:
            board = chess.Board(r["fen_before"])
            best = board.parse_san(r["best_san_sf"])
        except (ValueError, AssertionError):
            continue

        flags: dict[str, int] = {}
        for name, fn in _DETECTORS.items():
            try:
                flags[name] = 1 if fn(board, best) else 0
            except Exception:  # noqa: BLE001
                # un detector non deve mai far fallire la riga
                flags[name] = 0

        if any(flags.values()):
            counts["any"] += 1
        for name, v in flags.items():
            if v:
                counts[name] += 1

        conn.execute(
            f"UPDATE positions SET "
            f"  motif_hanging_piece     = ?,"
            f"  motif_fork              = ?,"
            f"  motif_removed_defender  = ?,"
            f"  motif_back_rank         = ?,"
            f"  motif_discovered_attack = ?"
            f" WHERE game_id=? AND ply=?",
            (
                flags["motif_hanging_piece"],
                flags["motif_fork"],
                flags["motif_removed_defender"],
                flags["motif_back_rank"],
                flags["motif_discovered_attack"],
                r["game_id"],
                r["ply"],
            ),
        )
        tagged += 1
        if tagged % 200 == 0:
            conn.commit()
    conn.commit()
    conn.close()

    log.info("Pattern detection: %s", counts)
    return {"tagged": tagged, **counts}


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
    parser.add_argument("--force", action="store_true", help="re-tag tutte le posizioni")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()

    cfg = load_config()
    repo_root = Path(__file__).resolve().parent.parent
    db_path = Path(cfg["paths"].get("positions_db", "data/positions.db"))
    if not db_path.is_absolute():
        db_path = repo_root / db_path

    stats = tag_all(db_path, force=args.force, limit=args.limit)
    print(stats)


if __name__ == "__main__":
    main()
