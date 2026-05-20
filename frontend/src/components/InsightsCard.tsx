export function InsightsCard({ insights }: { insights: string[] }) {
  if (!insights || insights.length === 0) return null;
  return (
    <div className="card mt-5 relative overflow-hidden">
      <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-[color:var(--color-brand)] opacity-10 blur-2xl pointer-events-none" />
      <div className="card-title">Cosa dicono i tuoi dati</div>
      <ul className="mt-3 space-y-2">
        {insights.map((s, i) => (
          <li key={i} className="flex gap-3 text-slate-200 leading-relaxed">
            <span
              className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: "var(--color-brand-soft)" }}
            />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
