"""SPRINT 3 v2 — Maia + policy completa (difficulty-as-money).

Per ogni posizione CRITICA chiediamo a due istanze di Maia (mio livello +
target) la policy COMPLETA su tutte le mosse legali. Non solo "qual e` la
top move", ma "con che probabilita` ogni mossa viene giocata a quel livello".

Cosa ne caviamo:
  best_san_maia_mine        — top move secondo Maia@mio livello
  best_san_maia_target      — top move secondo Maia@target
  p_maia_mine_top           — probabilita` della top move di Maia@mio
  p_maia_target_top         — probabilita` della top move di Maia@target
  move_difficulty           — 1 - p_maia_target_top  (la posizione e` ambigua anche per il target?)
  p_mine_plays_best_sf      — Maia@mio quanto spesso giocherebbe la mossa "giusta" (Stockfish)
  p_target_plays_best_sf    — Maia@target idem

La punchline del drill diventa:
  "il 78% dei 1600 trova questa mossa, al tuo livello la trova il 23%"
                              = p_target_plays_best_sf       = p_mine_plays_best_sf

Implementazione: lc0 con `--verbose-move-stats` stampa per ogni mossa una
riga `info string <uci> ... (P: XX.YY%) ...`. Parsing diretto del subprocess
UCI: piu` semplice di tentare di farselo dare da python-chess che non espone
le info-string streaming via SimpleEngine.
"""

from __future__ import annotations

import argparse
import logging
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import chess
from tqdm import tqdm

from config_loader import load_config
from positions_db import connect, init_schema

log = logging.getLogger("maia")

# Pesi Maia disponibili (passo 100, da 1100 a 1900).
_AVAILABLE_MAIA = (1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900)


def nearest_maia(rating: int) -> int:
    return min(_AVAILABLE_MAIA, key=lambda x: abs(x - rating))


# ---------------------------------------------------------------------------
# Maia subprocess UCI client con policy parsing
# ---------------------------------------------------------------------------

# Esempio riga: "info string e2e4  (242 ) N:       1 (+ 0) (P: 38.50%) (WL: ...)"
_POLICY_RE = re.compile(
    r"^info string\s+(?P<uci>[a-h][1-8][a-h][1-8][qrbn]?)\b.*\(P:\s+(?P<p>[\d.]+)%\)"
)


def _uci_to_san_with_castle_fix(board: chess.Board, uci: str) -> str | None:
    """Converti UCI emesso da lc0 in SAN sul board dato.

    Gestisce il caso lc0/Chess960 in cui il rocco e` rappresentato come
    "e1h1" (re va sulla torre) invece dello standard "e1g1".
    """
    try:
        mv = chess.Move.from_uci(uci)
    except ValueError:
        return None
    if mv in board.legal_moves:
        return board.san(mv)

    # Possibile rocco stile chess960: re-cattura-torre (e1h1 / e1a1 / e8h8 / e8a8).
    castle_map = {
        (chess.E1, chess.H1): chess.G1,
        (chess.E1, chess.A1): chess.C1,
        (chess.E8, chess.H8): chess.G8,
        (chess.E8, chess.A8): chess.C8,
    }
    alt_to = castle_map.get((mv.from_square, mv.to_square))
    if alt_to is None:
        return None
    alt = chess.Move(mv.from_square, alt_to)
    if alt in board.legal_moves and board.is_castling(alt):
        return board.san(alt)
    return None


