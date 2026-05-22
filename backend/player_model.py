"""SPRINT 4 v2 — Player Model.

Artefatto centrale della v2. Legge positions.db e produce data/player_model.json
con TUTTO ciò che la dashboard e l'agente LLM useranno:

  - identity         : username, goal, deadline, rating per cadenza
  - kpi              : ACPL, blunder rate, performance rolling (recente vs storico)
  - decisions        : conversion_rate (sai chiudere?), save_rate (sai salvarti?),
                       blown_winning_pct, agreement_with_maia_mine, agreement_with_target
  - critical         : analisi delle 3937 posizioni critiche (numeri puliti, non rumore)
  - avoidable        : errori evitabili alla mia forza (= drillabili)
  - time_management  : clock vs accuracy, mosse istantanee, zeitnot
  - tilt             : accuracy dopo aver subito un colpo
  - phase            : performance per fase con confidence
  - color            : performance per colore con confidence
  - openings         : repertorio peggiore con confidence
  - blind_spots      : top motivi tattici (su posizioni CRITICHE)
  - turning_points   : top 10 turning points recenti per drill-down
  - diagnoses        : 3-5 debolezze prioritizzate (impatto × frequenza × allenabilità)
  - drills           : esercizi pescati dai blunder avoidable
  - weekly_focus     : la cosa-numero-uno da lavorare questa settimana
  - confidence_notes : "non abbastanza dati per X"

Confidence: una claim su categoria con N<10 viene flaggata low confidence.
"""

from __future__ import annotations

import json
import logging
import math
import sys
import time as time_mod
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config_loader import load_config
from positions_db import connect

log = logging.getLogger("player_model")

GOAL_TARGET = 1600
GOAL_TIME_CLASS = "blitz"
GOAL_DEADLINE_ISO = "2026-12-31"
TARGET_RATING_FOR_MAIA = 1600  # per le diagnosi: errori evitabili a Maia-1600

LOW_CONFIDENCE_N = 10
ROLLING_PERF_WINDOW = 20


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------


def _q(conn, sql: str, *params) -> list[dict[str, Any]]:
    return [dict(r) for r in conn.execute(sql, params)]


def _qs(conn, sql: str, *params):
    row = conn.execute(sql, params).fetchone()
    return dict(row) if row else None


def _score(result: str | None) -> float | None:
    return {"win": 1.0, "draw": 0.5, "loss": 0.0}.get(result or "")


def _ratio(num: int, den: int) -> float | None:
    if not den:
        return None
    return round(num / den, 4)


def _confidence(n: int) -> str:
    if n < LOW_CONFIDENCE_N:
        return "low"
    if n < 30:
        return "medium"
    return "high"


def _perf_rating(opps: list[int], score_sum: float, n: int) -> int | None:
    if not opps or n == 0:
        return None
    avg = sum(opps) / n
    p = score_sum / n
    if p >= 0.999:
        return round(avg + 800)
    if p <= 0.001:
        return round(avg - 800)
    return round(avg - 400 * math.log10((1 - p) / p))


def _date_str(epoch: int | None) -> str | None:
    if not epoch:
        return None
    return datetime.fromtimestamp(epoch, tz=timezone.utc).strftime("%Y-%m-%d")


# ----------------------------------------------------------------------------
# Sezioni del modello
# ----------------------------------------------------------------------------


def _identity(conn, username: str) -> dict[str, Any]:
    last = _qs(conn, """
        SELECT g.my_rating, g.time_class, g.end_time_epoch
        FROM games g
        WHERE g.time_class = ? AND g.my_rating IS NOT NULL
        ORDER BY g.end_time_epoch DESC LIMIT 1
    """, GOAL_TIME_CLASS)
    current = last["my_rating"] if last else None

    first = _qs(conn, """
        SELECT g.my_rating, g.end_time_epoch
        FROM games g WHERE g.time_class = ? AND g.my_rating IS NOT NULL
        ORDER BY g.end_time_epoch ASC LIMIT 1
    """, GOAL_TIME_CLASS)
    start = first["my_rating"] if first else None
    start_epoch = first["end_time_epoch"] if first else None
    last_epoch = last["end_time_epoch"] if last else None

    deadline = datetime.fromisoformat(GOAL_DEADLINE_ISO).replace(tzinfo=timezone.utc)
    now_dt = (datetime.fromtimestamp(last_epoch, tz=timezone.utc)
              if last_epoch else datetime.now(tz=timezone.utc))
    days_left = max(0, (deadline - now_dt).days)
    days_elapsed = max(1, (datetime.fromtimestamp(last_epoch, tz=timezone.utc) -
                          datetime.fromtimestamp(start_epoch, tz=timezone.utc)).days) if start_epoch and last_epoch else 1

    points_gained = (current or 0) - (start or 0)
    points_needed = GOAL_TARGET - (current or 0)
    rate_so_far = round(points_gained / days_elapsed, 2) if days_elapsed > 0 else None
    rate_needed = round(points_needed / days_left, 2) if days_left > 0 else None
    projection = round((current or 0) + (rate_so_far or 0) * days_left) if rate_so_far is not None else None

    # rating per cadenza
    rating_by_tc: dict[str, int] = {}
    for r in _q(conn, """
        SELECT time_class, my_rating FROM games
        WHERE my_rating IS NOT NULL
        ORDER BY end_time_epoch DESC
    """):
        if r["time_class"] not in rating_by_tc:
            rating_by_tc[r["time_class"]] = r["my_rating"]

    return {
        "username": username,
        "goal": {
            "target": GOAL_TARGET,
            "time_class": GOAL_TIME_CLASS,
            "deadline": GOAL_DEADLINE_ISO,
            "current_rating": current,
            "start_rating": start,
            "points_gained_since_start": points_gained,
            "points_needed": points_needed,
            "days_left": days_left,
            "days_since_start": days_elapsed,
            "rate_per_day_so_far": rate_so_far,
            "rate_per_day_needed": rate_needed,
            "projection_at_deadline": projection,
            "on_track": projection is not None and projection >= GOAL_TARGET,
        },
        "rating_by_time_class": rating_by_tc,
        "last_game_date": _date_str(last_epoch),
    }


