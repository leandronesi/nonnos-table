"""Coach LLM — coach fattuale (facts → voice) con Python referee.

Pattern SIO-style: separation of concerns tra correttezza fattuale e
voce caratteriale. Le due dimensioni si combattono nello stesso turno
("competing constraints degrade performance"), quindi le separiamo.

Pipeline:
  1) STEP 1 (FACTS) — `draft_facts()`: 1 LLM call (gpt-5.4-mini, T=0.4)
     che legge la skill `coach_brain/01-facts/FACTS.md` e produce
     `{story, progress, roadmap, brief}` in prosa NEUTRA, asciutta,
     scacchisticamente corretta. Niente voce, niente "Oooh", niente
     metafore. È il backbone fattuale.

  2) STEP 2 (VOICE) — `paint_voice()`: 1 LLM call (T=0.6) che legge la
     persona di Nonno (`00-coach/COACH.md`), la skill di trasformazione
     (`02-voice/VOICE.md`) e gli esempi few-shot in
     `02-voice/examples/`, e RIDIPINGE il draft nella voce di Nonno.
     L'invariante è: i sostantivi scacchistici NON aumentano.

  3) PYTHON REFEREE — `voice_referee()`: estrae i sostantivi canonici
     (vedi `02-voice/CHESS_NOUNS.md`) da draft e painted; se painted
     aggiunge nomi nuovi, rifiuta e si rifa lo step 2 (max 2 retry,
     con feedback specifico su cosa il modello ha aggiunto). Dopo il
     secondo retry fallito: fallback al draft asciutto.

  4) JOURNAL ENTRY — `generate_journal_entry()`: terza call (ortogonale)
     che fa scrivere a Nonno una nuova voce di quaderno, memoria
     persistente cross-session.

Modalità:
  - FULL: brain + OPENAI_API_KEY → coach fattuale.
  - FALLBACK: brain mancante o no API → regole deterministiche minimal.

Output:
  - data/coach_brief.json        (struttura brief)
  - data/coach_story.md          player story narrativa
  - data/coach_progress.md       check progressi narrato
  - data/coach_roadmap.md        roadmap narrativa
  - data/coach_journal.md        memoria persistente (append)
  - player_model.json arricchito con `coach_brief` + `coach_artifacts`
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Aggregator deterministico delta-pattern week-over-week (no LLM call).
# Iniettato nei prompt di voice/session/journal cosi` Nonno puo` riferirsi a
# "tre settimane fa..." con dati reali.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from growth import compute_growth_delta  # noqa: E402

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

JOURNAL_PATH = REPO_ROOT / "data" / "coach_journal.md"
JOURNAL_MAX_CHARS = 12000

VOICE_MAX_RETRIES = 2


# ---------------------------------------------------------------------------
# Brain loader (filesystem-as-orchestration)
# ---------------------------------------------------------------------------


def load_coach_persona() -> str | None:
    """Persona di Nonno O. da 00-coach/COACH.md + identity (se presente)."""
    coach_md = BRAIN_DIR / "00-coach" / "COACH.md"
    if not coach_md.exists():
        return None
    chunks = [coach_md.read_text(encoding="utf-8")]
    identity_dir = BRAIN_DIR / "wiki" / "identity"
    if identity_dir.exists():
        for f in identity_dir.glob("*.md"):
            chunks.append(f"---\n\n# wiki/identity/{f.name}\n\n" + f.read_text(encoding="utf-8"))
    return "\n\n".join(chunks)


def load_facts_skill() -> str | None:
    """Skill che istruisce lo step 1 (draft asciutto, fattuale)."""
    p = BRAIN_DIR / "01-facts" / "FACTS.md"
    return p.read_text(encoding="utf-8") if p.exists() else None


def load_session_skill() -> str | None:
    """Skill che istruisce la generazione delle frasi di sessione (Nonno
    parla durante warmup/bivio/play/recap)."""
    p = BRAIN_DIR / "03-session" / "SESSION.md"
    return p.read_text(encoding="utf-8") if p.exists() else None


def load_voice_skill() -> str | None:
    """Skill che istruisce lo step 2 (ridipingere in voce Nonno).

    Include la skill VOICE.md, la lista CHESS_NOUNS.md (perché il modello
    sappia cosa il referee controllerà), e tutti gli esempi few-shot in
    02-voice/examples/ (lazy-loaded come file markdown).
    """
    voice_dir = BRAIN_DIR / "02-voice"
    voice_md = voice_dir / "VOICE.md"
    if not voice_md.exists():
        return None
    chunks = [voice_md.read_text(encoding="utf-8")]
    nouns_md = voice_dir / "CHESS_NOUNS.md"
    if nouns_md.exists():
        chunks.append("---\n\n# Lista sostantivi controllati (riferimento)\n\n"
                      + nouns_md.read_text(encoding="utf-8"))
    examples_dir = voice_dir / "examples"
    if examples_dir.exists():
        for f in sorted(examples_dir.glob("*.md")):
            chunks.append(f"---\n\n# Esempio few-shot: {f.stem}\n\n"
                          + f.read_text(encoding="utf-8"))
    return "\n\n".join(chunks)


def load_wiki_for(area: str) -> str:
    """by-area + concepts/patterns: dossier compatto da iniettare nello step 1."""
    out = []
    by_area = BRAIN_DIR / "wiki" / "by-area" / f"{area}.md"
    if by_area.exists():
        out.append(f"## wiki/by-area/{area}.md\n\n" + by_area.read_text(encoding="utf-8"))
    for sub in ("concepts", "patterns"):
        sub_dir = BRAIN_DIR / "wiki" / sub
        if sub_dir.exists():
            for f in sorted(sub_dir.glob("*.md")):
                out.append(f"\n\n## wiki/{sub}/{f.name}\n\n" + f.read_text(encoding="utf-8"))
    return "\n".join(out)


def load_journal() -> str:
    if not JOURNAL_PATH.exists():
        return ""
    txt = JOURNAL_PATH.read_text(encoding="utf-8")
    if len(txt) > JOURNAL_MAX_CHARS:
        head, _, body = txt.partition("---")
        keep_tail = body[-(JOURNAL_MAX_CHARS - len(head) - 200):]
        txt = head + "---\n\n## ...voci piu` vecchie troncate per spazio...\n" + keep_tail
    return txt


def append_to_journal(new_entry: str) -> None:
    if not new_entry or not new_entry.strip():
        return
    JOURNAL_PATH.parent.mkdir(parents=True, exist_ok=True)
    existing = JOURNAL_PATH.read_text(encoding="utf-8") if JOURNAL_PATH.exists() else "# Quaderno di Nonno O.\n\n"
    if not existing.endswith("\n\n"):
        existing += "\n\n"
    JOURNAL_PATH.write_text(existing + new_entry.strip() + "\n", encoding="utf-8")
    log.info("Aggiunta voce al quaderno (%d caratteri totali)", len(existing) + len(new_entry))


# ---------------------------------------------------------------------------
# Player model summary per prompt (utility, usato come dossier per step 1)
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
  - rate richiesto: {goal['rate_per_day_needed']} pt/giorno
  - rate attuale: {goal['rate_per_day_so_far']} pt/giorno
  - proiezione: {goal['projection_at_deadline']}

PRECISIONE (su {kpi['critical_positions']} posizioni CRITICHE):
  - ACPL medio: {kpi['avg_cp_loss_on_critical']}
  - blunder critici: {kpi['blunders_critical']} ({kpi['avoidable_blunders']} evitabili)
  - ACPL ultime 30: {kpi['acpl_recent_30']} (prec: {kpi['acpl_previous_30']})

DECISIONI:
  - conversion rate: {int((dec['conversion_rate'] or 0)*100)}% ({dec['converted_winning']}/{dec['reached_winning']})
  - blow rate: {int((dec['blow_rate'] or 0)*100)}% — {dec['blew_winning']} vittorie buttate
  - save rate: {int((dec['save_rate'] or 0)*100)}% ({dec['saved_losing']}/{dec['reached_losing']})

COLORE:
  - bianco: {int((by_color.get('white',{}).get('win_rate') or 0)*100)}% su {by_color.get('white',{}).get('games',0)}
  - nero: {int((by_color.get('black',{}).get('win_rate') or 0)*100)}% su {by_color.get('black',{}).get('games',0)}

TIME / TILT:
  {spent_line}
  - tilt factor: {tilt['tilt_factor']}× (post-blunder {tilt['after_blunder_avg_cp_loss']} vs baseline {tilt['baseline_avg_cp_loss']})

BLIND SPOTS top 3:
{motif_lines or '  (nessuno)'}

APERTURE PEGGIORI:
{open_lines or '  (nessuna chiara)'}

DIAGNOSI top 3:
{diag_lines}"""


