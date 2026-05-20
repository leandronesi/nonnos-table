"""Caricamento config.yaml + .env, con risoluzione del path Stockfish.

Logica del path engine (in ordine di priorità):
  1. env var STOCKFISH_PATH (da .env o shell)
  2. config.yaml > stockfish.path
  3. eseguibile `stockfish` (o `stockfish.exe`) nel PATH
  4. ./engine/stockfish[.exe] (binario portable in repo)
  5. percorsi noti di winget su Windows

Se nessuno funziona, alza un errore esplicito con istruzioni d'install.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_yaml() -> dict[str, Any]:
    cfg_path = REPO_ROOT / "config.yaml"
    if not cfg_path.exists():
        raise FileNotFoundError(f"config.yaml non trovato: {cfg_path}")
    with cfg_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_config() -> dict[str, Any]:
    """Ritorna il dict di config con override dalle env var."""
    load_dotenv(REPO_ROOT / ".env", override=False)
    cfg = _load_yaml()

    # Override username via env
    env_user = os.environ.get("CHESS_USERNAME")
    if env_user:
        cfg.setdefault("chess_com", {})["username"] = env_user

    # Path stockfish via env ha precedenza assoluta
    env_sf = os.environ.get("STOCKFISH_PATH")
    if env_sf:
        cfg.setdefault("stockfish", {})["path"] = env_sf

    # Tutti i path relativi diventano assoluti rispetto al repo root
    paths = cfg.setdefault("paths", {})
    for k, v in list(paths.items()):
        if isinstance(v, str):
            p = Path(v)
            if not p.is_absolute():
                paths[k] = str((REPO_ROOT / p).resolve())

    return cfg


def _candidate_stockfish_paths() -> list[Path]:
    """Lista di posti dove cercare Stockfish."""
    out: list[Path] = []
    is_win = sys.platform.startswith("win")
    exe = "stockfish.exe" if is_win else "stockfish"

    # PATH
    which = shutil.which("stockfish")
    if which:
        out.append(Path(which))

    # ./engine/ (sia path canonico che ricorsivo, per supportare zip estratti as-is)
    engine_dir = REPO_ROOT / "engine"
    out.append(engine_dir / exe)
    if engine_dir.exists():
        for cand in engine_dir.rglob("stockfish*.exe" if is_win else "stockfish*"):
            if cand.is_file():
                out.append(cand)

    # Windows: cartelle note di winget per Stockfish.Stockfish
    if is_win:
        local = Path(os.environ.get("LOCALAPPDATA", ""))
        winget_root = local / "Microsoft" / "WinGet" / "Packages"
        if winget_root.exists():
            for sub in winget_root.glob("Stockfish.Stockfish_*"):
                # Il binario ha nomi variabili (es. stockfish-windows-x86-64-avx2.exe).
                for cand in sub.rglob("stockfish*.exe"):
                    out.append(cand)

    return out


def resolve_stockfish_path(cfg: dict[str, Any]) -> Path:
    """Risolve un Path a Stockfish funzionante, o alza FileNotFoundError."""
    explicit = (cfg.get("stockfish") or {}).get("path")
    if explicit:
        p = Path(explicit)
        if p.exists():
            return p
        raise FileNotFoundError(
            f"stockfish.path in config indica '{p}' ma il file non esiste."
        )

    for cand in _candidate_stockfish_paths():
        if cand.exists():
            return cand

    raise FileNotFoundError(
        "Stockfish non trovato. Opzioni:\n"
        "  1) winget install Stockfish.Stockfish, poi rilancia (path verrà auto-rilevato)\n"
        "  2) scarica binario da https://stockfishchess.org/download/ in ./engine/stockfish.exe\n"
        "  3) imposta STOCKFISH_PATH=<percorso assoluto> in .env"
    )
