"""Coach LLM — produce 3 artifact narrativi (story / progress / roadmap).

Pattern SIO-lite (single-shot per artifact, brain navigabile come dossier).

Modalità di esecuzione:
  - FULL: `backend/coach_brain/` esiste (clonato da repo privato in CI con PAT,
    o presente in locale). Carica system prompt da COACH.md, template dai file
    in 02-output/, e wiki pertinente. 3 call OpenAI gpt-5.4-mini, una per
    artifact, ciascuna grounded sui dati + sul template + sulla wiki.
  - FALLBACK: brain mancante o OPENAI_API_KEY assente. Genera 3 artifact
    minimal dalle regole deterministiche del player_model.weekly_focus +
    diagnoses.

Output:
  - data/coach_brief.json       (back-compat)
  - data/coach_story.md         player story narrativa
  - data/coach_progress.md      check progressi narrato
  - data/coach_roadmap.md       roadmap 90 giorni
  - player_model.json arricchito con `coach_brief` + `coach_artifacts`
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger("coach")

MODEL = "gpt-5.4-mini"
REPO_ROOT = Path(__file__).resolve().parent.parent
BRAIN_DIR = REPO_ROOT / "backend" / "coach_brain"


# ---------------------------------------------------------------------------
# Brain loader (filesystem-as-orchestration, SIO-lite)
# ---------------------------------------------------------------------------


def load_brain_system_prompt() -> str | None:
    """Legge il system prompt dal brain (COACH.md + PLAN.md + identity)."""
    coach_md = BRAIN_DIR / "00-coach" / "COACH.md"
    plan_md = BRAIN_DIR / "01-pianificatore" / "PLAN.md"
    if not coach_md.exists():
        return None
    chunks = [coach_md.read_text(encoding="utf-8")]
    if plan_md.exists():
        chunks.append("---\n\n" + plan_md.read_text(encoding="utf-8"))
    # carica identity se presente
    identity_dir = BRAIN_DIR / "wiki" / "identity"
    if identity_dir.exists():
        for f in identity_dir.glob("*.md"):
            chunks.append(f"---\n\n# wiki/identity/{f.name}\n\n" + f.read_text(encoding="utf-8"))
    return "\n\n".join(chunks)


def load_template(name: str) -> str | None:
    p = BRAIN_DIR / "02-output" / f"{name}.md"
    return p.read_text(encoding="utf-8") if p.exists() else None


def load_wiki_for(area: str) -> str:
    """Carica by-area + concepts citati, come "dossier" da iniettare."""
    out = []
    by_area = BRAIN_DIR / "wiki" / "by-area" / f"{area}.md"
    if by_area.exists():
        out.append(f"## wiki/by-area/{area}.md\n\n" + by_area.read_text(encoding="utf-8"))
    # Carica TUTTI i concepts e patterns disponibili (sono piccoli e mirati,
    # in modo che il modello possa scegliere)
    for sub in ("concepts", "patterns"):
        sub_dir = BRAIN_DIR / "wiki" / sub
        if sub_dir.exists():
            for f in sorted(sub_dir.glob("*.md")):
                out.append(f"\n\n## wiki/{sub}/{f.name}\n\n" + f.read_text(encoding="utf-8"))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Player model summary per prompt
# ---------------------------------------------------------------------------


def player_brief(pm: dict) -> str:
    identity = pm["identity"]
    goal = identity["goal"]
    kpi = pm["kpi"]
    dec = pm["decisions"]
    tilt = pm["tilt"]
    tm = pm["time_management"]
    motifs = pm["blind_spots"][:3]
    diags = pm["diagnoses"][:3]
    openings = pm["openings"][:3]
    by_color = pm.get("by_color", {})

    motif_lines = "\n".join(
        f"  - {m['label_it']}: {m['n']} blunder ({m['avoidable_count']} evitabili alla tua forza)"
        for m in motifs
    )
    open_lines = "\n".join(
        f"  - {o['eco']} {o['opening']} col {o['my_color']}: win rate {int((o['win_rate'] or 0)*100)}% su {o['games']} partite"
        for o in openings
    )
    diag_lines = "\n".join(f"  {i+1}. {d['title']} — {d['evidence']}" for i, d in enumerate(diags))

    spent = tm.get("spent_vs_accuracy") or []
    fast = next((b for b in spent if b["key"] == "lt_1s"), None)
    slow = next((b for b in spent if b["key"] == "gt_30s"), None)
    spent_line = ""
    if fast and slow:
        spent_line = (
            f"Mosse <1s in posizione critica: ACPL {fast['avg_cp_loss']} ({fast['blunders']} blunder). "
            f"Mosse >30s: ACPL {slow['avg_cp_loss']}."
        )

    return f"""PLAYER: {identity['username']}

