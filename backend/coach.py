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

# Carica .env (locale) se presente. In CI le var arrivano dai secrets, .env non esiste.
try:
    from dotenv import load_dotenv
    _here = Path(__file__).resolve().parent.parent
    load_dotenv(_here / ".env", override=False)
except ImportError:
    pass

log = logging.getLogger("coach")

MODEL = "gpt-5.4-mini"
REPO_ROOT = Path(__file__).resolve().parent.parent
BRAIN_DIR = REPO_ROOT / "backend" / "coach_brain"

# Quaderno di Nonno — memoria persistente cross-session. Vive in data/ (repo
# pubblico) perche` cosi` la CI lo cachea via "Cache analysis data" e lo
# trasporta tra run. Nel brain (repo privato) ci stanno solo persona e wiki.
JOURNAL_PATH = REPO_ROOT / "data" / "coach_journal.md"
JOURNAL_MAX_CHARS = 12000  # tronca le voci piu` vecchie se cresce troppo


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


def load_journal() -> str:
    """Legge il quaderno di Nonno (memoria persistente cross-session).

    Se non esiste, ritorna stringa vuota. Nonno scrivera` la prima voce
    dopo la prima generazione.
    """
    if not JOURNAL_PATH.exists():
        return ""
    txt = JOURNAL_PATH.read_text(encoding="utf-8")
    # Tronca le voci piu` vecchie se cresce troppo (mantiene header + tail)
    if len(txt) > JOURNAL_MAX_CHARS:
        head, _, body = txt.partition("---")
        keep_tail = body[-(JOURNAL_MAX_CHARS - len(head) - 200):]
        txt = head + "---\n\n## ...voci piu` vecchie troncate per spazio...\n" + keep_tail
    return txt


def append_to_journal(new_entry: str) -> None:
    """Appende una nuova voce al quaderno. Crea il file se non esiste."""
    if not new_entry or not new_entry.strip():
        return
    JOURNAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = JOURNAL_PATH.read_text(encoding="utf-8") if JOURNAL_PATH.exists() else "# Quaderno di Nonno O.\n\n"
    # Assicura una separazione visibile prima della nuova voce
    if not existing.endswith("\n\n"):
        existing += "\n\n"
    JOURNAL_PATH.write_text(existing + new_entry.strip() + "\n", encoding="utf-8")
    log.info("Aggiunta voce al quaderno (%d caratteri totali)", len(existing) + len(new_entry))


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


def call_openai_md(system: str, user: str, min_chars: int = 200) -> str:
    """Call testuale, ritorna markdown.

    - Strip preamboli stile "Leggo i dati, poi scrivo..." se compaiono prima del primo `##`.
    - Retry una volta se l'output è troppo corto (sintomo di taglio).
    """
    from openai import OpenAI

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY non settato")
    client = OpenAI(api_key=api_key)

    def do_call(extra_kick: str = "") -> str:
        msgs = [
            {"role": "system", "content": system},
            {"role": "user", "content": user + extra_kick},
        ]
        resp = client.chat.completions.create(
            model=MODEL,
            messages=msgs,
            temperature=0.6,
            max_completion_tokens=2000,
        )
        text = resp.choices[0].message.content
        if not text:
            raise RuntimeError("LLM ha risposto vuoto")
        return text.strip()

    text = do_call()
    text = strip_preamble(text)
    if len(text) < min_chars:
        # Retry una volta con un "kick" più diretto
        text2 = do_call("\n\nIMPORTANTE: rispondi con TUTTO il file completo (200+ parole), iniziando DIRETTAMENTE con `## Titolo`. Niente preamboli.")
        text2 = strip_preamble(text2)
        if len(text2) > len(text):
            text = text2
    return text


