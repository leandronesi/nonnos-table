import { useState } from "react";
import type { FeedbackKind } from "../auth/db.types";
import { tr } from "../i18n/lang";
import { submitFeedback, trackEvent } from "../lib/telemetry";

export function FeedbackForm({
  kind = "product",
  subject = null,
  compact = false,
  onSubmitted,
}: {
  kind?: FeedbackKind;
  subject?: string | null;
  compact?: boolean;
  onSubmitted?: () => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (rating == null && !message.trim()) return;
    setSubmitting(true);
    setStatus(null);
    try {
      await submitFeedback({ kind, rating, subject, message });
      trackEvent("feedback_submitted", { kind, has_rating: rating != null });
      setMessage("");
      setRating(null);
      setStatus(tr("Grazie. Lo leggeremo davvero.", "Thank you. We will genuinely read it."));
      onSubmitted?.();
    } catch {
      setStatus(tr("Non sono riuscito a salvarlo. Riprova.", "Could not save it. Try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: compact ? "0.625rem" : "0.875rem" }}>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend style={{ fontSize: "0.75rem", color: "var(--color-muted)", marginBottom: "0.4rem" }}>
          {tr("Questa diagnosi ti somiglia?", "Does this diagnosis feel like you?")}
        </legend>
        <div style={{ display: "flex", gap: "0.375rem" }}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} / 5`}
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
              className="btn"
              style={{ minWidth: "2.35rem", color: rating === value ? "var(--color-brand-soft)" : undefined }}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>
      <label style={{ display: "grid", gap: "0.4rem", fontSize: "0.75rem", color: "var(--color-muted)" }}>
        {tr("Cosa non torna o cosa cambieresti?", "What feels wrong or what would you change?")}
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={4000}
          rows={compact ? 2 : 4}
          style={{
            width: "100%",
            resize: "vertical",
            border: "1px solid var(--color-line)",
            borderRadius: "8px",
            padding: "0.7rem",
            color: "var(--color-text)",
            background: "var(--color-surface-2)",
          }}
        />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="submit" className="btn btn-primary" disabled={submitting || (rating == null && !message.trim())}>
          {submitting ? tr("Invio…", "Sending…") : tr("Invia feedback", "Send feedback")}
        </button>
        {status ? <span role="status" style={{ fontSize: "0.75rem", color: "var(--color-muted)" }}>{status}</span> : null}
      </div>
    </form>
  );
}