def _verified_facts(pm: dict) -> str:
    """Fatti pre-validati da Python, qualitativizzati (niente numeri).

    È l'unico input "ground truth" che lo step 1 (facts draft) può usare.
    Costruito così da Python per evitare allucinazioni nello step LLM.
    """
    diagnoses = pm.get("diagnoses", [])[:3]
    tactical = pm.get("tactical_breakdown", [])
    decisions = pm.get("decisions", {})
    plan = pm.get("identity", {}).get("plan_summary") or {}

    rep_b = pm.get("repertoire_black", [])
    rep_w = pm.get("repertoire_white", [])
    worst_opening = None
    if rep_b and (rep_b[0].get("win_rate") or 1) < 0.5:
        worst_opening = ("Nero", rep_b[0]["opening"], rep_b[0].get("eco", ""))
    elif rep_w and (rep_w[0].get("win_rate") or 1) < 0.5:
        worst_opening = ("Bianco", rep_w[0]["opening"], rep_w[0].get("eco", ""))

    lines = ["FATTI VALIDATI (i SOLI che puoi usare. Tradotti gia` in parole — non aggiungere numeri):\n"]

    if diagnoses:
        lines.append("PROBLEMI PRINCIPALI (in ordine di impatto):")
        for i, d in enumerate(diagnoses, 1):
            lines.append(f"  {i}. {d['title']}")
        lines.append("")

    if tactical:
        t = tactical[0]
        share = t.get("share_pct", 0)
        if share >= 12:
            quanto = "molto spesso"
        elif share >= 7:
            quanto = "spesso"
        elif share >= 4:
            quanto = "qualche volta"
        else:
            quanto = "raramente"
        lines.append(f"MOTIVO TATTICO PIU` FREQUENTE: «{t['label_it']}» — gli capita {quanto}, "
                     f"e quando capita perde tanto materiale.")
        lines.append("")

    if worst_opening:
        color, name, _eco = worst_opening
        lines.append(f"APERTURA PEGGIORE: col {color} contro la «{name}» perde piu` partite del dovuto.")
        lines.append("")

    blow = decisions.get("blow_rate")
    conv = decisions.get("conversion_rate")
    if blow is not None and blow > 0.30:
        lines.append("DECISIONI: butta troppo spesso le partite in cui era arrivato in vantaggio. "
                     "Sa metterle bene, non sa chiuderle.")
        lines.append("")
    elif conv is not None and conv > 0.65 and (blow or 0) < 0.20:
        lines.append("DECISIONI: quando arriva in vantaggio, chiude bene. Solido sul concreto.")
        lines.append("")

    if plan and plan.get("delta_since_plan") is not None:
        delta = plan["delta_since_plan"]
        if delta >= 80:
            lines.append("PROGRESSIONE DAL GIORNO ZERO: salito molto. Si vede.")
        elif delta >= 20:
            lines.append("PROGRESSIONE DAL GIORNO ZERO: salito, ma lentamente.")
        elif delta >= -20:
            lines.append("PROGRESSIONE DAL GIORNO ZERO: fermo. Non sta salendo.")
        else:
            lines.append("PROGRESSIONE DAL GIORNO ZERO: sceso. Sta perdendo terreno.")

    # --- Sezioni adattive: tempo, tilt, colori, fasi (no numeri nel testo) --

    tm = pm.get("time_management") or {}
    spent = tm.get("spent_vs_accuracy") or []

    # 5.1 Tempo decisionale: confronto lt_1s vs gt_30s
    fast = next((b for b in spent if b.get("key") == "lt_1s"), None)
    slow = next((b for b in spent if b.get("key") == "gt_30s"), None)
    if fast and slow:
        fast_acpl = fast.get("avg_cp_loss") or 0
        slow_acpl = slow.get("avg_cp_loss") or 0
        fast_pos = fast.get("positions") or 0
        slow_pos = slow.get("positions") or 0
        if slow_acpl > 1.5 * fast_acpl and slow_pos >= 30:
            lines.append(
                "TEMPO DECISIONALE: quando pensa piu` di mezzo minuto, le posizioni sono "
                "gia` troppo difficili per lui — la risposta corretta deve arrivargli prima."
            )
        elif fast_acpl > 1.5 * slow_acpl and fast_pos >= 30:
            lines.append(
                "TEMPO DECISIONALE: muove troppo in fretta. Sotto il secondo perde molto, "
                "sopra recupera. Deve rallentare nelle posizioni critiche."
            )

    # 5.2 Mosse istantanee in posizione critica
    instant = tm.get("instant_moves_in_critical") or {}
    instant_n = instant.get("n") or 0
    instant_acpl = instant.get("avg_cp_loss") or 0
    if instant_n >= 20 and instant_acpl > 100:
        lines.append(
            "MOSSE ISTANTANEE: in posizione critica muove sotto un secondo troppe volte. "
            "Li` regala materiale. La fretta in posizione decisiva e` il problema."
        )

    # 5.3 Tilt
    tilt = pm.get("tilt") or {}
    tilt_factor = tilt.get("tilt_factor") or 0
    if tilt_factor >= 1.5:
        lines.append(
            "TILT: dopo un errore peggiora subito. La partita non si recupera con la rincorsa: "
            "dopo un brutto colpo, alzarsi e respirare."
        )

    # 5.4 Squilibrio colori
    by_color = pm.get("by_color") or {}
    white = by_color.get("white") or {}
    black = by_color.get("black") or {}
    white_games = white.get("games") or 0
    black_games = black.get("games") or 0
    if white_games >= 30 and black_games >= 30:
        white_wr = white.get("win_rate") or 0
        black_wr = black.get("win_rate") or 0
        if white_wr - black_wr >= 0.12:
            lines.append("COLORE: col Bianco va meglio, col Nero gli pesa. "
                         "Vale la pena ripulire la difesa col Nero.")
        elif black_wr - white_wr >= 0.12:
            lines.append("COLORE: col Nero va meglio, col Bianco gli pesa. "
                         "Va sistemata l'apertura col Bianco.")

    # 5.5 Squilibrio fasi
    by_phase = pm.get("by_phase") or []
    phases_ok = [p for p in by_phase if (p.get("positions") or 0) >= 200]
    if len(phases_ok) >= 2:
        worst_phase = max(phases_ok, key=lambda p: p.get("avg_cp_loss") or 0)
        best_phase = min(phases_ok, key=lambda p: p.get("avg_cp_loss") or 0)
        worst_acpl = worst_phase.get("avg_cp_loss") or 0
        best_acpl = best_phase.get("avg_cp_loss") or 0
        if best_acpl > 0 and worst_acpl > 1.4 * best_acpl:
            phase_name = worst_phase.get("phase", "")
            if phase_name == "middlegame":
                lines.append("FASE DEBOLE: nel mediogioco perde molto piu` che in "
                             "apertura/finale. La fase delle scelte concrete e` il punto.")
            elif phase_name == "endgame":
                lines.append("FASE DEBOLE: i finali costano. L'apertura la sa, ma quando "
                             "la posizione si semplifica perde terreno.")
            elif phase_name == "opening":
                lines.append("FASE DEBOLE: dall'apertura esce gia` indietro. "
                             "Va ripulito il repertorio.")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# OpenAI call helpers
