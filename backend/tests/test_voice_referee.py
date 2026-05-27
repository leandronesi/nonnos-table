"""Smoke test offline per pipeline coach: nessuna LLM call.

Verifica:
  1. `coach.py` importa pulito (no errori di sintassi / import).
  2. `load_chess_nouns()` parsa correttamente CHESS_NOUNS.md.
  3. `extract_chess_nouns()` trova canonici e sinonimi.
  4. `voice_referee()` accetta painted ⊆ draft e rifiuta painted ⊃ draft.

Run:
  python backend/tests/test_voice_referee.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# Aggiungi backend/ al path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import coach  # noqa: E402


def test_load_chess_nouns():
    families = coach.load_chess_nouns()
    assert families, "Nessuna famiglia parsata"
    # canonical attesi
    expected = ["pedone", "cavallo", "alfiere", "torre", "donna", "re",
                "pezzo appeso", "forchetta", "francese", "siciliana",
                "italiana", "spagnola", "mediogioco", "finale", "col bianco",
                "col nero"]
    missing = [c for c in expected if c not in families]
    assert not missing, f"Famiglie attese non trovate: {missing}"
    # nuovo formato: ogni valore e` dict con forms/section/strict
    fam_forchetta = families["forchetta"]
    assert isinstance(fam_forchetta, dict), "load_chess_nouns deve ritornare dict di metadata"
    assert "fork" in fam_forchetta["forms"], "Sinonimo 'fork' mancante"
    # strict check: forchetta (motivi tattici) deve essere strict
    assert fam_forchetta["strict"], "'forchetta' (motivo tattico) dovrebbe essere strict"
    # cavallo (pezzi) deve essere non-strict
    assert not families["cavallo"]["strict"], "'cavallo' (pezzo) NON dovrebbe essere strict"
    # francese (apertura) deve essere strict
    assert families["francese"]["strict"], "'francese' (apertura) dovrebbe essere strict"
    # mediogioco (fase) deve essere strict
    assert families["mediogioco"]["strict"], "'mediogioco' (fase) dovrebbe essere strict"
    strict = coach.strict_families(families)
    print(f"  [OK] {len(families)} famiglie parsate ({len(strict)} strict)")


def test_extract_chess_nouns():
    families = coach.load_chess_nouns()
    all_forms = coach._all_forms_dict(families)
    # caso 1: nomi diretti
    text = "Lascia il cavallo in d4 nel mediogioco, soprattutto col Nero contro la Francese."
    found = coach.extract_chess_nouns(text, all_forms)
    for canon in ["cavallo", "mediogioco", "col nero", "francese"]:
        assert canon in found, f"'{canon}' non trovato in: {found}"

    # caso 2: sinonimo "fork" -> "forchetta"
    text2 = "Il fork col cavallo gli sfugge un attimo tardi."
    found2 = coach.extract_chess_nouns(text2, all_forms)
    assert "forchetta" in found2, f"'forchetta' (via fork) non trovato in: {found2}"

    # caso 3: nessuno
    text3 = "Buongiorno, oggi mi sento bene e ho preso un caffe`."
    found3 = coach.extract_chess_nouns(text3, all_forms)
    assert not found3, f"Falsi positivi: {found3}"

    print(f"  [OK] extract funziona (caso 1: {len(found)} nouns, caso 2: {len(found2)}, caso 3: vuoto)")


def test_voice_referee_accept_subset():
    """Painted può essere ⊆ draft. Referee accetta."""
    families = coach.load_chess_nouns()
    draft = {
        "story": "Lascia il cavallo in presa nel mediogioco col Nero contro la Francese.",
        "progress": "Sta migliorando ma il pezzo appeso resta il problema.",
        "roadmap": "Lavoreremo prima sul pezzo appeso.",
        "brief": {
            "headline": "Pezzo appeso nel mediogioco.",
            "diagnosis_narrative": "Lasci il cavallo. Pezzo appeso frequente. Col Nero contro la Francese.",
            "this_week": ["controlla il cavallo", "guarda il pezzo appeso", "lavora col Nero"],
            "avoid": "Non lasciare il cavallo dopo una cattura."
        }
    }
    painted = {
        "story": "Oooh, le idee le vede. Ma nel mediogioco gli scappa il cavallo.",
        "progress": "Sta migliorando. Il pezzo appeso resta.",
        "roadmap": "Prima sistemiamo il pezzo appeso. Poi vediamo.",
        "brief": {
            "headline": "Il cavallo nel mediogioco.",
            "diagnosis_narrative": "Lasci il cavallo spesso. Pezzo appeso. Col Nero ti pesa.",
            "this_week": ["controlla il cavallo", "guarda dopo ogni mossa", "respira col Nero"],
            "avoid": "Non muovere il cavallo senza guardare."
        }
    }
    ok, extras = coach.voice_referee(draft, painted, families)
    assert ok, f"Referee doveva accettare. Extras: {extras}"
    print(f"  [OK] Painted subset-of draft accettato (draft={len(coach.extract_chess_nouns(coach._drafts_to_text(draft), families))} "
          f"nouns, painted={len(coach.extract_chess_nouns(coach._drafts_to_text(painted), families))} nouns)")


def test_voice_referee_reject_added():
    """Painted aggiunge un sostantivo NON nel draft. Referee rifiuta."""
    families = coach.load_chess_nouns()
    draft = {
        "story": "Lascia il cavallo nel mediogioco.",
        "progress": "Il pezzo appeso resta il problema.",
        "roadmap": "Prima il pezzo appeso.",
        "brief": {"headline": "Cavallo nel mediogioco.", "diagnosis_narrative": "",
                  "this_week": [], "avoid": ""}
    }
    # painted aggiunge "Francese" che NON era nel draft
    painted = {
        "story": "Lascia il cavallo nel mediogioco. Soprattutto contro la Francese.",
        "progress": "Il pezzo appeso resta.",
        "roadmap": "Prima il pezzo appeso.",
        "brief": {"headline": "Cavallo.", "diagnosis_narrative": "",
                  "this_week": [], "avoid": ""}
    }
    ok, extras = coach.voice_referee(draft, painted, families)
    assert not ok, "Referee doveva rifiutare (Francese aggiunta)"
    assert "francese" in extras, f"Extras dovrebbe contenere 'francese', invece: {extras}"
    print(f"  [OK] Painted superset-of draft rifiutato. Extras correttamente flaggati: {extras}")


def test_skills_present():
    """Le 3 skill devono esistere e caricarsi."""
    persona = coach.load_coach_persona()
    facts = coach.load_facts_skill()
    voice = coach.load_voice_skill()
    assert persona and len(persona) > 500, "Persona COACH.md non caricata correttamente"
    assert facts and len(facts) > 500, "Skill FACTS.md non caricata correttamente"
    assert voice and len(voice) > 1000, "Skill VOICE.md (con CHESS_NOUNS + examples) non caricata"
    # voice deve includere almeno un esempio
    assert "Esempio few-shot:" in voice, "VOICE.md non include gli esempi few-shot"
    print(f"  [OK] persona={len(persona)} chars · facts={len(facts)} chars · voice={len(voice)} chars (con esempi)")


def main():
    print("Smoke test pipeline coach (offline, no LLM)...")
    tests = [
        ("load_chess_nouns", test_load_chess_nouns),
        ("extract_chess_nouns", test_extract_chess_nouns),
        ("skills_present", test_skills_present),
        ("voice_referee_accept_subset", test_voice_referee_accept_subset),
        ("voice_referee_reject_added", test_voice_referee_reject_added),
    ]
    failed = []
    for name, fn in tests:
        print(f"\n[{name}]")
        try:
            fn()
        except AssertionError as e:
            print(f"  [FAIL] FAILED: {e}")
            failed.append(name)
        except Exception as e:  # noqa: BLE001
            print(f"  [FAIL] ERROR: {type(e).__name__}: {e}")
            failed.append(name)
    print(f"\n{'='*60}\nTotal: {len(tests) - len(failed)}/{len(tests)} passed")
    if failed:
        print(f"Failed: {failed}")
        sys.exit(1)


if __name__ == "__main__":
    main()