def strip_preamble(text: str) -> str:
    """Rimuove eventuali frasi di preambolo prima del primo `## Titolo`."""
    lines = text.splitlines()
    out = []
    started = False
    for line in lines:
        if not started and line.lstrip().startswith("#"):
            started = True
        if started:
            out.append(line)
    if not started:
        # nessun heading: ritorna originale strippato
        return text.strip()
    return "\n".join(out).strip()


def call_openai_json(system: str, user: str) -> dict:
    """Call che ritorna JSON valido (per il coach_brief retro-compat).

    Robusto al fatto che gpt-5.4-mini a volte aggiunge testo prima/dopo il
    JSON o lo wrappa in ```json``` fences, nonostante response_format.
    """
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
    # tentiamo parse diretto, se fallisce estraiamo il primo {...} bilanciato
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    # strip ```json fence
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
    # estraggo il primo blocco JSON bilanciato { ... }
    start = cleaned.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(cleaned)):
            if cleaned[i] == "{":
                depth += 1
            elif cleaned[i] == "}":
                depth -= 1
                if depth == 0:
                    return json.loads(cleaned[start : i + 1])
    raise RuntimeError(f"JSON non parsabile: {content[:200]}")


# ---------------------------------------------------------------------------
# Artifact generators
# ---------------------------------------------------------------------------


def generate_story(pm: dict, brain_sys: str | None, journal: str = "") -> str:
    template = load_template("STORY")
    wiki = load_wiki_for("profilazione") + "\n\n" + load_wiki_for("zavorre")
    system = brain_sys or "Sei un coach di scacchi italiano serio, diretto, senza fronzoli."
    memoria_block = f"\nMEMORIA (il tuo quaderno, cose gia` dette e notate nelle settimane scorse — rileggile prima di scrivere, riferisci a queste cose quando ha senso):\n{journal}\n" if journal.strip() else ""
    user = f"""Scrivi `artifacts/story.md`.
{memoria_block}
TEMPLATE (segui SPIRITO + TONO + ESEMPIO, non struttura rigida):
{template or '(template assente, scrivi una player story narrativa 200-300 parole)'}

DOSSIER WIKI (NON ricopiare, e` briefing tuo):
{wiki}

DATI DELL'ALLIEVO (usali come fatti, ma NON citarli con numeri — traducili
in parole, come faresti tu in cucina):
{player_brief(pm)}

Output: SOLO markdown. UN solo titolo `## ...` che e` UNA FRASE intera.
Prosa, 200-300 parole. Niente bullet, niente sezioni multiple.
Parla di lui IN TERZA PERSONA SINGOLARE (e`, sta, gli, lo). MAI in seconda
persona (sei, hai, stai). Inizia con *"E` un giocatore..."* o
*"Quando l'ho conosciuto..."* o *"In questi mesi..."* o un piccolo aneddoto.
NIENTE numeri (eccezione: numero di mosse di una partita specifica).
"""
    return call_openai_md(system, user)


def generate_progress(pm: dict, brain_sys: str | None, journal: str = "") -> str:
    template = load_template("PROGRESS")
    wiki = load_wiki_for("progressione")
    system = brain_sys or "Sei un coach di scacchi italiano serio, diretto, senza fronzoli."
    memoria_block = f"\nMEMORIA (le voci precedenti del tuo quaderno):\n{journal}\n" if journal.strip() else ""
    user = f"""Scrivi `artifacts/progress.md`.
{memoria_block}
TEMPLATE (SPIRITO + TONO):
{template or '(template assente)'}

DOSSIER WIKI:
{wiki}

DATI DELL'ALLIEVO (fatti per te, mai numeri nella tua risposta):
{player_brief(pm)}

Output: SOLO markdown. UN solo titolo `## ...` che e` UNA FRASE intera.
Prosa, 150-250 parole. Niente bullet, niente sezioni multiple.
Apri SUBITO con un verdetto asciutto, una frase: *"Sta migliorando..."* /
*"Oh. Sta stagnando."* / *"Va peggio."* / *"E` presto per dirlo."*.
Parla di lui in TERZA persona. MAI in seconda. NIENTE numeri di rating,
ACPL, percentuali, conteggi. Traduci tutto in parole: *"un po' piu` di
prima"*, *"meno spesso"*, *"da qualche settimana"*.
"""
    return call_openai_md(system, user)


