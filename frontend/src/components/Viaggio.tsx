/**
 * Viaggio — vertical ink timeline at the top of Tab Evoluzione.
 *
 * Renders a chronological journey:
 *   PARTENZA (first snapshot) → MILESTONE RAGGIUNTE (earned ones worth showing)
 *   → OGGI (last snapshot / current rating) → OBIETTIVO (gold, future)
 *
 * Visual signature: a vertical rail on the left with ink-drawn segments that
 * animate into view as each node scrolls in (useInkDraw per node).
 * The dashed segment toward OBIETTIVO is always visible and never animates.
 *
 * Props come from TabEvoluzione's already-loaded data — no extra fetches.
 */

import React from "react";
import type { HistorySnapshot, Milestone } from "../types";
import { materialForGap } from "../pipeline/history";
import { useInkDraw } from "../lib/motion";

// ── Italian month names (same as Quaderno.tsx / TavoloHome.tsx) ───────────────

const MONTHS_IT = [
  "gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic",
];

/** "12 MAR 2026" from an ISO string. */
function dateIt(iso: string): string {
  try {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const mon = MONTHS_IT[d.getMonth()]?.toUpperCase() ?? "";
    return `${day} ${mon} ${d.getFullYear()}`;
  } catch { return iso.slice(0, 10); }
}

/** "entro mar 2026" from an ISO deadline. */
function deadlineShort(iso: string): string {
  try {
    const parts = iso.slice(0, 7).split("-");
    const m = parseInt(parts[1] ?? "0", 10) - 1;
    return `entro ${MONTHS_IT[m] ?? ""} ${parts[0]}`;
  } catch { return ""; }
}

// ── Node helpers ──────────────────────────────────────────────────────────────

type MilestoneType = Milestone["type"];

/** Milestone types shown in the Viaggio (growth evidence only). */
const VIAGGIO_MILESTONE_TYPES: MilestoneType[] = [
  "rating_gain",
  "gap_closed",
  "anchor_improved",
  "anchor_domata",
];

/**
 * Builds the Nonno copy for each milestone type.
 * Returns null for types not shown in the Viaggio.
 */
function milestoneText(m: Milestone): string | null {
  switch (m.type) {
    case "rating_gain":
      return `Hai messo ${m.threshold} punti tra te e il primo giorno.`;
    case "gap_closed": {
      const pct = m.threshold;
      if (pct <= 0.25) return "Un quarto della distanza da chi vuoi diventare non c'e' piu'.";
      if (pct <= 0.5)  return "Meta' strada. La sedia davanti e' piu' vicina.";
      if (pct <= 0.75) return "Tre quarti della distanza sono alle spalle.";
      return "La distanza non c'e' piu'. Giochi alla sua altezza.";
    }
    case "anchor_improved": {
      // label_it is '"Label": in miglioramento (X% meno frequente)' — extract the anchor name
      const match = m.label_it.match(/^"([^"]+)"/);
      const label = match ? match[1] : m.label_it;
      return `${label}: ci cadi piu' di rado. Si vede il lavoro.`;
    }
    case "anchor_domata": {
      const match = m.label_it.match(/^"([^"]+)"/);
      const label = match ? match[1] : m.label_it;
      return `${label} e' fuori dai tuoi primi tre problemi. Domata.`;
    }
    default:
      return null;
  }
}

/** Small mono evidence tag (e.g. "+50" for rating_gain). */
function milestoneEvidence(m: Milestone): string | null {
  if (m.type === "rating_gain" && m.threshold != null) {
    return `+${m.threshold}`;
  }
  return null;
}

// ── Node components ───────────────────────────────────────────────────────────

/**
 * One timeline node: rail column (dot + animated segment) + content column.
 * `isLast` suppresses the animated segment (the last content node before OBIETTIVO
 * has a dashed segment drawn by the OBIETTIVO node itself).
 * `drawn` comes from the parent's useInkDraw() call — the hook observes the
 * dot, and drawn=true triggers both the segment animation and the content settle.
 */
