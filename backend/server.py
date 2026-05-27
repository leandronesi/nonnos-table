"""
Mygotham server — endpoint LLM-live per coaching reattivo.

Riceve lo STATO CORRENTE del giocatore (drill log, journal entries, freni
attivi) dal frontend e ritorna un brief contestuale generato da Nonno O. —
non un brief settimanale pre-cotto, ma "cosa ha fatto questo utente OGGI e
cosa propongo adesso".

Endpoint:
    POST /api/coach/live    — coaching contestuale
    GET  /api/health        — controllo openai key + modello

Avvio dev:
    cd backend && python -m uvicorn server:app --reload --port 8000
"""
from __future__ import annotations

import os
import json
import hashlib
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from coach import call_openai_json, MODEL  # type: ignore


# ---------------------------------------------------------------------------
# Schema input / output
# ---------------------------------------------------------------------------


class FrenoSummary(BaseModel):
    """Riassunto di un singolo freno (Pattern) per il prompt LLM."""
    name: str
    category: str  # tactic/timing/phase/decision/psych/color
    current_share: float  # % nelle partite del periodo (0..1)
    trend: str  # improving / stable / worsening
    avoidable_count: int  # posizioni evitabili al MIO livello
    avg_drill_value: float  # 0..1
    impact_score: float
    drill_runs_total: int  # quante volte allenato lifetime
    drill_done_today: bool
    last_drill_outcome: Optional[str] = None  # "all_perfect" / "mixed" / "wrong" / None


class JournalEntrySummary(BaseModel):
    """Riassunto di una entry del journal cliente per contesto LLM."""
    date: str
    kind: str
    body: str


class LiveCoachRequest(BaseModel):
    """Stato corrente che il frontend invia per ottenere il brief contestuale."""
    username: str
    current_rating: Optional[int] = None
    target_rating: int
    time_class: str
    days_to_deadline: Optional[int] = None
    streak_current: int = 0
    streak_best: int = 0
    rating_delta_30d: Optional[int] = None
    top_freni: list[FrenoSummary] = []
    recent_journal: list[JournalEntrySummary] = []
    focus_pattern_key: Optional[str] = None


class LiveCoachResponse(BaseModel):
    headline: str
    body: str
    suggested_focus_pattern_key: Optional[str] = None
    generated_at: str
    model: str
    cached: bool = False


# ---------------------------------------------------------------------------
# Prompt + LLM call
# ---------------------------------------------------------------------------


SYSTEM_PROMPT = """Sei Nonno O., coach scacchistico personale di Road to GranPa.

Voce:
- italiana, frasi brevi, calda ma asciutta. NIENTE retorica.
- usi termini scacchistici italiani veri: pezzo in presa, forchetta, attacco doppio,
  mediogioco, fianchetto, scacco di scoperta, ottava traversa, attacco scoperto.
- niente "tu" formale. Usi "ti", "te". Niente emoji.
- intercalari rari: "Mh", "Oooh", "Bravo", "Ecco".

Compito: dato lo STATO CORRENTE di un allievo, produci un brief contestuale
specifico a OGGI. Massimo 60 parole nel body. NON ripetere quanto è già ovvio
nei dati. Riferisci a cose specifiche che l'utente ha fatto/non fatto.

Output JSON OBBLIGATORIO:
{
  "headline": "6-10 parole, una micro-frase d'apertura",
  "body": "2-4 frasi (max 60 parole). Parla di OGGI, non in generale.",
  "suggested_focus_pattern_key": "key del freno consigliato per oggi (da top_freni) o null"
}

Regole dure:
- NON menzionare percentuali esatte ("12.4%") — di' "su 10 volte ti capita 1"
- NON usare "pattern" — usa "freno"
- NON usare gergo backend (cp_loss, MAIA, motif_*, ECO) — usa parole umane
- Riferisci SEMPRE il target dichiarato (es. "verso 1600 rapid") nel body o headline
- Se l'utente HA ALLENATO oggi: complimentati o nota l'esito (non ignorare)
- Se l'utente NON ha allenato oggi: invitalo a sedersi, senza colpevolizzare
"""


