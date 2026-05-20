"""Copia i payload di data/analysis/*.json in frontend/public/analysis/.

Servono al `GameDetail` della dashboard quando gira come SPA statica (GitHub
Pages), dove non c'è backend. Per ogni partita la dashboard farà:
    GET /analysis/<safe_game_id>.json
"""

from __future__ import annotations

import json
import logging
import shutil
import sys
from pathlib import Path

from config_loader import load_config

log = logging.getLogger("export")


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    cfg = load_config()
    src = Path(cfg["paths"]["analysis_dir"])
    if not src.exists():
        raise SystemExit(f"{src} non esiste — lancia prima `python backend/analyze.py`.")

    repo_root = Path(__file__).resolve().parent.parent
    dst = repo_root / "frontend" / "public" / "analysis"
    dst.mkdir(parents=True, exist_ok=True)

    # Pulisci la dst prima di ricopiare, così i game_id rimossi spariscono.
    for old in dst.glob("*.json"):
        old.unlink()

    n = 0
    for f in src.glob("*.json"):
        # Le ricopiamo "minified" (no indent) per ridurre il peso del bundle deploy.
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            log.warning("skip %s: %s", f, e)
            continue
        (dst / f.name).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        n += 1

    log.info("Esportate %d analisi in %s", n, dst)


if __name__ == "__main__":
    main()