GOAL:
  - target {goal['target']} {goal['time_class']} entro {goal['deadline']}
  - rating attuale: {goal['current_rating']}
  - ti mancano {goal['points_needed']} punti in {goal['days_left']} giorni
  - ritmo richiesto: {goal['rate_per_day_needed']} pt/giorno
  - ritmo attuale: {goal['rate_per_day_so_far']} pt/giorno
  - proiezione fine anno: {goal['projection_at_deadline']}
  - on track: {goal['on_track']}

PRECISIONE (su {kpi['critical_positions']} posizioni CRITICHE):
  - ACPL medio: {kpi['avg_cp_loss_on_critical']}
  - blunder critici: {kpi['blunders_critical']} ({kpi['avoidable_blunders']} evitabili alla tua forza)
  - agreement Maia@tuo_livello: {int((kpi['agreement_maia_mine_pct'] or 0)*100)}%
  - agreement Maia@target: {int((kpi['agreement_maia_target_pct'] or 0)*100)}%
  - ACPL ultime 30: {kpi['acpl_recent_30']} (prec: {kpi['acpl_previous_30']})

DECISIONI:
  - conversion rate (partite arrivate a +2 → vinte): {int((dec['conversion_rate'] or 0)*100)}% ({dec['converted_winning']}/{dec['reached_winning']})
  - blow rate: {int((dec['blow_rate'] or 0)*100)}% — {dec['blew_winning']} vittorie buttate
  - save rate (da -2): {int((dec['save_rate'] or 0)*100)}% ({dec['saved_losing']}/{dec['reached_losing']})

COLORE:
  - bianco win rate: {int((by_color.get('white',{}).get('win_rate') or 0)*100)}% su {by_color.get('white',{}).get('games',0)}
  - nero win rate: {int((by_color.get('black',{}).get('win_rate') or 0)*100)}% su {by_color.get('black',{}).get('games',0)}

TIME / TILT:
  {spent_line}
  - tilt factor: {tilt['tilt_factor']}× (ACPL post-blunder {tilt['after_blunder_avg_cp_loss']} vs baseline {tilt['baseline_avg_cp_loss']})

BLIND SPOTS top 3 (sui blunder critici):
{motif_lines or '  (nessun pattern dominante)'}

APERTURE PEGGIORI:
{open_lines or '  (nessuna chiara)'}

DIAGNOSI già prioritizzate dal sistema (le top 3):
{diag_lines}"""


# ---------------------------------------------------------------------------
# OpenAI call
# ---------------------------------------------------------------------------


def call_openai_md(system: str, user: str) -> str:
    """Una call testuale, ritorna markdown (no JSON wrapping)."""
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY non settato")
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.6,
    )
    text = resp.choices[0].message.content
    if not text:
        raise RuntimeError("LLM ha risposto vuoto")
    return text.strip()


def call_openai_json(system: str, user: str) -> dict:
    """Call che ritorna JSON valido (per il coach_brief retro-compat)."""
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY non settato")
    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        temperature=0.6,
    )
    content = resp.choices[0].message.content
    if not content:
        raise RuntimeError("LLM ha risposto vuoto")
    return json.loads(content)


# ---------------------------------------------------------------------------
# Artifact generators
# ---------------------------------------------------------------------------


def generate_story(pm: dict, brain_sys: str | None) -> str:
    template = load_template("STORY")
    wiki = load_wiki_for("profilazione") + "\n\n" + load_wiki_for("zavorre")
    system = brain_sys or "Sei un coach di scacchi italiano serio, diretto, senza fronzoli."
    user = f"""Scrivi `artifacts/story.md`.

