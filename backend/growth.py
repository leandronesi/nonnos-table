"""Aggregator deterministico per il delta di crescita sui pattern tattici.

No LLM, no API. Legge positions.db e calcola serie temporali multi-settimana
per tutti i pattern (11 totali: 5 motif tattici + 2 timing + 1 psych + 1 decision
+ 1 phase + 1 color).

Output: dict `growth_delta` da iniettare in pm["growth_delta"].

Schema output (campi aggiunti rispetto alla versione precedente):
  - as_of: date ISO della generazione
  - patterns: lista PatternEvolution con weekly_series (liste di {week_iso, share, n})
  - I campi summary_* esistenti sono mantenuti per back-compat.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any

log = logging.getLogger("growth")

# Finestra temporale: 8 settimane ISO
WEEKS_BACK = 8

# Per summary back-compat (vecchia logica 14/14)
WINDOW_DAYS = 14
COMPARE_DAYS = 14

MOTIF_DEFS: list[tuple[str, str]] = [
    ("motif_hanging_piece",     "Pezzo in presa"),
    ("motif_fork",              "Forchetta"),
    ("motif_removed_defender",  "Togliere il difensore"),
    ("motif_back_rank",         "Ottava traversa"),
    ("motif_discovered_attack", "Attacco scoperto"),
]

# Soglie per magnitude e direction
WEAK_THRESHOLD   = 0.05
STRONG_THRESHOLD = 0.15
IMPROVING_MIN    = -0.03   # delta < -0.03 -> improving
WORSENING_MIN    =  0.03   # delta >  0.03 -> worsening

MIN_BLUNDERS_FOR_RELIABLE = 5


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _magnitude(abs_delta: float) -> str:
    if abs_delta < WEAK_THRESHOLD:
        return "weak"
    if abs_delta < STRONG_THRESHOLD:
        return "medium"
    return "strong"


def _direction(delta: float) -> str:
    if delta < IMPROVING_MIN:
        return "improving"
    if delta > WORSENING_MIN:
        return "worsening"
    return "stable"


def _phrase_hint(label_it: str, direction: str, magnitude: str) -> str:
    """Suggerimento qualitativo per Nonno — niente numeri."""
    if direction == "improving" and magnitude == "strong":
        return f"{label_it}: in netto miglioramento, prima succedeva spesso, adesso quasi mai"
    if direction == "improving" and magnitude == "medium":
        return f"{label_it}: in miglioramento, meno frequente di prima"
    if direction == "improving":
        return f"{label_it}: lieve miglioramento"
    if direction == "worsening" and magnitude == "strong":
        return f"{label_it}: in peggioramento netto, adesso succede più spesso di prima"
    if direction == "worsening" and magnitude == "medium":
        return f"{label_it}: tende a peggiorare ultimamente"
    if direction == "worsening":
        return f"{label_it}: lieve peggioramento"
    return f"{label_it}: stabile"


def _check_columns(conn: sqlite3.Connection) -> list[str]:
    """Ritorna le colonne motif_* presenti nel DB."""
    existing = {row[1] for row in conn.execute("PRAGMA table_info(positions)")}
    return [col for col, _ in MOTIF_DEFS if col in existing]


def _iso_weeks(today: date, n: int) -> list[tuple[str, str, str]]:
    """Ritorna lista di (week_iso, date_start, date_end) per le ultime n settimane ISO.

    Settimana ISO: lunedì-domenica. Esclude la settimana corrente parziale
    se oggi non è domenica.
    """
    # Trova l'ultimo lunedì (inizio settimana corrente o precedente)
    # monday of current week
    monday = today - timedelta(days=today.weekday())  # 0=lunedì
    weeks = []
    for i in range(n):
        wk_start = monday - timedelta(weeks=i + 1)  # escludi settimana parziale corrente
        wk_end   = wk_start + timedelta(days=7)
        iso_year, iso_week, _ = wk_start.isocalendar()
        week_iso = f"{iso_year}-W{iso_week:02d}"
        weeks.append((week_iso, wk_start.isoformat(), wk_end.isoformat()))
    return list(reversed(weeks))  # dal più vecchio al più recente


# ---------------------------------------------------------------------------
# Summary back-compat (vecchia logica 14/14 — usata da coach voce)
# ---------------------------------------------------------------------------

def _count_blunders_with_motifs(
    conn: sqlite3.Connection,
    date_start: str,
    date_end: str,
    motif_cols: list[str],
) -> tuple[int, dict[str, int]]:
    col_not_null = " OR ".join(f"{c} IS NOT NULL" for c in motif_cols)
    total_sql = f"""
        SELECT COUNT(*) FROM positions
        WHERE category = 'blunder'
          AND date >= ? AND date < ?
          AND ({col_not_null})
    """
    total = conn.execute(total_sql, (date_start, date_end)).fetchone()[0]
    per_motif: dict[str, int] = {}
    for col in motif_cols:
        n = conn.execute(
            f"""SELECT COUNT(*) FROM positions
                WHERE category = 'blunder'
                  AND date >= ? AND date < ?
                  AND {col} IS NOT NULL
                  AND {col} = 1""",
            (date_start, date_end),
        ).fetchone()[0]
        per_motif[col] = n
    return total, per_motif


# ---------------------------------------------------------------------------
# Pattern: motif tattici (5) — weekly series su blunder
# ---------------------------------------------------------------------------

def _motif_weekly_series(
    conn: sqlite3.Connection,
    col: str,
    weeks: list[tuple[str, str, str]],
    motif_cols: list[str],
) -> list[dict[str, Any]]:
    """Serie settimanale share = motif_X_blunder / total_blunder_with_motif."""
    col_not_null = " OR ".join(f"{c} IS NOT NULL" for c in motif_cols)
    series = []
    for week_iso, wk_start, wk_end in weeks:
        total = conn.execute(
            f"""SELECT COUNT(*) FROM positions
                WHERE category = 'blunder' AND date >= ? AND date < ?
                  AND ({col_not_null})""",
            (wk_start, wk_end),
        ).fetchone()[0]
        n = conn.execute(
            f"""SELECT COUNT(*) FROM positions
                WHERE category = 'blunder' AND date >= ? AND date < ?
                  AND {col} IS NOT NULL AND {col} = 1""",
            (wk_start, wk_end),
        ).fetchone()[0] if total > 0 else 0
        share = round(n / total, 4) if total > 0 else 0.0
        series.append({"week_iso": week_iso, "share": share, "n": n})
    return series


# ---------------------------------------------------------------------------
# Pattern: timing — time_overthinking, time_instant_moves
# ---------------------------------------------------------------------------

def _timing_weekly_series(
    conn: sqlite3.Connection,
    pattern_key: str,
    weeks: list[tuple[str, str, str]],
) -> list[dict[str, Any]]:
    """Share = pattern_blunder / total_blunder nella settimana."""
    series = []
    for week_iso, wk_start, wk_end in weeks:
        total = conn.execute(
            """SELECT COUNT(*) FROM positions
               WHERE category = 'blunder' AND date >= ? AND date < ?""",
            (wk_start, wk_end),
        ).fetchone()[0]
        if total == 0:
            series.append({"week_iso": week_iso, "share": 0.0, "n": 0})
            continue
        if pattern_key == "time_overthinking":
            n = conn.execute(
                """SELECT COUNT(*) FROM positions
                   WHERE category = 'blunder' AND date >= ? AND date < ?
                     AND seconds_spent > 30 AND cp_loss > 100""",
                (wk_start, wk_end),
            ).fetchone()[0]
        else:  # time_instant_moves
            n = conn.execute(
                """SELECT COUNT(*) FROM positions
                   WHERE category = 'blunder' AND date >= ? AND date < ?
                     AND seconds_spent < 2 AND cp_loss > 100 AND is_critical = 1""",
                (wk_start, wk_end),
            ).fetchone()[0]
        series.append({"week_iso": week_iso, "share": round(n / total, 4), "n": n})
    return series


# ---------------------------------------------------------------------------
# Pattern: color_imbalance
# ---------------------------------------------------------------------------

def _color_imbalance_weekly(
    conn: sqlite3.Connection,
    weeks: list[tuple[str, str, str]],
) -> list[dict[str, Any]]:
    """abs(white_win_rate - black_win_rate) per settimana — usa tabella games."""
    series = []
    try:
        for week_iso, wk_start, wk_end in weeks:
            def _wr(color: str) -> float | None:
                r = conn.execute(
                    """SELECT COUNT(*) as total,
                              SUM(CASE WHEN result='win' THEN 1 ELSE 0 END) as wins
                       FROM games
                       WHERE date >= ? AND date < ? AND my_color = ?""",
                    (wk_start, wk_end, color),
                ).fetchone()
                if r and r[0] and r[0] >= 2:
                    return r[1] / r[0]
                return None
            ww = _wr("white")
            bw = _wr("black")
            if ww is not None and bw is not None:
                share = round(abs(ww - bw), 4)
                n = 1  # "1 misura"
            else:
                share = 0.0
                n = 0
            series.append({"week_iso": week_iso, "share": share, "n": n})
    except Exception as e:  # noqa: BLE001
        log.debug("color_imbalance_weekly fallito: %s", e)
        series = []
    return series


# ---------------------------------------------------------------------------
# Pattern: phase_middlegame — avg_cp_loss middlegame / avg_cp_loss opening
# ---------------------------------------------------------------------------

def _phase_middlegame_weekly(
    conn: sqlite3.Connection,
    weeks: list[tuple[str, str, str]],
) -> list[dict[str, Any]]:
    """Ratio avg_cp_loss middlegame / opening per settimana.

    Un valore alto = mediogioco debole rispetto all'apertura.
    Share = ratio normalizzata in [0, 1] via min-max (approssimazione).
    Per semplicitá usiamo il ratio grezzo come "share" (puo` superare 1).
    """
    series = []
    try:
        for week_iso, wk_start, wk_end in weeks:
            mid = conn.execute(
                """SELECT AVG(cp_loss) FROM positions
                   WHERE phase = 'middlegame' AND category = 'blunder'
                     AND date >= ? AND date < ?""",
                (wk_start, wk_end),
            ).fetchone()[0]
            opn = conn.execute(
                """SELECT AVG(cp_loss) FROM positions
                   WHERE phase = 'opening' AND category = 'blunder'
                     AND date >= ? AND date < ?""",
                (wk_start, wk_end),
            ).fetchone()[0]
            if mid is not None and opn is not None and opn > 0:
                ratio = round(min(mid / opn, 3.0) / 3.0, 4)  # normalizza a [0,1] con cap 3x
                n = 1
            else:
                ratio = 0.0
                n = 0
            series.append({"week_iso": week_iso, "share": ratio, "n": n})
    except Exception as e:  # noqa: BLE001
        log.debug("phase_middlegame_weekly fallito: %s", e)
        series = []
    return series


# ---------------------------------------------------------------------------
# Pattern: blow_winning — partite blow / reached_winning per settimana
# ---------------------------------------------------------------------------

def _blow_winning_weekly(
    conn: sqlite3.Connection,
    weeks: list[tuple[str, str, str]],
) -> list[dict[str, Any]]:
    """blow_rate settimanale da tabella games."""
    series = []
    try:
        for week_iso, wk_start, wk_end in weeks:
            r = conn.execute(
                """SELECT SUM(reached_winning),
                          SUM(CASE WHEN reached_winning=1 AND converted_winning=0 THEN 1 ELSE 0 END)
                   FROM games
                   WHERE date >= ? AND date < ?""",
                (wk_start, wk_end),
            ).fetchone()
            reached = r[0] or 0
            blown   = r[1] or 0
            if reached >= 2:
                share = round(blown / reached, 4)
                n = int(blown)
            else:
                share = 0.0
                n = 0
            series.append({"week_iso": week_iso, "share": share, "n": n})
    except Exception as e:  # noqa: BLE001
        log.debug("blow_winning_weekly fallito: %s", e)
        series = []
    return series


# ---------------------------------------------------------------------------
# Pattern: tilt_post_blunder — graceful stub (no sequence data in DB)
# ---------------------------------------------------------------------------

def _tilt_stub() -> list[dict[str, Any]]:
    """Nessun dato sequenziale disponibile in positions.db per calcolare il tilt
    su base settimanale. Ritorna lista vuota (graceful fallback)."""
    return []


# ---------------------------------------------------------------------------
# Trend aggregation: current = last week, previous = avg(last 4 weeks before)
# ---------------------------------------------------------------------------

def _compute_trend(weekly_series: list[dict[str, Any]]) -> tuple[float, float, str, str, str]:
    """Ritorna (current_share, previous_share, trend, magnitude, phrase_hint) dati la serie."""
    populated = [w for w in weekly_series if w["n"] > 0]
    if not populated:
        return 0.0, 0.0, "stable", "weak", ""

    current_share = populated[-1]["share"]
    # previous = media delle ultime 4 settimane prima dell'ultima
    prev_weeks = populated[:-1][-4:]
    if prev_weeks:
        previous_share = sum(w["share"] for w in prev_weeks) / len(prev_weeks)
    else:
        previous_share = current_share

    delta = current_share - previous_share
    trend = _direction(delta)
    magnitude = _magnitude(abs(delta))
    return round(current_share, 4), round(previous_share, 4), trend, magnitude, delta


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def compute_growth_delta(repo_root: Path) -> dict[str, Any]:
    """Calcola delta di crescita su 11 pattern con serie temporali 8 settimane.

    Back-compat: mantiene summary_* e patterns[*].share_curr/share_prev/delta_share/direction/magnitude.
    Aggiunge: as_of, patterns[*].current_share/previous_share/trend/weekly_series/phrase_hint.
    """
    db_path = repo_root / "data" / "positions.db"

    if not db_path.exists():
        log.info("positions.db non trovato in %s — growth_delta non disponibile", db_path)
        return {"available": False, "reason": "positions.db non trovato"}

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.OperationalError:
        conn = sqlite3.connect(str(db_path))

    try:
        motif_cols = _check_columns(conn)
        if not motif_cols:
            log.info("Nessuna colonna motif_* nel DB — growth_delta non disponibile")
            return {"available": False, "reason": "colonne motif_* assenti nel DB"}

        today = date.today()
        weeks = _iso_weeks(today, WEEKS_BACK)

        log.info("Serie temporale: %d settimane ISO (da %s a %s)",
                 len(weeks), weeks[0][0] if weeks else "?", weeks[-1][0] if weeks else "?")

        # --- summary back-compat (14/14 windows) ---
        curr_end   = today.isoformat()
        curr_start = (today - timedelta(days=WINDOW_DAYS)).isoformat()
        prev_end   = curr_start
        prev_start = (today - timedelta(days=WINDOW_DAYS + COMPARE_DAYS)).isoformat()

        curr_total, curr_per = _count_blunders_with_motifs(conn, curr_start, curr_end, motif_cols)
        prev_total, prev_per = _count_blunders_with_motifs(conn, prev_start, prev_end, motif_cols)

        log.info("back-compat: blunder con motif curr=%d, prev=%d", curr_total, prev_total)

        if curr_total < MIN_BLUNDERS_FOR_RELIABLE and prev_total < MIN_BLUNDERS_FOR_RELIABLE:
            log.info("Dati insufficienti (%d blunder) — growth_delta non disponibile", curr_total)
            return {
                "available": False,
                "reason": f"dati insufficienti: solo {curr_total} blunder nell'ultima finestra",
            }

        # --- Costruisce patterns (tutti 11) ---
        patterns: list[dict[str, Any]] = []

        # 1-5: motif tattici
        for col, label_it in MOTIF_DEFS:
            if col not in motif_cols:
                continue

            weekly_series = _motif_weekly_series(conn, col, weeks, motif_cols)
            current_share, previous_share, trend, magnitude, delta_raw = _compute_trend(weekly_series)

            # back-compat fields (usano ancora la logica 14/14)
            share_curr_bc = round(curr_per[col] / curr_total, 4) if curr_total > 0 else 0.0
            share_prev_bc = round(prev_per[col] / prev_total, 4) if prev_total > 0 else 0.0
            delta_bc = round(share_curr_bc - share_prev_bc, 4)

            phrase = _phrase_hint(label_it, trend, magnitude)
            log.info("  %s: curr=%.3f prev=%.3f -> %s/%s | %s",
                     col, current_share, previous_share, trend, magnitude, phrase)

            patterns.append({
                # nuovi campi
                "key":            col,
                "label_it":       label_it,
                "category":       "tactic",
                "current_share":  current_share,
                "previous_share": previous_share,
                "trend":          trend,
                "magnitude":      magnitude,
                "weekly_series":  weekly_series,
                "phrase_hint":    phrase,
                # back-compat
                "share_curr":     share_curr_bc,
                "share_prev":     share_prev_bc,
                "delta_share":    delta_bc,
                "direction":      trend,
            })

        # 6: time_overthinking
        try:
            wk_series_ot = _timing_weekly_series(conn, "time_overthinking", weeks)
            cs, ps, tr, mg, _ = _compute_trend(wk_series_ot)
            patterns.append({
                "key": "time_overthinking", "label_it": "Tempo eccessivo",
                "category": "timing",
                "current_share": cs, "previous_share": ps,
                "trend": tr, "magnitude": mg,
                "weekly_series": wk_series_ot,
                "phrase_hint": _phrase_hint("Tempo eccessivo", tr, mg),
                # back-compat stubs
                "share_curr": cs, "share_prev": ps, "delta_share": round(cs - ps, 4), "direction": tr,
            })
        except Exception as e:  # noqa: BLE001
            log.debug("time_overthinking fallito: %s", e)
            patterns.append(_stub_pattern("time_overthinking", "Tempo eccessivo", "timing"))

        # 7: time_instant_moves
        try:
            wk_series_im = _timing_weekly_series(conn, "time_instant_moves", weeks)
            cs, ps, tr, mg, _ = _compute_trend(wk_series_im)
            patterns.append({
                "key": "time_instant_moves", "label_it": "Mossa istantanea",
                "category": "timing",
                "current_share": cs, "previous_share": ps,
                "trend": tr, "magnitude": mg,
                "weekly_series": wk_series_im,
                "phrase_hint": _phrase_hint("Mossa istantanea", tr, mg),
                "share_curr": cs, "share_prev": ps, "delta_share": round(cs - ps, 4), "direction": tr,
            })
        except Exception as e:  # noqa: BLE001
            log.debug("time_instant_moves fallito: %s", e)
            patterns.append(_stub_pattern("time_instant_moves", "Mossa istantanea", "timing"))

        # 8: tilt_post_blunder — stub (no sequence data in DB per settimana)
        patterns.append(_stub_pattern("tilt_post_blunder", "Tilt dopo errore", "psych"))

        # 9: blow_winning
        try:
            wk_series_bw = _blow_winning_weekly(conn, weeks)
            cs, ps, tr, mg, _ = _compute_trend(wk_series_bw)
            patterns.append({
                "key": "blow_winning", "label_it": "Vittoria buttata",
                "category": "decision",
                "current_share": cs, "previous_share": ps,
                "trend": tr, "magnitude": mg,
                "weekly_series": wk_series_bw,
                "phrase_hint": _phrase_hint("Vittoria buttata", tr, mg),
                "share_curr": cs, "share_prev": ps, "delta_share": round(cs - ps, 4), "direction": tr,
            })
        except Exception as e:  # noqa: BLE001
            log.debug("blow_winning fallito: %s", e)
            patterns.append(_stub_pattern("blow_winning", "Vittoria buttata", "decision"))

        # 10: phase_middlegame
        try:
            wk_series_ph = _phase_middlegame_weekly(conn, weeks)
            cs, ps, tr, mg, _ = _compute_trend(wk_series_ph)
            patterns.append({
                "key": "phase_middlegame", "label_it": "Debolezza mediogioco",
                "category": "phase",
                "current_share": cs, "previous_share": ps,
                "trend": tr, "magnitude": mg,
                "weekly_series": wk_series_ph,
                "phrase_hint": _phrase_hint("Debolezza mediogioco", tr, mg),
                "share_curr": cs, "share_prev": ps, "delta_share": round(cs - ps, 4), "direction": tr,
            })
        except Exception as e:  # noqa: BLE001
            log.debug("phase_middlegame fallito: %s", e)
            patterns.append(_stub_pattern("phase_middlegame", "Debolezza mediogioco", "phase"))

        # 11: color_imbalance
        try:
            wk_series_ci = _color_imbalance_weekly(conn, weeks)
            cs, ps, tr, mg, _ = _compute_trend(wk_series_ci)
            patterns.append({
                "key": "color_imbalance", "label_it": "Squilibrio colore",
                "category": "color",
                "current_share": cs, "previous_share": ps,
                "trend": tr, "magnitude": mg,
                "weekly_series": wk_series_ci,
                "phrase_hint": _phrase_hint("Squilibrio colore", tr, mg),
                "share_curr": cs, "share_prev": ps, "delta_share": round(cs - ps, 4), "direction": tr,
            })
        except Exception as e:  # noqa: BLE001
            log.debug("color_imbalance fallito: %s", e)
            patterns.append(_stub_pattern("color_imbalance", "Squilibrio colore", "color"))

        # --- Summary (back-compat) ---
        # Scegli il pattern con |delta| maggiore tra quelli non-stub, priorità improving
        qualified = [p for p in patterns if p["weekly_series"]]
        if not qualified:
            qualified = patterns

        def _sort_key(p: dict) -> tuple:
            dir_rank = {"improving": 0, "worsening": 1, "stable": 2}
            mag_rank = {"strong": 0, "medium": 1, "weak": 2}
            return (dir_rank[p["trend"]], mag_rank[p["magnitude"]], -abs(p["delta_share"]))

        sorted_patterns = sorted(qualified, key=_sort_key)
        summary = sorted_patterns[0]

        phrase_hint = _phrase_hint(summary["label_it"], summary["trend"], summary["magnitude"])
        log.info("Summary: %s (%s/%s) — hint: %s",
                 summary["key"], summary["trend"], summary["magnitude"], phrase_hint)

        return {
            "available":           True,
            "as_of":               today.isoformat(),
            "window_days":         WINDOW_DAYS,
            "compare_to_days":     COMPARE_DAYS,
            "patterns":            patterns,
            # back-compat summary_*
            "summary_key":         summary["key"],
            "summary_label_it":    summary["label_it"],
            "summary_direction":   summary["trend"],
            "summary_magnitude":   summary["magnitude"],
            "summary_phrase_hint": phrase_hint,
        }

    finally:
        conn.close()


def _stub_pattern(key: str, label_it: str, category: str) -> dict[str, Any]:
    """Pattern senza dati sufficienti — graceful fallback con weekly_series vuota."""
    return {
        "key":            key,
        "label_it":       label_it,
        "category":       category,
        "current_share":  0.0,
        "previous_share": 0.0,
        "trend":          "stable",
        "magnitude":      "weak",
        "weekly_series":  [],
        "phrase_hint":    f"{label_it}: dati insufficienti",
        # back-compat
        "share_curr":     0.0,
        "share_prev":     0.0,
        "delta_share":    0.0,
        "direction":      "stable",
    }
