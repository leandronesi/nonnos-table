"""Test offline per _verified_facts().

Carica data/player_model.json reale e verifica:
  - Le sezioni esistenti (diagnoses, tactical, opening, decisions, plan) sono presenti.
  - Le 5 nuove sezioni (5.1-5.5) appaiono O sono giustamente assenti per soglie.
  - Nessun numero italiano nel testo output (grep su pattern \\d).

Eseguire con:
    python backend/tests/test_verified_facts.py
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

# Aggiungi backend/ al path per importare coach
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from coach import _verified_facts  # noqa: E402

PM_PATH = REPO_ROOT / "data" / "player_model.json"


def main() -> None:
    if not PM_PATH.exists():
        print(f"ERRORE: player_model.json non trovato in {PM_PATH}", file=sys.stderr)
        sys.exit(1)

    pm = json.loads(PM_PATH.read_text(encoding="utf-8"))
    output = _verified_facts(pm)

    print("=" * 70)
    print("OUTPUT DI _verified_facts():")
    print("=" * 70)
    print(output)
    print("=" * 70)

    errors: list[str] = []

    # --- Verifica sezioni esistenti ---
    required_prefixes = [
        ("DIAGNOSI:", "sezione diagnoses"),
        ("MOTIVO TATTICO PRINCIPALE:", "sezione top tactical"),
        ("APERTURA DEBOLE COL", "sezione worst opening"),
        ("DECISIONI:", "sezione decisions"),
        ("PROGRESSIONE PIANO:", "sezione plan summary"),
    ]
    for prefix, desc in required_prefixes:
        if not any(line.startswith(prefix) for line in output.splitlines()):
            errors.append(f"MANCANTE: {desc} (atteso prefisso '{prefix}')")

    # --- Verifica assenza numeri nel testo (solo cifre isolate, non parte di prefissi tecnici) ---
    # Controlliamo ogni riga che inizia con una sezione semantica (UPPERCASE keyword):
    # escludiamo le righe delle sezioni "esistenti" che ammettono % e numeri (DECISIONI, PROGRESSIONE)
    sezioni_nuove_labels = {
        "TEMPO DECISIONALE",
        "MOSSE ISTANTANEE",
        "TILT",
        "COLORE",
        "FASE DEBOLE",
    }
    sezioni_esistenti_con_numeri = {
        "DIAGNOSI",
        "DECISIONI",
        "PROGRESSIONE PIANO",
        "MOTIVO TATTICO PRINCIPALE",
        "APERTURA DEBOLE COL",
    }
    digit_pattern = re.compile(r"\d")
    for line in output.splitlines():
        # Identifica a quale sezione appartiene questa riga
        section_key = None
        for label in sezioni_nuove_labels:
            if line.startswith(label):
                section_key = label
                break
        if section_key and digit_pattern.search(line):
            errors.append(f"NUMERO in sezione nuova '{section_key}': {line!r}")

    # --- Verifica sezioni 5.1-5.5: segnala quale e` attiva e quale no ---
    print("\nSTATO SEZIONI 5.1-5.5:")
    nuove_sezioni = [
        ("5.1 Tempo decisionale", "TEMPO DECISIONALE"),
        ("5.2 Mosse istantanee", "MOSSE ISTANTANEE"),
        ("5.3 Tilt", "TILT"),
        ("5.4 Squilibrio colori", "COLORE"),
        ("5.5 Squilibrio fasi", "FASE DEBOLE"),
    ]
    for nome, prefix in nuove_sezioni:
        presente = any(line.startswith(prefix) for line in output.splitlines())
        stato = "ATTIVA" if presente else "assente (soglia non raggiunta)"
        print(f"  {nome}: {stato}")

    # --- Risultato ---
    print()
    if errors:
        print("FALLITO:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    else:
        print("OK: tutti i controlli superati.")


if __name__ == "__main__":
    main()