def _kpi(conn) -> dict[str, Any]:
    # KPI sui dati CRITICI (non rumore)
    row = _qs(conn, """
        SELECT
          COUNT(*) AS critical_positions,
          AVG(cp_loss) AS avg_cp_loss,
          SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders,
          SUM(CASE WHEN avoidable_at_my_level=1 THEN 1 ELSE 0 END) AS avoidable,
          SUM(CASE WHEN i_played_maia_mine=1 THEN 1 ELSE 0 END) AS agreed_with_mine,
          SUM(CASE WHEN i_played_maia_target=1 THEN 1 ELSE 0 END) AS agreed_with_target
        FROM positions WHERE is_critical=1
    """)
    games_n = _qs(conn, "SELECT COUNT(*) AS n FROM games")["n"]

    # ACPL ultime 30 partite vs precedenti 30
    last30_ids = [r["game_id"] for r in _q(conn, """
        SELECT game_id FROM games ORDER BY end_time_epoch DESC LIMIT 30
    """)]
    prev30_ids = [r["game_id"] for r in _q(conn, """
        SELECT game_id FROM games ORDER BY end_time_epoch DESC LIMIT 30 OFFSET 30
    """)]
    def acpl_for(ids: list[str]) -> float | None:
        if not ids:
            return None
        placeholders = ",".join("?" * len(ids))
        r = conn.execute(
            f"SELECT AVG(acpl) AS a FROM games WHERE game_id IN ({placeholders})", ids
        ).fetchone()
        return round(r["a"], 2) if r and r["a"] is not None else None

    acpl_recent = acpl_for(last30_ids)
    acpl_prev = acpl_for(prev30_ids)
    return {
        "critical_positions": row["critical_positions"],
        "avg_cp_loss_on_critical": round(row["avg_cp_loss"] or 0, 1),
        "blunders_critical": row["blunders"],
        "avoidable_blunders": row["avoidable"],
        "agreement_maia_mine_pct": _ratio(row["agreed_with_mine"], row["critical_positions"]),
        "agreement_maia_target_pct": _ratio(row["agreed_with_target"], row["critical_positions"]),
        "acpl_recent_30": acpl_recent,
        "acpl_previous_30": acpl_prev,
        "acpl_delta": round((acpl_recent or 0) - (acpl_prev or 0), 2) if acpl_recent and acpl_prev else None,
        "games_analyzed": games_n,
    }


def _decisions(conn) -> dict[str, Any]:
    g = _qs(conn, """
        SELECT
          COUNT(*) AS games,
          SUM(reached_winning) AS reached_winning,
          SUM(converted_winning) AS converted_winning,
          SUM(CASE WHEN reached_winning=1 AND converted_winning=0 THEN 1 ELSE 0 END) AS blew_winning,
          SUM(reached_losing) AS reached_losing,
          SUM(saved_losing) AS saved_losing
        FROM games
    """)
    return {
        "games": g["games"],
        "reached_winning": g["reached_winning"],
        "converted_winning": g["converted_winning"],
        "conversion_rate": _ratio(g["converted_winning"], g["reached_winning"]),
        "blew_winning": g["blew_winning"],
        "blow_rate": _ratio(g["blew_winning"], g["reached_winning"]),
        "reached_losing": g["reached_losing"],
        "saved_losing": g["saved_losing"],
        "save_rate": _ratio(g["saved_losing"], g["reached_losing"]),
        "confidence_conversion": _confidence(g["reached_winning"] or 0),
        "confidence_save": _confidence(g["reached_losing"] or 0),
    }