function ViaggioNode({
  date,
  text,
  evidence,
  isGoal = false,
  segment,
  drawn,
  dotRef,
}: {
  date?: string;
  text: string;
  evidence?: string | null;
  isGoal?: boolean;
  /**
   * The rail segment BELOW this node's dot, leading to the next node.
   * Grammar of the room: solid drawn ink = road covered, dashed = road ahead.
   *   "ink"    — covered (animated scaleY draw on view)
   *   "dashed" — the stretch still to walk (OGGI → OBIETTIVO), static
   *   "none"   — last node (OBIETTIVO), the road ends at the gold dot
   */
  segment: "ink" | "dashed" | "none";
  drawn: boolean;
  dotRef: React.RefCallback<Element>;
}) {
  const dotSize = isGoal ? 10 : 8;
  const dotColor = isGoal ? "var(--color-gold-soft)" : "var(--color-brand-soft)";

  return (
    <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", position: "relative" }}>
      {/* Rail column */}
      <div
        style={{
          width: "20px",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          paddingTop: "3px",
        }}
      >
        {/* Dot — this is the element observed by useInkDraw */}
        <div
          ref={dotRef}
          style={{
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            background: dotColor,
            flexShrink: 0,
            boxSizing: "border-box",
            alignSelf: "center",
          }}
        />
        {segment === "dashed" && (
          <div
            style={{
              flex: 1,
              width: "2px",
              minHeight: "48px",
              background: "repeating-linear-gradient(180deg, var(--color-line-strong) 0 4px, transparent 4px 10px)",
              opacity: 0.7,
              marginTop: "4px",
              alignSelf: "center",
            }}
          />
        )}
        {segment === "ink" && (
          <div
            style={{
              flex: 1,
              width: "2px",
              minHeight: "48px",
              background: "var(--color-line-strong)",
              marginTop: "4px",
              transformOrigin: "top",
              transform: drawn ? "scaleY(1)" : "scaleY(0)",
              transition: drawn
                ? "transform 700ms var(--ease-ink)"
                : "none",
              alignSelf: "center",
            }}
          />
        )}
      </div>

      {/* Content column */}
      <div
        style={{
          paddingBottom: "2rem",
          flex: 1,
          opacity: drawn ? 1 : 0,
          transform: drawn ? "translateY(0)" : "translateY(8px)",
          transition: drawn
            ? "opacity 600ms var(--ease-settle), transform 600ms var(--ease-settle)"
            : "none",
        }}
      >
        {/* Date eyebrow */}
        {date && (
          <div
            className="tt-eyebrow"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.70rem",
              color: isGoal ? "var(--color-gold-soft)" : "var(--color-faint)",
              marginBottom: "0.35rem",
              letterSpacing: "0.06em",
            }}
          >
            {date}
          </div>
        )}

        {/* Main text */}
        <p
          style={{
            fontFamily: "var(--font-voice)",
            fontWeight: 500,
            fontSize: "1.05rem",
            lineHeight: 1.5,
            color: isGoal ? "var(--color-gold-soft)" : "var(--color-text)",
            margin: 0,
          }}
        >
          {text}
        </p>

        {/* Evidence tag (optional, sobrio — ink does not judge, so muted not green) */}
        {evidence && (
          <div
            style={{
              marginTop: "0.3rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              color: "var(--color-muted)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {evidence}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface ViaggioProps {
  snapshots: HistorySnapshot[];
  milestones: Milestone[];
  goal: {
    target: number;
    current: number | null;
    deadline?: string | null;
  };
}

/**
 * Ink timeline of the journey from day 1 to today to the goal.
 * Returns null when there are no snapshots (guard).
 */
export function Viaggio({ snapshots, milestones, goal }: ViaggioProps) {
  // Guard: no snapshots → nothing to render
  if (snapshots.length === 0) return null;

  const sorted = [...snapshots].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const firstSnap = sorted[0];
  const lastSnap  = sorted[sorted.length - 1];

  // ── Build node list ────────────────────────────────────────────────────────

  type NodeDef = {
    key: string;
    date?: string;
    text: string;
    evidence?: string | null;
    isGoal?: boolean;
  };

  const nodes: NodeDef[] = [];

  // a. PARTENZA
  {
    const rating = firstSnap.goal.current;
    const mw = firstSnap.maia_weighted;
    const hasPct = mw.mine_pct != null && mw.target_pct != null;
    const gap = hasPct ? (mw.target_pct! - mw.mine_pct!) : null;
    const material = gap != null ? materialForGap(gap) : null;

    let text: string;
    if (rating != null && material != null) {
      text = `Ci siamo seduti la prima volta. Eri ${rating}. Ti avrei dato ${material.label} di vantaggio.`;
    } else if (rating != null) {
      text = `Ci siamo seduti la prima volta. Eri ${rating}.`;
    } else {
      text = "Ci siamo seduti la prima volta.";
    }

    nodes.push({
      key: "partenza",
      date: dateIt(firstSnap.captured_at),
      text,
    });
  }

  // b. MILESTONES (only when >= 2 snapshots — need history for meaning)
  if (snapshots.length >= 2) {
    const achieved = milestones.filter(
      (m) =>
        m.achieved &&
        m.achieved_at != null &&
        VIAGGIO_MILESTONE_TYPES.includes(m.type),
    );
    // Sort chronologically by achieved_at
    achieved.sort((a, b) => (a.achieved_at ?? "").localeCompare(b.achieved_at ?? ""));

    for (const m of achieved) {
      const text = milestoneText(m);
      if (text == null) continue;
      nodes.push({
        // label_it in the key: anchor milestones share type+threshold across anchors
        key: `ms-${m.type}-${m.threshold}-${m.label_it}`,
        date: m.achieved_at ? dateIt(m.achieved_at) : undefined,
        text,
        evidence: milestoneEvidence(m),
      });
    }
  }

  // c. OGGI
  {
    const rating = goal.current;
    const mw = lastSnap.maia_weighted;
    const hasPct = mw.mine_pct != null && mw.target_pct != null;
    const gap = hasPct ? (mw.target_pct! - mw.mine_pct!) : null;
    const material = gap != null ? materialForGap(gap) : null;

    let text: string;
    if (rating != null && material != null) {
      text = `Oggi sei ${rating}. Ti darei ${material.label}.`;
    } else if (rating != null && hasPct) {
      // has pct data but gap is null → quasi alla pari
      text = `Oggi sei ${rating}. Giochiamo quasi alla pari.`;
    } else if (rating != null) {
      text = `Oggi sei ${rating}.`;
    } else {
      text = "Siamo qui.";
    }

    nodes.push({
      key: "oggi",
      date: "OGGI",
      text,
    });
  }

  // d. OBIETTIVO (gold, future, always last)
  {
    const deadlineLabel = goal.deadline ? deadlineShort(goal.deadline) : null;
    nodes.push({
      key: "obiettivo",
      date: deadlineLabel ?? undefined,
      text: `${goal.target}. Il posto che stai raggiungendo.`,
      isGoal: true,
    });
  }

  return (
    <div style={{ marginBottom: "2.5rem" }}>
      {/* Eyebrow */}
      <div
        className="tt-eyebrow"
        style={{ marginBottom: "1.5rem", color: "var(--color-muted)" }}
      >
        Il nostro viaggio
      </div>

      {/* Node list.
          Segment grammar: every covered stretch is solid ink that draws itself;
          the stretch from the second-to-last node (OGGI) to OBIETTIVO is the
          road still ahead → dashed, static; OBIETTIVO ends the rail (none). */}
      <div>
        {nodes.map((node, idx) => (
          <ViaggioNodeWrapper
            key={node.key}
            node={node}
            segment={
              idx === nodes.length - 1
                ? "none"
                : idx === nodes.length - 2
                  ? "dashed"
                  : "ink"
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Wrapper that calls useInkDraw once per node and passes drawn + ref down.
 * Split into its own component so each node gets its own hook instance.
 */
function ViaggioNodeWrapper({
  node,
  segment,
}: {
  node: {
    key: string;
    date?: string;
    text: string;
    evidence?: string | null;
    isGoal?: boolean;
  };
  segment: "ink" | "dashed" | "none";
}) {
  const { ref, drawn } = useInkDraw();

  return (
    <ViaggioNode
      date={node.date}
      text={node.text}
      evidence={node.evidence}
      isGoal={node.isGoal}
      segment={segment}
      drawn={drawn}
      dotRef={ref}
    />
  );
}