def _build_user_prompt(req: LiveCoachRequest) -> str:
    """Compone il prompt utente strutturato a partire dallo stato."""
    lines: list[str] = []
    lines.append("STATO ATTUALE DELL'ALLIEVO\n")
    lines.append(f"Username: @{req.username}")
    cur_str = str(req.current_rating) if req.current_rating else "n/d"
    lines.append(f"Rating attuale ({req.time_class}): {cur_str}")
    lines.append(f"Obiettivo dichiarato: {req.target_rating} {req.time_class}")
    if req.days_to_deadline is not None:
        lines.append(f"Giorni alla deadline: {req.days_to_deadline}")
    if req.rating_delta_30d is not None:
        sign = "+" if req.rating_delta_30d >= 0 else ""
        lines.append(f"Delta rating 30gg: {sign}{req.rating_delta_30d}")
    lines.append(f"Streak attuale: {req.streak_current} (best: {req.streak_best})")
    lines.append("")

    lines.append("TOP FRENI (in ordine di impatto):")
    for i, f in enumerate(req.top_freni[:7], start=1):
        bits = [
            f"{i}. {f.name}",
            f"cat={f.category}",
            f"share={f.current_share*100:.0f}%",
            f"trend={f.trend}",
            f"avoidable={f.avoidable_count}",
            f"runs={f.drill_runs_total}",
            ("allenato_oggi=SI" if f.drill_done_today else "allenato_oggi=NO"),
        ]
        if f.last_drill_outcome:
            bits.append(f"ultima={f.last_drill_outcome}")
        lines.append("  " + " | ".join(bits))
    lines.append("")

    if req.recent_journal:
        lines.append("ULTIME ENTRY DEL DIARIO (dal più recente):")
        for e in req.recent_journal[:12]:
            lines.append(f"  [{e.date}] {e.kind}: {e.body}")
        lines.append("")

    if req.focus_pattern_key:
        lines.append(f"L'utente ha chiesto commento specifico su: {req.focus_pattern_key}")
        lines.append("")

    lines.append("Genera adesso il brief contestuale per OGGI. Solo JSON.")
    return "\n".join(lines)


def _generate_brief(req: LiveCoachRequest) -> dict[str, Any]:
    user_prompt = _build_user_prompt(req)
    return call_openai_json(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        temperature=0.55,
        max_tokens=400,
    )


# ---------------------------------------------------------------------------
# Cache su filesystem (semplice, dev-friendly)
# ---------------------------------------------------------------------------


CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "_live_coach_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_TTL_SECONDS = 3600  # 1 ora


def _cache_key(req: LiveCoachRequest) -> str:
    """Hash deterministico dello stato — se lo stato non cambia, riusa la risposta."""
    blob = json.dumps(req.dict(), sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:24]


def _cache_get(key: str) -> Optional[dict]:
    p = CACHE_DIR / f"{key}.json"
    if not p.exists():
        return None
    try:
        import time
        if time.time() - p.stat().st_mtime > CACHE_TTL_SECONDS:
            return None
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _cache_set(key: str, data: dict) -> None:
    try:
        p = CACHE_DIR / f"{key}.json"
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------


app = FastAPI(title="Mygotham Live Coach", version="0.1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=False,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    has_key = bool(os.environ.get("OPENAI_API_KEY"))
    return {"ok": True, "openai_key_present": has_key, "model": MODEL}


@app.post("/api/coach/live", response_model=LiveCoachResponse)
def coach_live(req: LiveCoachRequest, force: bool = False) -> LiveCoachResponse:
    """Genera brief contestuale per l'utente. Cache TTL 1h, invalidata se lo stato cambia."""
    if not os.environ.get("OPENAI_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY non settato sul server")

    key = _cache_key(req)
    cached = None if force else _cache_get(key)
    if cached:
        return LiveCoachResponse(**cached, cached=True)

    try:
        result = _generate_brief(req)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    from datetime import datetime, timezone
    response = {
        "headline": result.get("headline", ""),
        "body": result.get("body", ""),
        "suggested_focus_pattern_key": result.get("suggested_focus_pattern_key"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": MODEL,
    }
    _cache_set(key, response)
    return LiveCoachResponse(**response, cached=False)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