def _by_phase(conn) -> list[dict[str, Any]]:
    rows = _q(conn, """
        SELECT phase,
          COUNT(*) AS positions,
          AVG(cp_loss) AS avg_loss,
          SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders,
          SUM(avoidable_at_my_level) AS avoidable_blunders
        FROM positions
        WHERE is_critical=1
        GROUP BY phase
    """)
    out = []
    for r in rows:
        out.append({
            "phase": r["phase"],
            "positions": r["positions"],
            "avg_cp_loss": round(r["avg_loss"] or 0, 1),
            "blunders": r["blunders"],
            "avoidable_blunders": r["avoidable_blunders"] or 0,
            "blunder_rate": _ratio(r["blunders"], r["positions"]),
            "confidence": _confidence(r["positions"]),
        })
    out.sort(key=lambda r: -r["blunders"])
    return out


def _by_color(conn) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for color in ("white", "black"):
        g = _qs(conn, """
            SELECT COUNT(*) AS games,
                   SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN result='loss' THEN 1 ELSE 0 END) AS losses,
                   SUM(CASE WHEN result='draw' THEN 1 ELSE 0 END) AS draws,
                   AVG(acpl) AS avg_acpl
            FROM games WHERE my_color = ?
        """, color)
        # performance rating
        gms = _q(conn, "SELECT opp_rating, result FROM games WHERE my_color=? AND opp_rating IS NOT NULL", color)
        opps = [x["opp_rating"] for x in gms]
        scores = [{"win": 1.0, "draw": 0.5, "loss": 0.0}.get(x["result"], 0.5) for x in gms]
        perf = _perf_rating(opps, sum(scores), len(scores))
        out[color] = {
            "games": g["games"],
            "wins": g["wins"] or 0,
            "losses": g["losses"] or 0,
            "draws": g["draws"] or 0,
            "win_rate": _ratio(g["wins"] or 0, g["games"]),
            "avg_acpl": round(g["avg_acpl"] or 0, 1),
            "performance": perf,
            "confidence": _confidence(g["games"]),
        }
    return out


def _openings(conn, min_games: int = 3) -> list[dict[str, Any]]:
    rows = _q(conn, f"""
        SELECT eco, opening, my_color,
               COUNT(*) AS games,
               SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins,
               AVG(acpl) AS avg_acpl
        FROM games
        WHERE eco IS NOT NULL
        GROUP BY eco, opening, my_color
        HAVING games >= {min_games}
        ORDER BY (1.0 * SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) / COUNT(*)) ASC,
                 AVG(acpl) DESC
        LIMIT 20
    """)
    return [
        {
            "eco": r["eco"],
            "opening": r["opening"],
            "my_color": r["my_color"],
            "games": r["games"],
            "win_rate": _ratio(r["wins"], r["games"]),
            "avg_acpl": round(r["avg_acpl"] or 0, 1),
            "confidence": _confidence(r["games"]),
        }
        for r in rows
    ]


def _time_management(conn) -> dict[str, Any]:
    # Buckets di tempo rimasto
    buckets_rows = _q(conn, """
        SELECT
          CASE WHEN clock_seconds < 10 THEN 'under_10s'
               WHEN clock_seconds < 30 THEN '10_30s'
               WHEN clock_seconds < 60 THEN '30_60s'
               WHEN clock_seconds < 120 THEN '60_120s'
               ELSE 'over_120s' END AS bucket,
          COUNT(*) AS positions,
          AVG(cp_loss) AS avg_cp_loss,
          SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders
        FROM positions
        WHERE is_critical = 1 AND clock_seconds IS NOT NULL
        GROUP BY bucket
    """)
    bucket_order = ["under_10s", "10_30s", "30_60s", "60_120s", "over_120s"]
    bucket_label = {
        "under_10s": "< 10s",
        "10_30s": "10-30s",
        "30_60s": "30-60s",
        "60_120s": "60-120s",
        "over_120s": "> 120s",
    }
    buckets_by_key = {r["bucket"]: r for r in buckets_rows}
    clock_vs_accuracy = [
        {
            "bucket": bucket_label[b],
            "key": b,
            "positions": buckets_by_key.get(b, {}).get("positions", 0),
            "avg_cp_loss": round(buckets_by_key.get(b, {}).get("avg_cp_loss") or 0, 1),
            "blunders": buckets_by_key.get(b, {}).get("blunders", 0),
        }
        for b in bucket_order
    ]
    # Buckets di tempo SPESO per mossa (≠ tempo rimasto sull'orologio).
    # Risponde alla domanda: "quanti errori faccio quando muovo troppo veloce?"
    spent_rows = _q(conn, """
        SELECT
          CASE WHEN seconds_spent < 1 THEN 'lt_1s'
               WHEN seconds_spent < 3 THEN '1_3s'
               WHEN seconds_spent < 10 THEN '3_10s'
               WHEN seconds_spent < 30 THEN '10_30s'
               ELSE 'gt_30s' END AS bucket,
          COUNT(*) AS positions,
          AVG(cp_loss) AS avg_cp_loss,
          SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders,
          SUM(CASE WHEN category IN ('blunder','mistake') THEN 1 ELSE 0 END) AS errors
        FROM positions
        WHERE is_critical = 1 AND seconds_spent IS NOT NULL
        GROUP BY bucket
    """)
    spent_order = ["lt_1s", "1_3s", "3_10s", "10_30s", "gt_30s"]
    spent_label = {
        "lt_1s": "< 1s",
        "1_3s": "1-3s",
        "3_10s": "3-10s",
        "10_30s": "10-30s",
        "gt_30s": "> 30s",
    }
    by_spent = {r["bucket"]: r for r in spent_rows}
    spent_vs_accuracy = [
        {
            "bucket": spent_label[b],
            "key": b,
            "positions": by_spent.get(b, {}).get("positions", 0),
            "avg_cp_loss": round(by_spent.get(b, {}).get("avg_cp_loss") or 0, 1),
            "blunders": by_spent.get(b, {}).get("blunders", 0),
            "errors": by_spent.get(b, {}).get("errors", 0),
            "error_rate": round(
                (by_spent.get(b, {}).get("errors", 0) / max(1, by_spent.get(b, {}).get("positions", 1))),
                3,
            ),
        }
        for b in spent_order
    ]

    # Mosse istantanee in posizione critica
    instant = _qs(conn, """
        SELECT COUNT(*) AS n,
               AVG(cp_loss) AS avg_loss,
               SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders
        FROM positions WHERE is_critical=1 AND instant_move=1
    """)
    zeitnot = _qs(conn, """
        SELECT COUNT(*) AS n,
               AVG(cp_loss) AS avg_loss,
               SUM(CASE WHEN category='blunder' THEN 1 ELSE 0 END) AS blunders
        FROM positions WHERE is_critical=1 AND zeitnot=1
    """)
    return {
        "clock_vs_accuracy": clock_vs_accuracy,
        "spent_vs_accuracy": spent_vs_accuracy,
        "instant_moves_in_critical": {
            "n": instant["n"], "avg_cp_loss": round(instant["avg_loss"] or 0, 1), "blunders": instant["blunders"],
        },
        "zeitnot": {
            "n": zeitnot["n"], "avg_cp_loss": round(zeitnot["avg_loss"] or 0, 1), "blunders": zeitnot["blunders"],
        },
    }


