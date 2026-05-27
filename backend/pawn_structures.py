"""
Pawn structure detector + aggregator per Mygotham.

Razionale: il mediogioco e` strategia, non tattica. La struttura pedonale
e` il fattore unico piu` predittivo del piano. Drillare 5 mosse non insegna
strategia. Riconoscere "in questa struttura tendi a sbagliare quando…"
SI.

Output: per ogni famiglia di struttura, statistiche sul tuo profilo:
  - quante posizioni di mediogioco rilevate
  - quante partite (distinct game_id) la contengono
  - win-rate delle partite
  - avg cp_loss medio dei tuoi errori in posizioni con quella struttura
  - motif tattico dominante associato (per leggere "in struttura X cadi
    spesso per pezzo in presa")

Famiglie rilevate (6 cardinali per dilettante 1000-1800):
  - iqp_white / iqp_black  : pedone d isolato
  - carlsbad               : struttura simmetrica c3/d4/e3 vs c6/d5/e6 (QGD Exchange, Caro-Kann Exchange)
  - french_chain           : centro bloccato e5/d4 vs e6/d5
  - kings_indian_locked    : centro KID e4/d5 vs e5/d6
  - maroczy_bind           : c4+e4 bianco, nero senza c-pedone
  - open_sicilian          : bianco senza d-pedone, nero ha c5+e-pedone
"""
from __future__ import annotations

import logging
import sqlite3
from collections import defaultdict
from typing import Any

import chess


log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Detector — opera su una singola posizione (chess.Board)
# ---------------------------------------------------------------------------

# Etichette in italiano: label umano-friendly che finisce in UI
STRUCTURE_LABELS: dict[str, str] = {
    "iqp_white":         "Pedone d isolato (bianco)",
    "iqp_black":         "Pedone d isolato (nero)",
    "carlsbad":          "Carlsbad (centro simmetrico)",
    "french_chain":      "Catena francese (centro bloccato)",
    "kings_indian":      "Indiana del re (centro chiuso)",
    "maroczy_bind":      "Maroczy Bind (c4+e4)",
    "open_sicilian":     "Siciliana aperta (senza d-pedone)",
}


def _pawn_squares(board: chess.Board, color: chess.Color) -> set[int]:
    return set(board.pieces(chess.PAWN, color))


def _has_pawn(squares: set[int], file: int, rank: int) -> bool:
    """file 0..7 = a..h ; rank 0..7 = 1..8."""
    return chess.square(file, rank) in squares


def _files_with_pawns(squares: set[int]) -> set[int]:
    return {chess.square_file(sq) for sq in squares}


def _is_iqp(squares: set[int], color: chess.Color) -> bool:
    """Pedone d (file=3) presente, pedoni c e e assenti."""
    files = _files_with_pawns(squares)
    if 3 not in files:
        return False
    if 2 in files or 4 in files:
        return False
    # Sanity: deve esistere il pedone d in posizione centrale (rank 3,4 white o 4,3 black)
    if color == chess.WHITE:
        return any(_has_pawn(squares, 3, r) for r in (3, 4, 5))
    else:
        return any(_has_pawn(squares, 3, r) for r in (2, 3, 4))


def _is_carlsbad(white: set[int], black: set[int]) -> bool:
    """Tipica Carlsbad: bianco c3+d4+e3, nero c6+d5+e6 (con tolleranza)."""
    must_white = [(2, 2), (3, 3), (4, 2)]  # c3, d4, e3
    must_black = [(2, 5), (3, 4), (4, 5)]  # c6, d5, e6
    w_ok = sum(1 for f, r in must_white if _has_pawn(white, f, r))
    b_ok = sum(1 for f, r in must_black if _has_pawn(black, f, r))
    return w_ok >= 2 and b_ok >= 2


def _is_french_chain(white: set[int], black: set[int]) -> bool:
    """Centro bloccato e5/d4 (bianco) vs e6/d5 (nero) — francese Advance / chain."""
    return (
        _has_pawn(white, 4, 4)   # e5
        and _has_pawn(white, 3, 3)   # d4
        and _has_pawn(black, 4, 5)   # e6
        and _has_pawn(black, 3, 4)   # d5
    )


def _is_kings_indian_locked(white: set[int], black: set[int]) -> bool:
    """KID classic locked: bianco e4/d5, nero e5/d6."""
    return (
        _has_pawn(white, 4, 3)   # e4
        and _has_pawn(white, 3, 4)   # d5
        and _has_pawn(black, 4, 4)   # e5
        and _has_pawn(black, 3, 5)   # d6
    )


