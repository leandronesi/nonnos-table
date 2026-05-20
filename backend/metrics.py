"""Strato 2 (output) — Aggregati per la dashboard.

Legge tutti i file in data/analysis/*.json e produce data/metrics.json.

Output principali:
  - games:                  riga per partita (subset per dashboard)
  - aggregates.kpi:         KPI globali
  - aggregates.by_*:        mese / fase / colore / time_class / opening
  - aggregates.move_heatmap:matrice mossa×fase per blunder
  - aggregates.motifs:      distribuzione motivi tattici
  - aggregates.performance: Elo atteso (performance rating) overall e rolling per cadenza
  - aggregates.rating_trend:per-partita rating ufficiale + performance rolling (per chart)
  - aggregates.goal:        progresso verso 1600 blitz entro 31/12/2026
  - aggregates.daily_picks: 5 blunder consigliati per la review di OGGI
  - top.worst_games:        partite peggiori recenti (per drill-down)
  - top.blunders:           lista blunder con fen_before/best_san/motif (per Blunder Review)
  - insights:               3-7 frasi di coaching deterministiche in italiano
"""

from __future__ import annotations

import json
import logging
import math
import random
import sys
import time as time_mod
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Any

from config_loader import load_config

log = logging.getLogger("metrics")

GOAL_TARGET = 1600
GOAL_TIME_CLASS = "blitz"
GOAL_DEADLINE_ISO = "2026-12-31"

ROLLING_WINDOW = 20  # finestra del performance rating mobile


# ----------------------------- helper -----------------------------------------


def _safe_mean(xs: list[float]) -> float:
    return round(mean(xs), 2) if xs else 0.0


