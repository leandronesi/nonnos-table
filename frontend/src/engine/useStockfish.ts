import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Hook React per parlare con Stockfish-18-lite-single in WebWorker.
 *
 * Carico l'engine UNA volta (lazy: alla prima chiamata) e lo riuso per tutta
 * la sessione. Niente backend, niente API esterne: tutta la valutazione gira
 * nel browser, anche su mobile.
 *
 * Uso:
 *   const sf = useStockfish();
 *   await sf.ready();
 *   const ev = await sf.evaluate(fen, { depth: 14 });
 *   // ev = { scoreCp, bestMoveUci, pvUci, mate, depth }
 */

export interface EvalResult {
  scoreCp: number | null;        // in cp dal punto di vista del player al tratto
  mate: number | null;            // matto in N (positivo = chi muove vince) — null se non c'è
  bestMoveUci: string | null;     // es. "e2e4"
  pvUci: string[];                // PV in formato UCI
  depth: number;
}

interface EvalOpts {
  depth?: number;
  movetimeMs?: number;
  multiPV?: number;
  skillLevel?: number;            // 0-20, lasciar 20 per "max"
}

const ENGINE_PATH = `${import.meta.env.BASE_URL || "/"}engine/stockfish-18-lite-single.js`;

export interface StockfishApi {
  ready(): Promise<void>;
  evaluate(fen: string, opts?: EvalOpts): Promise<EvalResult>;
  playMove(fen: string, opts?: EvalOpts): Promise<string | null>;
  stop(): void;
  isReady: boolean;
}

export function useStockfish(): StockfishApi {
  const workerRef = useRef<Worker | null>(null);
  const readyPromiseRef = useRef<Promise<void> | null>(null);
  const pendingResolveRef = useRef<((res: EvalResult) => void) | null>(null);
  const currentEvalRef = useRef<EvalResult>({
    scoreCp: null,
    mate: null,
    bestMoveUci: null,
    pvUci: [],
    depth: 0,
  });
  const [isReady, setIsReady] = useState(false);

  // Lazy init del worker
  const initWorker = useCallback(() => {
    if (workerRef.current) return;
    const w = new Worker(ENGINE_PATH);
    workerRef.current = w;

    w.onmessage = (e: MessageEvent<string>) => {
      const line = typeof e.data === "string" ? e.data : "";
      if (!line) return;

      if (line === "uciok") {
        w.postMessage("isready");
        return;
      }
      if (line === "readyok") {
        setIsReady(true);
        return;
      }
      if (line.startsWith("info ")) {
        // Parse degli "info depth N ... score cp X ... pv ..."
        parseInfo(line, currentEvalRef.current);
      }
      if (line.startsWith("bestmove ")) {
        const parts = line.split(/\s+/);
        currentEvalRef.current.bestMoveUci = parts[1] && parts[1] !== "(none)" ? parts[1] : null;
        if (pendingResolveRef.current) {
          pendingResolveRef.current({ ...currentEvalRef.current });
          pendingResolveRef.current = null;
        }
      }
    };

    w.onerror = (err) => {
      console.error("Stockfish worker error", err);
    };

    // UCI handshake
    w.postMessage("uci");
  }, []);

  // ready() ritorna una promessa che si risolve quando l'engine è pronto
  const ready = useCallback((): Promise<void> => {
    if (isReady) return Promise.resolve();
    if (readyPromiseRef.current) return readyPromiseRef.current;
    initWorker();
    readyPromiseRef.current = new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (isReady) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
    return readyPromiseRef.current;
  }, [isReady, initWorker]);

  // Init worker subito al mount (asincrono, è leggero)
  useEffect(() => {
    initWorker();
    return () => {
      try {
        workerRef.current?.postMessage("quit");
        workerRef.current?.terminate();
      } catch {
        // ignore
      }
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const evaluate = useCallback(
    async (fen: string, opts: EvalOpts = {}): Promise<EvalResult> => {
      await ready();
      const w = workerRef.current;
      if (!w) throw new Error("Stockfish non disponibile");

      const depth = opts.depth ?? 14;
      const movetime = opts.movetimeMs;
      const multiPV = opts.multiPV ?? 1;
      const skill = opts.skillLevel ?? 20;

      // reset eval corrente
      currentEvalRef.current = {
        scoreCp: null,
        mate: null,
        bestMoveUci: null,
        pvUci: [],
        depth: 0,
      };

      return new Promise<EvalResult>((resolve) => {
        pendingResolveRef.current = resolve;
        w.postMessage("ucinewgame");
        w.postMessage(`setoption name MultiPV value ${multiPV}`);
        w.postMessage(`setoption name Skill Level value ${skill}`);
        w.postMessage(`position fen ${fen}`);
        if (movetime) {
          w.postMessage(`go movetime ${movetime}`);
        } else {
          w.postMessage(`go depth ${depth}`);
        }
      });
    },
    [ready],
  );

  const playMove = useCallback(
    async (fen: string, opts: EvalOpts = {}): Promise<string | null> => {
      const ev = await evaluate(fen, opts);
      return ev.bestMoveUci;
    },
    [evaluate],
  );

  const stop = useCallback(() => {
    workerRef.current?.postMessage("stop");
  }, []);

  return { ready, evaluate, playMove, stop, isReady };
}

// Parsing helper: aggiorna `target` con le info correnti dell'engine
function parseInfo(line: string, target: EvalResult): void {
  const m = line.match(/depth (\d+)/);
  if (m) target.depth = Number(m[1]);
  const cp = line.match(/score cp (-?\d+)/);
  if (cp) {
    target.scoreCp = Number(cp[1]);
    target.mate = null;
  }
  const mate = line.match(/score mate (-?\d+)/);
  if (mate) {
    target.mate = Number(mate[1]);
    target.scoreCp = mate[1].startsWith("-") ? -10000 : 10000;
  }
  const pv = line.match(/ pv ([a-h1-8nbrqk =OoQq\-]+?)(\s|$)/);
  if (pv) {
    target.pvUci = pv[1].trim().split(/\s+/);
  }
}