def _is_maroczy(white: set[int], black: set[int]) -> bool:
    """Maroczy bind: c4+e4 bianco, nero senza c-pedone, presenza black c-flank semi-open."""
    if not (_has_pawn(white, 2, 3) and _has_pawn(white, 4, 3)):
        return False
    # Black c-file deve essere vuoto di pedoni neri
    if any(_has_pawn(black, 2, r) for r in range(8)):
        return False
    # E nero deve avere un pedone d (tipico) per non confondere con altre strutture
    return any(_has_pawn(black, 3, r) for r in (4, 5, 6))


def _is_open_sicilian(white: set[int], black: set[int]) -> bool:
    """Bianco senza d-pedone (cambiato in dxc5) + nero ha c-file open o c-pedone laterale (a/b)."""
    if any(_has_pawn(white, 3, r) for r in range(8)):
        return False
    if not _has_pawn(white, 4, 3):  # white deve avere e4
        return False
    # nero deve avere un pedone d (d6 tipico) e nessun c-pedone (cambiato)
    if not any(_has_pawn(black, 3, r) for r in (5, 6)):
        return False
    if any(_has_pawn(black, 2, r) for r in range(8)):
        return False
    return True


def detect_structure(fen: str) -> str | None:
    """Ritorna la chiave di una struttura riconosciuta, o None."""
    try:
        board = chess.Board(fen)
    except Exception:
        return None
    white = _pawn_squares(board, chess.WHITE)
    black = _pawn_squares(board, chess.BLACK)

    # Skip se centro ancora chiaramente "in opening" (10+ pedoni totali)
    # o se finale (4 o meno pedoni) — il detector si applica al mediogioco.
    total = len(white) + len(black)
    if total < 8 or total > 14:
        # Confina al middlegame "vero"
        pass  # Lasciamo passare comunque: il chiamante puo` filtrare con phase=='middlegame'

    # Ordine di prova: piu` specifico prima
    if _is_french_chain(white, black):
        return "french_chain"
    if _is_kings_indian_locked(white, black):
        return "kings_indian"
    if _is_carlsbad(white, black):
        return "carlsbad"
    if _is_maroczy(white, black):
        return "maroczy_bind"
    if _is_open_sicilian(white, black):
        return "open_sicilian"
    if _is_iqp(white, chess.WHITE):
        return "iqp_white"
    if _is_iqp(black, chess.BLACK):
        return "iqp_black"
    return None


# ---------------------------------------------------------------------------
# Aggregator — opera sul DB completo
# ---------------------------------------------------------------------------


