"""Strato 2 — Analisi Stockfish.

Per ogni partita in data/raw/<YYYY-MM>.json:
  - ricostruisce la sequenza di posizioni
  - per ogni MIA mossa fa valutare prima/dopo da Stockfish
  - calcola la centipawn loss dal mio punto di vista
  - classifica la mossa (best / inaccuracy / mistake / blunder)
  - identifica la fase di gioco (opening / middlegame / endgame)
  - per mistake/blunder salva: best_san (mossa migliore), pv_san (primi 5 ply),
    fen_before (posizione prima della mossa), motif (tipo tattico semplice)

Output per partita: data/analysis/<game_id>.json (cache).
Riusa una singola istanza Stockfish per partita.
Parallelizza N partite con multiprocessing.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import multiprocessing as mp
import os
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

import chess
import chess.engine
import chess.pgn
from tqdm import tqdm

from config_loader import load_config, resolve_stockfish_path

log = logging.getLogger("analyze")

EVAL_CAP_CP = 1000


# ----------------------------- fasi di gioco ---------------------------------

_PIECE_VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
_PIECE_VAL_NO_PAWN = {chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def _phase_score(board: chess.Board) -> int:
    s = 0
    for ptype, val in _PIECE_VAL_NO_PAWN.items():
        s += val * (
            len(board.pieces(ptype, chess.WHITE)) + len(board.pieces(ptype, chess.BLACK))
        )
    return s


def detect_phase(board_before_move: chess.Board, cfg_phases: dict[str, Any]) -> str:
    full_move = board_before_move.fullmove_number
    if full_move <= int(cfg_phases.get("opening_until_move", 12)):
        return "opening"
    if _phase_score(board_before_move) <= int(cfg_phases.get("endgame_material_threshold", 24)):
        return "endgame"
    return "middlegame"


def _total_material(board: chess.Board, color: bool) -> int:
    """Somma valore pezzi (re escluso) per il colore dato."""
    s = 0
    for ptype, val in _PIECE_VAL.items():
        s += val * len(board.pieces(ptype, color))
    return s


# ----------------------------- valutazione -----------------------------------


def _eval_cp_for_white(info: dict[str, Any]) -> int:
    score = info["score"].white()
    if score.is_mate():
        m = score.mate() or 0
        return EVAL_CAP_CP if m > 0 else -EVAL_CAP_CP
    cp = score.score()
    if cp is None:
        return 0
    return max(-EVAL_CAP_CP, min(EVAL_CAP_CP, cp))


def _is_mate_score(info: dict[str, Any]) -> tuple[bool, int]:
    score = info["score"].white()
    if score.is_mate():
        return True, score.mate() or 0
    return False, 0


def _categorize(cp_loss: int, thr: dict[str, int]) -> str:
    if cp_loss >= thr["blunder"]:
        return "blunder"
    if cp_loss >= thr["mistake"]:
        return "mistake"
    if cp_loss >= thr["inaccuracy"]:
        return "inaccuracy"
    return "ok"


def _pv_to_san(board: chess.Board, pv: list[chess.Move], max_plies: int = 5) -> list[str]:
    out = []
    b = board.copy()
    for mv in pv[:max_plies]:
        if mv not in b.legal_moves:
            break
        out.append(b.san(mv))
        b.push(mv)
    return out


# ----------------------------- motif tattico ---------------------------------


def _classify_motif(
    board_before: chess.Board,
    board_after: chess.Board,
    my_color: bool,
    cp_before: int,
    cp_after: int,
    cp_loss: int,
    next_info_white_cp: int,
    next_info_is_mate: bool,
    next_info_mate_in: int,
) -> str | None:
    """Etichetta semplice del tipo di errore. None se la mossa è OK.

    Regole (ordine di priorità):
      1. allowed_mate          → permetto matto in N (dopo la mia mossa l'avversario ha mate)
      2. material_loss         → perdo materiale netto (>= 3 punti) DOPO la mossa
      3. winning_to_lost       → la valutazione passa da > +200 a < -100 (o viceversa)
      4. winning_advantage_thrown → da > +200 a tra -100 e +100 (ho buttato il vantaggio)
      5. positional_blunder    → tutto il resto
    """
    if cp_loss < 50:  # sotto inaccuracy threshold, niente motif
        return None

    # 1. Permetto matto (dal mio POV cp_after è -inf, il prossimo info dice mate per l'avv)
    if next_info_is_mate:
        # Convertiamo dal POV bianco al mio POV: se sono nero, il segno si inverte
        mate_for_me = next_info_mate_in if my_color == chess.WHITE else -next_info_mate_in
        if mate_for_me < 0:
            return "allowed_mate"

    # 2. Material loss: pezzi del MIO colore prima vs dopo
    my_mat_before = _total_material(board_before, my_color)
    my_mat_after = _total_material(board_after, my_color)
    delta = my_mat_before - my_mat_after
    # Cattura "normale" dell'avversario: se l'avversario può catturare un mio pezzo
    # dopo la mossa, devo guardare la posizione DOPO che lui ha catturato. Approssimazione
    # semplice: se la valutazione è crollata e la differenza materiale (corrente vs prima)
    # è almeno 2 punti, è un material loss. In più, anche se non è ancora cambiato il
    # materiale ma la valutazione successiva mostra che catturerà presto, lo segno comunque.
    if cp_loss >= 250 and delta >= 2:
        return "material_loss"
    # Se cp_after è molto basso (perso) e cp_loss alto, probabilmente sto perdendo materiale
    # nelle mosse subito successive (en prise).
    if cp_loss >= 250 and cp_after <= -200:
        return "material_loss"

    # 3. Da vincente a perso
    if cp_before >= 200 and cp_after <= -100:
        return "winning_to_lost"
    if cp_before <= -200 and cp_after >= 100:
        # Da perdente a vincente non è un blunder mio, è una mossa salvifica avversaria...
        # In realtà se sono io a muovere e la valutazione cresce, non è cp_loss > 0. Skip.
        pass

    # 4. Vantaggio buttato
    if cp_before >= 200 and abs(cp_after) <= 100:
        return "winning_advantage_thrown"

    # 5. Default
    return "positional_blunder"


# ----------------------------- analisi singola partita -----------------------


@dataclass
class MoveAnalysis:
    ply: int
    move_number: int
    san: str
    phase: str
    cp_before: int
    cp_after: int
    cp_loss: int
    category: str
    # Riempiti SOLO per mistake/blunder/inaccuracy:
    best_san: str | None = None
    pv_san: list[str] = field(default_factory=list)
    fen_before: str | None = None
    motif: str | None = None


def analyze_game(
    pgn_text: str,
    my_color: str,
    engine: chess.engine.SimpleEngine,
    *,
    depth: int | None,
    movetime_ms: int | None,
    cfg_phases: dict[str, Any],
    thresholds: dict[str, int],
) -> dict[str, Any] | None:
    pgn_io = io.StringIO(pgn_text)
    game = chess.pgn.read_game(pgn_io)
    if game is None:
        return None

    limit = (
        chess.engine.Limit(time=movetime_ms / 1000.0)
        if movetime_ms
        else chess.engine.Limit(depth=depth)
    )

    board = game.board()
    nodes = list(game.mainline())
    if not nodes:
        return None

    # Pre-calcolo: per ogni posizione (boards_before[i]) salvo eval (white cp) + pv.
    # `boards_before[i]` = posizione PRIMA della mossa i (per i in [0, len(nodes)]).
    boards_before: list[chess.Board] = [board.copy()]
    sans: list[str] = []

    # Info iniziale: posizione prima della mossa 0
    info0 = engine.analyse(board, limit)
    evals_white_cp: list[int] = [_eval_cp_for_white(info0)]
    is_mate_list: list[tuple[bool, int]] = [_is_mate_score(info0)]
    pv_list: list[list[chess.Move]] = [list(info0.get("pv") or [])]

    for node in nodes:
        san = board.san(node.move)
        board.push(node.move)
        sans.append(san)
        boards_before.append(board.copy())
        info = engine.analyse(board, limit)
        evals_white_cp.append(_eval_cp_for_white(info))
        is_mate_list.append(_is_mate_score(info))
        pv_list.append(list(info.get("pv") or []))

    my_is_white = my_color == "white"
    moves: list[MoveAnalysis] = []
    all_fens: list[str] = [b.fen() for b in boards_before]  # tutte le posizioni
    all_evals_my_pov: list[int] = []
    for i, w in enumerate(evals_white_cp):
        all_evals_my_pov.append(w if my_is_white else -w)

    for i, _node in enumerate(nodes):
        is_white_move = (i % 2 == 0)
        is_my_move = (is_white_move and my_is_white) or (not is_white_move and not my_is_white)
        if not is_my_move:
            continue

        board_before = boards_before[i]
        board_after = boards_before[i + 1]
        before_w = evals_white_cp[i]
        after_w = evals_white_cp[i + 1]
        if my_is_white:
            cp_before, cp_after = before_w, after_w
        else:
            cp_before, cp_after = -before_w, -after_w
        cp_loss = max(0, cp_before - cp_after)
        category = _categorize(cp_loss, thresholds)

        ma = MoveAnalysis(
            ply=i + 1,
            move_number=board_before.fullmove_number,
            san=sans[i],
            phase=detect_phase(board_before, cfg_phases),
            cp_before=cp_before,
            cp_after=cp_after,
            cp_loss=cp_loss,
            category=category,
        )

        # Arricchimento per mosse problematiche
        if category in ("inaccuracy", "mistake", "blunder"):
            ma.fen_before = boards_before[i].fen()
            ma.pv_san = _pv_to_san(boards_before[i], pv_list[i], max_plies=6)
            ma.best_san = ma.pv_san[0] if ma.pv_san else None
            next_is_mate, next_mate_in = is_mate_list[i + 1]
            ma.motif = _classify_motif(
                board_before=board_before,
                board_after=board_after,
                my_color=chess.WHITE if my_is_white else chess.BLACK,
                cp_before=cp_before,
                cp_after=cp_after,
                cp_loss=cp_loss,
                next_info_white_cp=after_w,
                next_info_is_mate=next_is_mate,
                next_info_mate_in=next_mate_in,
            )

        moves.append(ma)

    # ---- aggregati per partita -----------------------------------------------
    by_phase: dict[str, dict[str, int]] = {
        "opening": {"moves": 0, "cp_loss_sum": 0, "inaccuracy": 0, "mistake": 0, "blunder": 0},
        "middlegame": {"moves": 0, "cp_loss_sum": 0, "inaccuracy": 0, "mistake": 0, "blunder": 0},
        "endgame": {"moves": 0, "cp_loss_sum": 0, "inaccuracy": 0, "mistake": 0, "blunder": 0},
    }
    for m in moves:
        bp = by_phase[m.phase]
        bp["moves"] += 1
        bp["cp_loss_sum"] += m.cp_loss
        if m.category in ("inaccuracy", "mistake", "blunder"):
            bp[m.category] += 1

    motif_counts: dict[str, int] = {}
    for m in moves:
        if m.motif:
            motif_counts[m.motif] = motif_counts.get(m.motif, 0) + 1

    total_moves = len(moves)
    total_loss = sum(m.cp_loss for m in moves)
    acpl = (total_loss / total_moves) if total_moves else 0.0

    blunder_move_numbers = [m.move_number for m in moves if m.category == "blunder"]

    return {
        "moves": [asdict(m) for m in moves],
        "fens": all_fens,                      # 1 per ogni ply (len = num_moves+1)
        "evals_my_pov": all_evals_my_pov,      # eval per ogni ply, dal mio POV
        "summary": {
            "my_color": my_color,
            "n_my_moves": total_moves,
            "acpl": round(acpl, 2),
            "by_phase": by_phase,
            "counts": {
                "inaccuracy": sum(1 for m in moves if m.category == "inaccuracy"),
                "mistake": sum(1 for m in moves if m.category == "mistake"),
                "blunder": sum(1 for m in moves if m.category == "blunder"),
            },
            "motif_counts": motif_counts,
            "blunder_move_numbers": blunder_move_numbers,
            "first_blunder_move": blunder_move_numbers[0] if blunder_move_numbers else None,
            "worst_move_loss": max((m.cp_loss for m in moves), default=0),
        },
    }


# ----------------------------- multiprocessing -------------------------------


def _params_hash(profile: dict[str, Any], thr: dict[str, int]) -> str:
    h = hashlib.sha1()
    # Bumpiamo l'hash quando cambia lo SCHEMA dell'analisi (best_san, motif, fens…)
    payload = {"v": 2, "profile": profile, "thresholds": thr}
    h.update(json.dumps(payload, sort_keys=True).encode())
    return h.hexdigest()[:10]


_WORKER: dict[str, Any] = {}


def _init_worker(sf_path: str, threads: int, hash_mb: int, cfg_dump: dict[str, Any]) -> None:
    engine = chess.engine.SimpleEngine.popen_uci(sf_path)
    engine.configure({"Threads": threads, "Hash": hash_mb})
    _WORKER["engine"] = engine
    _WORKER["cfg"] = cfg_dump


def _worker_task(item: dict[str, Any]) -> tuple[str, dict[str, Any] | None, str | None]:
    engine: chess.engine.SimpleEngine = _WORKER["engine"]
    cfg = _WORKER["cfg"]
    try:
        result = analyze_game(
            pgn_text=item["pgn"],
            my_color=item["my_color"],
            engine=engine,
            depth=cfg["depth"],
            movetime_ms=cfg["movetime_ms"],
            cfg_phases=cfg["phases"],
            thresholds=cfg["thresholds"],
        )
        return item["game_id"], result, None
    except Exception as e:  # noqa: BLE001
        return item["game_id"], None, repr(e)


# ----------------------------- orchestrazione --------------------------------


def _load_pgn_index(cfg: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    raw_dir = Path(cfg["paths"]["raw_dir"])
    index_path = Path(cfg["paths"]["index_file"])
    if not index_path.exists():
        raise SystemExit("index.json non trovato. Lancia prima `python backend/ingest.py`.")

    rows = json.loads(index_path.read_text(encoding="utf-8"))
    pgn_by_id: dict[str, str] = {}
    for jf in sorted(raw_dir.glob("*.json")):
        data = json.loads(jf.read_text(encoding="utf-8"))
        for g in data.get("games", []):
            gid = g.get("uuid") or g.get("url")
            if gid and g.get("pgn"):
                pgn_by_id[gid] = g["pgn"]
    return rows, pgn_by_id


def run(cfg: dict[str, Any], *, deep: bool, limit: int | None) -> None:
    profile_name = "deep" if deep else "fast"
    profile = cfg["analysis"][profile_name]
    thresholds = cfg["analysis"]["thresholds"]
    phases = cfg["analysis"]["phases"]
    analysis_dir = Path(cfg["paths"]["analysis_dir"])
    analysis_dir.mkdir(parents=True, exist_ok=True)

    sf_path = resolve_stockfish_path(cfg)
    log.info("Stockfish: %s", sf_path)
    log.info("Profilo analisi: %s (%s)", profile_name, profile)

    rows, pgn_by_id = _load_pgn_index(cfg)
    rows = [r for r in rows if r["id"] in pgn_by_id]
    if limit:
        rows = rows[-int(limit):]

    params_h = _params_hash(profile, thresholds)
    log.info("Params hash: %s", params_h)

    todo: list[dict[str, Any]] = []
    skipped = 0
    for r in rows:
        out_file = analysis_dir / f"{_safe_id(r['id'])}.json"
        if out_file.exists():
            try:
                existing = json.loads(out_file.read_text(encoding="utf-8"))
                if existing.get("params_hash") == params_h:
                    skipped += 1
                    continue
            except Exception:  # noqa: BLE001
                pass
        todo.append(
            {
                "game_id": r["id"],
                "pgn": pgn_by_id[r["id"]],
                "my_color": r["my_color"],
                "out_file": str(out_file),
                "index_row": r,
            }
        )

    log.info("Da analizzare: %d (cache: %d)", len(todo), skipped)
    if not todo:
        return

    sf_cfg = cfg["stockfish"]
    cfg_workers = int(cfg["analysis"]["parallel_workers"])
    workers = cfg_workers if cfg_workers > 0 else min(4, max(1, (os.cpu_count() or 2) - 1))
    workers = min(workers, len(todo))
    log.info("Worker paralleli: %d", workers)

    cfg_dump = {
        "depth": profile.get("depth"),
        "movetime_ms": profile.get("movetime_ms"),
        "phases": phases,
        "thresholds": thresholds,
    }

    ctx = mp.get_context("spawn")
    init_args = (str(sf_path), int(sf_cfg["threads"]), int(sf_cfg["hash_mb"]), cfg_dump)
    with ctx.Pool(workers, initializer=_init_worker, initargs=init_args) as pool:
        for game_id, result, err in tqdm(
            pool.imap_unordered(_worker_task, todo, chunksize=1),
            total=len(todo),
            desc="Partite",
            unit="partita",
        ):
            if err:
                log.warning("Analisi fallita per %s: %s", game_id, err)
                continue
            if result is None:
                continue
            item = next(t for t in todo if t["game_id"] == game_id)
            payload = {
                "game_id": game_id,
                "params_hash": params_h,
                "profile": profile_name,
                "index": item["index_row"],
                "pgn": item["pgn"],   # PGN completo, comodo per drill-down
                "analysis": result,
            }
            Path(item["out_file"]).write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )


def _safe_id(s: str) -> str:
    return s.replace("/", "_").replace(":", "_").replace("?", "_").replace("&", "_")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    parser = argparse.ArgumentParser()
    parser.add_argument("--deep", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    cfg = load_config()
    run(cfg, deep=args.deep, limit=args.limit)


if __name__ == "__main__":
    main()