# ---------------------------------------------------------------------------


def _openai_client():
    from openai import OpenAI
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY non settato")
    return OpenAI(api_key=api_key)


def call_openai_json(system: str, user: str, temperature: float = 0.4,
                     max_tokens: int = 3000) -> dict:
    """Call che ritorna JSON valido. Robusta a fence/preamboli."""
    client = _openai_client()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={"type": "json_object"},
        temperature=temperature,
        max_completion_tokens=max_tokens,
    )
    content = resp.choices[0].message.content
    if not content:
        raise RuntimeError("LLM ha risposto vuoto")
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
        cleaned = cleaned.strip()
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


def call_openai_md(system: str, user: str, temperature: float = 0.6,
                   min_chars: int = 80) -> str:
    """Call testuale markdown (usata solo dal journal entry)."""
    client = _openai_client()
    resp = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_completion_tokens=2000,
    )
    text = resp.choices[0].message.content
    if not text:
        raise RuntimeError("LLM ha risposto vuoto")
    text = text.strip()
    # Strip preamboli prima del primo heading
    lines = text.splitlines()
    started = any(line.lstrip().startswith("#") for line in lines)
    if started:
        out = []
        kicked = False
        for line in lines:
            if not kicked and line.lstrip().startswith("#"):
                kicked = True
            if kicked:
                out.append(line)
        text = "\n".join(out).strip()
    return text