def analyze_player_structures(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """
    Itera tutte le posizioni di mediogioco del giocatore, detecta la struttura
    per ognuna, aggrega per famiglia. Espone:
      - aggregati (n_positions, n_games, win_rate, avg_cp_loss, dominant_motif)
      - games_sample: i tuoi N matchi piu` recenti che ci passano (per la lista detail)
      - openings_breakdown: quali ECO/aperture funnelano in questa struttura
      - sample_positions: posizioni concrete da rivedere/drillare
    """
    sql = """
        SELECT p.game_id, p.ply, p.fen_before, p.cp_loss, p.motif, p.motif_label_it,
               p.san, p.best_san_sf, p.move_number, p.my_color AS p_my_color,
               p.cp_before, p.cp_after, p.phase,
               p.last_opp_from, p.last_opp_to, p.last_opp_san,
               p.p_mine_plays_best_sf, p.p_target_plays_best_sf,
               p.motif_hanging_piece, p.motif_fork, p.motif_removed_defender,
               p.motif_back_rank, p.motif_discovered_attack,
               g.result, g.my_color, g.date, g.opp_rating, g.opening, g.eco, g.url
          FROM positions p
          JOIN games g ON g.game_id = p.game_id
         WHERE p.phase = 'middlegame'
           AND p.fen_before IS NOT NULL
           AND p.cp_loss IS NOT NULL
    """
    rows = list(conn.execute(sql))

    # Aggregazione per struttura
    by_struct: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "n_positions": 0,
            "game_ids": set(),
            "wins": 0,
            "losses": 0,
            "draws": 0,
            "cp_loss_sum": 0.0,
            "cp_loss_count": 0,
            "motif_counts": defaultdict(int),
            "eco_counts": defaultdict(lambda: {"n_games": 0, "wins": 0, "losses": 0,
                                                "draws": 0, "opening": "", "game_ids": set()}),
            "all_positions": [],   # raw row records for sample_positions selection
        }
    )

    for r in rows:
        struct = detect_structure(r["fen_before"])
        if not struct:
            continue
        bucket = by_struct[struct]
        bucket["n_positions"] += 1
        bucket["game_ids"].add(r["game_id"])
        bucket["cp_loss_sum"] += r["cp_loss"] or 0
        bucket["cp_loss_count"] += 1
        if r["motif_label_it"]:
            bucket["motif_counts"][r["motif_label_it"]] += 1
        # ECO/opening tracking — per-game (dedup via set)
        eco_key = (r["eco"] or "?", r["opening"] or "?")
        eco_bucket = bucket["eco_counts"][eco_key]
        if r["game_id"] not in eco_bucket["game_ids"]:
            eco_bucket["game_ids"].add(r["game_id"])
            eco_bucket["n_games"] += 1
            eco_bucket["opening"] = r["opening"] or "?"
            if _is_win(r["result"], r["my_color"]):
                eco_bucket["wins"] += 1
            elif _is_loss(r["result"], r["my_color"]):
                eco_bucket["losses"] += 1
            else:
                eco_bucket["draws"] += 1
        # Keep all raw positions for selecting samples + games_sample
        p_mine = r["p_mine_plays_best_sf"]
        p_target = r["p_target_plays_best_sf"]
        drill_value = (
            (p_target - p_mine)
            if (p_mine is not None and p_target is not None)
            else None
        )
        bucket["all_positions"].append({
            "game_id": r["game_id"],
            "ply": r["ply"],
            "move_number": r["move_number"],
            "fen_before": r["fen_before"],
            "cp_loss": r["cp_loss"],
            "cp_before": r["cp_before"],
            "cp_after": r["cp_after"],
            "san": r["san"],
            "best_san_sf": r["best_san_sf"],
            "motif": r["motif"],
            "motif_label_it": r["motif_label_it"],
            "phase": r["phase"],
            "my_color": r["p_my_color"],
            "date": r["date"],
            "opp_rating": r["opp_rating"],
            "opening": r["opening"],
            "eco": r["eco"],
            "url": r["url"],
            "result": r["result"],
            "game_my_color": r["my_color"],
            "last_opp_from": r["last_opp_from"],
            "last_opp_to": r["last_opp_to"],
            "last_opp_san": r["last_opp_san"],
            "p_mine_plays_best_sf": p_mine,
            "p_target_plays_best_sf": p_target,
            "drill_value": drill_value,
            "motif_hanging_piece": r["motif_hanging_piece"],
            "motif_fork": r["motif_fork"],
            "motif_removed_defender": r["motif_removed_defender"],
            "motif_back_rank": r["motif_back_rank"],
            "motif_discovered_attack": r["motif_discovered_attack"],
        })

    # Risultati di partite distinte
    game_results: dict[str, str] = {}
    game_my_color: dict[str, str] = {}
    for r in rows:
        gid = r["game_id"]
        if gid not in game_results:
            game_results[gid] = r["result"] or ""
            game_my_color[gid] = r["my_color"] or ""

    # Costruisce output finale
    out: list[dict[str, Any]] = []
    for key, bucket in by_struct.items():
        if bucket["n_positions"] < 5:
            # Troppe poche occorrenze — skip (confidence troppo bassa)
            continue
        n_games = len(bucket["game_ids"])
        wins = sum(
            1 for gid in bucket["game_ids"]
            if _is_win(game_results.get(gid), game_my_color.get(gid))
        )
        losses = sum(
            1 for gid in bucket["game_ids"]
            if _is_loss(game_results.get(gid), game_my_color.get(gid))
        )
        draws = n_games - wins - losses
        win_rate = (wins / n_games) if n_games > 0 else None
        avg_cp_loss = bucket["cp_loss_sum"] / bucket["cp_loss_count"] if bucket["cp_loss_count"] else 0.0

        # Motif dominante = piu` frequente
        motif_counts = bucket["motif_counts"]
        dominant_motif = None
        if motif_counts:
            dominant_motif = max(motif_counts.items(), key=lambda kv: kv[1])[0]

        confidence = "high" if n_games >= 10 else "medium" if n_games >= 4 else "low"

        # Openings breakdown (top 8 ECO che funnel in questa struttura)
        openings_breakdown = []
        for (eco, opening_name), eco_b in bucket["eco_counts"].items():
            n_g = eco_b["n_games"]
            wr = (eco_b["wins"] / n_g) if n_g > 0 else None
            openings_breakdown.append({
                "eco": eco,
                "opening": opening_name,
                "n_games": n_g,
                "wins": eco_b["wins"],
                "losses": eco_b["losses"],
                "draws": eco_b["draws"],
                "win_rate": round(wr, 3) if wr is not None else None,
            })
        openings_breakdown.sort(key=lambda x: x["n_games"], reverse=True)
        openings_breakdown = openings_breakdown[:8]

        # Sample positions (top 6 con cp_loss più alto — sono quelle "dove cadi peggio")
        sorted_pos = sorted(bucket["all_positions"],
                            key=lambda p: p["cp_loss"] or 0, reverse=True)
        sample_positions = []
        seen_games_for_samples: set[str] = set()
        for p in sorted_pos:
            if p["game_id"] in seen_games_for_samples:
                continue  # 1 sample per game per varietà
            seen_games_for_samples.add(p["game_id"])
            sample_positions.append({
                "game_id": p["game_id"],
                "ply": p["ply"],
                "move_number": p["move_number"],
                "fen_before": p["fen_before"],
                "cp_loss": p["cp_loss"],
                "cp_before": p["cp_before"],
                "cp_after": p["cp_after"],
                "san": p["san"],
                "best_san_sf": p["best_san_sf"],
                "motif": p["motif"],
                "motif_label_it": p["motif_label_it"],
                "phase": p["phase"],
                "my_color": p["my_color"],
                "date": p["date"],
                "opp_rating": p["opp_rating"],
                "opening": p["opening"],
                "eco": p["eco"],
                "url": p["url"],
                "result": p["result"],
                "last_opp_from": p["last_opp_from"],
                "last_opp_to": p["last_opp_to"],
                "last_opp_san": p["last_opp_san"],
                "p_mine_plays_best_sf": p["p_mine_plays_best_sf"],
                "p_target_plays_best_sf": p["p_target_plays_best_sf"],
                "drill_value": p["drill_value"],
                "motif_hanging_piece": p["motif_hanging_piece"],
                "motif_fork": p["motif_fork"],
                "motif_removed_defender": p["motif_removed_defender"],
                "motif_back_rank": p["motif_back_rank"],
                "motif_discovered_attack": p["motif_discovered_attack"],
            })
            if len(sample_positions) >= 6:
                break

        # Games sample (top 12 partite distinte ordinate per data desc)
        games_seen: dict[str, dict[str, Any]] = {}
        for p in bucket["all_positions"]:
            gid = p["game_id"]
            if gid not in games_seen:
                games_seen[gid] = {
                    "game_id": gid,
                    "date": p["date"],
                    "opp_rating": p["opp_rating"],
                    "opening": p["opening"],
                    "eco": p["eco"],
                    "my_color": p["game_my_color"],
                    "result": p["result"],
                    "url": p["url"],
                    "n_positions_in_struct": 1,
                    "worst_cp_loss": p["cp_loss"] or 0,
                }
            else:
                games_seen[gid]["n_positions_in_struct"] += 1
                games_seen[gid]["worst_cp_loss"] = max(
                    games_seen[gid]["worst_cp_loss"], p["cp_loss"] or 0
                )
        games_sample = sorted(games_seen.values(),
                              key=lambda g: (g["date"] or ""), reverse=True)[:12]

        out.append({
            "key": key,
            "label_it": STRUCTURE_LABELS.get(key, key),
            "n_positions": bucket["n_positions"],
            "n_games": n_games,
            "wins": wins,
            "losses": losses,
            "draws": draws,
            "win_rate": round(win_rate, 3) if win_rate is not None else None,
            "avg_cp_loss": round(avg_cp_loss, 1),
            "dominant_motif": dominant_motif,
            "confidence": confidence,
            "openings_breakdown": openings_breakdown,
            "sample_positions": sample_positions,
            "games_sample": games_sample,
        })

    # Sort per impatto: n_positions desc come proxy (le strutture in cui giochi piu`)
    out.sort(key=lambda x: x["n_positions"], reverse=True)
    return out


def _is_win(result: str | None, my_color: str | None) -> bool:
    if not result or not my_color:
        return False
    r = result.lower()
    if my_color == "white":
        return r in ("1-0", "white", "win")
    return r in ("0-1", "black", "win")


def _is_loss(result: str | None, my_color: str | None) -> bool:
    if not result or not my_color:
        return False
    r = result.lower()
    if my_color == "white":
        return r in ("0-1", "loss")
    return r in ("1-0", "loss")


# ---------------------------------------------------------------------------
# CLI per debug standalone
# ---------------------------------------------------------------------------


def main() -> None:
    import argparse
    import json
    from pathlib import Path

    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/positions.db")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = Path(__file__).resolve().parent.parent / db_path

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    out = analyze_player_structures(conn)
    conn.close()

    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