def generate_roadmap(pm: dict, brain_sys: str | None, journal: str = "") -> str:
    template = load_template("ROADMAP")
    wiki = load_wiki_for("piano-allenamento") + "\n\n" + load_wiki_for("zavorre")
    system = brain_sys or "Sei un coach di scacchi italiano serio, diretto, senza fronzoli."
    memoria_block = f"\nMEMORIA (cose gia` dette o promesse):\n{journal}\n" if journal.strip() else ""
    user = f"""Scrivi `artifacts/roadmap.md`.
{memoria_block}
TEMPLATE (SPIRITO + TONO):
{template or '(template assente)'}

DOSSIER WIKI:
{wiki}

DATI DELL'ALLIEVO:
{player_brief(pm)}

Output: SOLO markdown. UN solo titolo `## ...` che e` UNA FRASE intera.
Prosa, 250-400 parole, niente bullet. TRE PARAGRAFI distinti, ciascuno
preceduto da una frase del tipo *"La prima cosa che gli faccio fare..."*,
*"Quando questa e` digerita, passiamo a..."*, *"Per ultimo, la cosa
difficile..."*. Ciascun paragrafo nomina UNA cosa concreta da lavorare.
NIENTE settimane, NIENTE date, NIENTE *"milestone"*. Chiudi con una frase
che riconosca che il piano puo` cambiare.
"""
    return call_openai_md(system, user)


def generate_brief(pm: dict, brain_sys: str | None, journal: str = "") -> dict:
    """Brief settimanale JSON nella voce di Nonno O.

    Non riusa il brain_sys completo (che e` orientato alla scrittura libera),
    ma ne mutua la persona. Le stringhe devono avere il TONO di Nonno: poche
    parole, niente numeri, italiano vero.
    """
    _ = brain_sys  # esplicitamente non usato — qui costruiamo system dedicato
    memoria_block = f"\nMEMORIA (cose gia` dette o notate):\n{journal[-2000:] if journal else ''}\n" if journal.strip() else ""
    system = f"""Sei Nonno O., 75 anni, comandante di lungo corso in pensione,
sorrentino. Allenatore di scacchi del giocatore qui sotto. Scrivi un brief
settimanale per lui.

LE STRINGHE che produci nel JSON devono avere il TONO di Nonno:
- italiano vero, asciutto, caldo
- frasi corte, una cosa per volta
- MAI termini tech: niente ACPL, blunder, drill, score, target, gap, KPI,
  performance, training. MAI anglicismi.
- MAI numeri (eccezione: numero di mosse di una partita specifica)
- MAI dire "io" come soggetto, MAI dire "hai sbagliato"
- Puoi usare "Oooh" all'inizio di una headline o di una frase quando
  ha senso (ammirazione, finto rimprovero, riconoscimento).
- Tono: nonno seduto in cucina a Sorrento, caffe` davanti, scacchiera
  mezza preparata. Non manager, non analista, non chatbot.
{memoria_block}
Output rigorosamente JSON valido (NO markdown wrapper, NO testo fuori).
Struttura ESATTA:
{{
  "headline": "1 frase tonale di Nonno, max 110 caratteri (es. 'Oooh. Devi guardare prima di muovere, basta correre.')",
  "diagnosis_narrative": "2-3 frasi di Nonno che riassumono cosa vede in questo momento dell'allievo, MAI numeri, riferimento eventuale alla MEMORIA se rilevante",
  "this_week": ["frase 1 cosa lavorare (max 90 char, voce di Nonno)", "frase 2 (max 90 char)", "frase 3 (max 90 char)"],
  "avoid": "1 cosa concreta da NON fare questa settimana, voce di Nonno, max 90 char"
}}"""
    user = f"""DATI sull'allievo (fatti per orientarti — NON metterli nel testo come numeri):
{player_brief(pm)}

Rispondi SOLO col JSON. Niente altro fuori dalle graffe."""
    return call_openai_json(system, user)


