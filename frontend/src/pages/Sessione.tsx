/**
 * Sessione.tsx — Pagina sessione di coaching multi-utente.
 *
 * Carica aggregates.json dal quaderno dell'utente, estrae le cadute
 * e le passa a NonnoSession (flusso lineare REVIEW -> PARTITA -> SALUTO).
 *
 * Empty state: se non ci sono cadute, NonnoSession mostra il proprio
 * schermo vuoto pulito — ma intercettiamo anche qui per uniformita'.
 */

import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { downloadJson, quadernoPath } from "../auth/storage";
import { NonnoSession } from "../session/NonnoSession";
import type { Aggregates, PositionExample } from "../pipeline/aggregate";
import { PRODUCT_NAME } from "../coaching";

export function Sessione() {
  const { user, profile } = useAuth();
  const nav = useNavigate();

  const [cadute, setCadute] = useState<PositionExample[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !profile) return;
    let cancelled = false;

    (async () => {
      try {
        const agg = await downloadJson<Aggregates>(quadernoPath(user.id, "aggregates.json"));
        if (cancelled) return;

        // Supporta sia aggregates.cadute (nuovo) sia aggregates.examples (legacy)
        const loaded = agg?.cadute ?? agg?.examples ?? [];
        setCadute(loaded);
      } catch (e) {
        if (!cancelled) setError(String(e instanceof Error ? e.message : e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, profile]);

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--color-bg)" }}
      >
        <div className="text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">
            {PRODUCT_NAME}
          </div>
          <div className="text-sm mt-2 text-[color:var(--color-text-soft)]">
            Preparo la sessione…
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: "var(--color-bg)" }}
      >
        <div className="surface surface-padded max-w-xl text-center">
          <div className="label-eyebrow text-rose-300 mb-2">Errore</div>
          <p className="text-[color:var(--color-text-soft)]">{error}</p>
          <Link to="/" className="btn btn-ghost mt-4 inline-block">
            Torna al Tavolo
          </Link>
        </div>
      </div>
    );
  }

  // ── Not yet loaded ────────────────────────────────────────────────────────

  if (cadute === null && !error) {
    // Still loading — spinner already shown above
    return null;
  }

  // ── Sessione ───────────────────────────────────────────────────────────────
  // NonnoSession handles cadute.length === 0 with its own clean empty state.

  return (
    <NonnoSession
      cadute={cadute ?? []}
      targetRating={profile?.goal_rating ?? 1600}
      currentRating={null}
      onClose={() => nav("/")}
    />
  );
}
