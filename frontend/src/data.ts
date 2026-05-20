import type { Metrics } from "./types";

export async function loadMetrics(): Promise<Metrics> {
  // Default: file statico copiato dalla pipeline in frontend/public/metrics.json.
  // Override: VITE_METRICS_URL (es. http://localhost:8000/api/metrics se gira FastAPI).
  // Su gh-pages BASE_URL = '/mygotham/' quindi l'URL diventa '/mygotham/metrics.json'.
  const url = import.meta.env.VITE_METRICS_URL || `${import.meta.env.BASE_URL}metrics.json`;
  const resp = await fetch(url, { cache: "no-store" });
  if (!resp.ok) {
    throw new Error(
      `Impossibile caricare ${url} (${resp.status}). Lancia 'python backend/metrics.py' per generare i dati.`,
    );
  }
  return resp.json();
}
