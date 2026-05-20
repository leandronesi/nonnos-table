"""FastAPI opzionale: serve data/metrics.json (e ricostruisce on-demand).

Avvio:
    uvicorn backend.server:app --reload
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config_loader import load_config
from metrics import build as build_metrics

app = FastAPI(title="Chess Coach API", version="0.1")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _read_metrics() -> dict:
    cfg = load_config()
    p = Path(cfg["paths"]["metrics_file"])
    if not p.exists():
        raise HTTPException(status_code=404, detail="metrics.json non esiste — lancia metrics.py")
    return json.loads(p.read_text(encoding="utf-8"))


@app.get("/api/metrics")
def get_metrics() -> dict:
    return _read_metrics()


@app.post("/api/metrics/rebuild")
def rebuild_metrics() -> dict:
    cfg = load_config()
    out = build_metrics(cfg)
    Path(cfg["paths"]["metrics_file"]).write_text(
        json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True, "games": len(out["games"])}


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}
