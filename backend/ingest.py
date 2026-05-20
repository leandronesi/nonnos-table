"""Strato 1 — Ingestion delle partite da Chess.com.

Per ogni mese disponibile dell'archivio pubblico salva:
  - data/raw/<YYYY-MM>.pgn  → concatenazione di tutti i PGN del mese
  - data/raw/<YYYY-MM>.json → metadati richiesti dall'API (utile per debugging)

Mantiene un indice unico in data/index.json con una riga per partita
(estraendo metadati comodi per il resto della pipeline, dal MIO punto di vista).

Idempotenza: i mesi già scaricati vengono saltati, *tranne* l'ultimo mese
(in corso) che viene sempre re-fetchato perché può contenere partite nuove.
"""

from __future__ import annotations

import io
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import chess.pgn
import requests
from tqdm import tqdm

from config_loader import load_config

log = logging.getLogger("ingest")


def _session(user_agent: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": user_agent, "Accept": "application/json"})
    return s


def _get_with_retry(
    s: requests.Session,
    url: str,
    *,
    max_retries: int,
    initial_backoff: float,
    sleep_between: float,
) -> requests.Response:
    """GET con backoff esponenziale su 429/5xx."""
    delay = initial_backoff
    for attempt in range(1, max_retries + 1):
        resp = s.get(url, timeout=30)
        if resp.status_code == 200:
            time.sleep(sleep_between)
            return resp
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_retries:
            log.warning("HTTP %s su %s — retry %d in %.1fs", resp.status_code, url, attempt, delay)
            time.sleep(delay)
            delay *= 2
            continue
        resp.raise_for_status()
    resp.raise_for_status()
    return resp  # unreachable


def list_archives(s: requests.Session, username: str, **retry_kw) -> list[str]:
    url = f"https://api.chess.com/pub/player/{username}/games/archives"
    r = _get_with_retry(s, url, **retry_kw)
    return r.json().get("archives", [])


def fetch_month(s: requests.Session, archive_url: str, **retry_kw) -> dict[str, Any]:
    return _get_with_retry(s, archive_url, **retry_kw).json()


def _result_from_my_pov(my_color: str, white_result: str, black_result: str) -> str:
    """Converte i due `result` Chess.com nel mio risultato {'win','loss','draw'}.

    Chess.com mette 'win' al vincitore e a chi non vince un codice di tipo perdita
    (resigned, timeout, checkmated, stalemate, agreed, repetition, ...).
    """
    me = white_result if my_color == "white" else black_result
    opp = black_result if my_color == "white" else white_result
    if me == "win":
        return "win"
    if opp == "win":
        return "loss"
    return "draw"


def _extract_index_entry(game: dict[str, Any], username: str) -> dict[str, Any] | None:
    """Estrae i metadati comodi per la pipeline."""
    white = game.get("white") or {}
    black = game.get("black") or {}
    w_user = (white.get("username") or "").lower()
    b_user = (black.get("username") or "").lower()
    me = username.lower()
    if me == w_user:
        my_color = "white"
        my_rating = white.get("rating")
        opp_rating = black.get("rating")
    elif me == b_user:
        my_color = "black"
        my_rating = black.get("rating")
        opp_rating = white.get("rating")
    else:
        # Partita in cui non sono coinvolto (non dovrebbe succedere via /pub/player/<me>)
        return None

    pgn_text = game.get("pgn") or ""
    # Estrai ECO/Opening name parsando il PGN
    eco = None
    opening_name = None
    num_moves = None
    try:
        pgn_io = io.StringIO(pgn_text)
        parsed = chess.pgn.read_game(pgn_io)
        if parsed is not None:
            eco = parsed.headers.get("ECO") or None
            opening_name = (
                parsed.headers.get("Opening")
                or parsed.headers.get("ECOUrl")
                or None
            )
            # ECOUrl è una URL tipo .../openings/Sicilian-Defense...; lo usiamo come fallback
            if opening_name and opening_name.startswith("http"):
                opening_name = opening_name.rsplit("/", 1)[-1].replace("-", " ")
            # conta ply e converti a mosse
            ply = 0
            node = parsed
            while node.variations:
                node = node.variation(0)
                ply += 1
            num_moves = (ply + 1) // 2
    except Exception as e:  # noqa: BLE001
        log.debug("PGN parse fail per %s: %s", game.get("url"), e)

    end_time = game.get("end_time")
    end_iso = (
        datetime.fromtimestamp(end_time, tz=timezone.utc).isoformat()
        if isinstance(end_time, int)
        else None
    )

    return {
        "id": game.get("uuid") or game.get("url"),
        "url": game.get("url"),
        "end_time_iso": end_iso,
        "end_time_epoch": end_time,
        "time_class": game.get("time_class"),
        "time_control": game.get("time_control"),
        "rated": game.get("rated"),
        "my_color": my_color,
        "my_rating": my_rating,
        "opp_rating": opp_rating,
        "result": _result_from_my_pov(
            my_color, white.get("result", ""), black.get("result", "")
        ),
        "eco": eco,
        "opening": opening_name,
        "num_moves": num_moves,
        "rules": game.get("rules"),
    }


def run(cfg: dict[str, Any]) -> None:
    chess_cfg = cfg["chess_com"]
    paths = cfg["paths"]
    username = chess_cfg["username"]
    if not username or username.startswith("<"):
        raise SystemExit("Imposta chess_com.username in config.yaml")

    raw_dir = Path(paths["raw_dir"])
    raw_dir.mkdir(parents=True, exist_ok=True)
    index_path = Path(paths["index_file"])
    index_path.parent.mkdir(parents=True, exist_ok=True)

    retry_kw = dict(
        max_retries=chess_cfg["max_retries"],
        initial_backoff=chess_cfg["initial_backoff_seconds"],
        sleep_between=chess_cfg["request_sleep_seconds"],
    )

    s = _session(chess_cfg["user_agent"])
    log.info("Recupero lista archivi per %s…", username)
    archives = list_archives(s, username, **retry_kw)
    if chess_cfg.get("last_n_months"):
        archives = archives[-int(chess_cfg["last_n_months"]) :]
    log.info("Archivi da processare: %d", len(archives))

    # L'ultimo mese (in corso) lo rifaccio sempre per pescare partite nuove.
    last_archive = archives[-1] if archives else None

    # Indice cumulativo (dedupe per id)
    index: dict[str, dict[str, Any]] = {}
    if index_path.exists():
        try:
            index = {row["id"]: row for row in json.loads(index_path.read_text(encoding="utf-8"))}
        except Exception:  # noqa: BLE001
            log.warning("index.json corrotto, ricreo da zero")
            index = {}

    total_new = 0
    for url in tqdm(archives, desc="Mesi", unit="mese"):
        ym = "/".join(url.rstrip("/").split("/")[-2:])  # "YYYY/MM"
        ym_flat = ym.replace("/", "-")  # "YYYY-MM"
        pgn_file = raw_dir / f"{ym_flat}.pgn"
        json_file = raw_dir / f"{ym_flat}.json"

        is_last = url == last_archive
        if pgn_file.exists() and json_file.exists() and not is_last:
            # mese chiuso → già scaricato, skip
            for g in json.loads(json_file.read_text(encoding="utf-8")).get("games", []):
                entry = _extract_index_entry(g, username)
                if entry:
                    index[entry["id"]] = entry
            continue

        data = fetch_month(s, url, **retry_kw)
        games = data.get("games", [])
        json_file.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        with pgn_file.open("w", encoding="utf-8") as f:
            for g in games:
                pgn = g.get("pgn")
                if pgn:
                    f.write(pgn.strip() + "\n\n")

        new_this_month = 0
        for g in games:
            entry = _extract_index_entry(g, username)
            if entry is None:
                continue
            if entry["id"] not in index:
                new_this_month += 1
            index[entry["id"]] = entry
        total_new += new_this_month
        log.debug("%s: %d partite (%d nuove)", ym, len(games), new_this_month)

    # Salva indice ordinato per data
    rows = sorted(
        index.values(),
        key=lambda r: r.get("end_time_epoch") or 0,
    )
    index_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Indicizzate %d partite (+%d nuove). Index: %s", len(rows), total_new, index_path)


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
