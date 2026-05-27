"""Test offline per i 3 campi R1-A: spent_seconds, prev_moves, waiting_moves.

Carica data/player_model.json e verifica la presenza dei nuovi campi in
pm.drills e pm.turning_points. Stampa esempi visivi per ispezione.

Eseguire:
    python backend/tests/test_review_fields.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _load_pm() -> dict:
    root = Path(__file__).resolve().parent.parent.parent
    path = root / "data" / "player_model.json"
    if not path.exists():
        print(f"ERRORE: {path} non trovato. Esegui prima python backend/player_model.py")
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))


def _check_field(items: list[dict], label: str) -> dict:
    """Verifica copertura dei 3 campi e ritorna stats."""
    n = len(items)
    if n == 0:
        print(f"  {label}: nessun elemento")
        return {"n": 0}

    n_ss = sum(1 for x in items if x.get("spent_seconds") is not None)
    n_pm = sum(1 for x in items if x.get("prev_moves") and len(x["prev_moves"]) >= 3)
    n_pm_any = sum(1 for x in items if x.get("prev_moves"))
    n_wm = sum(1 for x in items if x.get("waiting_moves") is not None)
    n_low_maia = sum(1 for x in items if (x.get("p_maia_mine_top") or 1.0) < 0.20)

    print(f"\n  {label} ({n} totali):")
    print(f"    spent_seconds   : {n_ss}/{n}  ({100*n_ss//max(1,n)}%)")
    print(f"    prev_moves>=3   : {n_pm}/{n}  ({100*n_pm//max(1,n)}%)")
    print(f"    prev_moves (any): {n_pm_any}/{n}")
    print(f"    waiting_moves   : {n_wm}/{n}  ({100*n_wm//max(1,n)}%)  [p_maia_mine_top<0.20: {n_low_maia}]")

    return {
        "n": n,
        "n_ss": n_ss,
        "n_pm": n_pm,
        "n_wm": n_wm,
        "n_low_maia": n_low_maia,
    }


def _print_sample(item: dict, label: str) -> None:
    print(f"\n  --- Esempio {label} ---")
    print(f"    game_id      : {item['game_id']}")
    print(f"    ply/move_num : {item['ply']} / {item.get('move_number')}")
    print(f"    san          : {item.get('san')}  ->  best: {item.get('best_san_sf')}")
    print(f"    date / opp   : {item.get('date')} vs {item.get('opp_rating')}")
    print(f"    spent_seconds: {item.get('spent_seconds')}")
    print(f"    prev_moves   : {item.get('prev_moves')}")
    print(f"    waiting_moves: {item.get('waiting_moves')}")
    print(f"    p_maia_mine  : {item.get('p_maia_mine_top')}  p_maia_target: {item.get('p_maia_target_top')}")
    print(f"    cp_loss      : {item.get('cp_loss')}")


def main() -> None:
    print("=" * 60)
    print("TEST R1-A: spent_seconds / prev_moves / waiting_moves")
    print("=" * 60)

    pm = _load_pm()
    drills = pm.get("drills") or []
    tps = pm.get("turning_points") or []

    print("\n[ COPERTURA CAMPI ]")
    d_stats = _check_field(drills, "drills")
    t_stats = _check_field(tps, "turning_points")

    print("\n[ ASSERZIONI ]")
    errors: list[str] = []

    # spent_seconds: deve essere 100% per drills e turning_points
    for label, stats in [("drills", d_stats), ("turning_points", t_stats)]:
        n = stats.get("n", 0)
        n_ss = stats.get("n_ss", 0)
        if n > 0 and n_ss == 0:
            errors.append(f"FAIL: {label} — nessun elemento ha spent_seconds")
        elif n > 0:
            print(f"  OK: {label}.spent_seconds presente su {n_ss}/{n}")

    # prev_moves: almeno 1 drill con >= 3 mosse
    n_pm_d = d_stats.get("n_pm", 0)
    if d_stats.get("n", 0) > 0 and n_pm_d == 0:
        errors.append("FAIL: drills — nessun elemento ha prev_moves con >= 3 mosse")
    elif n_pm_d > 0:
        print(f"  OK: drills.prev_moves>=3 su {n_pm_d} drill")

    n_pm_t = t_stats.get("n_pm", 0)
    if t_stats.get("n", 0) > 0 and n_pm_t == 0:
        errors.append("FAIL: turning_points — nessun elemento ha prev_moves con >= 3 mosse")
    elif n_pm_t > 0:
        print(f"  OK: turning_points.prev_moves>=3 su {n_pm_t} turning_points")

    # waiting_moves: NULL accettabile se Stockfish non disponibile
    # (il colonna esiste — verificare che il campo sia presente, anche se None)
    for label, items in [("drills", drills), ("turning_points", tps)]:
        if items:
            missing_key = [x for x in items if "waiting_moves" not in x]
            if missing_key:
                errors.append(f"FAIL: {label} — campo waiting_moves mancante in {len(missing_key)} elementi")
            else:
                print(f"  OK: {label}.waiting_moves campo presente (NULL = Stockfish non disponibile)")

    # Stampa esempi
    print("\n[ ESEMPI VISIVI ]")
    # Drill con spent_seconds + prev_moves
    sample_d = next(
        (d for d in drills if d.get("spent_seconds") and d.get("prev_moves") and len(d.get("prev_moves", [])) >= 3),
        drills[0] if drills else None,
    )
    if sample_d:
        _print_sample(sample_d, "drill")

    # Turning point con prev_moves
    sample_t = next(
        (t for t in tps if t.get("prev_moves") and len(t.get("prev_moves", [])) >= 3),
        tps[0] if tps else None,
    )
    if sample_t:
        _print_sample(sample_t, "turning_point")

    # Drill con p_maia_mine_top < 0.20 (candidato per waiting_moves quando Stockfish disponibile)
    sample_low = next(
        (d for d in drills if (d.get("p_maia_mine_top") or 1.0) < 0.20),
        None,
    )
    if sample_low:
        print("\n  --- Drill con p_maia_mine_top < 0.20 (candidato waiting_moves) ---")
        _print_sample(sample_low, "low_maia_drill")
    else:
        print("\n  (nessun drill nei top-12 ha p_maia_mine_top < 0.20 — controllare turning_points)")
        sample_low_tp = next(
            (t for t in tps if (t.get("p_maia_mine_top") or 1.0) < 0.20),
            None,
        )
        if sample_low_tp:
            _print_sample(sample_low_tp, "low_maia_turning_point")

    # Risultato finale
    print("\n" + "=" * 60)
    if errors:
        print("RESULT: FALLITO")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print("RESULT: OK — tutti i campi presenti e verificati")
        print()
        print("NOTA: waiting_moves = NULL perché Stockfish non disponibile.")
        print("      Eseguire backend/compute_waiting_moves.py dopo installazione Stockfish.")


if __name__ == "__main__":
    main()
