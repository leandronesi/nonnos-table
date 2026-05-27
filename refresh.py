"""Pipeline completa locale — replica di .github/workflows/refresh-and-deploy.yml.

Uso:
  python refresh.py            # pipeline completa
  python refresh.py fast       # skip analyze --deep
  python refresh.py coachonly  # solo player_model + coach

Prerequisiti: venv attivo, Stockfish raggiungibile, OPENAI_API_KEY in .env.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
PY = sys.executable  # usa lo stesso interprete del venv corrente

MODE = sys.argv[1] if len(sys.argv) > 1 else "full"

STEPS_FULL = [
    ("1/10  Ingest Chess.com (partite nuove)",     ["backend/ingest.py"],                  True),
    ("2a/10 Analyze --deep",                       ["backend/analyze.py", "--deep"],       True),
    ("2b/10 Analyze",                              ["backend/analyze.py"],                 True),
    ("3/10  Build positions DB",                   ["backend/build_positions_db.py"],      True),
    ("4/10  Maia features",                        ["backend/maia_features.py"],           False),  # opzionale
    ("5/10  Derive features",                      ["backend/derive_features.py"],         True),
    ("6/10  Enrich decisions",                     ["backend/enrich_decisions.py"],        True),
    ("7/10  Tactical patterns (motif tagging)",    ["backend/tactical_patterns.py"],       True),
    ("8/10  Compute waiting_moves",                ["backend/compute_waiting_moves.py"],   False),  # opzionale
    ("9/10  Player model build",                   ["backend/player_model.py"],            True),
    ("10/10 Coach LLM (brief + voce + session)",   ["backend/coach.py"],                   True),
]

STEPS_FAST = [s for s in STEPS_FULL if "--deep" not in s[1]]
STEPS_COACHONLY = [s for s in STEPS_FULL if s[1][0] in ("backend/ingest.py", "backend/player_model.py", "backend/coach.py")]

steps = {"full": STEPS_FULL, "fast": STEPS_FAST, "coachonly": STEPS_COACHONLY}.get(MODE, STEPS_FULL)


def run(label: str, args: list[str], required: bool) -> bool:
    print(f"\n=== [{label}] ===", flush=True)
    cmd = [PY, *args]
    result = subprocess.run(cmd, cwd=str(REPO))
    if result.returncode != 0:
        if required:
            print(f"\n=== ERRORE === Step '{label}' fallito (exit {result.returncode}). Pipeline interrotta.")
            sys.exit(result.returncode)
        else:
            print(f"  (step '{label}' saltato — non bloccante)")
    return result.returncode == 0


print(f"Pipeline refresh — modalità: {MODE}")
print(f"Repo: {REPO}")
print(f"Python: {PY}")

for label, args, required in steps:
    run(label, args, required)

print("\n=== DONE === Pipeline completata. Hard-reload del browser su localhost.")
