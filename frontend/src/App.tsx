import { useEffect, useState } from "react";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import type { PlayerModel } from "./types";
import { loadPlayerModel } from "./data";
import { Home } from "./pages/Home";
import { Cruscotto } from "./pages/Cruscotto";
import { Storia } from "./pages/Storia";
import { Repertorio } from "./pages/Repertorio";

/**
 * Root router.
 *
 * Modello mentale: chesspath è un'app di training quotidiano. La home `/`
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

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-bg, #0a0c18)" }}>
        <div className="surface surface-padded max-w-xl">
          <div className="label-eyebrow text-rose-300 mb-2">Dati non disponibili</div>
          <p className="text-[color:var(--color-text-soft)] leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  if (!pm) {
    return (
      <div className="min-h-screen flex items-center justify-center text-[color:var(--color-muted)]" style={{ background: "var(--color-bg, #0a0c18)" }}>
        <div className="text-center">
          <div className="label-eyebrow text-[color:var(--color-brand-soft)]">chesspath</div>
          <div className="text-sm mt-2">Carico il player model…</div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home pm={pm} />} />
        <Route path="/cruscotto" element={<Cruscotto pm={pm} />} />
        <Route path="/storia" element={<Storia pm={pm} />} />
        <Route path="/repertorio" element={<Repertorio pm={pm} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
