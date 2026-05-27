import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, RefreshCw, ChevronRight, AlertCircle } from "lucide-react";
import type { PlayerModel } from "../types";
import {
  fetchLiveCoach, getCachedLiveCoach, type LiveCoachResponse,
} from "../liveCoach";

interface Props {
  pm: PlayerModel;
  /** Se true, prova a caricare al mount automaticamente. */
  autoLoad?: boolean;
}

/**
 * LiveBrief — il brief contestuale di Nonno generato dall'LLM live.
 *
 * Modalità:
 *   - Cache hit → renderizza subito + mostra "cached" badge
 *   - Cache miss + autoLoad → fetcha al mount
 *   - Errore (backend down / no API key) → fallback graceful
 *
 * UI: headline + body + "Aggiorna" button. Loading spinner durante fetch.
 */
export function LiveBrief({ pm, autoLoad = true }: Props) {
  const [resp, setResp] = useState<LiveCoachResponse | null>(() => getCachedLiveCoach(pm));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchLiveCoach(pm, { force });
      setResp(r);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (autoLoad && !resp && !error) {
      load(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  if (error) {
    return (
      <div className="live-brief live-brief-error">
        <div className="live-brief-head">
          <AlertCircle size={16} aria-hidden="true" />
          <span className="label-eyebrow">Coach live non disponibile</span>
        </div>
        <p className="text-sm text-[color:var(--color-text-soft)] mt-2">
          Per ottenere il brief contestuale di Nonno, avvia il server backend:
          <br />
          <code className="font-mono text-xs">cd backend && python -m uvicorn server:app --port 8000</code>
          <br />
          Assicurati che <code className="font-mono text-xs">OPENAI_API_KEY</code> sia esportata.
        </p>
        <details className="mt-3 text-xs text-[color:var(--color-faint)]">
          <summary className="cursor-pointer">Dettaglio errore</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono">{error}</pre>
        </details>
        <button onClick={() => load(true)} className="btn btn-ghost btn-sm mt-3">
          <RefreshCw size={14} /> Riprova
        </button>
      </div>
    );
  }

  if (loading && !resp) {
    return (
      <div className="live-brief live-brief-loading">
        <div className="live-brief-head">
          <Sparkles size={16} aria-hidden="true" />
          <span className="label-eyebrow">Nonno sta pensando…</span>
        </div>
        <div className="live-brief-skeleton">
          <div className="live-brief-skeleton-line" style={{ width: "70%" }} />
          <div className="live-brief-skeleton-line" style={{ width: "92%" }} />
          <div className="live-brief-skeleton-line" style={{ width: "85%" }} />
        </div>
      </div>
    );
  }

  if (!resp) return null;

  return (
    <div className="live-brief">
      <div className="live-brief-head">
        <Sparkles size={16} aria-hidden="true" />
        <span className="label-eyebrow">Brief di oggi · live</span>
        <button
          type="button"
          onClick={() => load(true)}
          className="live-brief-refresh"
          disabled={loading}
          title="Genera nuovo brief"
        >
          <RefreshCw size={12} aria-hidden="true" className={loading ? "spin" : ""} />
        </button>
      </div>
      <h3 className="live-brief-headline">{resp.headline}</h3>
      <p className="live-brief-body">{resp.body}</p>
      {resp.suggested_focus_pattern_key && (
        <Link
          to={`/patterns/${encodeURIComponent(resp.suggested_focus_pattern_key)}`}
          className="live-brief-suggestion"
        >
          Vai al freno suggerito <ChevronRight size={14} aria-hidden="true" />
        </Link>
      )}
      <div className="live-brief-meta">
        {resp.cached ? "in cache" : "appena generato"} · {resp.model}
      </div>
    </div>
  );
}
