import { useEffect, useState } from "react";

interface NavItem {
  id: string;
  num: string;
  label: string;
}

const NAV_TRAIN: NavItem[] = [
  { id: "today", num: "·", label: "Sessione di oggi" },
  { id: "trainer", num: "01", label: "Trainer" },
  { id: "play", num: "02", label: "Gioca dal blunder" },
];

const NAV_DIAGNOSE: NavItem[] = [
  { id: "focus", num: "03", label: "Focus settimanale" },
  { id: "diagnoses", num: "04", label: "Diagnosi" },
  { id: "decisions", num: "05", label: "Decisioni" },
];

const NAV_DEEP: NavItem[] = [
  { id: "grafici", num: "06", label: "Grafici" },
  { id: "time", num: "07", label: "Time management" },
  { id: "blindspots", num: "08", label: "Blind spots" },
  { id: "turning", num: "09", label: "Turning points" },
  { id: "glossary", num: "·", label: "Glossario" },
];

export function Sidebar({ username, lastUpdate }: { username: string; lastUpdate: string }) {
  const [active, setActive] = useState<string>("today");

  // Sticky scroll spy: trova quale sezione è in vista
  useEffect(() => {
    const ids = [...NAV_TRAIN, ...NAV_DIAGNOSE, ...NAV_DEEP].map((n) => n.id);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActive(e.target.id);
            break;
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <aside className="sidebar">
      {/* Brand */}
      <div className="brand">
        <div className="brand-mark">♚</div>
        <div>
          <div className="brand-name">Chess Coach</div>
          <div className="brand-sub">{username}</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="nav">
        <div className="nav-section-label">Allenamento</div>
        {NAV_TRAIN.map((n) => (
          <NavLink key={n.id} item={n} active={active === n.id} onClick={() => scrollTo(n.id)} />
        ))}

        <div className="nav-section-label" style={{ marginTop: "0.875rem" }}>Diagnosi</div>
        {NAV_DIAGNOSE.map((n) => (
          <NavLink key={n.id} item={n} active={active === n.id} onClick={() => scrollTo(n.id)} />
        ))}

        <div className="nav-section-label" style={{ marginTop: "0.875rem" }}>Approfondisci</div>
        {NAV_DEEP.map((n) => (
          <NavLink key={n.id} item={n} active={active === n.id} onClick={() => scrollTo(n.id)} />
        ))}
      </nav>

      <div className="sidebar-footer">
        v2 · aggiornato<br />{lastUpdate}
      </div>
    </aside>
  );
}

function NavLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <a
      href={`#${item.id}`}
      className={`nav-item ${active ? "active" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <span className="nav-item-num">{item.num}</span>
      <span>{item.label}</span>
    </a>
  );
}
