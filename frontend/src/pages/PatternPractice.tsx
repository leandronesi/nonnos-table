import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import { Link, useSearchParams } from "react-router-dom";
import { BoardView } from "../components/BoardView";
import { useTavoloData } from "./tavolo/useTavoloData";
import { useAuth } from "../auth/AuthContext";
import { getStorageUserScope, scopedStorage } from "../auth/userStorage";
import { PATTERN_CATALOG, type PersonalPattern } from "../pipeline/personalPatterns";
import { StockfishEngine, type BatchEvalResult } from "../pipeline/stockfishWorker";
import { createPatternPractice, gradePracticeMove, practiceAttemptInput, readPatternPractice, type PatternPracticeState, type PracticeResult } from "../session/patternPractice";
import { recordTrainingAttempt, type TrainingAttemptInput } from "../trainingProgress";
import { tr } from "../i18n/lang";
import { patternTitle } from "./PatternLibrary";
import { MovePlayback } from "../components/MovePlayback";
import "./pattern-coach.css";

export interface PracticePersistence {
  read: () => string | null;
  write: (state: string) => boolean;
}

interface PracticeProps {
  pattern: PersonalPattern;
  persistence: PracticePersistence;
  saveAttempt: (input: TrainingAttemptInput) => Promise<{ created_at: string }>;
  evaluate?: (fen: string) => Promise<BatchEvalResult>;
}