# ---------------------------------------------------------------------------
# Chess noun vocabulary (per Python referee)
# ---------------------------------------------------------------------------


# Sezioni di CHESS_NOUNS.md che il referee controlla STRICT (no aggiunte).
# Le altre sezioni (pezzi, strutture pedonali, decisioni, ecc.) sono
# vocabolario utile ma non strict: la voce puo` liberamente menzionarle
# perche` sono parole italiane normali, non allucinazioni scacchistiche.
STRICT_REFEREE_SECTIONS = {
    "motivi tattici",
    "fasi della partita",
    "colori",
    "aperture",  # match prefix per "## Aperture (...)"
}


def load_chess_nouns() -> dict[str, dict]:
    """Parsa `02-voice/CHESS_NOUNS.md`. Ritorna:
        {canonical: {"forms": [synonyms...], "section": "...", "strict": bool}}

    `strict=True` -> la famiglia è controllata dal referee post-voice
    (non puo` essere aggiunta). `strict=False` -> vocabolario tollerato.

    Salta la sezione finale "Cose che NON sono sostantivi controllati".
    """
    path = BRAIN_DIR / "02-voice" / "CHESS_NOUNS.md"
    families: dict[str, dict] = {}
    if not path.exists():
        return families
    current_section = ""
    skip = False
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith("## "):
            current_section = stripped.lstrip("# ").strip().lower()
            skip = current_section.startswith("cose che non sono")
            continue
        if skip:
            continue
        if stripped.startswith("- "):
            payload = stripped[2:].strip()
            forms = [f.strip().lower() for f in payload.split(",") if f.strip()]
            if not forms:
                continue
            canonical = forms[0]
            strict = any(current_section.startswith(s) for s in STRICT_REFEREE_SECTIONS)
            families[canonical] = {"forms": forms, "section": current_section, "strict": strict}
    return families


def strict_families(families: dict[str, dict]) -> dict[str, list[str]]:
    """Sotto-vocabolario controllato dal referee."""
    return {k: v["forms"] for k, v in families.items() if v.get("strict")}


def extract_chess_nouns(text: str, families: dict) -> set[str]:
    """Set di canonici trovati nel testo (case-insensitive, parola intera o frase).

    Accetta sia il dict completo {canonical: {forms, section, strict}}
    sia un dict semplificato {canonical: [forms]}.
    """
    found: set[str] = set()
    text_low = text.lower()
    for canonical, value in families.items():
        forms = value["forms"] if isinstance(value, dict) else value
        for form in forms:
            pattern = r"(?<!\w)" + re.escape(form) + r"(?!\w)"
            if re.search(pattern, text_low):
                found.add(canonical)
                break
    return found


def _flatten_brief(brief: dict) -> str:
    """Concatena i campi del brief in un'unica stringa per il referee."""
    parts = []
    for k in ("headline", "diagnosis_narrative", "avoid"):
        v = brief.get(k, "")
        if isinstance(v, str):
            parts.append(v)
    this_week = brief.get("this_week", [])
    if isinstance(this_week, list):
        parts.extend(str(x) for x in this_week)
    return "\n".join(parts)


def _drafts_to_text(drafts: dict) -> str:
    """Concatena tutti gli artifact di un dict {story, progress, roadmap, brief}."""
    parts = []
    for k in ("story", "progress", "roadmap"):
        v = drafts.get(k, "")
        if isinstance(v, str):
            parts.append(v)
    brief = drafts.get("brief", {})
    if isinstance(brief, dict):
        parts.append(_flatten_brief(brief))
    return "\n".join(parts)


def voice_referee(draft: dict, painted: dict,
                  families: dict) -> tuple[bool, set[str]]:
    """True se painted non aggiunge sostantivi STRICT rispetto al draft.

    `families` può essere il dict completo (con metadati) o un sotto-dict
    già filtrato (solo forms). Il referee considera SOLO le famiglie strict
    (motivi tattici, aperture, fasi, colori) — le altre (pezzi, decisioni,
    strutture) sono vocabolario tollerato.

    Ritorna (ok, extras): extras è il set di canonici strict che painted
    ha aggiunto illegalmente.
    """
    # Estrai sotto-dict strict se il dict input ha metadati
    if families and isinstance(next(iter(families.values()), None), dict):
        check_vocab = strict_families(families)
    else:
        check_vocab = families  # già forms-only
    draft_nouns = extract_chess_nouns(_drafts_to_text(draft), check_vocab)
    painted_nouns = extract_chess_nouns(_drafts_to_text(painted), check_vocab)
    extras = painted_nouns - draft_nouns
    return (len(extras) == 0, extras)