def generate_journal_entry(pm: dict, brain_sys: str | None, journal: str, artifacts: dict[str, str]) -> str:
    """Genera la NUOVA voce di quaderno che Nonno scrive a fine sessione.

    E` la sua memoria — quello che ha notato oggi, quello che si ripromette di
    rivedere, una promessa al prossimo incontro. 3-6 frasi.
    """
    system = brain_sys or "Sei Nonno O., un nonno di Sorrento che allena scacchi."
    user = f"""A fine sessione, prima di andare a fare due passi al porto, apri il
quaderno e scrivi una NUOVA voce. Solo per te. Per ricordarti la prossima volta.

MEMORIA (voci precedenti):
{journal[-3000:] if journal else '(prima voce)'}

DATI ATTUALI:
{player_brief(pm)}

COSA HAI SCRITTO OGGI ALL'ALLIEVO (story / progress / roadmap):
=== STORY ===
{artifacts.get('story','')[:1200]}

=== PROGRESS ===
{artifacts.get('progress','')[:1200]}

=== ROADMAP ===
{artifacts.get('roadmap','')[:1200]}

Adesso scrivi UNA voce di quaderno, formato:

## YYYY-MM-DD · titolo asciutto in minuscolo

3-6 frasi in prima persona (TU sei Nonno), con il TUO tono. Cose tipo:
- "Oggi ho visto che..."
- "Mi sono ripromesso di..."
- "Continua a fare {{cosa}}, devo trovare un modo di farglielo notare..."
- "Settimana prossima provo a..."

NIENTE numeri. NIENTE termini tech. Scrivi a mano, su un'agenda.

Output: solo il blocco markdown (titolo + 3-6 frasi). Niente preamboli.
"""
    return call_openai_md(system, user, min_chars=80)


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
    journal = load_journal()
    have_api = bool(os.environ.get("OPENAI_API_KEY"))

    artifacts: dict[str, str] = {}
    brief: dict[str, Any]

    if brain_sys and have_api:
        log.info("Modalità FULL (brain + OpenAI %s) · journal: %d caratteri", MODEL, len(journal))
        # try/except SEPARATI per ogni artifact: se uno fallisce, gli altri
        # già ottenuti dal LLM restano (prima il bug era che il fallback
        # del brief sovrascriveva anche story/progress/roadmap già pronti).
        fb = fallback_artifacts(pm)
        for name, gen in (
            ("story", generate_story),
            ("progress", generate_progress),
            ("roadmap", generate_roadmap),
        ):
            try:
                artifacts[name] = gen(pm, brain_sys, journal)
            except Exception as e:  # noqa: BLE001
                log.warning("LLM artifact %s fallito (%s). Fallback per questo solo.", name, e)
                artifacts[name] = fb[name]
        try:
            brief = generate_brief(pm, brain_sys, journal)
            brief["generated_at"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
            brief["model"] = MODEL
        except Exception as e:  # noqa: BLE001
            log.warning("LLM brief fallito (%s). Fallback brief.", e)
            brief = fallback_brief(pm)

        # Nuova voce di quaderno (memoria persistente per le prossime sessioni).
        # Best-effort: se fallisce non rompiamo il run, semplicemente la
        # memoria non cresce questa volta.
        try:
            new_entry = generate_journal_entry(pm, brain_sys, journal, artifacts)
            append_to_journal(new_entry)
        except Exception as e:  # noqa: BLE001
            log.warning("Voce di quaderno fallita (%s). Memoria non aggiornata.", e)
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