def _rating_curve(conn) -> dict[str, list[dict[str, Any]]]:
    """Per ogni cadenza, lista cronologica con rating ufficiale + perf rolling 5 + perf rolling 20.

    Performance rating con formula log10 di Elo sulla finestra mobile.
    Rispondi alla domanda 'sto migliorando?' confrontando rolling 5 (volatile)
    e rolling 20 (trend) col rating ufficiale (laggy).
    """
    out: dict[str, list[dict[str, Any]]] = {}
    games_by_tc = _q(
        conn,
        """
        SELECT time_class, game_id, end_time_epoch, date, my_rating, opp_rating, result
        FROM games
        WHERE my_rating IS NOT NULL AND opp_rating IS NOT NULL
        ORDER BY time_class, end_time_epoch
        """,
    )
    # raggruppo per time_class
    by_tc: dict[str, list[dict[str, Any]]] = {}
    for g in games_by_tc:
        by_tc.setdefault(g["time_class"], []).append(g)

    for tc, gs in by_tc.items():
        series: list[dict[str, Any]] = []
        for i, g in enumerate(gs):
            def window_perf(window: list[dict[str, Any]]) -> int | None:
                opps = [w["opp_rating"] for w in window]
                scores_list = [_score(w["result"]) for w in window]
                scores_list = [s for s in scores_list if s is not None]
                if not scores_list:
                    return None
                return _perf_rating(opps, sum(scores_list), len(scores_list))

            win5 = gs[max(0, i - 4) : i + 1]
            win20 = gs[max(0, i - 19) : i + 1]
            series.append(
                {
                    "epoch": g["end_time_epoch"],
                    "date": g["date"],
                    "rating": g["my_rating"],
                    "perf_5": window_perf(win5),
                    "perf_20": window_perf(win20),
                    "opp_rating": g["opp_rating"],
                    "result": g["result"],
                    "game_id": g["game_id"],
                }
            )
        out[tc] = series
    return out


def _tilt(conn) -> dict[str, Any]:
    """Tilt: ACPL nelle 3 mosse subito DOPO un mio blunder, vs ACPL in posizioni non-post-blunder."""
    # Tag positioni "post-blunder": stesso game_id, ply tra (blunder_ply + 2) e (blunder_ply + 6)
    # (le 3 mie mosse successive sono ply+2, +4, +6).
    post_blunder = _qs(conn, """
        WITH bl AS (
          SELECT game_id, ply AS bly FROM positions
          WHERE is_critical=1 AND category='blunder'
        )
        SELECT AVG(p.cp_loss) AS avg_loss, COUNT(*) AS n
        FROM positions p
        JOIN bl ON p.game_id = bl.game_id AND p.ply > bl.bly AND p.ply <= bl.bly + 6
        WHERE p.is_critical=1
    """)
    rest = _qs(conn, """
        WITH bl AS (
          SELECT game_id, ply AS bly FROM positions
          WHERE is_critical=1 AND category='blunder'
        )
        SELECT AVG(p.cp_loss) AS avg_loss, COUNT(*) AS n
        FROM positions p
        WHERE p.is_critical=1
          AND NOT EXISTS (
            SELECT 1 FROM bl WHERE bl.game_id = p.game_id AND p.ply > bl.bly AND p.ply <= bl.bly + 6
          )
    """)
    return {
        "after_blunder_avg_cp_loss": round(post_blunder["avg_loss"] or 0, 1),
        "after_blunder_n": post_blunder["n"],
        "baseline_avg_cp_loss": round(rest["avg_loss"] or 0, 1),
        "baseline_n": rest["n"],
        "tilt_factor": round((post_blunder["avg_loss"] or 0) / (rest["avg_loss"] or 1), 2),
    }