def _all_forms_dict(families: dict) -> dict[str, list[str]]:
    """Estrae il dict forms-only dal dict completo (utility per extract)."""
    if not families:
        return {}
    if isinstance(next(iter(families.values()), None), dict):
        return {k: v["forms"] for k, v in families.items()}
    return families  # già forms-only


# ---------------------------------------------------------------------------
# Growth delta context block (iniettato nei prompt voice/session/journal)
# ---------------------------------------------------------------------------


def growth_context_block(growth: dict | None) -> str:
    """Produce la sezione testuale da iniettare nei prompt.

    Quando disponibile, e` OBBLIGATORIO per il modello citarla nel testo —
    e` il moltiplicatore principale del valore del prodotto (Nonno ricorda
    e misura). Senza la citazione, il prodotto perde il senso di
    progressione.
    """
    if not growth or not growth.get("available"):
        return ""
    hint = growth.get("summary_phrase_hint", "")
    if not hint:
        return ""
    return f"""
CRESCITA SETTIMANE RECENTI (OBBLIGATORIO citarla — Nonno ricorda):

{hint}

ISTRUZIONE: inserisci UNA frase nel testo (brief o open_tavolo) che racconti
questo delta in voce di Nonno. Esempi di trasformazione:
- "Pezzo in presa: in netto miglioramento" → "Quattro settimane fa lo
  lasciavi spesso. Adesso quasi mai. Continuiamo."
- "Tempo eccessivo: in lieve peggioramento" → "Stai pensando piu` di prima
  e perdi di piu`. Bisogna rallentare alle posizioni critiche, non a tutte."

NON inventare numeri. Usa i qualifier: "spesso", "quasi mai", "meno di
prima", "torna su", "in netto miglioramento". Senza questa citazione manca
il valore principale.
"""


# ---------------------------------------------------------------------------
# STEP 1: draft facts
# ---------------------------------------------------------------------------


def draft_facts(pm: dict) -> dict:
    """LLM call #1: produce draft asciutto fattualmente corretto.

    Output JSON: {story, progress, roadmap, brief}.
    story/progress/roadmap sono markdown. brief è dict con sotto-campi.
    """
    facts_skill = load_facts_skill()
    if not facts_skill:
        raise RuntimeError("Skill 01-facts/FACTS.md mancante")

    # Wiki: usiamo le aree pertinenti come dossier di riferimento (non da
    # ricopiare). Il modello scegliera` cosa serve.
    wiki = (
        load_wiki_for("profilazione") + "\n\n" +
        load_wiki_for("zavorre") + "\n\n" +
        load_wiki_for("progressione") + "\n\n" +
        load_wiki_for("piano-allenamento")
    )

    system = facts_skill
    user = f"""Produci i 4 artifact dello step 1 (draft asciutto).

DOSSIER WIKI (riferimento, NON ricopiare — serve solo per chiamare le
cose col nome giusto):

{wiki}

FATTI PRE-VALIDATI (sono i SOLI fatti che puoi usare):

{_verified_facts(pm)}

Output: JSON valido con esattamente 4 chiavi:
- "story": markdown con `## Titolo` + 200-250 parole prosa
- "progress": markdown con `## Titolo` + 180-220 parole prosa
- "roadmap": markdown con `## Titolo` + 250-320 parole prosa (3 paragrafi,
  uno per ognuno dei 3 problemi top, stesso ordine)
- "brief": oggetto con headline (str, ≤100 char), diagnosis_narrative
  (str, esattamente 3 frasi corte), this_week (array di 3 stringhe ≤80
  char), avoid (str ≤80 char), open_tavolo (str, 3-4 frasi 50-70 parole
  che apriranno il Tavolo/home). `open_tavolo` DEVE includere:
    (a) anticipazione del pattern del giorno (es. "oggi guardiamo il
        pezzo in presa nel mediogioco");
    (b) SE il blocco growth e` disponibile nel prompt, citazione della
        TRAIETTORIA del pattern in voce ("quattro settimane fa lo
        lasciavi spesso, adesso meno") — usa SOLO qualifier qualitativi,
        mai numeri;
    (c) cosa rivediamo e quanto dura (3 momenti, una partita, ~15 min);
    (d) invito asciutto "Sediamoci" o equivalente.
  Nel draft step 1 ancora ASCIUTTO, fattuale; lo step 2 lo ridipinge in
  voce Nonno con la traiettoria.

Tono ASCIUTTO. Niente voce, niente "Oooh", niente metafore. Niente numeri.
"""
    return call_openai_json(system, user, temperature=0.4, max_tokens=3500)


# ---------------------------------------------------------------------------
# STEP 2: paint voice
# ---------------------------------------------------------------------------


