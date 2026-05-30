// =========================================================
// Progress bar
// =========================================================
(function () {
  const bar = document.getElementById('progress');
  function update() {
    const h = document.documentElement;
    const scrolled = h.scrollTop;
    const max = h.scrollHeight - h.clientHeight;
    const pct = max > 0 ? (scrolled / max) * 100 : 0;
    bar.style.width = pct + '%';
  }
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  update();
})();

// =========================================================
// Active section highlight in side nav
// =========================================================
(function () {
  const links = document.querySelectorAll('.nav a[href^="#"]');
  const map = new Map();
  links.forEach(a => {
    const id = a.getAttribute('href').slice(1);
    const el = document.getElementById(id);
    if (el) map.set(el, a);
  });
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      const link = map.get(e.target);
      if (!link) return;
      if (e.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      }
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
  map.forEach((_, el) => observer.observe(el));
})();

// =========================================================
// Gift download — usa il payload embeddato (window.__GIFT_MD) per generare
// il download del CLAUDE.md anche quando il deck e' spedito come singolo
// file HTML, senza il file CLAUDE.md a fianco.
// =========================================================
(function () {
  const btn = document.getElementById('gift-download');
  if (!btn) return;

  btn.addEventListener('click', (e) => {
    const md = window.__GIFT_MD;
    if (!md || typeof md !== 'string' || md.length === 0) {
      // Fallback: lascia che il browser segua href="CLAUDE.md" relativo
      return;
    }
    e.preventDefault();
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'CLAUDE.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  });
})();

// =========================================================
// Hamburger nav toggle (mobile)
// =========================================================
(function () {
  const toggle = document.getElementById('nav-toggle');
  const nav = document.getElementById('nav-main');
  const backdrop = document.getElementById('nav-backdrop');
  if (!toggle || !nav || !backdrop) return;

  function open() {
    toggle.classList.add('is-open');
    nav.classList.add('is-open');
    backdrop.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    toggle.classList.remove('is-open');
    nav.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }
  function toggleNav() {
    if (nav.classList.contains('is-open')) close();
    else open();
  }

  toggle.addEventListener('click', toggleNav);
  backdrop.addEventListener('click', close);

  // Chiudi quando l'utente seleziona una voce della nav
  nav.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', () => close());
  });

  // Chiudi con Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) close();
  });

  // Se l'utente ridimensiona oltre il breakpoint mentre la nav e' aperta,
  // chiudila per evitare stato inconsistente
  window.addEventListener('resize', () => {
    if (window.innerWidth > 960 && nav.classList.contains('is-open')) close();
  });
})();