class MaiaPolicy:
    """Wraps un processo lc0 con VerboseMoveStats attivo.

    Uso:
        with MaiaPolicy(lc0_path, weights) as m:
            policy_dict = m.policy(fen)  # {uci_move: prob_0_to_1}

    Riusa lo stesso processo per tutte le posizioni (no fork-bomb).
    """

    def __init__(self, lc0_path: Path, weights: Path, threads: int = 1, backend: str = "eigen") -> None:
        if not lc0_path.exists():
            raise FileNotFoundError(f"lc0 non trovato: {lc0_path}")
        if not weights.exists():
            raise FileNotFoundError(f"peso Maia non trovato: {weights}")

        self.proc = subprocess.Popen(
            [
                str(lc0_path),
                f"--weights={weights}",
                f"--threads={threads}",
                f"--backend={backend}",
                "--verbose-move-stats",
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
        )
        self._handshake()

    def _handshake(self) -> None:
        self._send("uci")
        self._wait_for("uciok", timeout_lines=2000)
        self._send("setoption name VerboseMoveStats value true")
        self._send("isready")
        self._wait_for("readyok", timeout_lines=200)

    def _send(self, line: str) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()

    def _readline(self) -> str:
        assert self.proc.stdout is not None
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("lc0 ha chiuso lo stdout (process morto)")
        return line.rstrip("\r\n")

    def _wait_for(self, target: str, timeout_lines: int = 5000) -> None:
        for _ in range(timeout_lines):
            line = self._readline()
            if line.strip() == target:
                return
        raise RuntimeError(f"timeout aspettando '{target}' da lc0")

    def policy(self, fen: str) -> dict[str, float]:
        """Ritorna {san_move: probabilita`} per tutte le mosse legali al fen.

        Usiamo SAN come chiave per evitare ambiguita` UCI sul rocco (lc0 puo`
        emettere "e1g1" standard o "e1h1" chess960 — il SAN "O-O" e` univoco).

        Se la posizione e` terminale o invalida, ritorna {}.
        """
        try:
            board = chess.Board(fen)
        except ValueError:
            return {}
        if board.is_game_over():
            return {}

        self._send(f"position fen {fen}")
        self._send("go nodes 1")

        result: dict[str, float] = {}
        for _ in range(2000):
            line = self._readline()
            if line.startswith("bestmove"):
                break
            m = _POLICY_RE.match(line)
            if not m:
                continue
            uci = m.group("uci")
            prob = float(m.group("p")) / 100.0
            san = _uci_to_san_with_castle_fix(board, uci)
            if san is not None:
                result[san] = prob
        return result

    def __enter__(self) -> "MaiaPolicy":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def close(self) -> None:
        try:
            self._send("quit")
            self.proc.wait(timeout=5)
        except Exception:  # noqa: BLE001
            self.proc.kill()


# ---------------------------------------------------------------------------
# Pipeline: arricchimento del DB
# ---------------------------------------------------------------------------


def _positions_to_enrich(conn: sqlite3.Connection, force: bool) -> list[sqlite3.Row]:
    if force:
        sql = "SELECT game_id, ply, fen_before, best_san_sf FROM positions WHERE is_critical=1"
    else:
        sql = (
            "SELECT game_id, ply, fen_before, best_san_sf FROM positions "
            "WHERE is_critical=1 AND "
            "(p_maia_target_top IS NULL OR p_target_plays_best_sf IS NULL)"
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
    init_schema(conn)  # idempotent, applica migrazioni se mancano

    rows = _positions_to_enrich(conn, force=force)
    if limit:
        rows = rows[:limit]
    log.info("Posizioni critiche da arricchire: %d", len(rows))
    if not rows:
        conn.close()
        return {"enriched": 0, "total": 0}

    log.info("Avvio engine: mine=%s target=%s", weights_mine.name, weights_target.name)
    enriched = 0
    skipped_empty_policy = 0
    with MaiaPolicy(lc0_path, weights_mine) as m_mine, MaiaPolicy(lc0_path, weights_target) as m_target:
        for r in tqdm(rows, desc="Maia policy", unit="pos"):
            fen = r["fen_before"]
            best_san_sf = r["best_san_sf"]

            try:
                board = chess.Board(fen)
            except ValueError:
                continue

            pol_mine = m_mine.policy(fen)
            pol_target = m_target.policy(fen)

            if not pol_mine or not pol_target:
                skipped_empty_policy += 1
                continue

            best_san_maia_mine = max(pol_mine, key=lambda k: pol_mine[k])
            best_san_maia_target = max(pol_target, key=lambda k: pol_target[k])

            p_mine_top = pol_mine[best_san_maia_mine]
            p_target_top = pol_target[best_san_maia_target]
            p_mine_plays_best = pol_mine.get(best_san_sf, 0.0) if best_san_sf else None
            p_target_plays_best = pol_target.get(best_san_sf, 0.0) if best_san_sf else None
            move_difficulty = 1.0 - p_target_top

            conn.execute(
                """
                UPDATE positions SET
                    best_san_maia_mine=?,
                    best_san_maia_target=?,
                    p_maia_mine_top=?,
                    p_maia_target_top=?,
                    move_difficulty=?,
                    p_mine_plays_best_sf=?,
                    p_target_plays_best_sf=?
                WHERE game_id=? AND ply=?
                """,
                (
                    best_san_maia_mine,
                    best_san_maia_target,
                    p_mine_top,
                    p_target_top,
                    move_difficulty,
                    p_mine_plays_best,
                    p_target_plays_best,
                    r["game_id"],
                    r["ply"],
                ),
            )
            enriched += 1
            if enriched % 100 == 0:
                conn.commit()
        conn.commit()

    log.info(
        "Maia: arricchite %d posizioni (skip per policy vuota: %d)",
        enriched,
        skipped_empty_policy,
    )
    conn.close()
    return {
        "enriched": enriched,
        "total": len(rows),
        "skipped_empty_policy": skipped_empty_policy,
    }


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
    parser.add_argument("--mine", type=int, default=None, help="Rating per Maia 'mio livello'.")
    parser.add_argument("--target", type=int, default=1600, help="Rating per Maia 'target' (default 1600)")
    parser.add_argument("--force", action="store_true", help="ri-elabora tutte le posizioni critiche")
    parser.add_argument("--limit", type=int, default=None, help="limita a N posizioni (smoke test)")
    args = parser.parse_args()

    cfg = load_config()
    repo_root = Path(__file__).resolve().parent.parent
    lc0_dir = repo_root / "engine" / "lc0"
    explicit = cfg.get("maia", {}).get("lc0_path")
    if explicit:
        lc0_path = Path(explicit)
    elif (lc0_dir / "lc0.exe").exists():
        lc0_path = lc0_dir / "lc0.exe"
    elif (lc0_dir / "lc0").exists():
        lc0_path = lc0_dir / "lc0"
    else:
        lc0_path = lc0_dir / "lc0"
    maia_dir = Path(cfg.get("maia", {}).get("weights_dir") or repo_root / "engine" / "maia")

    db_path = Path(cfg["paths"].get("positions_db", "data/positions.db"))
    if not db_path.is_absolute():
        db_path = repo_root / db_path

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