def paint_voice(draft: dict, journal: str = "",
                feedback: str | None = None,
                growth: dict | None = None) -> dict:
    """LLM call #2: ridipingi il draft nella voce di Nonno O.

    `feedback` (se presente): messaggio dal referee precedente che dice
    "hai aggiunto questi nomi nuovi, non puoi". Usato nei retry.
    `growth` (se presente): delta-pattern week-over-week, Nonno puo`
    riferirsi al passato ("tre settimane fa...").
    """
    persona = load_coach_persona()
    voice_skill = load_voice_skill()
    if not persona or not voice_skill:
        raise RuntimeError("Brain incompleto: serve 00-coach/COACH.md + 02-voice/VOICE.md")

    system = (
        persona + "\n\n---\n\n# Skill voice (regole operative di trasformazione)\n\n"
        + voice_skill
    )

    memoria_block = ""
    if journal.strip():
        memoria_block = (
            f"\nMEMORIA (il tuo quaderno, cose dette nelle settimane "
            f"scorse — usala per riferimenti se pertinente):\n\n"
            f"{journal[-3000:]}\n"
        )

    growth_block = growth_context_block(growth)

    feedback_block = ""
    if feedback:
        feedback_block = (
            f"\n# RETRY — il referee ha rifiutato il tuo output precedente\n\n"
            f"{feedback}\n\nRifai mantenendo SOLO i sostantivi scacchistici "
            f"del draft. Non aggiungerne di nuovi.\n"
        )

    user = f"""Ridipingi il DRAFT seguente nella voce di Nonno O.

DRAFT (input — fattualmente corretto, asciutto):

{json.dumps(draft, ensure_ascii=False, indent=2)}
{memoria_block}{growth_block}{feedback_block}
Output: JSON valido con la STESSA struttura del draft (story, progress,
roadmap come markdown stringa; brief come oggetto con headline,
diagnosis_narrative, this_week array di 3, avoid, open_tavolo).

NOTA SU `open_tavolo`: è la frase che apre la HOME quando l'allievo
apre l'app. 3-4 frasi (50-70 parole), tono "ti aspettavo, sediamoci".
DEVE anticipare cosa rivediamo oggi: tipologia di momenti scelti
(es. "oggi guardiamo tre tue partite recenti dove hai lasciato il
pezzo in presa"), durata stimata (~15 minuti), promessa concreta
("poi giochiamo una contro un giocatore al tuo target"). NON è una
frase generica di feedback — è l'INVITO al tavolo di oggi.

VINCOLO LESSICALE OBBLIGATORIO: in tutto il painted finale scrivi
SEMPRE `pezzo in presa` (italiano scacchistico tradizionale), MAI
`pezzo appeso` (calco dall'inglese, vietato). Se il draft dice
`pezzo appeso` riscrivilo come `pezzo in presa` — è la stessa cosa,
solo il lessico vero.

VINCOLO HARD (verificato dal referee Python — 4 categorie strict):

NON aggiungere NESSUN sostantivo nuovo in queste 4 categorie se non era
gia` nel draft:
  1. MOTIVI TATTICI: pezzo appeso, forchetta, attacco scoperto,
     inchiodatura, ottava traversa, infilata, doppio attacco, ecc.
     Se il draft cita solo "pezzo appeso", tu NON puoi aggiungere
     "attacco scoperto" o "forchetta", anche se sono semanticamente
     correlati.
  2. APERTURE: Francese, Siciliana, Italiana, Spagnola, ecc.
     Se il draft non nomina un'apertura, tu non la nomini.
  3. FASI DELLA PARTITA: apertura, mediogioco, finale, finale di torri,
     finale di pedoni. Se il draft parla solo di "mediogioco", tu non
     puoi aggiungere "finale".
  4. COLORI: col Bianco, col Nero. Stessa regola.

Puoi liberamente usare: pezzi (cavallo, alfiere, ecc.), concetti
posizionali (vantaggio, conversione, semplificazione, scambio,
diagonale, colonna), parole italiane normali, "Oooh", scene osservate,
riferimenti alla memoria.

Puoi anche OMETTERE sostantivi strict del draft (semplificare). La
regola è "non aggiungerne", non "mantienili tutti".
"""
    return call_openai_json(system, user, temperature=0.6, max_tokens=3500)


# ---------------------------------------------------------------------------
# Pipeline orchestrator
# ---------------------------------------------------------------------------


