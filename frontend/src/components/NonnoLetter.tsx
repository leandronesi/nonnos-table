/**
 * NonnoLetter — la lettera piegata del Nonno.
 *
 * Una piega 3D su un unico asse (transform-origin: bottom del flap).
 * Stato chiuso: la meta' alta (flap) copre la meta' bassa (body).
 * Click/tap: il flap ruota di -178deg in 1600ms verso l'alto e svanisce
 * negli ultimi 20% del viaggio. La body cresce via grid-rows trick (0fr -> 1fr).
 *
 * Reduced-motion: la lettera parte gia' aperta, il seen viene salvato al mount.
 */

import React, { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "../lib/motion";

interface NonnoLetterProps {
  /** Unique identity of this letter (generated_at or djb2 hash of voice). Used for localStorage. */
  identity: string;
  /** Called when the user opens the letter (to persist "seen" in localStorage). */
  onOpen: () => void;
  /** Content rendered inside the opened letter body. */
  children: React.ReactNode;
}

export function NonnoLetter({ identity: _identity, onOpen, children }: NonnoLetterProps) {
  const reduced = prefersReducedMotion();
  const [open, setOpen] = useState(reduced);
  // Whether to mount children yet (delay until flap is almost done, or immediately with reduced-motion)
  const [showContent, setShowContent] = useState(reduced);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // With reduced-motion: mark as seen immediately at mount.
  useEffect(() => {
    if (reduced) {
      onOpen();
    }
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  // onOpen is stable (defined inline in TavoloHome as a useCallback or arrow; we suppress exhaustive-deps here intentionally)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleOpen() {
    if (open) return;
    setOpen(true);
    onOpen();
    // Mount the content just before the flap finishes rotating (~1200ms into 1600ms)
    timerRef.current = setTimeout(() => {
      setShowContent(true);
    }, 1200);
  }

  return (
    <div className="letter-scene">
      {/* Container is a div, NOT a button: when open it holds the greeting CTA,
          and nested interactive elements are invalid HTML / broken for AT.
          The interactive element is a transparent full-area button that only
          exists while the letter is closed. */}
      <div className="letter" data-open={open ? "true" : "false"}>
        {/* Body — lower half, always visible. Grows via grid-rows when open. */}
        <div className="letter-body">
          {/* Content wrapper: grid expansion trick for height: auto */}
          <div className="letter-body-inner">
            {showContent && children}
          </div>
        </div>

        {/* Flap — upper half, folds backward on click. aria-hidden: decorative. */}
        <div className="letter-flap" aria-hidden="true">
          {/* Front face (visible when closed): eyebrow + serif greeting */}
          <div className="letter-flap-front">
            <span className="letter-flap-eyebrow">Nonno</span>
            <span className="letter-flap-greeting">Per te.</span>
          </div>
        </div>

        {/* Full-area opener — unmounts once the letter is open */}
        {!open && (
          <button
            className="letter-open-btn"
            aria-label="Apri la lettera del Nonno"
            onClick={handleOpen}
          />
        )}
      </div>
    </div>
  );
}
