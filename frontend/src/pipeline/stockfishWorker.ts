/**
 * Stockfish driver "headless" — non-hook, usabile da pipeline batch.
 *
 * Stesso WASM di useStockfish.ts, ma esposto come classe singleton riusabile
 * fuori da React. Serve all'analyze pipeline che processa N partite in batch.
 *
 * Una singola istanza, serializzazione FIFO interna (Stockfish gestisce
 * UNA search alla volta).
 */

export interface MultiPVLine {
  scoreCp: number | null;
  mate: number | null;
  moveUci: string | null;
}

export interface BatchEvalResult {
  scoreCp: number | null;
  mate: number | null;
  bestMoveUci: string | null;
  depth: number;
  /** MultiPV lines ordered by index (lines[0] = multipv 1 = best).
   *  Fallback: single-element array mirroring scoreCp/mate/bestMoveUci. */
  lines: MultiPVLine[];
}

const ENGINE_PATH = `${import.meta.env.BASE_URL || "/"}engine/stockfish-18-lite-single.js`;

/** Maximum ms allowed for a single evaluate() call before the worker is restarted. */
const EVAL_TIMEOUT_MS = 12000;

export class StockfishEngine {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  private current: BatchEvalResult = {
    scoreCp: null,
    mate: null,
    bestMoveUci: null,
    depth: 0,
    lines: [],
  };
  /** Accumulates MultiPV lines keyed by multipv index (1-based) during search. */
  private currentLines: Map<number, MultiPVLine> = new Map();
  private pendingResolve: ((r: BatchEvalResult) => void) | null = null;
  private pendingReject: ((e: Error) => void) | null = null;

  /** Terminate the current worker and reset all state so the next
   *  waitReady() → init() call spins up a fresh instance. */
  private restartWorker() {
    try { this.worker?.terminate(); } catch { /* ignore */ }
    this.worker = null;
    this.readyPromise = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.currentLines = new Map();
  }

  private init() {
    if (this.worker) return;
    const w = new Worker(ENGINE_PATH);
    this.worker = w;

    this.readyPromise = new Promise<void>((resolve) => {
      let resolved = false;
      w.onmessage = (e: MessageEvent<string>) => {
        const line = typeof e.data === "string" ? e.data : "";
        if (!line) return;
        if (line === "uciok") {
          w.postMessage("isready");
          return;
        }
        if (line === "readyok" && !resolved) {
          resolved = true;
          // Set MultiPV once, right after engine is ready.
          w.postMessage("setoption name MultiPV value 2");
          resolve();
          return;
        }
        if (line.startsWith("info ")) {
          this.parseInfo(line);
          return;
        }
        if (line.startsWith("bestmove ")) {
          const parts = line.split(/\s+/);
          this.current.bestMoveUci =
            parts[1] && parts[1] !== "(none)" ? parts[1] : null;
          // Build ordered lines array from accumulated MultiPV data.
          if (this.currentLines.size > 0) {
            const maxIdx = Math.max(...this.currentLines.keys());
            const linesArr: MultiPVLine[] = [];
            for (let k = 1; k <= maxIdx; k++) {
              const l = this.currentLines.get(k);
              if (l) linesArr.push(l);
            }
            this.current.lines = linesArr;
          }
          // Fallback: if no multipv lines parsed, synthesise one from best.
          if (this.current.lines.length === 0) {
            this.current.lines = [{
              scoreCp: this.current.scoreCp,
              mate: this.current.mate,
              moveUci: this.current.bestMoveUci,
            }];
          }
          // Resolve via the wrapper stored in pendingResolve; the wrapper
          // handles clearTimeout + settled flag internally.
          const resolveFn = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingReject = null;
          if (resolveFn) resolveFn({ ...this.current });
        }
      };
      w.onerror = (err) => {
        // eslint-disable-next-line no-console
        console.error("[sf] worker error", err);
        const rejectFn = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        this.restartWorker();
        if (rejectFn) rejectFn(new Error("stockfish worker error"));
      };
      w.postMessage("uci");
    });
  }

