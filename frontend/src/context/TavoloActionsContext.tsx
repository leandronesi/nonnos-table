/**
 * TavoloActionsContext — shared handle for "Aggiorna partite" / "Rianalizza da capo".
 *
 * TavoloHome registers the callbacks once mounted; AppShell sidebar consumes them.
 * This avoids duplicating the runRefresh/runFullReanalyze + navigate logic.
 */

import { createContext, useContext, useRef, type ReactNode } from "react";

export interface TavoloActions {
  handleRefresh: () => void;
  handleFullReanalyze: () => void;
}

const Ctx = createContext<React.MutableRefObject<TavoloActions | null> | null>(null);

export function TavoloActionsProvider({ children }: { children: ReactNode }) {
  const ref = useRef<TavoloActions | null>(null);
  return <Ctx.Provider value={ref}>{children}</Ctx.Provider>;
}

/** Returns the mutable ref. Components register by writing to ref.current. */
export function useTavoloActionsRef(): React.MutableRefObject<TavoloActions | null> {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTavoloActionsRef must be inside TavoloActionsProvider");
  return ctx;
}