def _month_key(epoch: int | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m")


def _date_key(epoch: int | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")


def _score(result: str | None) -> float | None:
    return {"win": 1.0, "draw": 0.5, "loss": 0.0}.get(result or "")


def _perf_rating(opps: list[int], score_sum: float, n: int) -> int | None:
    """Performance rating con formula log10 di Elo (continua, gestisce gli estremi)."""
    if not opps or n == 0:
        return None
    avg = sum(opps) / n
    p = score_sum / n
    if p >= 0.999:
        return round(avg + 800)
    if p <= 0.001:
        return round(avg - 800)
    return round(avg - 400 * math.log10((1 - p) / p))


def _load_all(cfg: dict[str, Any]) -> list[dict[str, Any]]:
    analysis_dir = Path(cfg["paths"]["analysis_dir"])
    out: list[dict[str, Any]] = []
    for f in analysis_dir.glob("*.json"):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception as e:  # noqa: BLE001
            log.warning("skip %s: %s", f, e)
    out.sort(key=lambda p: (p.get("index") or {}).get("end_time_epoch") or 0)
    return out


# ----------------------------- riga partita -----------------------------------


def _build_games(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for p in payloads:
        idx = p.get("index") or {}
        summ = (p.get("analysis") or {}).get("summary") or {}
        rows.append(
            {
                "id": p["game_id"],
                "url": idx.get("url"),
                "end_time_iso": idx.get("end_time_iso"),
                "end_time_epoch": idx.get("end_time_epoch"),
                "month": _month_key(idx.get("end_time_epoch")),
                "date": _date_key(idx.get("end_time_epoch")),
                "time_class": idx.get("time_class"),
                "rated": idx.get("rated"),
                "my_color": idx.get("my_color"),
                "my_rating": idx.get("my_rating"),
                "opp_rating": idx.get("opp_rating"),
                "result": idx.get("result"),
                "eco": idx.get("eco"),
                "opening": idx.get("opening"),
                "num_moves": idx.get("num_moves"),
                "acpl": summ.get("acpl"),
                "counts": summ.get("counts") or {"inaccuracy": 0, "mistake": 0, "blunder": 0},
                "by_phase": summ.get("by_phase") or {},
                "blunder_move_numbers": summ.get("blunder_move_numbers") or [],
                "first_blunder_move": summ.get("first_blunder_move"),
                "worst_move_loss": summ.get("worst_move_loss", 0),
                "motif_counts": summ.get("motif_counts") or {},
            }
        )
    return rows


# ----------------------------- aggregati base ---------------------------------


def _agg_by_month(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "acpls": [], "blunders": 0, "mistakes": 0, "inaccuracies": 0,
            "games": 0, "wins": 0, "losses": 0, "draws": 0,
            "opps": [], "scores": [],
        }
    )
    for g in games:
        m = g.get("month")
        if not m:
            continue
        b = bucket[m]
        if g.get("acpl") is not None:
            b["acpls"].append(g["acpl"])
        c = g["counts"]
        b["blunders"] += c.get("blunder", 0)
        b["mistakes"] += c.get("mistake", 0)
        b["inaccuracies"] += c.get("inaccuracy", 0)
        b["games"] += 1
        r = g.get("result")
        if r == "win":
            b["wins"] += 1
        elif r == "loss":
            b["losses"] += 1
        elif r == "draw":
            b["draws"] += 1
        if g.get("opp_rating") is not None:
            b["opps"].append(g["opp_rating"])
            s = _score(r)
            if s is not None:
                b["scores"].append(s)

    out = []
    for month, b in sorted(bucket.items()):
        out.append(
            {
                "month": month,
                "acpl": _safe_mean(b["acpls"]),
                "blunders": b["blunders"],
                "mistakes": b["mistakes"],
                "inaccuracies": b["inaccuracies"],
                "games": b["games"],
                "win_rate": round(b["wins"] / b["games"], 3) if b["games"] else 0.0,
                "wins": b["wins"], "losses": b["losses"], "draws": b["draws"],
                "performance": _perf_rating(b["opps"], sum(b["scores"]), len(b["scores"])),
            }
        )
    return out


def _agg_by_phase(games: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {
        "opening": {"inaccuracy": 0, "mistake": 0, "blunder": 0, "moves": 0, "cp_loss_sum": 0},
        "middlegame": {"inaccuracy": 0, "mistake": 0, "blunder": 0, "moves": 0, "cp_loss_sum": 0},
        "endgame": {"inaccuracy": 0, "mistake": 0, "blunder": 0, "moves": 0, "cp_loss_sum": 0},
    }
    for g in games:
        for ph, vals in (g.get("by_phase") or {}).items():
            if ph not in out:
                continue
            for k in ("inaccuracy", "mistake", "blunder", "moves", "cp_loss_sum"):
                out[ph][k] += vals.get(k, 0)
    for ph, vals in out.items():
        vals["acpl"] = round(vals["cp_loss_sum"] / vals["moves"], 2) if vals["moves"] else 0.0
    return out


def _agg_by_color(games: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for color in ("white", "black"):
        subset = [g for g in games if g.get("my_color") == color]
        n = len(subset)
        wins = sum(1 for g in subset if g.get("result") == "win")
        losses = sum(1 for g in subset if g.get("result") == "loss")
        draws = sum(1 for g in subset if g.get("result") == "draw")
        acpls = [g["acpl"] for g in subset if g.get("acpl") is not None]
        opps = [g["opp_rating"] for g in subset if g.get("opp_rating") is not None]
        scores = [s for g in subset if (s := _score(g.get("result"))) is not None]
        out[color] = {
            "games": n,
            "wins": wins, "losses": losses, "draws": draws,
            "win_rate": round(wins / n, 3) if n else 0.0,
            "acpl": _safe_mean(acpls),
            "blunders": sum(g["counts"].get("blunder", 0) for g in subset),
            "mistakes": sum(g["counts"].get("mistake", 0) for g in subset),
            "inaccuracies": sum(g["counts"].get("inaccuracy", 0) for g in subset),
            "performance": _perf_rating(opps, sum(scores), len(scores)),
        }
    return out


def _agg_by_time_class(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"acpls": [], "b": 0, "n": 0, "w": 0, "opps": [], "scores": []}
    )
    for g in games:
        tc = g.get("time_class") or "unknown"
        b = bucket[tc]
        if g.get("acpl") is not None:
            b["acpls"].append(g["acpl"])
        b["b"] += g["counts"].get("blunder", 0)
        b["n"] += 1
        if g.get("result") == "win":
            b["w"] += 1
        if g.get("opp_rating") is not None:
            b["opps"].append(g["opp_rating"])
            s = _score(g.get("result"))
            if s is not None:
                b["scores"].append(s)

    out = []
    for tc, b in bucket.items():
        out.append(
            {
                "time_class": tc,
                "games": b["n"],
                "acpl": _safe_mean(b["acpls"]),
                "blunders": b["b"],
                "win_rate": round(b["w"] / b["n"], 3) if b["n"] else 0.0,
                "performance": _perf_rating(b["opps"], sum(b["scores"]), len(b["scores"])),
            }
        )
    out.sort(key=lambda r: -r["games"])
    return out


def _agg_by_opening(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bucket: dict[tuple[str, str, str], dict[str, Any]] = defaultdict(
        lambda: {"acpls": [], "n": 0, "w": 0, "b": 0, "eco": "", "opening": "", "color": "?",
                 "opps": [], "scores": []}
    )
    for g in games:
        if not g.get("eco") and not g.get("opening"):
            continue
        key = (g.get("eco") or "—", g.get("opening") or "Unknown", g.get("my_color") or "?")
        b = bucket[key]
        b["eco"] = key[0]
        b["opening"] = key[1]
        b["color"] = key[2]
        if g.get("acpl") is not None:
            b["acpls"].append(g["acpl"])
        b["n"] += 1
        if g.get("result") == "win":
            b["w"] += 1
        b["b"] += g["counts"].get("blunder", 0)
        if g.get("opp_rating") is not None:
            b["opps"].append(g["opp_rating"])
            s = _score(g.get("result"))
            if s is not None:
                b["scores"].append(s)

    out = []
    for b in bucket.values():
        out.append(
            {
                "eco": b["eco"], "opening": b["opening"], "my_color": b["color"],
                "games": b["n"], "acpl": _safe_mean(b["acpls"]),
                "win_rate": round(b["w"] / b["n"], 3) if b["n"] else 0.0,
                "blunders": b["b"],
                "performance": _perf_rating(b["opps"], sum(b["scores"]), len(b["scores"])),
            }
        )
    out.sort(key=lambda r: -r["games"])
    return out


def _move_heatmap(games: list[dict[str, Any]]) -> dict[str, list[dict[str, int]]]:
    bins = [(1, 10), (11, 20), (21, 30), (31, 40), (41, 60), (61, 200)]

    def bin_label(mn: int) -> str:
        for a, b in bins:
            if a <= mn <= b:
                return f"{a}-{b}"
        return "61-200"

    out: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for g in games:
        mn_list = g.get("blunder_move_numbers") or []
        phases = g.get("by_phase") or {}
        if not mn_list:
            continue
        for mn in mn_list:
            if mn <= 12:
                ph = "opening"
            elif phases.get("endgame", {}).get("blunder", 0) > 0 and mn >= 30:
                ph = "endgame"
            else:
                ph = "middlegame"
            out[bin_label(mn)][ph] += 1

    bin_order = [f"{a}-{b}" for a, b in bins]
    return {
        "bins": bin_order,
        "data": [
            {
                "bin": b,
                "opening": out.get(b, {}).get("opening", 0),
                "middlegame": out.get(b, {}).get("middlegame", 0),
                "endgame": out.get(b, {}).get("endgame", 0),
            }
            for b in bin_order
        ],
    }


# ----------------------------- Elo atteso / performance -----------------------


def _rating_trend(games: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Per ogni cadenza, lista cronologica con rating ufficiale e performance rolling.

    Il "performance rolling" è il performance rating calcolato sulla finestra
    delle ultime ROLLING_WINDOW partite (incluse quella corrente).
    """
    out: dict[str, list[dict[str, Any]]] = defaultdict(list)
    by_tc: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g in games:
        if g.get("time_class") and g.get("opp_rating") is not None:
            by_tc[g["time_class"]].append(g)

    for tc, subset in by_tc.items():
        for i, g in enumerate(subset):
            window = subset[max(0, i - ROLLING_WINDOW + 1) : i + 1]
            opps = [w["opp_rating"] for w in window if w.get("opp_rating") is not None]
            scores = [_score(w.get("result")) for w in window]
            scores = [s for s in scores if s is not None]
            perf = _perf_rating(opps, sum(scores), len(scores)) if scores else None
            out[tc].append(
                {
                    "epoch": g["end_time_epoch"],
                    "date": g["date"],
                    "rating": g["my_rating"],
                    "performance_rolling": perf,
                    "result": g["result"],
                    "opp_rating": g["opp_rating"],
                    "game_id": g["id"],
                }
            )
    return dict(out)


def _performance(games: list[dict[str, Any]]) -> dict[str, Any]:
    """Performance rating overall e per cadenza, su ultime N partite + lifetime."""
    out: dict[str, Any] = {"overall": {}, "by_time_class": {}}
    opps = [g["opp_rating"] for g in games if g.get("opp_rating") is not None]
    scores = [s for g in games if (s := _score(g.get("result"))) is not None]
    out["overall"]["lifetime"] = _perf_rating(opps, sum(scores), len(scores))
    last30 = games[-30:]
    last30_opps = [g["opp_rating"] for g in last30 if g.get("opp_rating") is not None]
    last30_scores = [s for g in last30 if (s := _score(g.get("result"))) is not None]
    out["overall"]["last_30"] = _perf_rating(last30_opps, sum(last30_scores), len(last30_scores))

    by_tc = defaultdict(list)
    for g in games:
        if g.get("time_class"):
            by_tc[g["time_class"]].append(g)
    for tc, subset in by_tc.items():
        opps = [g["opp_rating"] for g in subset if g.get("opp_rating") is not None]
        scores = [s for g in subset if (s := _score(g.get("result"))) is not None]
        last = subset[-20:]
        lopps = [g["opp_rating"] for g in last if g.get("opp_rating") is not None]
        lscores = [s for g in last if (s := _score(g.get("result"))) is not None]
        current_rating = subset[-1]["my_rating"] if subset else None
        out["by_time_class"][tc] = {
            "lifetime": _perf_rating(opps, sum(scores), len(scores)),
            "last_20": _perf_rating(lopps, sum(lscores), len(lscores)),
            "current_rating": current_rating,
            "games": len(subset),
        }
    return out


# ----------------------------- goal tracker -----------------------------------


def _goal(games: list[dict[str, Any]], performance: dict[str, Any]) -> dict[str, Any]:
    """Stato del progresso verso GOAL_TARGET in GOAL_TIME_CLASS entro GOAL_DEADLINE_ISO."""
    blitz_games = [g for g in games if g.get("time_class") == GOAL_TIME_CLASS]
    if not blitz_games:
        return {
            "target": GOAL_TARGET,
            "time_class": GOAL_TIME_CLASS,
            "deadline": GOAL_DEADLINE_ISO,
            "no_data": True,
        }

    current = blitz_games[-1].get("my_rating")
    start = blitz_games[0].get("my_rating")
    first_epoch = blitz_games[0].get("end_time_epoch") or 0
    last_epoch = blitz_games[-1].get("end_time_epoch") or 0

    deadline_dt = datetime.fromisoformat(GOAL_DEADLINE_ISO).replace(tzinfo=timezone.utc)
    now_dt = datetime.fromtimestamp(last_epoch, tz=timezone.utc) if last_epoch else datetime.now(tz=timezone.utc)
    days_left = max(0, (deadline_dt - now_dt).days)
    days_elapsed = max(1, (datetime.fromtimestamp(last_epoch, tz=timezone.utc) - datetime.fromtimestamp(first_epoch, tz=timezone.utc)).days) if first_epoch and last_epoch else 1

    points_gained = (current or 0) - (start or 0)
    points_needed = GOAL_TARGET - (current or 0)
    points_per_day_so_far = round(points_gained / days_elapsed, 2) if days_elapsed > 0 else None
    points_per_day_needed = round(points_needed / days_left, 2) if days_left > 0 else None

    # Proiezione: rating attuale + (points_per_day_so_far × days_left)
    projection = round((current or 0) + (points_per_day_so_far or 0) * days_left) if points_per_day_so_far is not None else None

    perf_last_20 = performance.get("by_time_class", {}).get(GOAL_TIME_CLASS, {}).get("last_20")

    on_track = projection is not None and projection >= GOAL_TARGET
    return {
        "target": GOAL_TARGET,
        "time_class": GOAL_TIME_CLASS,
        "deadline": GOAL_DEADLINE_ISO,
        "current_rating": current,
        "start_rating": start,
        "points_gained_since_start": points_gained,
        "points_needed": points_needed,
        "days_left": days_left,
        "days_since_start": days_elapsed,
        "rate_per_day_so_far": points_per_day_so_far,
        "rate_per_day_needed": points_per_day_needed,
        "projection_at_deadline": projection,
        "on_track": on_track,
        "performance_last_20": perf_last_20,
        "performance_vs_rating_gap": (perf_last_20 - current) if (perf_last_20 is not None and current is not None) else None,
    }


# ----------------------------- motifs -----------------------------------------


MOTIF_LABELS_IT = {
    "allowed_mate": "Matto subìto",
    "material_loss": "Pezzo lasciato",
    "winning_to_lost": "Da vincente a perso",
    "winning_advantage_thrown": "Vantaggio buttato",
    "positional_blunder": "Errore posizionale",
}


def _motifs(games: list[dict[str, Any]]) -> list[dict[str, Any]]:
    total: dict[str, int] = defaultdict(int)
    for g in games:
        for k, v in (g.get("motif_counts") or {}).items():
            total[k] += v
    out = [
        {"motif": k, "label_it": MOTIF_LABELS_IT.get(k, k), "count": v}
        for k, v in total.items()
    ]
    out.sort(key=lambda r: -r["count"])
    return out


# ----------------------------- top: blunders + worst games --------------------


def _top_blunders(payloads: list[dict[str, Any]], k: int = 50) -> list[dict[str, Any]]:
    """Lista top-k blunder ordinati per cp_loss (più alto = peggio). Conserva tutto
    il necessario per la "Blunder Review" lato UI."""
    rows: list[dict[str, Any]] = []
    for p in payloads:
        idx = p.get("index") or {}
        for m in (p.get("analysis") or {}).get("moves") or []:
            if m.get("category") != "blunder":
                continue
            rows.append(
                {
                    "game_id": p["game_id"],
                    "url": idx.get("url"),
                    "date": _date_key(idx.get("end_time_epoch")),
                    "end_time_epoch": idx.get("end_time_epoch"),
                    "time_class": idx.get("time_class"),
                    "my_color": idx.get("my_color"),
                    "my_rating": idx.get("my_rating"),
                    "opp_rating": idx.get("opp_rating"),
                    "result": idx.get("result"),
                    "eco": idx.get("eco"),
                    "opening": idx.get("opening"),
                    "ply": m.get("ply"),
                    "move_number": m.get("move_number"),
                    "san": m.get("san"),
                    "phase": m.get("phase"),
                    "cp_before": m.get("cp_before"),
                    "cp_after": m.get("cp_after"),
                    "cp_loss": m.get("cp_loss"),
                    "best_san": m.get("best_san"),
                    "pv_san": m.get("pv_san") or [],
                    "fen_before": m.get("fen_before"),
                    "motif": m.get("motif"),
                    "motif_label": MOTIF_LABELS_IT.get(m.get("motif") or "", ""),
                }
            )
    rows.sort(key=lambda r: (-(r["cp_loss"] or 0), -(r["end_time_epoch"] or 0)))
    return rows[:k]


def _worst_games(games: list[dict[str, Any]], k: int = 25) -> list[dict[str, Any]]:
    """Le partite "peggiori" per score combinato (acpl + blunders × 50)."""
    def score(g: dict[str, Any]) -> float:
        return (g.get("acpl") or 0) + 50 * g["counts"].get("blunder", 0)

    rows = sorted(games, key=lambda g: -score(g))
    return [
        {
            "id": g["id"], "url": g["url"], "date": g["date"], "end_time_epoch": g["end_time_epoch"],
            "time_class": g["time_class"], "my_color": g["my_color"],
            "result": g["result"], "opp_rating": g["opp_rating"], "my_rating": g["my_rating"],
            "opening": g["opening"], "eco": g["eco"], "num_moves": g["num_moves"],
            "acpl": g["acpl"], "counts": g["counts"], "worst_move_loss": g["worst_move_loss"],
            "ugliness": round(score(g), 1),
        }
        for g in rows[:k]
    ]


def _daily_picks(blunders: list[dict[str, Any]], n: int = 5) -> list[dict[str, Any]]:
    """5 blunder casuali ma deterministici per OGGI (basato sulla data UTC) presi
    dagli ultimi 60 giorni di partite. Cambia ogni giorno."""
    if not blunders:
        return []
    today = datetime.now(tz=timezone.utc).date()
    cutoff = today.toordinal() - 60
    recent = [b for b in blunders if b.get("end_time_epoch") and
              datetime.fromtimestamp(b["end_time_epoch"], tz=timezone.utc).date().toordinal() >= cutoff]
    pool = recent or blunders
    rng = random.Random(today.toordinal())
    rng.shuffle(pool)
    return pool[:n]


# ----------------------------- KPI --------------------------------------------


def _kpi(games: list[dict[str, Any]]) -> dict[str, Any]:
    last_30 = games[-30:] if len(games) >= 30 else games
    prev_30 = games[-60:-30] if len(games) >= 60 else []
    acpl_recent = _safe_mean([g["acpl"] for g in last_30 if g.get("acpl") is not None])
    acpl_prev = _safe_mean([g["acpl"] for g in prev_30 if g.get("acpl") is not None])
    delta_acpl = round(acpl_recent - acpl_prev, 2) if prev_30 else None

    rating_by_tc: dict[str, int] = {}
    for g in reversed(games):
        tc = g.get("time_class")
        if tc and tc not in rating_by_tc and g.get("my_rating") is not None:
            rating_by_tc[tc] = g["my_rating"]

    total_moves = 0
    total_blunders = 0
    for g in games:
        c = g.get("counts") or {}
        total_blunders += c.get("blunder", 0)
        for ph, vals in (g.get("by_phase") or {}).items():
            total_moves += vals.get("moves", 0)

    blunder_rate = round(total_blunders / total_moves, 4) if total_moves else 0.0

    return {
        "games_analyzed": len(games),
        "acpl_recent": acpl_recent,
        "acpl_previous": acpl_prev,
        "acpl_delta": delta_acpl,
        "rating_by_time_class": rating_by_tc,
        "blunder_rate": blunder_rate,
        "total_blunders": total_blunders,
    }


# ----------------------------- insight ----------------------------------------


def _insights(
    games: list[dict[str, Any]],
    by_phase: dict[str, Any],
    by_color: dict[str, Any],
    by_time_class: list[dict[str, Any]],
    by_opening: list[dict[str, Any]],
    kpi: dict[str, Any],
    goal: dict[str, Any],
    performance: dict[str, Any],
    motifs: list[dict[str, Any]],
) -> list[str]:
    out: list[str] = []

    # 1. Goal status — la cosa più importante per uso quotidiano
    if not goal.get("no_data"):
        if goal["on_track"]:
            out.append(
                f"🎯 Sei in linea col goal 1600 blitz: al ritmo attuale arrivi a {goal['projection_at_deadline']} entro il 31/12. "
                f"Tieni questa traiettoria."
            )
        elif goal["points_needed"] > 0:
            out.append(
                f"🎯 Per arrivare a 1600 blitz entro il 31/12 ti servono {goal['points_needed']} punti in {goal['days_left']} giorni "
                f"({goal['rate_per_day_needed']}/giorno). Finora stai facendo {goal['rate_per_day_so_far']}/giorno — devi accelerare."
            )
        # Performance vs rating gap
        gap = goal.get("performance_vs_rating_gap")
        if gap is not None and gap >= 30:
            out.append(
                f"📈 La tua performance delle ultime 20 partite è {goal['performance_last_20']}, "
                f"cioè +{gap} sul rating ufficiale: stai già giocando come un giocatore più forte, il rating ti sta inseguendo."
            )
        elif gap is not None and gap <= -30:
            out.append(
                f"⚠️ La tua performance ultime 20 è {goal['performance_last_20']}, {gap} rispetto al rating: "
                f"stai sotto-rendendo, c'è correzione in arrivo se non cambi qualcosa."
            )

    # 2. Trend ACPL
    if kpi["acpl_delta"] is not None:
        if kpi["acpl_delta"] < -3:
            out.append(f"✅ ACPL sceso da {kpi['acpl_previous']} a {kpi['acpl_recent']}: precisione in aumento.")
        elif kpi["acpl_delta"] > 3:
            out.append(f"❌ ACPL salito da {kpi['acpl_previous']} a {kpi['acpl_recent']}: qualcosa si è inceppato.")

    # 3. Fase con più blunder
    blunder_by_phase = {p: by_phase[p]["blunder"] for p in by_phase}
    total_b = sum(blunder_by_phase.values())
    if total_b > 0:
        top_phase, top_count = max(blunder_by_phase.items(), key=lambda kv: kv[1])
        pct = round(100 * top_count / total_b)
        phase_it = {"opening": "in apertura", "middlegame": "nel mediogioco", "endgame": "nel finale"}[top_phase]
        if pct >= 45:
            out.append(f"🔥 Il {pct}% dei blunder arriva {phase_it}: lì sta la leva principale per migliorare.")

    # 4. Motif dominante
    if motifs:
        top_motif = motifs[0]
        if top_motif["count"] >= 10:
            out.append(
                f"🧨 Motivo di errore più frequente: «{top_motif['label_it']}» ({top_motif['count']} casi). "
                "Allena specificamente questo pattern."
            )

    # 5. Bianco vs Nero
    w = by_color.get("white", {})
    b = by_color.get("black", {})
    if w.get("games") and b.get("games"):
        if w.get("win_rate", 0) - b.get("win_rate", 0) > 0.08:
            out.append(
                f"♔ vs ♚: meglio col bianco ({int(100*w['win_rate'])}%) che col nero ({int(100*b['win_rate'])}%): "
                "lavora sul repertorio col nero."
            )
        elif b.get("win_rate", 0) - w.get("win_rate", 0) > 0.08:
            out.append(
                f"♚ vs ♔: vai meglio col nero ({int(100*b['win_rate'])}%) che col bianco ({int(100*w['win_rate'])}%): "
                "non stai sfruttando la prima mossa."
            )

    # 6. Apertura peggiore
    bad_op = [o for o in by_opening if o["games"] >= 3]
    if bad_op:
        bad_op.sort(key=lambda o: (o["win_rate"], -o["acpl"]))
        worst = bad_op[0]
        if worst["win_rate"] < 0.4:
            out.append(
                f"📚 In {worst['opening']} ({worst['eco']}, col {worst['my_color']}) win rate "
                f"{int(100*worst['win_rate'])}% su {worst['games']}: studia o evita."
            )

    return out[:7]


# ----------------------------- build ------------------------------------------


def build(cfg: dict[str, Any]) -> dict[str, Any]:
    payloads = _load_all(cfg)
    games = _build_games(payloads)
    by_month = _agg_by_month(games)
    by_phase = _agg_by_phase(games)
    by_color = _agg_by_color(games)
    by_time_class = _agg_by_time_class(games)
    by_opening = _agg_by_opening(games)
    move_heatmap = _move_heatmap(games)
    performance = _performance(games)
    rating_trend = _rating_trend(games)
    motifs = _motifs(games)
    kpi = _kpi(games)
    goal = _goal(games, performance)
    top_blunders = _top_blunders(payloads, k=80)
    worst_games = _worst_games(games, k=25)
    daily_picks = _daily_picks(top_blunders, n=5)
    insights = _insights(games, by_phase, by_color, by_time_class, by_opening, kpi, goal, performance, motifs)

    return {
        "generated_at_epoch": time_mod.time(),
        "username": cfg["chess_com"]["username"],
        "games": games,
        "aggregates": {
            "kpi": kpi,
            "goal": goal,
            "performance": performance,
            "rating_trend": rating_trend,
            "motifs": motifs,
            "by_month": by_month,
            "by_phase": by_phase,
            "by_color": by_color,
            "by_time_class": by_time_class,
            "by_opening": by_opening,
            "move_heatmap": move_heatmap,
        },
        "top": {
            "blunders": top_blunders,
            "worst_games": worst_games,
            "daily_picks": daily_picks,
        },
        "insights": insights,
    }


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s | %(message)s",
        stream=sys.stdout,
    )
    cfg = load_config()
    out = build(cfg)

    out_path = Path(cfg["paths"]["metrics_file"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info(
        "Scritto %s (%d partite, %d insight, %d blunder top, %d worst games)",
        out_path,
        len(out["games"]),
        len(out["insights"]),
        len(out["top"]["blunders"]),
        len(out["top"]["worst_games"]),
    )

    fe_public = Path(__file__).resolve().parent.parent / "frontend" / "public"
    if fe_public.exists():
        (fe_public / "metrics.json").write_text(
            json.dumps(out, ensure_ascii=False), encoding="utf-8"
        )
        log.info("Copiato anche in frontend/public/metrics.json")


if __name__ == "__main__":
    main()
