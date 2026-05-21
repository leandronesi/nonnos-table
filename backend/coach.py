"""SPRINT 6 v2 — Agente coach via OpenAI SDK (gpt-5.4-mini).

Legge `data/player_model.json` e produce `data/coach_brief.json` con:
  - headline             : 1 frase punchy (cosa devi fare questa settimana)
  - diagnosis_narrative  : 2-3 frasi che spiegano il "perché", grounded sui dati
  - this_week            : 3 azioni concrete per i prossimi 7 giorni
  - avoid                : 1 cosa specifica da NON fare

L'LLM NON inventa scacchi: legge i fatti aggregati dal player_model.
Tutto in italiano. Costo: ~5 cent/giorno con gpt-5.4-mini.

Skippa graceful se OPENAI_API_KEY non è settato (CI senza secret → fallback regole).
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("coach")

MODEL = "gpt-5.4-mini"
SYSTEM_PROMPT = """Sei un coach di scacchi italiano serio. Lavori con un giocatore amatoriale
che ha un obiettivo numerico esplicito e i suoi dati di gioco analizzati con
Stockfish + Maia.

Tu NON inventi scacchi. Tu LEGGI i fatti aggregati dal player model e li
trasformi in un coaching narrativo + plan d'azione per i prossimi 7 giorni.

Stile:
  - Italiano, diretto, NO fronzoli, NO buzzword.
  - Non scrivere "sei sulla buona strada!". Scrivi i numeri.
  - Usa il "tu" (sei, devi, evita).
  - Sii specifico: cita motivo, fase, apertura, numero quando li hai.
  - Niente emoji.
  - Output rigorosamente JSON valido senza markdown wrapper.

Format JSON:
{
  "headline": "1 frase, max 100 caratteri, l'una cosa da fissare questa settimana",
  "diagnosis_narrative": "2-3 frasi che spiegano i fatti dai dati. Usa numeri.",
  "this_week": ["azione 1 (max 80 char)", "azione 2", "azione 3"],
  "avoid": "1 frase, max 80 char, una cosa da NON fare per 7 giorni"
}"""


def build_user_prompt(pm: dict) -> str:
    """Estrai i fatti chiave dal player_model in un brief leggibile dall'LLM."""
    identity = pm["identity"]
    goal = identity["goal"]
    kpi = pm["kpi"]
    dec = pm["decisions"]
    tilt = pm["tilt"]
    tm = pm["time_management"]
    motifs = pm["blind_spots"][:3]
    diags = pm["diagnoses"][:3]
    openings = pm["openings"][:3]

    motif_lines = "\n".join(
        f"  - {m['label_it']}: {m['n']} blunder ({m['avoidable_count']} evitabili alla tua forza)"
        for m in motifs
    )
    open_lines = "\n".join(
        f"  - {o['eco']} {o['opening']} col {o['my_color']}: win rate {int((o['win_rate'] or 0)*100)}% su {o['games']} partite"
        for o in openings
    )
    diag_lines = "\n".join(f"  {i+1}. {d['title']} — {d['evidence']}" for i, d in enumerate(diags))

    clock = tm["clock_vs_accuracy"]
    under_30 = next((b for b in clock if b["key"] in ("under_10s", "10_30s")), None)
    over_120 = next((b for b in clock if b["key"] == "over_120s"), None)
    clock_line = ""
    if under_30 and over_120:
        clock_line = (
            f"Sotto i 30s: ACPL {under_30['avg_cp_loss']}, {under_30['blunders']} blunder. "
            f"Sopra i 120s: ACPL {over_120['avg_cp_loss']}."
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

PRECISIONE (sulle 3937 posizioni CRITICHE — equilibrio entro ±150cp, non book, non già decise):
  - ACPL medio: {kpi['avg_cp_loss_on_critical']}
  - blunder critici: {kpi['blunders_critical']} ({kpi['avoidable_blunders']} evitabili alla tua forza)
  - agreement con Maia@1200 (il tuo livello): {int((kpi['agreement_maia_mine_pct'] or 0)*100)}%
  - agreement con Maia@1600 (target): {int((kpi['agreement_maia_target_pct'] or 0)*100)}%
  - ACPL ultime 30 partite: {kpi['acpl_recent_30']} (precedenti 30: {kpi['acpl_previous_30']})

DECISIONI vs RISULTATO:
  - conversion rate (partite arrivate a +2 → vinte): {int((dec['conversion_rate'] or 0)*100)}% ({dec['converted_winning']}/{dec['reached_winning']})
  - vittorie buttate (blow rate): {int((dec['blow_rate'] or 0)*100)}% — {dec['blew_winning']} partite
  - save rate (partite a -2 → salvate): {int((dec['save_rate'] or 0)*100)}% ({dec['saved_losing']}/{dec['reached_losing']})

TILT:
  - ACPL dopo un tuo blunder (3 mosse seguenti): {tilt['after_blunder_avg_cp_loss']}
  - baseline: {tilt['baseline_avg_cp_loss']}
  - tilt factor: {tilt['tilt_factor']}×

TIME MANAGEMENT:
  {clock_line}
  - mosse istantanee (<2s) in critica: {tm['instant_moves_in_critical']['n']}, ACPL {tm['instant_moves_in_critical']['avg_cp_loss']}

BLIND SPOTS TATTICI (top 3, sui blunder critici):
{motif_lines or '  (nessun pattern dominante)'}

APERTURE PEGGIORI:
{open_lines or '  (nessuna chiara)'}

DIAGNOSI già prioritizzate dal sistema (le top 3):
{diag_lines}

Genera ORA il JSON coach brief con headline + narrative + this_week + avoid."""


def fallback_brief(pm: dict) -> dict:
    """Se OPENAI_API_KEY manca o la chiamata fallisce, usiamo regole deterministiche
    già presenti nel player_model (weekly_focus)."""
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


def call_openai(prompt: str) -> dict:
    try:
        from openai import OpenAI
    except ImportError:
        raise SystemExit("Manca `openai`. `pip install openai`.")

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY non settato")

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        response_format={"type": "json_object"},
        temperature=0.6,
    )
    content = resp.choices[0].message.content
    if not content:
        raise RuntimeError("LLM ha risposto vuoto")
    data = json.loads(content)
    data["generated_at"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
    data["model"] = MODEL
    return data


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    repo_root = Path(__file__).resolve().parent.parent
    pm_path = repo_root / "data" / "player_model.json"
    if not pm_path.exists():
        log.error("Player model non trovato: %s", pm_path)
        log.error("Lancia prima: python backend/player_model.py")
        sys.exit(1)

    pm = json.loads(pm_path.read_text(encoding="utf-8"))
    prompt = build_user_prompt(pm)

    try:
        brief = call_openai(prompt)
        log.info("Coach brief generato con %s", MODEL)
    except Exception as e:  # noqa: BLE001
        log.warning("OpenAI non disponibile (%s). Uso fallback regole.", e)
        brief = fallback_brief(pm)

    # Salva il brief separato
    out_path = repo_root / "data" / "coach_brief.json"
    out_path.write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Scritto %s", out_path)

    # Inietta dentro player_model.json (e copia in frontend/public)
    pm["coach_brief"] = brief
    pm_path.write_text(json.dumps(pm, ensure_ascii=False, indent=2), encoding="utf-8")
    fe = repo_root / "frontend" / "public" / "player_model.json"
    if fe.parent.exists():
        fe.write_text(json.dumps(pm, ensure_ascii=False), encoding="utf-8")
        log.info("Player model aggiornato in %s", fe)

    log.info("Headline: %s", brief.get("headline", "?"))


if __name__ == "__main__":
    main()