def _blind_spots(conn) -> list[dict[str, Any]]:
    """Top motivi tattici sui blunder in posizioni CRITICHE."""
    rows = _q(conn, """
        SELECT motif, motif_label_it, COUNT(*) AS n,
               SUM(avoidable_at_my_level) AS avoidable,
               AVG(cp_loss) AS avg_loss
        FROM positions
        WHERE is_critical=1 AND motif IS NOT NULL AND category='blunder'
        GROUP BY motif
        ORDER BY n DESC
    """)
    return [
        {
            "motif": r["motif"],
            "label_it": r["motif_label_it"],
            "n": r["n"],
            "avoidable_count": r["avoidable"] or 0,
            "avg_cp_loss": round(r["avg_loss"] or 0, 1),
            "confidence": _confidence(r["n"]),
        }
        for r in rows
    ]


_TACTICAL_PATTERNS = (
    ("motif_hanging_piece",     "Pezzo appeso"),
    ("motif_fork",              "Forchetta"),
    ("motif_removed_defender",  "Rimozione difensore"),
    ("motif_discovered_attack", "Attacco scoperto"),
    ("motif_back_rank",         "Ottava traversa"),
)


def _tactical_breakdown(conn) -> list[dict[str, Any]]:
    """Distribuzione dei pattern tattici tra i miei mistake/blunder critici.

    Per ogni pattern dico: quante volte mi e` capitato, su quanti totali, con
    che drill_value medio (cioe` quanto "money" e` il pattern per me). Output
    ordinato per frequenza decrescente — il top dovrebbe alimentare la
    diagnosi "fai troppe forchette" / "ti perdi i pezzi appesi" / ecc.
    """
    cols = ", ".join(f"SUM({k}) AS {k}" for k, _ in _TACTICAL_PATTERNS)
    totals_row = conn.execute(
        f"SELECT COUNT(*) AS n_total, {cols} "
        f"FROM positions "
        f"WHERE is_critical=1 AND category IN ('mistake','blunder') AND best_san_sf IS NOT NULL"
    ).fetchone()
    if not totals_row:
        return []

    n_total = totals_row["n_total"] or 0
    out: list[dict[str, Any]] = []
    for key, label in _TACTICAL_PATTERNS:
        n = totals_row[key] or 0
        if n == 0:
            continue
        # drill_value medio per questo pattern (solo dove Maia ha girato)
        gap_row = conn.execute(
            f"SELECT AVG(p_target_plays_best_sf - COALESCE(p_mine_plays_best_sf, 0)) AS gap, "
            f"       AVG(cp_loss) AS cp_loss "
            f"FROM positions WHERE {key}=1 AND p_target_plays_best_sf IS NOT NULL"
        ).fetchone()
        out.append({
            "key": key,
            "label_it": label,
            "n": n,
            "n_total": n_total,
            "share_pct": round(100 * n / n_total, 1) if n_total else 0,
            "avg_gap_pct": round(100 * (gap_row["gap"] or 0), 1),
            "avg_cp_loss": round(gap_row["cp_loss"] or 0, 1),
            "confidence": _confidence(n),
        })
    out.sort(key=lambda x: (-x["n"], -x["avg_gap_pct"]))
    return out


def _repertoire_by_color(conn, color: str, k: int = 5, min_games: int = 3) -> list[dict[str, Any]]:
    """Repertorio peggiore di un colore.

    Per ogni (eco, opening) col mio colore, prendo:
      - games, win_rate, avg_acpl
      - 3 posizioni "incriminate": critical mistake/blunder con cp_loss massimo,
        preferibilmente nelle prime 25 mosse (= zona apertura/inizio middlegame).
    """
    ops = _q(conn, """
        SELECT eco, opening,
               COUNT(*) AS games,
               SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) AS wins,
               AVG(acpl) AS avg_acpl
        FROM games
        WHERE eco IS NOT NULL AND my_color = ?
        GROUP BY eco, opening
        HAVING games >= ?
        ORDER BY (1.0 * SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) / COUNT(*)) ASC,
                 AVG(acpl) DESC
        LIMIT ?
    """, color, min_games, k)

    out: list[dict[str, Any]] = []
    for op in ops:
        positions = _q(conn, """
            SELECT p.game_id, p.ply, p.move_number, p.san, p.best_san_sf,
                   p.best_san_maia_target, p.best_san_maia_mine,
                   p.p_mine_plays_best_sf, p.p_target_plays_best_sf,
                   p.cp_before, p.cp_after, p.cp_loss, p.phase, p.fen_before,
                   p.motif, p.motif_label_it, p.url, p.date,
                   p.my_color, p.opp_rating, p.result, p.opening, p.eco,
                   p.pv_san_sf,
                   p.motif_hanging_piece, p.motif_fork, p.motif_removed_defender,
                   p.motif_back_rank, p.motif_discovered_attack,
                   p.last_opp_from, p.last_opp_to, p.last_opp_san
            FROM positions p
            WHERE p.eco = ? AND p.opening = ? AND p.my_color = ?
              AND p.is_critical = 1 AND p.category IN ('mistake','blunder')
              AND p.best_san_sf IS NOT NULL
            ORDER BY CASE WHEN p.ply <= 50 THEN 0 ELSE 1 END,
                     p.cp_loss DESC
            LIMIT 3
        """, op["eco"], op["opening"], color)
        if not positions:
            continue
        out.append({
            "eco": op["eco"],
            "opening": op["opening"],
            "games": op["games"],
            "wins": op["wins"],
            "win_rate": _ratio(op["wins"], op["games"]),
            "avg_acpl": round(op["avg_acpl"] or 0, 1),
            "confidence": _confidence(op["games"]),
            "positions": positions,
        })
    return out