export function PatternPracticeView({ pattern, persistence, saveAttempt, evaluate }: PracticeProps) {
  const [state, setState] = useState(() => readPatternPractice(persistence.read(), pattern.id) ?? createPatternPractice(pattern));
  const stateRef = useRef(state);
  const mounted = useRef(true);
  const engine = useRef<StockfishEngine | null>(null);
  const inFlight = useRef(new Set<string>());
  const flushClock = useRef(() => {});
  const [draft, setDraft] = useState("");
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [promotion, setPromotion] = useState("q");
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const position = state.positions[state.index];
  const result = state.results[state.index];
  let draftFen = position?.fen;
  if (position && draft) {
    try { const preview = new Chess(position.fen); preview.move(draft); draftFen = preview.fen(); } catch { /* Incomplete keyboard entry. */ }
  }
  const catalog = PATTERN_CATALOG[pattern.kind];

  const update = useCallback((next: PatternPracticeState) => {
    if (!mounted.current) return;
    stateRef.current = next;
    setState(next);
    setStorageError(!persistence.write(JSON.stringify(next)));
  }, [persistence]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; engine.current?.destroy(); engine.current = null; };
  }, []);

  useEffect(() => {
    let since = document.hidden || stateRef.current.phase !== "choosing" ? null : performance.now();
    const tick = () => {
      const now = performance.now();
      if (since !== null && stateRef.current.phase === "choosing") {
        update({ ...stateRef.current, elapsedMs: stateRef.current.elapsedMs + Math.max(0, now - since) });
      }
      since = document.hidden || stateRef.current.phase !== "choosing" ? null : now;
    };
    flushClock.current = tick;
    const timer = setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pagehide", tick);
    return () => {
      tick();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("pagehide", tick);
    };
  }, [state.phase, update]);

  async function syncResult(value: PracticeResult) {
    if (inFlight.current.has(value.attemptId) || value.savedAt) return;
    inFlight.current.add(value.attemptId);
    setSaveError(false);
    try {
      const saved = await saveAttempt(practiceAttemptInput(stateRef.current, value));
      if (!mounted.current) return;
      update({ ...stateRef.current, results: stateRef.current.results.map((r) => r.attemptId === value.attemptId ? { ...r, savedAt: saved.created_at } : r) });
    } catch { if (mounted.current) setSaveError(true); }
    finally { inFlight.current.delete(value.attemptId); }
  }

  async function evaluateFen(fen: string) {
    if (evaluate) return evaluate(fen);
    engine.current ??= new StockfishEngine();
    return engine.current.evaluate(fen, 12);
  }

  function chooseMove(from: string, to: string): boolean {
    if (stateRef.current.phase !== "choosing" || evaluating) return false;
    try {
      const board = new Chess(position.fen);
      const move = board.move({ from, to, promotion });
      if (!move) return false;
      setDraft(move.san);
      setSelectedSquare(null);
      setError(null);
      return true;
    } catch { return false; }
  }

  async function submitMove() {
    if (evaluating || stateRef.current.phase !== "choosing") return;
    if (!stateRef.current.preparation) {
      setError(tr("Indica prima come vuoi affrontare la scelta.", "First indicate how you want to approach the choice."));
      return;
    }
    let board: Chess;
    let move;
    try {
      board = new Chess(position.fen);
      const entered = draft.trim().replace(/^C(?=[a-h1-8x])/, "N").replace(/^A(?=[a-h1-8x])/, "B")
        .replace(/^T(?=[a-h1-8x])/, "R").replace(/^D(?=[a-h1-8x])/, "Q");
      move = board.move(entered);
      if (!move) throw new Error("illegal");
    } catch {
      setError(tr("La mossa non è legale. Tocca partenza e arrivo oppure scrivila in notazione, ad esempio Cf3 (Nf3).", "That move is not legal. Tap its starting and ending squares or enter notation, for example Nf3."));
      return;
    }
    flushClock.current();
    const decision = stateRef.current;
    update({ ...decision, phase: "ready" });
    setEvaluating(true);
    setError(null);
    try {
      const before = await evaluateFen(position.fen);
      // Terminal positions are established by chess rules, even when an engine
      // returns no searched line or depth for them.
      const after: BatchEvalResult = board.isGameOver()
        ? { scoreCp: 0, mate: board.isCheckmate() ? 0 : null, depth: 12, bestMoveUci: null, pvUci: null, lines: [] }
        : await evaluateFen(board.fen());
      if (!mounted.current) return;
      const grading = gradePracticeMove(before, after);
      const value: PracticeResult = {
        attemptId: crypto.randomUUID(), positionId: position.id, playedUci: move.lan,
        playedSan: move.san, resultingFen: board.fen(), bestUci: before.bestMoveUci,
        replyUci: after.bestMoveUci,
        bestLine: before.pvUci?.trim().split(/\s+/).slice(0, 2),
        ...grading, responseMs: decision.elapsedMs, preparation: decision.preparation!,
        usedHint: decision.usedHint, savedAt: null,
      };
      const next = { ...decision, phase: "feedback" as const, results: [...decision.results, value] };
      update(next);
      void syncResult(value);
    } catch {
      if (mounted.current) setError(tr("Non riesco a verificare la mossa adesso. Il tentativo non è stato valutato: puoi riprendere e riprovare.", "I cannot verify the move now. The attempt was not graded: resume and try again."));
    } finally { if (mounted.current) setEvaluating(false); }
  }

  function nextPosition() {
    const current = stateRef.current;
    update(current.index + 1 >= current.positions.length ? { ...current, phase: "complete" }
      : { ...current, index: current.index + 1, phase: "ready", elapsedMs: 0, preparation: null, usedHint: false });
    setDraft(""); setSelectedSquare(null); setError(null);
  }

  const pending = state.results.filter((r) => !r.savedAt);
  return <div className="pattern-coach practice-page">
    <Link className="pattern-back" to={`/quaderno?pattern=${encodeURIComponent(pattern.id)}`}>← {tr("Torna al pattern", "Back to pattern")}</Link>
    <p className="pattern-kicker">{tr("Allenamento personale", "Personal practice")}</p>
    <h1>{patternTitle(pattern)}</h1>
    {storageError && <p role="alert">{tr("Questo browser non sta salvando la sessione sul dispositivo. Rimani sulla pagina fino al salvataggio del risultato.", "This browser is not saving the session on this device. Stay on the page until the result is saved.")}</p>}
    {!position ? <p>{tr("Non ci sono ancora posizioni utilizzabili per questo pattern. Aggiorna le partite dal quaderno.", "There are no usable positions for this pattern yet. Refresh games from the notebook.")}</p>
      : state.phase === "complete" ? <section className="pattern-focus">
        <p className="pattern-kicker">{tr("Sessione conclusa", "Session complete")}</p>
        <h2>{tr("Adesso portalo in partita.", "Now take it into a game.")}</h2>
        <p>{state.results.filter((r) => r.verdict !== "wrong").length} / {state.results.length} {tr("decisioni hanno mantenuto una qualità accettabile secondo il motore.", "decisions maintained acceptable quality according to the engine.")}</p>
        <p>{tr(catalog.action, catalog.actionEn)}</p>
        <p className="pattern-muted">{tr("Risolvere queste posizioni è pratica. Verificheremo il comportamento nelle occasioni nuove delle partite successive.", "Solving these positions is practice. We will check your behavior in new opportunities from later games.")}</p>
        <Link className="pattern-primary" to="/progressi">{tr("Guarda il percorso", "View progress")}</Link>
        <div className="pattern-actions"><button type="button" disabled={pending.length > 0} onClick={() => update(createPatternPractice(pattern))}>{tr("Ripassa queste posizioni", "Revisit these positions")}</button></div>
      </section> : <>
        <div className="practice-toolbar"><span>{tr("Posizione", "Position")} {state.index + 1} / {state.positions.length}</span>
          <span>{tr("Tempo di decisione", "Decision time")}: <strong>{Math.floor(state.elapsedMs / 1000)} s</strong></span></div>
        {state.phase === "ready" ? <section className="pattern-focus">
          <h2>{evaluating ? tr("Verifico la tua scelta…", "Checking your choice…") : state.elapsedMs > 0 ? tr("Riprendiamo da qui.", "Let's resume here.") : tr("Prima riconosci. Poi scegli.", "Recognize first. Then choose.")}</h2>
          <p>{tr(catalog.action, catalog.actionEn)}</p>
          <p className="pattern-muted">{tr("Il tempo parte quando apri la posizione e si ferma se cambi scheda o metti in pausa. Non devi aspettare un numero prefissato di secondi.", "Time starts when you open the position and stops when you switch tabs or pause. There is no fixed number of seconds you must wait.")}</p>
          <button type="button" className="pattern-primary" disabled={evaluating} onClick={() => update({ ...stateRef.current, phase: "choosing" })}>{tr("Osserva la posizione", "View position")}</button>
        </section> : <div className="practice-layout">
          <div className="pattern-board">
            {state.phase === "choosing" && <div className="practice-position-context">
              <p className="pattern-kicker">{position.color === "white" ? tr("Muove il Bianco", "White to move") : tr("Muove il Nero", "Black to move")}</p>
              {position.timing.clockBeforeSeconds !== null && <p>{tr("In partita avevi", "In the game you had")} <strong>{Math.floor(position.timing.clockBeforeSeconds / 60)}:{String(Math.floor(position.timing.clockBeforeSeconds % 60)).padStart(2, "0")}</strong> {tr("a disposizione.", "available.")}</p>}
            </div>}
            {state.phase === "feedback" ? <MovePlayback key={result.attemptId} fen={position.fen} orientation={position.color} initialPly={1}
              lines={[{ label: tr("La tua mossa", "Your move"), moves: [result.playedUci, result.replyUci] },
                ...(result.bestUci ? [{ label: tr("Alternativa del motore", "Engine alternative"), moves: result.bestLine?.[0] === result.bestUci ? result.bestLine : [result.bestUci] }] : [])]} /> :
            <BoardView fen={draftFen ?? position.fen} animate resetKey={position.id} size={520} orientation={position.color}
            draggable={state.phase === "choosing"} onPieceDrop={(from, to) => chooseMove(from, to)}
            highlights={selectedSquare ? [{ square: selectedSquare, color: "#c28b40" }] : []}
            onSquareClick={state.phase === "choosing" ? (square) => {
              if (!selectedSquare || !chooseMove(selectedSquare, square)) setSelectedSquare(square);
            } : undefined} />}</div>
          <div className="practice-decision">
            {state.phase === "choosing" ? <>
              <fieldset className="practice-preparation"><legend>{tr("Come affronti questa scelta?", "How will you approach this choice?")}</legend>
                <button type="button" aria-pressed={state.preparation === "check"} onClick={() => update({ ...stateRef.current, preparation: "check" })}>{tr("Mi fermo a controllare", "I will stop and check")}</button>
                <button type="button" aria-pressed={state.preparation === "ready"} onClick={() => update({ ...stateRef.current, preparation: "ready" })}>{tr("Ho già una candidata", "I have a candidate")}</button>
              </fieldset>
              <p>{tr("Tocca il pezzo e la casa di arrivo. Conferma quando hai scelto.", "Tap the piece and destination square. Confirm when you have chosen.")}</p>
              <form onSubmit={(event) => { event.preventDefault(); void submitMove(); }}>
                <details><summary>{tr("Usa la tastiera", "Use the keyboard")}</summary><label htmlFor="practice-move">{tr("La tua mossa (notazione SAN)", "Your move (SAN notation)")}</label>
                <input id="practice-move" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Nf3" autoComplete="off" autoCapitalize="off" spellCheck={false} /></details>
                {new Chess(position.fen).moves({ verbose: true }).some((m) => m.promotion) && <label>{tr("Promozione", "Promotion")}<select value={promotion} onChange={(e) => {
                    const next = e.target.value; setPromotion(next);
                    try {
                      const candidate = new Chess(position.fen).move(draft);
                      if (candidate?.promotion) {
                        const board = new Chess(position.fen);
                        const changed = board.move({ from: candidate.from, to: candidate.to, promotion: next });
                        if (changed) setDraft(changed.san);
                      }
                    } catch { /* Promotion can also be chosen before moving. */ }
                  }}>
                  <option value="q">{tr("Donna", "Queen")}</option><option value="r">{tr("Torre", "Rook")}</option><option value="b">{tr("Alfiere", "Bishop")}</option><option value="n">{tr("Cavallo", "Knight")}</option>
                </select></label>}
                {draft && <button type="button" onClick={() => { setDraft(""); setSelectedSquare(null); }}>{tr("Cambia mossa", "Change move")}</button>}
                <button type="submit" className="pattern-primary" disabled={!draft.trim()}>{tr("Conferma la scelta", "Confirm choice")}</button>
              </form>
              <div className="pattern-actions"><button type="button" onClick={() => { flushClock.current(); update({ ...stateRef.current, phase: "ready" }); }}>{tr("Pausa", "Pause")}</button>
                <button type="button" onClick={() => update({ ...stateRef.current, usedHint: true })}>{tr("Un aiuto", "A hint")}</button></div>
              {state.usedHint && <p className="pattern-coach-note">{tr(catalog.action, catalog.actionEn)} {tr("Controlla prima scacchi, catture e minacce di entrambi.", "First check checks, captures and threats for both sides.")}</p>}
            </> : <>
              <p className="pattern-kicker">{tr("La tua decisione", "Your decision")}</p>
              <h2>{result.verdict === "perfect" ? tr("Una scelta solida.", "A sound choice.") : result.verdict === "ok" ? tr("Una scelta giocabile.", "A playable choice.") : tr("C'è qualcosa da rivedere.", "There is something to review.")}</h2>
              <p>{tr("Tempo impiegato", "Time spent")} · {Math.round(result.responseMs / 1000)} s</p>
              {position.timing.spentSeconds !== null && <p>{tr("Nella partita originale avevi deciso in", "In the original game you decided in")} {position.timing.spentSeconds} s.</p>}
              <p>{result.verdict === "wrong"
                ? tr("La risposta perde qualità secondo il motore. Riguarda cosa lascia a disposizione dell'avversario.", "The reply loses quality according to the engine. Revisit what it allows your opponent.")
                : tr("La scelta mantiene la posizione. Se l'hai riconosciuta rapidamente, la velocità non è un difetto.", "The choice preserves the position. If you recognized it quickly, speed is not a fault.")}</p>
              <p className="pattern-muted">{tr("Conta come usi il tempo per decidere, non solo quanti secondi passano. Una durata diversa non dimostra da sola un miglioramento.", "How you use time matters, not just how many seconds pass. A different duration alone does not prove improvement.")}</p>
              <button type="button" className="pattern-primary" onClick={nextPosition}>{state.index + 1 < state.positions.length ? tr("Prossima posizione", "Next position") : tr("Concludi la sessione", "Finish session")}</button>
            </>}
          </div>
        </div>}
      </>}
    {error && <p role="alert">{error}</p>}
    {pending.length > 0 && <div className="practice-save" role="status"><p>{saveError ? tr("Il risultato resta sul dispositivo, ma il salvataggio nell'account non è riuscito.", "The result remains on this device, but account saving failed.") : tr("Risultati in attesa di salvataggio nell'account.", "Results awaiting account saving.")}</p>
      <button type="button" onClick={() => pending.forEach((r) => void syncResult(r))}>{tr("Salva i risultati", "Save results")}</button></div>}
    {state.results.length > 0 && pending.length === 0 && <p className="pattern-muted" role="status">{tr("Risultati salvati nel tuo account.", "Results saved to your account.")}</p>}
  </div>;
}