  private parseInfo(line: string) {
    const d = line.match(/depth (\d+)/);
    if (d) this.current.depth = Number(d[1]);

    // Detect multipv index (if present).
    const mpvMatch = line.match(/\bmultipv (\d+)\b/);
    const mpvIdx = mpvMatch ? Number(mpvMatch[1]) : null;

    // Parse score.
    let lineCp: number | null = null;
    let lineMate: number | null = null;
    const cp = line.match(/score cp (-?\d+)/);
    if (cp) {
      lineCp = Number(cp[1]);
    }
    const mate = line.match(/score mate (-?\d+)/);
    if (mate) {
      lineMate = Number(mate[1]);
      lineCp = mate[1].startsWith("-") ? -10000 : 10000;
    }

    // Parse first move from pv.
    const pvMatch = line.match(/\bpv ([a-h][1-8][a-h][1-8][qrbnQRBN]?)/);
    const pvMove = pvMatch ? pvMatch[1] : null;

    if (mpvIdx !== null) {
      // MultiPV line: accumulate per-index.
      this.currentLines.set(mpvIdx, {
        scoreCp: lineCp,
        mate: lineMate,
        moveUci: pvMove,
      });
      // Keep current (multipv 1) in sync with the top-level result.
      if (mpvIdx === 1) {
        if (lineMate !== null) {
          this.current.mate = lineMate;
          this.current.scoreCp = lineCp;
        } else if (lineCp !== null) {
          this.current.scoreCp = lineCp;
          this.current.mate = null;
        }
      }
    } else {
      // No multipv tag (single-pv mode or header line): update current directly.
      if (lineMate !== null) {
        this.current.mate = lineMate;
        this.current.scoreCp = lineCp;
      } else if (lineCp !== null) {
        this.current.scoreCp = lineCp;
        this.current.mate = null;
      }
    }
  }

  async waitReady(): Promise<void> {
    this.init();
    return this.readyPromise!;
  }

  evaluate(fen: string, depth = 12): Promise<BatchEvalResult> {
    const next = (async () => {
      await this.queue.catch(() => undefined);
      await this.waitReady();
      const w = this.worker!;
      this.current = { scoreCp: null, mate: null, bestMoveUci: null, depth: 0, lines: [] };
      this.currentLines = new Map();
      return new Promise<BatchEvalResult>((resolve, reject) => {
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.pendingResolve = null;
          this.pendingReject = null;
          // eslint-disable-next-line no-console
          console.warn("[sf] eval timeout, riavvio worker");
          this.restartWorker();
          reject(new Error("stockfish eval timeout"));
        }, EVAL_TIMEOUT_MS);

        // Wrapper stored on the instance; called by the bestmove handler.
        this.pendingResolve = (r: BatchEvalResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(r);
        };

        // Stored so onerror can reject the outstanding promise.
        this.pendingReject = (e: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(e);
        };

        w.postMessage("ucinewgame");
        w.postMessage(`position fen ${fen}`);
        w.postMessage(`go depth ${depth}`);
      });
    })();
    this.queue = next;
    return next;
  }

  destroy() {
    try {
      this.worker?.postMessage("quit");
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
    this.readyPromise = null;
    this.pendingResolve = null;
    this.pendingReject = null;
  }
}

let singleton: StockfishEngine | null = null;
export function getStockfishEngine(): StockfishEngine {
  if (!singleton) singleton = new StockfishEngine();
  return singleton;
}

export function disposeStockfishEngine() {
  singleton?.destroy();
  singleton = null;
}

/**
 * Creates a pool of N independent StockfishEngine instances.
 * Each engine has its own Worker, queue, and state — fully isolated.
 * Call waitReady() on each before use; call destroy() when done.
 */
export function createStockfishPool(size: number): StockfishEngine[] {
  return Array.from({ length: Math.max(1, size) }, () => new StockfishEngine());
}