TEMPLATE (segui spirito + tono, non struttura rigida):
{template or '(template assente, scrivi una player story narrativa 200 parole)'}

DOSSIER WIKI (NON ricopiare, è briefing):
{wiki}

DATI:
{player_brief(pm)}

Output: solo markdown con sezioni `## Titolo`, prosa narrativa, 200-350 parole.
Niente bullet points. Niente jargon di sistema. Niente "Continua così".
"""
    return call_openai_md(system, user)


def generate_progress(pm: dict, brain_sys: str | None) -> str:
    template = load_template("PROGRESS")
    wiki = load_wiki_for("progressione")
    system = brain_sys or "Sei un coach di scacchi italiano serio, diretto, senza fronzoli."
    user = f"""Scrivi `artifacts/progress.md`.

TEMPLATE:
{template or '(template assente)'}

DOSSIER WIKI:
{wiki}

DATI:
{player_brief(pm)}

Output: markdown, 200-350 parole, sezioni `## Titolo`, prosa.
Inizia con un VERDETTO CHIARO: "Stai migliorando", "Stai stagnando", "Stai peggiorando",
o "Non abbastanza dati". Onesto, anche se è "stai peggiorando".
"""
    return call_openai_md(system, user)


def generate_roadmap(pm: dict, brain_sys: str | None) -> str:
    template = load_template("ROADMAP")
    wiki = load_wiki_for("piano-allenamento") + "\n\n" + load_wiki_for("zavorre")
    system = brain_sys or "Sei un coach di scacchi italiano serio, diretto, senza fronzoli."
    user = f"""Scrivi `artifacts/roadmap.md`.

TEMPLATE:
{template or '(template assente)'}

DOSSIER WIKI:
{wiki}

DATI:
{player_brief(pm)}

Output: markdown, 3 capitoli (settimane 1-4, 5-8, 9-12), prosa narrativa,
ogni capitolo con 2-3 azioni operative + 1 milestone misurabile.
"""
    return call_openai_md(system, user)


def generate_brief(pm: dict, brain_sys: str | None) -> dict:
    """Vecchio coach_brief JSON, per retro-compatibilità WeeklyFocusCard."""
    system = (brain_sys or "Sei un coach di scacchi italiano serio.") + """

Output rigorosamente JSON valido senza markdown wrapper:
{
  "headline": "1 frase, max 100 caratteri",
  "diagnosis_narrative": "2-3 frasi che spiegano i fatti dai dati. Usa numeri.",
  "this_week": ["azione 1 (max 80 char)", "azione 2", "azione 3"],
  "avoid": "1 frase, max 80 char"
}"""
    user = f"""Genera il coach brief settimanale.

DATI:
{player_brief(pm)}

Output: JSON."""
    return call_openai_json(system, user)


# ---------------------------------------------------------------------------
# Fallback (no brain / no API)
# ---------------------------------------------------------------------------


def fallback_artifacts(pm: dict) -> dict[str, str]:
    wf = pm.get("weekly_focus") or {}
    diag = (pm.get("diagnoses") or [{}])[0]
    goal = pm["identity"]["goal"]
    kpi = pm["kpi"]
    dec = pm["decisions"]
    story = f"""## Stato attuale

Rating blitz {goal['current_rating']}, obiettivo {goal['target']} entro {goal['deadline']}. Ti mancano {goal['points_needed']} punti in {goal['days_left']} giorni.

Su {kpi['critical_positions']} posizioni critiche, hai {kpi['blunders_critical']} blunder ({kpi['avoidable_blunders']} evitabili alla tua forza). Conversion rate {int((dec['conversion_rate'] or 0)*100)}%, save rate {int((dec['save_rate'] or 0)*100)}%.

