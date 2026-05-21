interface Props {
  id?: string;         // anchor per sidebar scroll-spy
  index: string;       // "01", "02", ...
  eyebrow: string;     // es. "OBIETTIVO"
  title: string;       // headline grossa
  sub?: string;
  children: React.ReactNode;
  delay?: number;      // 1..7 per stagger animazione
}

/**
 * Section editoriale numerata.
 * Pattern usato da molti prodotti "premium" (Linear, Vercel, Stripe):
 * un'etichetta-eyebrow piccola + numero, un titolo grande, una riga di sub,
 * poi il contenuto. La numerazione crea similarity tra le sezioni (Gestalt)
 * e dà ritmo allo scroll.
 */
export function Section({ id, index, eyebrow, title, sub, children, delay }: Props) {
  const delayClass = delay ? `fade-in-delay-${Math.min(delay, 7)}` : "";
  return (
    <section id={id} className={`section fade-in scroll-mt-8 ${delayClass}`}>
      <div className="section-eyebrow">
        <span className="section-number">{index} ·</span>
        <span className="label-eyebrow">{eyebrow}</span>
      </div>
      <h2 className="section-title">{title}</h2>
      {sub && <p className="section-sub">{sub}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}
