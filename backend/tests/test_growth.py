"""Smoke test offline per compute_growth_delta (versione con weekly_series).

Esegui:
    python backend/tests/test_growth.py

Non fa LLM call. Verifica struttura + stampa visivo dei 5 motif tattici.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from growth import compute_growth_delta


TACTIC_MOTIF_KEYS = {
    "motif_hanging_piece",
    "motif_fork",
    "motif_removed_defender",
    "motif_back_rank",
    "motif_discovered_attack",
}


def test_compute_growth_delta() -> None:
    result = compute_growth_delta(REPO_ROOT)

    # Deve sempre ritornare un dict
    assert isinstance(result, dict), "compute_growth_delta deve ritornare un dict"
    assert "available" in result, "Il dict deve avere la chiave 'available'"
    assert isinstance(result["available"], bool), "'available' deve essere bool"

    print(f"\n[growth] available = {result['available']}")

    if not result["available"]:
        reason = result.get("reason", "(nessuna ragione fornita)")
        print(f"[growth] reason = {reason}")
        print("[growth] TEST PASSED (fallback corretto — dati non disponibili)")
        return

    # Se available=True, verifica struttura completa
    assert "patterns" in result, "deve avere 'patterns'"
    assert isinstance(result["patterns"], list), "'patterns' deve essere una lista"
    assert len(result["patterns"]) > 0, "'patterns' non deve essere vuota"

    # Verifica campi obbligatori su ogni pattern
    for p in result["patterns"]:
        for field in ("key", "label_it", "category", "current_share", "previous_share",
                      "trend", "magnitude", "weekly_series", "phrase_hint"):
            assert field in p, f"Pattern manca campo '{field}': {p['key']}"

        assert p["trend"] in ("improving", "worsening", "stable"), \
            f"trend invalido: {p['trend']} in {p['key']}"
        assert p["magnitude"] in ("weak", "medium", "strong"), \
            f"magnitude invalida: {p['magnitude']} in {p['key']}"
        assert isinstance(p["weekly_series"], list), \
            f"weekly_series deve essere lista in {p['key']}"

        for wk in p["weekly_series"]:
            assert "week_iso" in wk, f"week manca week_iso in {p['key']}"
            assert "share" in wk, f"week manca share in {p['key']}"
            assert "n" in wk, f"week manca n in {p['key']}"
            assert 0.0 <= wk["share"] <= 1.0 or p["category"] in ("phase",), \
                f"share fuori [0,1] in {p['key']}: {wk['share']}"

        # back-compat
        for field in ("share_curr", "share_prev", "delta_share", "direction"):
            assert field in p, f"Pattern manca back-compat '{field}' in {p['key']}"

    # Verifica summary_*
    for field in ("summary_key", "summary_label_it", "summary_direction", "summary_phrase_hint"):
        assert field in result, f"Manca campo summary '{field}'"

    # Verifica as_of
    assert "as_of" in result, "deve avere 'as_of'"

    # Verifica che i 5 motif tattici siano presenti
    pattern_keys = {p["key"] for p in result["patterns"]}
    missing = TACTIC_MOTIF_KEYS - pattern_keys
    assert not missing, f"Motif tattici mancanti: {missing}"

    # Verifica weekly_series popolata per i 5 motif
    for p in result["patterns"]:
        if p["key"] in TACTIC_MOTIF_KEYS:
            assert len(p["weekly_series"]) > 0, \
                f"weekly_series vuota per motif tattico {p['key']}"

    # --- Stampa visiva dei 5 motif tattici ---
    print(f"\n[growth] as_of = {result['as_of']}")
    print(f"[growth] Patterns totali: {len(result['patterns'])}")
    print(f"\n[growth] 5 MOTIF TATTICI — weekly_series:")
    for p in result["patterns"]:
        if p["key"] not in TACTIC_MOTIF_KEYS:
            continue
        arrow = "v" if p["trend"] == "improving" else ("^" if p["trend"] == "worsening" else "-")
        print(f"\n  {arrow} {p['label_it']} [{p['trend']}/{p['magnitude']}]")
        print(f"     curr={p['current_share']:.3f}  prev={p['previous_share']:.3f}")
        print(f"     Frase: {p['phrase_hint']}")
        if p["weekly_series"]:
            pts = "  ".join(f"{w['week_iso']}={w['share']:.2f}(n={w['n']})"
                            for w in p["weekly_series"])
            print(f"     Serie: {pts}")

    print(f"\n[growth] SUMMARY: {result['summary_key']} — {result['summary_phrase_hint']}")
    print("\n[growth] TEST PASSED")


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s | %(message)s")
    test_compute_growth_delta()
