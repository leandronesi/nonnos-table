/**
 * TeachTest.tsx — pagina di diagnosi DEV per la voce-maestro.
 *
 * Itera su casi di test noti e mostra, per ognuno:
 *   1. Fatti deterministici (extractMoveFacts)
 *   2. Principio curriculum (selectPrinciple)
 *   3. Floor deterministico (buildMoveReason)
 *   4. Lezione LLM (fetchLesson via coach-llm)
 *
 * Rotta: /dev/teach  — solo in DEV.
 * Richiede: login attivo + Edge Function coach-llm deployata.
 */

import { useEffect, useState, useRef } from "react";
import {
  extractMoveFacts,
  buildMoveReason,
  type MoveReasonInput,
  type MoveFacts,
} from "../../session/moveReason";
import { selectPrinciple } from "../../coach/selectPrinciple";
import {
  fetchLesson,
  buildTeachArgs,
  type TeachArgs,
} from "../../coach/teachClient";
import { BoardView } from "../../components/BoardView";

// ── Casi di test ──────────────────────────────────────────────────────────────

interface TestCase {
  label: string;
  input: MoveReasonInput;
  note?: string;
}

const TEST_CASES: TestCase[] = [
  {
    label: "Pezzo in presa (LPDO)",
    input: {
      fenBefore: "6k1/2b1pp1p/3p4/4N3/8/8/PPP2PPP/3Q1RK1 w - - 0 1",
      myColor: "white",
      playedSan: "Qd3",
      bestSan: "Nf3",
    },
    note: "Il cavallo bianco in e5 è attaccato dal pedone d6 e indifeso. Qd3 lo ignora; Nf3 lo salva. Atteso: hung_piece cavallo e5, best.effect='save', floor + lezione ricca.",
  },
  {
    label: "Cattura gratis mancata",
    input: {
      fenBefore: "6k1/ppp2ppp/8/3n4/2P5/8/PP3PPP/6K1 w - - 0 1",
      myColor: "white",
      playedSan: "h3",
      bestSan: "cxd5",
    },
    note: "Il cavallo nero in d5 è indifeso, attaccato dal pedone c4. h3 è neutro; cxd5 vince il cavallo. Atteso: hung_piece null (e' il pezzo del nemico), best.effect='capture', floor + lezione 'avevi cxd5 gratis'.",
  },
];

// ── Stato per singolo caso ─────────────────────────────────────────────────────

type LessonState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; text: string | null };

// ── Componente singolo caso ────────────────────────────────────────────────────