export function PatternPractice() {
  const data = useTavoloData();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const patternId = params.get("pattern");
  const patterns = data.aggregates?.personal_patterns?.patterns ?? [];
  const selected = patterns.find((p) => p.id === patternId);
  const persistence = useMemo<PracticePersistence>(() => {
    const owner = user?.id;
    const key = `pattern-practice:v1:${patternId}`;
    return {
      read: () => getStorageUserScope() === owner ? scopedStorage.getItem(key) : null,
      write: (raw) => getStorageUserScope() === owner && scopedStorage.setItem(key, raw),
    };
  }, [user?.id, patternId]);
  const save = useCallback((input: TrainingAttemptInput) => recordTrainingAttempt({ ...input, expectedUserId: user?.id }), [user?.id]);
  if (selected) return <PatternPracticeView key={`${user?.id}:${selected.id}`} pattern={selected} persistence={persistence} saveAttempt={save} />;
  return <div className="pattern-coach"><p className="pattern-kicker">{tr("Allenamento personale", "Personal practice")}</p>
    <h1>{tr("Una cosa su cui lavorare.", "One thing to work on.")}</h1>
    <p>{tr("Scegli una situazione delle tue partite. Ci alleniamo sul riconoscimento, sulla mossa e sull'uso del tempo.", "Choose a situation from your games. Practice recognition, move choice and use of time.")}</p>
    {data.loading && <p role="status">{tr("Carico le tue posizioni…", "Loading your positions…")}</p>}
    {data.error && <p role="alert">{data.error}</p>}
    {patternId && !data.loading && <p>{tr("Il pattern richiesto non compare nella lettura attuale. Scegline uno disponibile.", "The requested pattern is not in this report. Choose an available one.")}</p>}
    <div className="pattern-list">{patterns.filter((p) => p.examples.length + p.successfulExamples.length > 0).map((pattern) => <article key={pattern.id}>
      <p className="pattern-kicker">{pattern.games} {tr("partite osservate", "observed games")}</p><h2>{patternTitle(pattern)}</h2>
      <p>{tr(PATTERN_CATALOG[pattern.kind].action, PATTERN_CATALOG[pattern.kind].actionEn)}</p>
      <Link className="pattern-primary" to={`/sessione?pattern=${encodeURIComponent(pattern.id)}`}>{tr("Allenati su questo", "Practice this")}</Link>
    </article>)}</div>
    {!data.loading && !patterns.length && <p>{tr("Servono prima le tue partite per scegliere esercizi pertinenti.", "Your games are needed first to choose relevant exercises.")} <Link to="/quaderno">{tr("Apri il quaderno", "Open notebook")}</Link></p>}
  </div>;
}
