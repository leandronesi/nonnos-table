import { useState, useRef, useEffect } from "react";

/**
 * Help tooltip per acronimi/concetti tecnici.
 *
 * Uso:
 *   <Help text="Average Centipawn Loss: media della perdita di valutazione (in centesimi di pedone) per ogni tua mossa. 0 = perfetto, 100 ≈ un pedone, 250+ = blunder." />
 *   <Help label="ACPL" text="..." />   // mostra il label inline, con (?) accanto
 *
 * Posizionamento: si auto-aggiusta in alto o in basso in base allo spazio disponibile.
 */
interface Props {
  text: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}

export function Help({ text, label, className, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("top");
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPlacement(rect.top < 120 ? "bottom" : "top");
  }, [open]);

  const dim = size === "md" ? "w-4 h-4 text-[11px]" : "w-3.5 h-3.5 text-[10px]";

  return (
    <span
      ref={wrapRef}
      className={"relative inline-flex items-center gap-1 align-middle " + (className || "")}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {label && <span>{label}</span>}
      <button
        type="button"
        tabIndex={0}
        className={
          `${dim} rounded-full border border-[color:var(--color-line)] ` +
          "text-slate-400 hover:text-slate-200 hover:border-slate-400 " +
          "flex items-center justify-center cursor-help select-none transition"
        }
        aria-label="Aiuto"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>

      {open && (
        <span
          role="tooltip"
          className={
            "absolute z-40 left-1/2 -translate-x-1/2 w-64 px-3 py-2 rounded-lg " +
            "border border-[color:var(--color-line)] bg-slate-950 text-slate-200 " +
            "text-xs leading-relaxed shadow-2xl normal-case tracking-normal font-normal " +
            (placement === "top" ? "bottom-full mb-2" : "top-full mt-2")
          }
          style={{ pointerEvents: "none" }}
        >
          {text}
        </span>
      )}
    </span>
  );
}