def _turning_points(conn, k: int = 12) -> list[dict[str, Any]]:
    rows = _q(conn, """
        SELECT p.game_id, p.ply, p.move_number, p.san, p.best_san_sf,
               p.best_san_maia_mine, p.best_san_maia_target,
               p.cp_before, p.cp_after, p.cp_loss, p.phase, p.fen_before,
               p.motif, p.motif_label_it, p.url, p.date,
               p.my_color, p.opp_rating, p.result, p.opening, p.eco,
               p.pv_san_sf,
               p.avoidable_at_my_level, p.unavoidable_at_target,
               p.last_opp_from, p.last_opp_to, p.last_opp_san
        FROM positions p
        WHERE p.is_turning_point=1
        ORDER BY p.end_time_epoch DESC, p.cp_loss DESC
        LIMIT ?
    """, k)
    return rows


def _drills(conn, k: int = 12) -> list[dict[str, Any]]:
    """Drill = posizioni di errore allenabili.

    Priorita`:
      1. Drill con GAP massimo target-vs-mine sulla mossa giusta:
         "il 78% dei 1600 la trova, al tuo livello solo il 23%" → drill perfetto.
         Richiede p_target_plays_best_sf e p_mine_plays_best_sf popolati.
      2. Avoidable (Maia@mio livello la trova) senza policy = drill secondario.
      3. Blunder critici grezzi = ultimo fallback se Maia non ha girato (CI).

    drill_value = p_target_plays_best_sf - p_mine_plays_best_sf
       in [0,1]. Piu` alto = piu` "money": il target lo sa, tu no, e si
       puo` colmare.
    """
    rows = _q(conn, """
        SELECT p.game_id, p.ply, p.move_number, p.san, p.best_san_sf,
               p.best_san_maia_mine, p.best_san_maia_target,
               p.p_maia_mine_top, p.p_maia_target_top,
               p.move_difficulty,
               p.p_mine_plays_best_sf, p.p_target_plays_best_sf,
               p.cp_before, p.cp_after, p.cp_loss, p.phase, p.fen_before,
               p.motif, p.motif_label_it,
               p.motif_hanging_piece, p.motif_fork, p.motif_removed_defender,
               p.motif_back_rank, p.motif_discovered_attack,
               p.url, p.date,
               p.my_color, p.opp_rating, p.result, p.opening, p.eco,
               p.pv_san_sf,
               p.last_opp_from, p.last_opp_to, p.last_opp_san,
               -- drill_value: il vero "money". Quanto il target sa che il mio
               -- livello non sa. NULL se Maia non e` ancora passata.
               CASE
                 WHEN p.p_target_plays_best_sf IS NOT NULL
                  AND p.p_mine_plays_best_sf  IS NOT NULL
                 THEN (p.p_target_plays_best_sf - p.p_mine_plays_best_sf)
                 ELSE NULL
               END AS drill_value,
               -- priority_score: tre livelli di certezza pedagogica.
               --   3 = drill_value alto (target lo trova, tu no)
               --   2 = avoidable (Maia old: mio livello lo trova)
               --   1 = blunder critico grezzo (no Maia)
               CASE
                 WHEN p.p_target_plays_best_sf > 0.40
                  AND (p.p_target_plays_best_sf - COALESCE(p.p_mine_plays_best_sf, 0)) > 0.15 THEN 3
                 WHEN p.avoidable_at_my_level = 1 THEN 2
                 WHEN p.category = 'blunder' AND p.is_critical = 1 THEN 1
                 ELSE 0
               END AS priority_score
        FROM positions p
        WHERE p.avoidable_at_my_level = 1
           OR (p.p_target_plays_best_sf > 0.40
               AND (p.p_target_plays_best_sf - COALESCE(p.p_mine_plays_best_sf, 0)) > 0.15)
           OR (p.category = 'blunder' AND p.is_critical = 1 AND p.best_san_sf IS NOT NULL)
        ORDER BY priority_score DESC,
                 drill_value DESC NULLS LAST,
                 p.cp_loss DESC,
                 p.end_time_epoch DESC
        LIMIT ?
    """, k)
    return rows


