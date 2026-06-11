/**
 * StanzaHome — cantiere Onda P2+Q.
 *
 * Per ora: placeholder full-viewport. Chiama useTavoloData() per verificare
 * che il data layer compili e funzioni come consumer; i dati non sono ancora
 * usati nel render (vengono usati nelle onde successive).
 *
 * NON e' ancora cablata a nessuna route. Il cablaggio avviene in Onda S.
 */

import { useTavoloData } from "./tavolo/useTavoloData";

export function StanzaHome() {
  // Data layer presente: verifica che il hook compili correttamente.
  // Le onde P2/Q useranno questi dati per costruire la scena 3D.
  // Data layer: hook present for future waves (P2/Q). Loading state guards the placeholder.
  const { loading } = useTavoloData();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-ui, sans-serif)",
          fontSize: "0.7rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--color-muted)",
        }}
      >
        La Stanza
      </div>
      <p
        style={{
          fontFamily: "var(--font-voice)",
          fontSize: "1.05rem",
          color: "var(--color-text-soft)",
          margin: 0,
        }}
      >
        {loading ? "Un attimo..." : "Sto apparecchiando."}
      </p>
    </div>
  );
}