def _debug_dump(name: str, payload: dict) -> None:
    """Scrive payload in data/_debug/<name>.json per ispezione post-mortem."""
    debug_dir = REPO_ROOT / "data" / "_debug"
    debug_dir.mkdir(parents=True, exist_ok=True)
    (debug_dir / f"{name}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def run_pipeline(pm: dict, journal: str, growth: dict | None = None) -> tuple[dict, dict, str]:
    """Esegue step1 (draft fattuale) -> step2 (voice Nonno) -> referee -> retry.

    Ritorna (final, draft, mode_tag) dove mode_tag ∈
    {"voice", "voice-retry", "draft-fallback"}.

    Side effects (debug): scrive in data/_debug/ il draft e ogni tentativo
    painted (anche se rifiutato), per ispezione post-mortem.
    """
    families = load_chess_nouns()
    strict = strict_families(families)
    log.info("Step 1: draft asciutto in corso (%d famiglie totali, %d strict)",
             len(families), len(strict))
    draft = draft_facts(pm)
    _debug_dump("step1_draft", draft)
    log.info("Step 1 ok: story=%d progress=%d roadmap=%d brief.keys=%s",
             len(draft.get("story", "")), len(draft.get("progress", "")),
             len(draft.get("roadmap", "")), list(draft.get("brief", {}).keys()))

    last_feedback: str | None = None
    for attempt in range(1, VOICE_MAX_RETRIES + 2):
        log.info("Step 2 tentativo %d/%d", attempt, VOICE_MAX_RETRIES + 1)
        painted = paint_voice(draft, journal=journal, feedback=last_feedback, growth=growth)
        _debug_dump(f"step2_painted_attempt_{attempt}", painted)
        ok, extras = voice_referee(draft, painted, families)
        if ok:
            tag = "voice" if attempt == 1 else "voice-retry"
            log.info("Step 2 ok (referee passato al tentativo %d)", attempt)
            return painted, draft, tag
        extras_str = ", ".join(sorted(extras))
        log.warning("Referee rifiuta: painted ha aggiunto strict nouns: %s", extras_str)
        last_feedback = (
            f"Hai aggiunto questi sostantivi scacchistici STRICT che NON "
            f"erano nel draft: {extras_str}. Sono motivi tattici, aperture, "
            f"fasi della partita o colori. NON puoi aggiungerne di nuovi "
            f"in queste 4 categorie. Riformula evitandoli."
        )

    log.warning("Referee fallito %d volte. Fallback al draft asciutto.", VOICE_MAX_RETRIES + 1)
    return draft, draft, "draft-fallback"

# ---------------------------------------------------------------------------
# STEP 3 (ortogonale): session phrases pre-generate
# ---------------------------------------------------------------------------


SESSION_PHRASE_KEYS = (
    "open_warmup", "between_warmup_bivio", "open_bivio", "between_bivio_play",
    "open_play", "recap_win", "recap_draw", "recap_loss", "close",
)

SESSION_FALLBACK = {
    "open_warmup": "Cinque posizioni. Conta i difensori del pezzo prima di muovere.",
    "between_warmup_bivio": "Bene. Adesso tre posizioni vere. Pensa alla minaccia sul pezzo prima di scegliere.",
    "open_bivio": "Ecco. Prima conta gli attaccanti e i difensori. Poi muovi.",
    "between_bivio_play": "Adesso la partita. Vediamo se stavolta semplifichi a tempo.",
    "open_play": "Ricordati: prima di muovere, conta i difensori del pezzo che sposti.",
    "recap_win": "Bravo. Hai scambiato bene e hai tolto controgioco.",
    "recap_draw": "Mh. Hai tenuto il punto. Va bene cosi`.",
    "recap_loss": "Oh. C'erano pezzi non protetti. Lavoriamoci.",
    "close": "Riposati. Domani contiamo i difensori prima di muovere.",
}


def generate_session_phrases(brief: dict, journal: str, growth: dict | None = None) -> dict:
    """LLM call #3: pre-genera 9 frasi della sessione (warmup/bivio/play/recap).

    Le frasi vivono in `pm["coach_session"]` e sono lette dal frontend
    nei momenti giusti durante la sessione giornaliera. `growth` (se
    presente) permette a Nonno di riferirsi al delta-pattern (es. recap
    win/loss che cita un pattern in miglioramento).
    """
    persona = load_coach_persona()
    session_skill = load_session_skill()
    if not persona or not session_skill:
        log.warning("Brain incompleto per session phrases. Uso fallback.")
        return dict(SESSION_FALLBACK)

    system = (
        persona + "\n\n---\n\n# Skill session (frasi pre-generate)\n\n"
        + session_skill
    )
    memoria_block = ""
    if journal.strip():
        memoria_block = (
            f"\nMEMORIA (il quaderno):\n{journal[-2000:]}\n"
        )
    growth_block = growth_context_block(growth)
    user = f"""Genera il blocco JSON con le 9 frasi della sessione di questa settimana.

BRIEF SETTIMANALE (uso obbligatorio dei sostantivi scacchistici qui presenti
— non aggiungerne nuovi, vedi vincolo strict dello skill voice):

{json.dumps(brief, ensure_ascii=False, indent=2)}
{memoria_block}{growth_block}
Output: SOLO JSON valido con queste 9 chiavi esatte:
{", ".join(SESSION_PHRASE_KEYS)}

Niente preamboli. Niente testo fuori dalle graffe.
"""
    try:
        out = call_openai_json(system, user, temperature=0.55, max_tokens=1200)
    except Exception as e:  # noqa: BLE001
        log.warning("Session phrases LLM fallita (%s). Fallback.", e)
        return dict(SESSION_FALLBACK)

    # Validate: tutte le chiavi presenti, valori stringa non vuoti.
    result = {}
    for k in SESSION_PHRASE_KEYS:
        v = out.get(k)
        if isinstance(v, str) and v.strip():
            result[k] = v.strip()
        else:
            log.warning("Session phrase '%s' mancante o vuota, uso fallback.", k)
            result[k] = SESSION_FALLBACK[k]
    return result


# ---------------------------------------------------------------------------
# Journal entry (ortogonale, terza call)
# ---------------------------------------------------------------------------


def generate_journal_entry(pm: dict, journal: str, artifacts: dict[str, str], growth: dict | None = None) -> str:
    persona = load_coach_persona() or "Sei Nonno O., un nonno di Sorrento che allena scacchi."
    growth_block = growth_context_block(growth)
    user = f"""A fine sessione, prima di andare a fare due passi al porto, apri il
quaderno e scrivi una NUOVA voce. Solo per te. Per ricordarti la prossima volta.

MEMORIA (voci precedenti):
{journal[-3000:] if journal else '(prima voce)'}
{growth_block}
DATI ATTUALI:
{player_brief(pm)}

COSA HAI SCRITTO OGGI ALL'ALLIEVO:
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
    return call_openai_md(persona, user, temperature=0.6, min_chars=80)


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

Rating blitz {goal['current_rating']}, obiettivo {goal['target']} entro {goal['deadline']}.

Su {kpi['critical_positions']} posizioni critiche, {kpi['blunders_critical']} blunder ({kpi['avoidable_blunders']} evitabili). Conversion rate {int((dec['conversion_rate'] or 0)*100)}%, save rate {int((dec['save_rate'] or 0)*100)}%.

(Coach LLM non disponibile — output minimal dai dati grezzi.)
"""
    progress = f"""## Verdetto

{('On track' if goal['on_track'] else 'Dietro il piano')}: proiezione {goal['projection_at_deadline']}.

ACPL ultime 30: {kpi['acpl_recent_30']}, precedenti 30: {kpi['acpl_previous_30']}.
"""
    roadmap = f"""## Capitolo 1 · {diag.get('title','Sistema il problema #1')}

{diag.get('evidence','')}

**Cosa fai**: {diag.get('trainable','tactic trainer Lichess')}.
"""
    return {"story": story, "progress": progress, "roadmap": roadmap}


def fallback_brief(pm: dict) -> dict:
    wf = pm.get("weekly_focus") or {}
    diag = (pm.get("diagnoses") or [{}])[0]
    return {
        "headline": wf.get("headline") or diag.get("title") or "Continua a giocare e torna domani",
        "diagnosis_narrative": diag.get("evidence", ""),
        "this_week": wf.get("actions") or [diag.get("trainable", "")][:3],
        "avoid": "Bullet quando vuoi migliorare in blitz",
        "open_tavolo": "Oooh, eccolo. Oggi rivediamo i tuoi momenti chiave dalle ultime partite. Poi giochiamo contro un giocatore al tuo target. Sediamoci.",
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
    persona = load_coach_persona()
    facts_skill = load_facts_skill()
    voice_skill = load_voice_skill()
    journal = load_journal()
    have_api = bool(os.environ.get("OPENAI_API_KEY"))
    brain_complete = bool(persona and facts_skill and voice_skill)

    # Aggregator deterministico (no LLM) — delta-pattern week-over-week.
    # Iniettato nei prompt voice/session/journal cosi` Nonno puo` riferirsi
    # al miglioramento/peggioramento dei pattern nel tempo.
    growth = compute_growth_delta(REPO_ROOT)
    pm["growth_delta"] = growth
    if growth.get("available"):
        log.info("growth_delta: %s (%s/%s)",
                 growth.get("summary_label_it"),
                 growth.get("summary_direction"),
                 growth.get("summary_magnitude"))
    else:
        log.info("growth_delta non disponibile: %s", growth.get("reason", "?"))

    artifacts: dict[str, str] = {}
    brief: dict[str, Any]
    mode_tag = "fallback"

    if brain_complete and have_api:
        log.info("Modalita` FULL · pipeline 2-step (%s) · journal: %d chars",
                 MODEL, len(journal))
        try:
            final, draft, mode_tag = run_pipeline(pm, journal, growth=growth)
            artifacts = {
                "story": final.get("story", draft.get("story", "")),
                "progress": final.get("progress", draft.get("progress", "")),
                "roadmap": final.get("roadmap", draft.get("roadmap", "")),
            }
            brief_obj = final.get("brief") or draft.get("brief") or {}
            if not isinstance(brief_obj, dict):
                brief_obj = {}
            brief = dict(brief_obj)
            brief["generated_at"] = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
            brief["model"] = MODEL
            brief["pipeline_mode"] = mode_tag
        except Exception as e:  # noqa: BLE001
            log.warning("Pipeline 2-step fallita (%s). Fallback.", e)
            artifacts = fallback_artifacts(pm)
            brief = fallback_brief(pm)
            mode_tag = "fallback-error"

        # Session phrases pre-generate (LLM call con voce Nonno, best-effort)
        try:
            session_phrases = generate_session_phrases(brief, journal, growth=growth)
            log.info("Session phrases generate (%d chiavi)", len(session_phrases))
        except Exception as e:  # noqa: BLE001
            log.warning("Session phrases fallite (%s). Fallback statico.", e)
            session_phrases = dict(SESSION_FALLBACK)

        # Journal entry (best-effort): Nonno scrive una nuova voce di quaderno.
        try:
            new_entry = generate_journal_entry(pm, journal, artifacts, growth=growth)
            append_to_journal(new_entry)
        except Exception as e:  # noqa: BLE001
            log.warning("Voce di quaderno fallita (%s). Memoria non aggiornata.", e)
    else:
        if not brain_complete:
            missing = []
            if not persona: missing.append("00-coach/COACH.md")
            if not facts_skill: missing.append("01-facts/FACTS.md")
            if not voice_skill: missing.append("02-voice/VOICE.md")
            log.warning("Brain incompleto, manca: %s. Fallback regole.", ", ".join(missing))
        if not have_api:
            log.warning("OPENAI_API_KEY non settato. Fallback regole.")
        artifacts = fallback_artifacts(pm)
        brief = fallback_brief(pm)
        session_phrases = dict(SESSION_FALLBACK)

    out_dir = REPO_ROOT / "data"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, content in artifacts.items():
        (out_dir / f"coach_{name}.md").write_text(content, encoding="utf-8")
        log.info("Scritto data/coach_%s.md (%d chars)", name, len(content))

    (out_dir / "coach_brief.json").write_text(
        json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    pm["coach_brief"] = brief
    pm["coach_artifacts"] = artifacts
    pm["coach_session"] = session_phrases
    pm_path.write_text(json.dumps(pm, ensure_ascii=False, indent=2), encoding="utf-8")
    fe = REPO_ROOT / "frontend" / "public" / "player_model.json"
    if fe.parent.exists():
        fe.write_text(json.dumps(pm, ensure_ascii=False), encoding="utf-8")
        log.info("Player model aggiornato in %s", fe)

    log.info("Pipeline: %s | Headline: %s", mode_tag, brief.get("headline", "?"))


if __name__ == "__main__":
    main()