(Coach LLM non disponibile in questo run — sto generando il minimo dai dati grezzi.)
"""
    progress = f"""## Verdetto

{('On track' if goal['on_track'] else 'Dietro il piano')}: proiezione fine anno {goal['projection_at_deadline']}.

ACPL ultime 30 partite: {kpi['acpl_recent_30']}, precedenti 30: {kpi['acpl_previous_30']}. {('Stai migliorando' if (kpi.get('acpl_delta') or 0) < -2 else 'Stai stagnando' if abs(kpi.get('acpl_delta') or 0) <= 2 else 'Stai peggiorando')}.
"""
    roadmap = f"""## Capitolo 1 · Settimane 1-4 · {diag.get('title','Sistema il problema #1')}

{diag.get('evidence','')}

**Cosa fai**: {diag.get('trainable','tactic trainer Lichess')}.
"""
    return {
        "story": story,
        "progress": progress,
        "roadmap": roadmap,
    }


def fallback_brief(pm: dict) -> dict:
    wf = pm.get("weekly_focus") or {}
    diag = (pm.get("diagnoses") or [{}])[0]
    return {
        "headline": wf.get("headline") or diag.get("title") or "Continua a giocare e torna domani",
        "diagnosis_narrative": diag.get("evidence", ""),
        "this_week": wf.get("actions") or [diag.get("trainable", "")][:3],
        "avoid": "Bullet quando vuoi migliorare in blitz",
        "generated_at": datetime.now(tz=timezone.utc).isoformat(timespec="seconds"),
        "model": "fallback-rules",
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    pm_path = REPO_ROOT / "data" / "player_model.json"
    if not pm_path.exists():
        log.error("Player model non trovato: %s", pm_path)
        sys.exit(1)

    pm = json.loads(pm_path.read_text(encoding="utf-8"))
    brain_sys = load_brain_system_prompt()
    have_api = bool(os.environ.get("OPENAI_API_KEY"))

    artifacts: dict[str, str] = {}
    brief: dict[str, Any]

    if brain_sys and have_api:
        log.info("Modalità FULL (brain + OpenAI %s)", MODEL)
        try:
            artifacts["story"] = generate_story(pm, brain_sys)
            artifacts["progress"] = generate_progress(pm, brain_sys)
            artifacts["roadmap"] = generate_roadmap(pm, brain_sys)
            brief = generate_brief(pm, brain_sys)
            brief["generated_at"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
            brief["model"] = MODEL
        except Exception as e:  # noqa: BLE001
            log.warning("LLM fallito (%s). Uso fallback regole.", e)
            artifacts = fallback_artifacts(pm)
            brief = fallback_brief(pm)
    else:
        if not brain_sys:
            log.warning("backend/coach_brain/ mancante. Fallback regole.")
        if not have_api:
            log.warning("OPENAI_API_KEY non settato. Fallback regole.")
        artifacts = fallback_artifacts(pm)
        brief = fallback_brief(pm)

    # Scrivi gli artifact su disco
    out_dir = REPO_ROOT / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, content in artifacts.items():
        (out_dir / f"coach_{name}.md").write_text(content, encoding="utf-8")
        log.info("Scritto data/coach_%s.md (%d caratteri)", name, len(content))

    (out_dir / "coach_brief.json").write_text(
        json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    # Inietta tutto nel player_model.json
    pm["coach_brief"] = brief
    pm["coach_artifacts"] = artifacts
    pm_path.write_text(json.dumps(pm, ensure_ascii=False, indent=2), encoding="utf-8")
    fe = REPO_ROOT / "frontend" / "public" / "player_model.json"
    if fe.parent.exists():
        fe.write_text(json.dumps(pm, ensure_ascii=False), encoding="utf-8")
        log.info("Player model aggiornato in %s", fe)

    log.info("Headline: %s", brief.get("headline", "?"))


if __name__ == "__main__":
    main()