function CaseBlock({ tc }: { tc: TestCase }) {
  const { label, input, note } = tc;
  const [lessonState, setLessonState] = useState<LessonState>({ status: "idle" });
  const fetchedRef = useRef(false);

  // Calcoli deterministici sincroni
  const facts: MoveFacts | null = extractMoveFacts(input);
  const principleResult = facts ? selectPrinciple(facts, {}) : null;
  const floor = buildMoveReason(input);

  // Costruisce TeachArgs solo se facts non-null e le mosse sono presenti
  const teachArgs: TeachArgs | null =
    facts && input.playedSan && input.bestSan
      ? buildTeachArgs(input, facts)
      : null;

  useEffect(() => {
    if (!teachArgs || fetchedRef.current) return;
    fetchedRef.current = true;
    setLessonState({ status: "loading" });

    fetchLesson(teachArgs).then((lesson) => {
      setLessonState({ status: "done", text: lesson });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{
        border: "1px solid var(--color-border, #333)",
        borderRadius: 8,
        padding: "1.25rem 1.5rem",
        marginBottom: "2rem",
        background: "var(--color-surface, #1a1a1a)",
      }}
    >
      {/* Header caso */}
      <h2
        style={{
          fontFamily: "var(--font-display, serif)",
          fontSize: "1.2rem",
          color: "var(--color-gold, #c9a84c)",
          marginBottom: "0.5rem",
        }}
      >
        {label}
      </h2>

      {note && (
        <p
          style={{
            fontSize: "0.78rem",
            color: "var(--color-muted, #888)",
            marginBottom: "1rem",
            fontStyle: "italic",
          }}
        >
          {note}
        </p>
      )}

      {/* Scacchiera miniatura + dettagli posizione */}
      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <div style={{ flexShrink: 0 }}>
          <BoardView
            fen={input.fenBefore}
            size={200}
            orientation={input.myColor}
          />
        </div>
        <div style={{ fontSize: "0.82rem", color: "var(--color-text, #e0e0e0)", lineHeight: 1.7 }}>
          <div>
            <strong>FEN:</strong>{" "}
            <code style={{ fontSize: "0.75rem", color: "var(--color-muted, #888)", wordBreak: "break-all" }}>
              {input.fenBefore}
            </code>
          </div>
          <div><strong>Colore:</strong> {input.myColor}</div>
          <div><strong>Mossa giocata:</strong> {input.playedSan ?? "—"}</div>
          <div><strong>Mossa giusta:</strong> {input.bestSan ?? "—"}</div>
          {input.motif && <div><strong>Motif:</strong> {input.motif}</div>}
          {input.phase && <div><strong>Fase:</strong> {input.phase}</div>}
        </div>
      </div>

      <hr style={{ border: "none", borderTop: "1px solid var(--color-border, #333)", margin: "1rem 0" }} />

      {/* 1. FATTI */}
      <Section title="Fatti (extractMoveFacts)">
        {facts === null ? (
          <Badge color="#c0392b">nessun fatto estraibile</Badge>
        ) : (
          <FactsTable facts={facts} />
        )}
      </Section>

      {/* 2. PRINCIPIO */}
      <Section title="Principio (selectPrinciple)">
        {!facts ? (
          <span style={{ color: "var(--color-muted, #888)" }}>non calcolabile (facts null)</span>
        ) : principleResult === null ? (
          <Badge color="#c0392b">nessun principio trovato</Badge>
        ) : (
          <div style={{ fontSize: "0.85rem", lineHeight: 1.7 }}>
            <div>
              <strong>id:</strong>{" "}
              <code style={{ color: "var(--color-gold, #c9a84c)" }}>{principleResult.principle.id}</code>
            </div>
            <div><strong>nome:</strong> {principleResult.principle.name_it}</div>
            <div><strong>idea:</strong> {principleResult.principle.idea_it}</div>
            <div><strong>score:</strong> {principleResult.score.toFixed(2)}</div>
            {principleResult.signals_matched.length > 0 && (
              <div>
                <strong>segnali:</strong>{" "}
                {principleResult.signals_matched.map((s) => (
                  <Badge key={s} color="#2c4a2c" textColor="#7ecf7e" style={{ marginRight: 4 }}>
                    {s}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 3. FLOOR */}
      <Section title="Floor (buildMoveReason)">
        {floor === null ? (
          <Badge color="#c0392b">null — nessuna frase deterministica</Badge>
        ) : (
          <blockquote
            style={{
              margin: 0,
              padding: "0.5rem 1rem",
              borderLeft: "3px solid var(--color-gold, #c9a84c)",
              fontStyle: "italic",
              color: "var(--color-text, #e0e0e0)",
            }}
          >
            {floor}
          </blockquote>
        )}
      </Section>

      {/* 4. MAESTRO */}
      <Section title="Maestro (fetchLesson — richiede coach-llm deployata)">
        {teachArgs === null ? (
          <Badge color="#c0392b">teachArgs null — mancano mosse o facts</Badge>
        ) : lessonState.status === "idle" ? (
          <span style={{ color: "var(--color-muted, #888)" }}>in attesa...</span>
        ) : lessonState.status === "loading" ? (
          <span style={{ color: "var(--color-muted, #888)" }}>carico...</span>
        ) : lessonState.text === null ? (
          <div>
            <Badge color="#7a5c1a">nessuna lezione: floor</Badge>
            <div style={{ fontSize: "0.75rem", color: "var(--color-muted, #888)", marginTop: 4 }}>
              Controlla la console per <code>[teachClient]</code> per dettagli sull'errore.
            </div>
          </div>
        ) : (
          <blockquote
            style={{
              margin: 0,
              padding: "0.75rem 1.25rem",
              borderLeft: "3px solid var(--color-brand-soft, #8b6c42)",
              fontStyle: "italic",
              color: "var(--color-text, #e0e0e0)",
              lineHeight: 1.7,
              whiteSpace: "pre-wrap",
            }}
          >
            {lessonState.text}
          </blockquote>
        )}
      </Section>
    </div>
  );
}

// ── Sotto-componenti di supporto ──────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: "1rem" }}>
      <div
        style={{
          fontSize: "0.68rem",
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--color-muted, #888)",
          marginBottom: "0.35rem",
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Badge({
  color,
  textColor = "#fff",
  children,
  style,
}: {
  color: string;
  textColor?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        background: color,
        color: textColor,
        borderRadius: 4,
        padding: "1px 8px",
        fontSize: "0.78rem",
        fontWeight: 600,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function FactsTable({ facts }: { facts: MoveFacts }) {
  return (
    <div style={{ fontSize: "0.85rem", lineHeight: 1.8 }}>
      <div>
        <strong>hung_piece:</strong>{" "}
        {facts.hung_piece ? (
          <Badge color="#2c3e50">
            {facts.hung_piece.type} in {facts.hung_piece.square}
          </Badge>
        ) : (
          <span style={{ color: "var(--color-muted, #888)" }}>nessuno</span>
        )}
      </div>
      <div>
        <strong>punishment:</strong>{" "}
        {facts.punishment ? (
          <Badge color="#2c3e50">
            {facts.punishment.capture_san} ({facts.punishment.capturer_type} x {facts.punishment.victim_square})
          </Badge>
        ) : (
          <span style={{ color: "var(--color-muted, #888)" }}>nessuno</span>
        )}
      </div>
      <div>
        <strong>best:</strong>{" "}
        {facts.best ? (
          <span>
            <Badge color="#1a3a1a" textColor="#7ecf7e" style={{ marginRight: 6 }}>
              {facts.best.san}
            </Badge>
            <Badge color="#1a2a3a" textColor="#7eb8cf" style={{ marginRight: 6 }}>
              effect: {facts.best.effect}
            </Badge>
            {facts.best.captured_type && (
              <Badge color="#3a1a1a" textColor="#cf7e7e">
                cattura: {facts.best.captured_type}
              </Badge>
            )}
          </span>
        ) : (
          <span style={{ color: "var(--color-muted, #888)" }}>null</span>
        )}
      </div>
      <div>
        <strong>motif:</strong>{" "}
        {facts.motif ?? <span style={{ color: "var(--color-muted, #888)" }}>null</span>}
      </div>
      <div>
        <strong>played_san:</strong>{" "}
        {facts.played_san ?? <span style={{ color: "var(--color-muted, #888)" }}>null</span>}
      </div>
    </div>
  );
}

// ── Pagina principale ─────────────────────────────────────────────────────────

export function TeachTest() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg, #111)",
        padding: "2rem 1.5rem",
        boxSizing: "border-box",
      }}
    >
      {/* Intestazione */}
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div
          style={{
            fontSize: "0.68rem",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--color-muted, #888)",
            marginBottom: "0.25rem",
          }}
        >
          Dev / Diagnosi
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display, serif)",
            fontSize: "1.75rem",
            color: "var(--color-text, #e0e0e0)",
            marginBottom: "0.5rem",
          }}
        >
          Voce Maestro — Test
        </h1>
        <div
          style={{
            background: "var(--color-surface, #1a1a1a)",
            border: "1px solid var(--color-border, #333)",
            borderLeft: "3px solid var(--color-brand-soft, #8b6c42)",
            borderRadius: 6,
            padding: "0.75rem 1rem",
            fontSize: "0.82rem",
            color: "var(--color-muted, #888)",
            marginBottom: "2rem",
            lineHeight: 1.6,
          }}
        >
          Pagina di test. Richiede: login attivo + coach-llm deployata. Il <strong>MAESTRO</strong> appare solo dopo il deploy.
          <br />
          Floor e Fatti funzionano offline (deterministici, zero LLM).
        </div>

        {/* Casi */}
        {TEST_CASES.map((tc) => (
          <CaseBlock key={tc.label} tc={tc} />
        ))}
      </div>
    </div>
  );
}
