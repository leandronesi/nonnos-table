import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import type { PlayerModel } from "./types";
import { loadPlayerModel } from "./data";
import { Home } from "./pages/Home";
import { Cruscotto } from "./pages/Cruscotto";
import { Storia } from "./pages/Storia";
import { Repertorio } from "./pages/Repertorio";
import { Patterns } from "./pages/Patterns";
import { PatternDetail } from "./pages/PatternDetail";
import { PatternDrill } from "./pages/PatternDrill";
import { PositionDetail } from "./pages/PositionDetail";
import { Diagnoses } from "./pages/Diagnoses";
import { DiagnosisDetail } from "./pages/DiagnosisDetail";
import { Coach } from "./pages/Coach";
import { StructureDetail } from "./pages/StructureDetail";
import { PRODUCT_NAME } from "./coaching";

/**
 * Root router.
 *
 * Modello mentale: Road to GranPa e' un'app di training quotidiano. La home `/`
 * mostra UNA viewport con la missione di oggi (no scroll). Le 3 destinazioni
 * `/cruscotto`, `/storia`, `/repertorio` sono il deep-dive: ognuna scrolla
 * normalmente e racconta UNA storia.
 */
export function App() {
  const [pm, setPm] = useState<PlayerModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPlayerModel().then(setPm).catch((e) => setError(String(e)));
  }, []);

  function retry() {
    setError(null);
    loadPlayerModel().then(setPm).catch((e) => setError(String(e)));
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-bg)" }}>
        <div className="surface surface-padded max-w-xl">
          <div className="label-eyebrow text-rose-300 mb-2">Dati non disponibili</div>
          <p className="text-[color:var(--color-text-soft)] leading-relaxed">
            Non riesco a leggere il tuo profilo. Controlla la connessione, poi riprova.
          </p>
          <details className="mt-3 text-xs text-[color:var(--color-faint)]">
            <summary className="cursor-pointer">Dettagli tecnici</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono">{error}</pre>
          </details>
          <button onClick={retry} className="btn btn-primary mt-4">Riprova</button>
        </div>
      </div>
    );
  }

  if (!pm) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[color:var(--color-muted)]" style={{ background: "var(--color-bg)" }}>
        <div className="text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">{PRODUCT_NAME}</div>
          <div className="text-sm mt-2">Preparo la scacchiera...</div>
        </div>
      </div>
    );
  }

  // Empty state: profilo vuoto o senza partite analizzate.
  // (Pre-login onboarding sara` un percorso separato in futuro; per ora basta avvisare.)
  const hasGames = (pm.drills?.length ?? 0) + (pm.turning_points?.length ?? 0) > 0;
  if (!hasGames) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-bg)" }}>
        <div className="surface surface-padded max-w-xl text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">{PRODUCT_NAME}</div>
          <h1 className="display-medium mt-3">Ancora niente da rivedere</h1>
          <p className="text-[color:var(--color-text-soft)] mt-3 leading-relaxed">
            Non vedo partite analizzate per il tuo profilo. Lancia <code className="font-mono">python refresh.py</code> per scaricarle da Chess.com e calcolare i pattern, poi torna qui.
          </p>
          <p className="text-xs text-[color:var(--color-faint)] mt-4">
            (Quando il prodotto avrà l'onboarding pre-login, questa schermata ti farà collegare l'account Chess.com e scegliere obiettivo + categoria di tempo.)
          </p>
        </div>
      </div>
    );
  }

  // GH Pages: il sito vive a /Mygotham/. Vite inietta import.meta.env.BASE_URL.
  // BrowserRouter basename vuole il path SENZA trailing slash.
  const basename = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") || undefined;

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<Home pm={pm} />} />
        <Route path="/patterns" element={<Patterns pm={pm} />} />
        <Route path="/patterns/:key" element={<PatternDetail pm={pm} />} />
        <Route path="/patterns/:key/drill" element={<PatternDrill pm={pm} />} />
        <Route path="/positions/:gameId/:ply" element={<PositionDetail pm={pm} />} />
        <Route path="/diagnoses" element={<Diagnoses pm={pm} />} />
        <Route path="/diagnoses/:key" element={<DiagnosisDetail pm={pm} />} />
        <Route path="/coach" element={<Coach pm={pm} />} />
        <Route path="/strutture/:key" element={<StructureDetail pm={pm} />} />
        <Route path="/cruscotto" element={<Cruscotto pm={pm} />} />
        <Route path="/profilo" element={<Cruscotto pm={pm} />} />
        <Route path="/storia" element={<Storia pm={pm} />} />
        <Route path="/repertorio" element={<Repertorio pm={pm} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