# ----------------------------------------------------------------------------
# Diagnoses + weekly focus
# ----------------------------------------------------------------------------


def _diagnoses(
    kpi: dict[str, Any],
    decisions: dict[str, Any],
    by_phase: list[dict[str, Any]],
    by_color: dict[str, dict[str, Any]],
    openings: list[dict[str, Any]],
    time_mgmt: dict[str, Any],
    tilt: dict[str, Any],
    blind_spots: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Diagnosi prioritizzate.

    Per ognuna calcola un PRIORITY SCORE = impact × frequency × trainability.
    Output ordinato per priority desc.
    """
    out: list[dict[str, Any]] = []

    # 1. Buttare partite vinte
    if decisions.get("blew_winning") and (decisions.get("blow_rate") or 0) > 0.25:
        out.append({
            "key": "conversion",
            "title": "Butti le partite vinte",
            "evidence": (
                f"{decisions['blew_winning']} delle {decisions['reached_winning']} partite "
                f"in cui sei arrivato a +2 le hai perse o pareggiate "
                f"({int((decisions['blow_rate'] or 0) * 100)}% blow rate)."
            ),
            "trainable": "studio di finali tecnici (T+P, donna vs torre) + 'simplification when ahead'",
            "lichess_theme": "endgame",
            "priority": int((decisions["blow_rate"] or 0) * 100) * 3,
            "confidence": decisions["confidence_conversion"],
        })

    # 2. Time management sotto pressione
    under_30 = next((b for b in time_mgmt["clock_vs_accuracy"] if b["key"] in ("under_10s", "10_30s")), None)
    over_120 = next((b for b in time_mgmt["clock_vs_accuracy"] if b["key"] == "over_120s"), None)
    if under_30 and over_120 and under_30["positions"] >= 20:
        delta = under_30["avg_cp_loss"] - over_120["avg_cp_loss"]
        if delta > 30:
            out.append({
                "key": "time_management",
                "title": "Crolli sotto pressione di tempo",
                "evidence": (
                    f"Sotto i 30s di orologio: ACPL {under_30['avg_cp_loss']}, "
                    f"{under_30['blunders']} blunder su {under_30['positions']} posizioni critiche. "
                    f"Con >120s ACPL è {over_120['avg_cp_loss']} — differenza +{int(delta)} ACPL."
                ),
                "trainable": "premoves in apertura conosciuta + 'no instinct moves' < 10s + più rapid e meno bullet/blitz",
                "lichess_theme": None,
                "priority": int(delta) * 2,
                "confidence": _confidence(under_30["positions"]),
            })

    # 3. Tilt dopo blunder
    if tilt["after_blunder_n"] >= 20 and tilt["tilt_factor"] > 1.3:
        out.append({
            "key": "tilt",
            "title": "Tilti dopo aver sbagliato",
            "evidence": (
                f"Dopo un tuo blunder, nelle 3 mosse seguenti l'ACPL sale a "
                f"{tilt['after_blunder_avg_cp_loss']} (baseline {tilt['baseline_avg_cp_loss']}, "
                f"+{int((tilt['tilt_factor'] - 1) * 100)}%)."
            ),
            "trainable": "pausa di 10s prima di rispondere dopo un blunder; non rincorrere; ricalcolare equilibrio",
            "lichess_theme": None,
            "priority": int(tilt["tilt_factor"] * 50),
            "confidence": _confidence(tilt["after_blunder_n"]),
        })

    # 4. Fase peggiore
    if by_phase:
        worst_phase = max(by_phase, key=lambda r: r["blunders"])
        if worst_phase["blunders"] >= 20:
            theme_map = {"opening": None, "middlegame": "middlegame", "endgame": "endgame"}
            out.append({
                "key": f"phase_{worst_phase['phase']}",
                "title": f"Sbagli più nel {worst_phase['phase']}",
                "evidence": (
                    f"{worst_phase['blunders']} blunder ({worst_phase['avoidable_blunders']} evitabili "
                    f"alla tua forza) su {worst_phase['positions']} posizioni critiche, "
                    f"ACPL medio {worst_phase['avg_cp_loss']}."
                ),
                "trainable": f"puzzle/studio focused su {worst_phase['phase']}",
                "lichess_theme": theme_map.get(worst_phase["phase"]),
                "priority": worst_phase["blunders"],
                "confidence": worst_phase["confidence"],
            })

    # 5. Motif dominante (sui blunder critici)
    if blind_spots:
        top = blind_spots[0]
        if top["n"] >= 5:
            theme_map = {
                "allowed_mate": "mateIn2",
                "material_loss": "hangingPiece",
                "winning_to_lost": "endgame",
                "winning_advantage_thrown": "middlegame",
                "positional_blunder": "middlegame",
            }
            out.append({
                "key": f"motif_{top['motif']}",
                "title": f"Blind spot: {top['label_it']}",
                "evidence": (
                    f"{top['n']} blunder critici classificati come «{top['label_it']}» "
                    f"({top['avoidable_count']} evitabili alla tua forza)."
                ),
                "trainable": f"tactic trainer Lichess su tema {theme_map.get(top['motif'], 'middlegame')}",
                "lichess_theme": theme_map.get(top["motif"]),
                "priority": top["n"] * 3,
                "confidence": top["confidence"],
            })

    # 6. Apertura peggiore
    bad_ops = [o for o in openings if (o["win_rate"] or 0) < 0.4]
    if bad_ops:
        worst = bad_ops[0]
        color_it = "col bianco" if worst["my_color"] == "white" else "col nero"
        out.append({
            "key": f"opening_{worst['eco']}_{worst['my_color']}",
            "title": f"Apertura debole: {worst['opening']} ({worst['eco']}) {color_it}",
            "evidence": (
                f"Win rate {int((worst['win_rate'] or 0) * 100)}% su {worst['games']} partite, "
                f"ACPL medio {worst['avg_acpl']}."
            ),
            "trainable": "Lichess Opening Explorer + prepararti una linea-tipo (15-20 min/giorno)",
            "lichess_theme": None,
            "priority": int(40 * (1 - (worst["win_rate"] or 0))) + worst["games"],
            "confidence": worst["confidence"],
        })

    # ordina per priorità desc
    out.sort(key=lambda r: -r["priority"])
    return out[:5]


def _weekly_focus(diagnoses: list[dict[str, Any]], drills: list[dict[str, Any]]) -> dict[str, Any]:
    if not diagnoses:
        return {
            "headline": "Non ho abbastanza dati per una diagnosi forte. Gioca 10 partite e torna.",
            "actions": [],
            "confidence": "low",
        }
    top = diagnoses[0]
    actions = [f"📌 {top['title']} — {top['trainable']}"]
    # Aggiunge 2 drill specifici dalla lista
    for d in drills[:2]:
        if d.get("best_san_sf"):
            actions.append(
                f"🎯 Rivedi mossa {d['move_number']} ({d['date']}, vs {d['opp_rating']}): "
                f"giocata {d['san']}, meglio {d['best_san_sf']}"
            )
    return {
        "headline": top["title"],
        "evidence": top["evidence"],
        "actions": actions,
        "confidence": top["confidence"],
    }


# ----------------------------------------------------------------------------
# Build
# ----------------------------------------------------------------------------


def build(cfg: dict[str, Any]) -> dict[str, Any]:
    db_path = Path(cfg["paths"].get("positions_db", "data/positions.db"))
    if not db_path.is_absolute():
        db_path = Path(__file__).resolve().parent.parent / db_path
    conn = connect(db_path)

    username = cfg["chess_com"]["username"]
    identity = _identity(conn, username)
    kpi = _kpi(conn)
    decisions = _decisions(conn)
    by_phase = _by_phase(conn)
    by_color = _by_color(conn)
    openings = _openings(conn)
    time_mgmt = _time_management(conn)
    rating_curve = _rating_curve(conn)
    tilt = _tilt(conn)
    blind_spots = _blind_spots(conn)
    tactical_breakdown = _tactical_breakdown(conn)
    repertoire_black = _repertoire_by_color(conn, "black")
    repertoire_white = _repertoire_by_color(conn, "white")
    turning_points = _turning_points(conn)
    drills = _drills(conn)
    diagnoses = _diagnoses(kpi, decisions, by_phase, by_color, openings, time_mgmt, tilt, blind_spots)
    weekly_focus = _weekly_focus(diagnoses, drills)

    conn.close()

    return {
        "generated_at_epoch": time_mod.time(),
        "schema_version": 3,
        "identity": identity,
        "kpi": kpi,
        "decisions": decisions,
        "by_phase": by_phase,
        "by_color": by_color,
        "openings": openings,
        "time_management": time_mgmt,
        "rating_curve": rating_curve,
        "tilt": tilt,
        "blind_spots": blind_spots,
        "tactical_breakdown": tactical_breakdown,
        "repertoire_black": repertoire_black,
        "repertoire_white": repertoire_white,
        "turning_points": turning_points,
        "drills": drills,
        "diagnoses": diagnoses,
        "weekly_focus": weekly_focus,
    }


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s | %(message)s", stream=sys.stdout)
    cfg = load_config()
    out = build(cfg)
    repo_root = Path(__file__).resolve().parent.parent
    out_path = repo_root / "data" / "player_model.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    log.info("Scritto %s", out_path)

    # Copia in frontend/public
    fe = repo_root / "frontend" / "public" / "player_model.json"
    if fe.parent.exists():
        fe.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        log.info("Copiato in %s", fe)

    # Quick stats
    log.info("KPI: %s", out["kpi"])
    log.info("Decisioni: conv=%s save=%s blow=%s",
             out["decisions"]["conversion_rate"], out["decisions"]["save_rate"], out["decisions"]["blow_rate"])
    log.info("Diagnosi: %d", len(out["diagnoses"]))


if __name__ == "__main__":
    main()
