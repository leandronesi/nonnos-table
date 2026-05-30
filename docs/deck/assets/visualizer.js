// =========================================================
// VISUALIZER — il cuore del deck (v0.2 — reel-grade motion)
// Due istanze (vz1 turno 1, vz2 turno 2). Stessa engine.
//
// Vedi skills/motion-reel/SKILL.md per principi e anti-pattern.
// =========================================================
(function () {

  // ====== Timing canonico (musical) ======
  const T = {
    particleTravel: 750,    // ms
    waveExpand:     800,
    typewriter:     32,     // ms per char
    fileSlideIn:    420,
    stateTransition: 420,
    interStep:      280,
    autoPlayPace:   2600,   // pausa tra step in auto-play
  };

  const EASE = {
    outQuart:  'cubic-bezier(0.23, 1, 0.32, 1)',
    outExpo:   'cubic-bezier(0.16, 1, 0.3, 1)',
    overshoot: 'cubic-bezier(0.34, 1.5, 0.5, 1)',
    smooth:    'cubic-bezier(0.4, 0, 0.2, 1)',
  };

  // ====== Step turno 1: filesystem vuoto → file creato ======
  const TURN_1_STEPS = [
    {
      actors: ['user'],
      transitions: [],
      thinking: [],
      fs: 'empty',
      narr: '<strong>1. Input.</strong> Tu scrivi la richiesta. L\'harness la cattura.',
    },
    {
      actors: ['harness'],
      transitions: [{ type: 'particle', from: 'user', to: 'harness' }],
      thinking: [],
      fs: 'empty',
      narr: '<strong>2. Assembly.</strong> L\'harness costruisce il prompt completo: regole di sistema, lista tool disponibili, history (vuota), il tuo messaggio. Tutto in un unico blob che parte verso il modello.',
    },
    {
      actors: ['model'],
      transitions: [{ type: 'particle', from: 'harness', to: 'model' }],
      thinking: ['model'],
      fs: 'empty',
      narr: '<strong>3. Modello pensa.</strong> Riceve il prompt, lo legge, decide cosa fare. Non scrive ancora nulla — sta solo "pensando".',
    },
    {
      actors: ['model'],
      transitions: [],
      thinking: [],
      fs: 'empty',
      narr: '<strong>4. Tool call.</strong> Il modello produce: <code>write_file(path="note.md", content="ciao mondo")</code>. Non sta eseguendo — sta solo <em>chiedendo</em> all\'harness di farlo.',
    },
    {
      actors: ['tools'],
      transitions: [
        { type: 'wave',     from: 'model', to: 'tools', color: 'gold' },
        { type: 'particle', from: 'model', to: 'tools', color: 'gold' },
        { type: 'particle', from: 'tools', to: 'fs',    color: 'gold', delay: 200 },
      ],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"', changed: true, animate: 'typewrite' }],
      narr: '<strong>5. Tool exec.</strong> L\'harness intercetta la chiamata e la esegue davvero: <em>crea il file</em> sul disco.',
    },
    {
      actors: ['model'],
      transitions: [{ type: 'particle', from: 'fs', to: 'model', color: 'gold' }],
      thinking: ['model'],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>6. Result + decisione.</strong> Il modello viene richiamato con il risultato del tool ("ok, fatto"). Decide: ho finito.',
    },
    {
      actors: ['user'],
      transitions: [{ type: 'particle', from: 'model', to: 'user' }],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>7. Output.</strong> L\'harness restituisce a te: <em>"Fatto. Ho creato note.md con dentro \'ciao mondo\'."</em> Il turno e\' completo.',
    },
  ];

  // ====== Step turno 2: file esiste → letto → modificato ======
  const TURN_2_STEPS = [
    {
      actors: ['user'],
      transitions: [],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>1. Input.</strong> Tu scrivi: "aggiungi una riga \'arrivederci\' a note.md". Nota: il modello non sa cosa contiene il file. Era un altro turno.',
    },
    {
      actors: ['harness'],
      transitions: [{ type: 'particle', from: 'user', to: 'harness' }],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>2. Assembly.</strong> L\'harness costruisce il nuovo prompt. Niente di magico: gli passa il tuo messaggio nuovo + l\'history del turno 1 (incluse le tool_call gia\' fatte).',
    },
    {
      actors: ['model'],
      transitions: [{ type: 'particle', from: 'harness', to: 'model' }],
      thinking: ['model'],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>3. Modello pensa.</strong> Realizza: <em>"per aggiungere una riga devo prima sapere cosa c\'e\' dentro il file"</em>. Quindi <strong>chiede di leggerlo</strong>.',
    },
    {
      actors: ['model'],
      transitions: [],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>4. Tool call (read).</strong> Il modello produce: <code>read_file(path="note.md")</code>. Vuole vedere il contenuto attuale.',
    },
    {
      actors: ['tools'],
      transitions: [
        { type: 'wave',     from: 'model', to: 'tools', color: 'gold' },
        { type: 'particle', from: 'model', to: 'tools', color: 'gold' },
        { type: 'particle', from: 'tools', to: 'fs',    color: 'gold', delay: 180 },
      ],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"', highlight: true }],
      narr: '<strong>5. Tool exec (read).</strong> L\'harness legge il file dal disco e rispedisce il contenuto al modello: <code>"ciao mondo"</code>.',
    },
    {
      actors: ['model'],
      transitions: [{ type: 'particle', from: 'fs', to: 'model', color: 'gold' }],
      thinking: ['model'],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>6. Modello ricompone.</strong> Adesso sa cosa c\'e\' dentro. Costruisce il nuovo contenuto: <code>"ciao mondo\\narrivederci"</code>.',
    },
    {
      actors: ['model'],
      transitions: [],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"' }],
      narr: '<strong>7. Tool call (write).</strong> Il modello produce: <code>write_file(path="note.md", content="ciao mondo\\narrivederci")</code>.',
    },
    {
      actors: ['tools'],
      transitions: [
        { type: 'wave',     from: 'model', to: 'tools', color: 'gold' },
        { type: 'particle', from: 'model', to: 'tools', color: 'gold' },
        { type: 'particle', from: 'tools', to: 'fs',    color: 'gold', delay: 180 },
      ],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"\n"arrivederci"', changed: true, animate: 'typewrite' }],
      narr: '<strong>8. Tool exec (write).</strong> L\'harness sovrascrive il file con il nuovo contenuto.',
    },
    {
      actors: ['user'],
      transitions: [{ type: 'particle', from: 'model', to: 'user' }],
      thinking: [],
      fs: [{ name: 'note.md', content: '"ciao mondo"\n"arrivederci"' }],
      narr: '<strong>9. Output.</strong> "Fatto. Ho aggiunto la riga \'arrivederci\' al file." Turno completo.',
    },
  ];

  // ====== Helpers ======
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  function center(el, refRect) {
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - refRect.left,
      y: r.top + r.height / 2 - refRect.top,
    };
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ====== LoopVisualizer ======
  class LoopVisualizer {
    constructor(rootId, steps, initialFs) {
      this.root = document.getElementById(rootId);
      if (!this.root) return;

      this.rootId = rootId;
      this.steps = steps;
      this.initialFs = initialFs;
      this.stepIndex = 0;
      this.isAnimating = false;
      this.autoPlayTimer = null;

      this.stage = this.root.querySelector('.vz-stage');
      this.actors = Array.from(this.root.querySelectorAll('.vz-actor'));
      this.fsTree = this.root.querySelector(`#${rootId}-fs`);
      this.fsPanel = this.root.querySelector('.vz-fs');
      this.narrEl = this.root.querySelector(`#${rootId}-narration`);
      this.stepCountEl = this.root.querySelector(`#${rootId}-step`);
      this.totalEl = this.root.querySelector(`#${rootId}-total`);
      this.totalEl.textContent = this.steps.length;
      this.initialNarration = this.narrEl.innerHTML;

      // Inietta atmosphere layer (background drift + vignette) PRIMA di tutto
      this.atmosphere = document.createElement('div');
      this.atmosphere.className = 'vz-atmosphere';
      this.stage.insertBefore(this.atmosphere, this.stage.firstChild);

      // Inietta FX layer (particles + wave) + flash overlay
      this.fxLayer = document.createElement('div');
      this.fxLayer.className = 'vz-fx-layer';
      this.stage.appendChild(this.fxLayer);

      this.flashLayer = document.createElement('div');
      this.flashLayer.className = 'vz-fx-flash';
      this.stage.appendChild(this.flashLayer);

      // Brain pattern (sostituisce i 3 dots) negli attori
      this.actors.forEach(a => {
        if (a.querySelector('.vz-brain')) return;
        const brain = document.createElement('span');
        brain.className = 'vz-brain';
        brain.innerHTML = '<svg viewBox="0 0 56 14" preserveAspectRatio="none">' +
          '<path d="M0 7 L8 7 L12 2 L16 12 L20 4 L24 10 L28 7 L36 7 L40 3 L44 11 L48 7 L56 7" />' +
          '</svg>';
        a.appendChild(brain);
      });

      this.renderInitial();
      this.preShowFadeIn();
    }

    // ===== Pre-show: scena nera, attori entrano in cascata =====
    preShowFadeIn() {
      // Quando la scena entra in viewport, anima staggered entry.
      // IntersectionObserver per partire solo quando visibile (non in background).
      const stage = this.stage;
      const actors = this.actors;
      // Stato iniziale "dietro le quinte"
      stage.style.opacity = '0';
      actors.forEach((a, i) => {
        a.style.opacity = '0';
        a.style.transform = 'translateY(12px) scale(0.96)';
      });

      const reveal = () => {
        stage.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 600, easing: EASE.outExpo, fill: 'forwards' }
        );
        stage.style.opacity = '';

        actors.forEach((a, i) => {
          setTimeout(() => {
            a.animate(
              [{ opacity: 0, transform: 'translateY(12px) scale(0.96)' },
               { opacity: 1, transform: 'translateY(0) scale(1)' }],
              { duration: 520, easing: EASE.outQuart, fill: 'forwards' }
            );
            a.style.opacity = '';
            a.style.transform = '';
          }, 120 + i * 110);
        });
      };

      if ('IntersectionObserver' in window) {
        const obs = new IntersectionObserver((entries) => {
          entries.forEach(e => {
            if (e.isIntersecting) {
              reveal();
              obs.disconnect();
            }
          });
        }, { threshold: 0.3 });
        obs.observe(this.root);
      } else {
        // Fallback: parte subito
        setTimeout(reveal, 100);
      }
    }

    actorEl(role) {
      if (role === 'fs') return this.fsPanel;
      return this.root.querySelector(`.vz-actor[data-actor="${role}"]`);
    }

    setActorStates(active = [], thinking = []) {
      const hasActive = active.length > 0;
      this.actors.forEach(a => {
        const role = a.getAttribute('data-actor');
        a.classList.toggle('active', active.includes(role));
        a.classList.toggle('thinking', thinking.includes(role));
        a.classList.toggle('dim', hasActive && !active.includes(role));
      });
    }

    renderInitial() {
      this.renderFs(this.initialFs);
      this.setActorStates([], []);
      this.stepCountEl.textContent = 0;
    }

    renderFs(fs) {
      if (fs === 'empty' || !fs) {
        this.fsTree.innerHTML = '<div class="vz-fs-empty">(vuoto)</div>';
        return;
      }
      this.fsTree.innerHTML = fs.map(f => `
        <div class="vz-fs-file ${f.changed || f.highlight ? 'just-changed' : ''}">
          <span class="vz-fs-name">${escapeHtml(f.name)}</span>
          <span class="vz-fs-content">${escapeHtml(f.content)}</span>
        </div>
      `).join('');
    }

    // ===== Particle: punto luminoso CON TRAIL che viaggia da from a to =====
    async particle(fromEl, toEl, opts = {}) {
      const layerRect = this.fxLayer.getBoundingClientRect();
      const start = center(fromEl, layerRect);
      const end = center(toEl, layerRect);
      const isGold = opts.color === 'gold';

      // Particle principale
      const el = document.createElement('div');
      el.className = 'vz-particle' + (isGold ? ' vz-particle-gold' : '');
      el.style.left = start.x + 'px';
      el.style.top = start.y + 'px';
      this.fxLayer.appendChild(el);

      // Fade in
      el.animate(
        [{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.4)' },
         { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }],
        { duration: 160, easing: EASE.outQuart, fill: 'forwards' }
      );

      // Trail: 5 puntini secondari sparati con ritardo crescente, opacita' calante.
      // Ogni trail "insegue" la particle viaggiando con un offset temporale.
      const TRAIL_COUNT = 5;
      const TRAIL_DELAY = 55;
      for (let i = 0; i < TRAIL_COUNT; i++) {
        const t = document.createElement('div');
        t.className = 'vz-particle-trail' + (isGold ? ' vz-particle-trail-gold' : '');
        t.style.left = start.x + 'px';
        t.style.top = start.y + 'px';
        const fadeFactor = 1 - (i + 1) / (TRAIL_COUNT + 1);
        t.style.opacity = String(fadeFactor * 0.65);
        t.style.width = (10 - i * 1.2) + 'px';
        t.style.height = (10 - i * 1.2) + 'px';
        this.fxLayer.appendChild(t);

        setTimeout(() => {
          t.animate(
            [{ left: start.x + 'px', top: start.y + 'px' },
             { left: end.x + 'px',   top: end.y + 'px' }],
            { duration: T.particleTravel, easing: EASE.outQuart, fill: 'forwards' }
          );
          setTimeout(() => {
            t.animate(
              [{ opacity: parseFloat(t.style.opacity) },
               { opacity: 0 }],
              { duration: 220, fill: 'forwards' }
            ).finished.then(() => t.remove());
          }, T.particleTravel);
        }, (i + 1) * TRAIL_DELAY);
      }

      // Travel della particle principale
      const travel = el.animate(
        [{ left: start.x + 'px', top: start.y + 'px' },
         { left: end.x + 'px',   top: end.y + 'px' }],
        { duration: T.particleTravel, easing: EASE.outQuart, fill: 'forwards' }
      );
      await travel.finished;

      // Burst sull'arrivo
      await el.animate(
        [{ opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
         { opacity: 0, transform: 'translate(-50%, -50%) scale(2.6)' }],
        { duration: 260, easing: EASE.outQuart, fill: 'forwards' }
      ).finished;

      el.remove();
    }

    // ===== Flash: lampo bianco brevissimo sullo stage =====
    async flash() {
      const anim = this.flashLayer.animate(
        [{ opacity: 0 }, { opacity: 0.55 }, { opacity: 0 }],
        { duration: 240, easing: EASE.outExpo, fill: 'forwards' }
      );
      await anim.finished;
    }

    // ===== Wave: onda concentrica con flash + onde multiple sfasate =====
    async wave(fromEl, _toEl, opts = {}) {
      const layerRect = this.fxLayer.getBoundingClientRect();
      const origin = center(fromEl, layerRect);
      const isGold = opts.color === 'gold';

      // Flash bianco sullo stage in concomitanza dell'inizio della wave
      this.flash();

      // 3 onde sfasate per profondita' sonica visiva
      const waves = [
        { delay: 0,   maxScale: 6,   startOpacity: 0.95 },
        { delay: 110, maxScale: 4.5, startOpacity: 0.7 },
        { delay: 220, maxScale: 3,   startOpacity: 0.45 },
      ];

      const promises = waves.map(w => new Promise(resolve => {
        setTimeout(() => {
          const el = document.createElement('div');
          el.className = 'vz-wave' + (isGold ? ' vz-wave-gold' : '');
          el.style.left = origin.x + 'px';
          el.style.top = origin.y + 'px';
          this.fxLayer.appendChild(el);

          el.animate(
            [{ transform: 'translate(-50%, -50%) scale(0.4)', opacity: w.startOpacity },
             { transform: `translate(-50%, -50%) scale(${w.maxScale})`, opacity: 0 }],
            { duration: T.waveExpand, easing: EASE.outExpo, fill: 'forwards' }
          ).finished.then(() => {
            el.remove();
            resolve();
          });
        }, w.delay);
      }));
      await Promise.all(promises);
    }

    // ===== Typewriter: scrive il testo carattere per carattere =====
    async typewriter(el, text, perChar = T.typewriter) {
      el.textContent = '';
      const caret = document.createElement('span');
      caret.className = 'vz-fs-caret';
      el.appendChild(caret);
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const tn = document.createTextNode(ch);
        el.insertBefore(tn, caret);
        await wait(perChar);
      }
      await wait(260);
      caret.remove();
    }

    // ===== File slide-in: il file entra con overshoot + typing del contenuto =====
    async fileSlideIn(file) {
      this.fsTree.innerHTML = `
        <div class="vz-fs-file just-changed" style="opacity:0;transform:translateY(14px) scale(0.96)">
          <span class="vz-fs-name">${escapeHtml(file.name)}</span>
          <span class="vz-fs-content" data-typetarget></span>
        </div>
      `;
      const fileEl = this.fsTree.querySelector('.vz-fs-file');
      await fileEl.animate(
        [{ opacity: 0, transform: 'translateY(14px) scale(0.96)' },
         { opacity: 1, transform: 'translateY(0) scale(1)' }],
        { duration: T.fileSlideIn, easing: EASE.overshoot, fill: 'forwards' }
      ).finished;

      const target = fileEl.querySelector('[data-typetarget]');
      await this.typewriter(target, file.content);
    }

    // ===== Esegui le transitions di uno step (coreografia con delay) =====
    async runTransitions(transitions) {
      const promises = transitions.map(async (t) => {
        if (t.delay) await wait(t.delay);
        const from = this.actorEl(t.from);
        const to = this.actorEl(t.to);
        if (!from || !to) return;
        if (t.type === 'particle') await this.particle(from, to, { color: t.color });
        else if (t.type === 'wave') await this.wave(from, to, { color: t.color });
      });
      await Promise.all(promises);
    }

    // ===== Cinematic narration swap (fade+blur out, masked reveal in) =====
    async swapNarration(html) {
      // Fade out old
      this.narrEl.classList.add('fading-out');
      await wait(260);
      // Replace content
      this.narrEl.innerHTML = html;
      this.narrEl.classList.remove('fading-out');
      // Force reflow trick — riporta in stato "entering" e poi "entered"
      this.narrEl.classList.add('entering');
      // eslint-disable-next-line no-unused-expressions
      void this.narrEl.offsetWidth;
      this.narrEl.classList.remove('entering');
      this.narrEl.classList.add('entered');
      await wait(460);
      this.narrEl.classList.remove('entered');
    }

    // ===== Render dello step idx (1-based) — choreografato =====
    async goToStep(idx) {
      if (this.isAnimating) return;
      if (idx < 0 || idx > this.steps.length) return;

      this.isAnimating = true;
      this.stepIndex = idx;
      this.stepCountEl.textContent = idx;

      if (idx === 0) {
        this.renderInitial();
        this.narrEl.innerHTML = this.initialNarration;
        this.isAnimating = false;
        this.updateButtons();
        return;
      }

      const step = this.steps[idx - 1];

      // 1. Cinematic swap della narrazione (fade out vecchio, blur in nuovo) —
      //    parte in parallelo agli stati attori
      const narrPromise = this.swapNarration(step.narr);

      // 2. 80ms di respiro prima di accendere gli stati visivi
      await wait(80);
      this.setActorStates(step.actors, step.thinking);

      // 3. Esegui le transitions di motion (wave/particle/trail)
      await this.runTransitions(step.transitions || []);

      // 4. Filesystem update — con glow ambient se stiamo scrivendo
      const animatedFile = Array.isArray(step.fs)
        ? step.fs.find(f => f.animate === 'typewrite')
        : null;
      if (animatedFile) {
        this.fsPanel.classList.add('writing');
        await this.fileSlideIn(animatedFile);
        // Lascia il glow per 600ms dopo che il typing finisce
        setTimeout(() => this.fsPanel.classList.remove('writing'), 600);
      } else {
        this.renderFs(step.fs);
      }

      // Aspetta che la narration finisca di fade-in se ancora in volo
      await narrPromise;

      this.isAnimating = false;
      this.updateButtons();
    }

    nextStep() {
      if (this.isAnimating) return;
      if (this.stepIndex < this.steps.length) {
        this.goToStep(this.stepIndex + 1);
      }
    }

    reset() {
      this.stopAutoPlay();
      this.fxLayer.innerHTML = '';
      this.stepIndex = 0;
      this.renderInitial();
      this.narrEl.innerHTML = this.initialNarration;
      this.stepCountEl.textContent = 0;
      this.updateButtons();
    }

    toggleAutoPlay() {
      if (this.autoPlayTimer) this.stopAutoPlay();
      else this.startAutoPlay();
    }

    startAutoPlay() {
      if (this.stepIndex >= this.steps.length) return;
      this.autoPlayTimer = true;
      this.updatePlayButton(true);
      const tick = async () => {
        if (!this.autoPlayTimer) return;
        if (this.stepIndex >= this.steps.length) {
          this.stopAutoPlay();
          return;
        }
        await this.goToStep(this.stepIndex + 1);
        if (!this.autoPlayTimer) return;
        this.autoPlayTimer = setTimeout(tick, T.autoPlayPace);
      };
      this.autoPlayTimer = setTimeout(tick, 100);
    }

    stopAutoPlay() {
      if (this.autoPlayTimer && this.autoPlayTimer !== true) {
        clearTimeout(this.autoPlayTimer);
      }
      this.autoPlayTimer = null;
      this.updatePlayButton(false);
    }

    updateButtons() {
      const nextBtn = document.querySelector(`[data-vz="${this.rootId}"][data-action="next"]`);
      const playBtn = document.querySelector(`[data-vz="${this.rootId}"][data-action="play"]`);
      const done = this.stepIndex >= this.steps.length;
      if (nextBtn) {
        nextBtn.disabled = done;
        nextBtn.textContent = done ? 'Fine' : 'Step ▶';
      }
      if (playBtn) {
        playBtn.disabled = done;
      }
    }

    updatePlayButton(playing) {
      const playBtn = document.querySelector(`[data-vz="${this.rootId}"][data-action="play"]`);
      if (playBtn) {
        playBtn.textContent = playing ? '⏸ Stop' : '▶ Auto';
      }
    }
  }

  // =========================================================
  // FsNavVisualizer — l'agente che naviga la cartella docs/deck/
  // =========================================================
  const NAV_STEPS = [
    {
      thought: '<strong>Input ricevuto.</strong> L\'utente vuole modificare la <em>slide 5</em>. Pero\' non so dove sta. Apro la macroistruzione per orientarmi.',
      reads: 'CLAUDE.md',
    },
    {
      thought: '<strong>Letto <code>CLAUDE.md</code>.</strong> Mi dice: <em>"le slide vivono in <code>content/</code>, una parte per file. Per il tono usa <code>spec/voice.md</code>."</em>',
      reads: 'CLAUDE.md',
    },
    {
      thought: '<strong>Prima il tono.</strong> Leggo <code>spec/voice.md</code> per scrivere nel registro giusto.',
      reads: 'spec/voice.md',
    },
    {
      thought: '<strong>Voice.md mi dice:</strong> italiano colloquiale, frasi corte, niente em-dash, niente "ovviamente". Ok, lo applico.',
      reads: 'spec/voice.md',
      action: true,
    },
    {
      thought: '<strong>Adesso devo trovare la slide 5.</strong> La slide 5 vive nella Parte 1 (slides 4-7). File giusto: <code>content/01-harness.html</code>.',
      reads: 'content/01-harness.html',
    },
    {
      thought: '<strong>Apro <code>content/01-harness.html</code>.</strong> Trovo il blocco <code>&lt;!-- SLIDE 5 --&gt;</code> e identifico dove aggiungere la nota.',
      reads: 'content/01-harness.html',
      action: true,
    },
    {
      thought: '<strong>Scrivo la modifica.</strong> Aggiungo una <code>&lt;div class="note"&gt;</code> con il testo richiesto. Tono coerente con voice.md.',
      writes: 'content/01-harness.html',
    },
    {
      thought: '<strong>Eseguo <code>build.py</code>.</strong> Concatena content + assets + template in <code>dist/index.html</code>. Fatto. L\'utente vedra\' la modifica al prossimo refresh.',
      done: 'content/01-harness.html',
    },
  ];

  class FsNavVisualizer {
    constructor(rootId, steps) {
      this.root = document.getElementById(rootId);
      if (!this.root) return;

      this.rootId = rootId;
      this.steps = steps;
      this.stepIndex = 0;
      this.isAnimating = false;
      this.autoPlayTimer = null;

      this.thoughtList = this.root.querySelector(`#${rootId}-thought-list`);
      this.tree = this.root.querySelector(`#${rootId}-tree`);
      this.stepCountEl = this.root.querySelector(`#${rootId}-step`);
      this.totalEl = this.root.querySelector(`#${rootId}-total`);
      this.totalEl.textContent = this.steps.length;
      this.fsnEls = new Map();
      this.tree.querySelectorAll('.fsn').forEach(el => {
        const path = el.getAttribute('data-path');
        if (path) this.fsnEls.set(path, el);
      });
    }

    clearStates() {
      this.fsnEls.forEach(el => {
        el.classList.remove('is-reading', 'is-writing', 'is-done');
      });
    }

    setReading(path) {
      this.clearStates();
      const el = this.fsnEls.get(path);
      if (el) el.classList.add('is-reading');
    }
    setWriting(path) {
      this.clearStates();
      const el = this.fsnEls.get(path);
      if (el) el.classList.add('is-writing');
    }
    setDone(path) {
      this.clearStates();
      const el = this.fsnEls.get(path);
      if (el) el.classList.add('is-done');
    }

    addThought(html, kind) {
      const el = document.createElement('div');
      el.className = 'vz-thought';
      if (kind === 'action') el.classList.add('vz-thought-action');
      if (kind === 'write') el.classList.add('vz-thought-write');
      el.innerHTML = html;
      this.thoughtList.appendChild(el);
      // Scroll to bottom
      requestAnimationFrame(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }

    async goToStep(idx) {
      if (this.isAnimating) return;
      if (idx < 0 || idx > this.steps.length) return;
      this.isAnimating = true;
      this.stepIndex = idx;
      this.stepCountEl.textContent = idx;

      if (idx === 0) {
        this.thoughtList.innerHTML = '';
        this.clearStates();
        this.isAnimating = false;
        this.updateButtons();
        return;
      }

      const step = this.steps[idx - 1];
      const kind = step.writes ? 'write' : step.action ? 'action' : 'read';
      this.addThought(step.thought, kind);
      await wait(120);
      if (step.writes) this.setWriting(step.writes);
      else if (step.done) this.setDone(step.done);
      else if (step.reads) this.setReading(step.reads);

      await wait(400);
      this.isAnimating = false;
      this.updateButtons();
    }

    nextStep() {
      if (this.isAnimating) return;
      if (this.stepIndex < this.steps.length) this.goToStep(this.stepIndex + 1);
    }

    reset() {
      this.stopAutoPlay();
      this.stepIndex = 0;
      this.thoughtList.innerHTML = '';
      this.clearStates();
      this.stepCountEl.textContent = 0;
      this.updateButtons();
    }

    toggleAutoPlay() {
      if (this.autoPlayTimer) this.stopAutoPlay();
      else this.startAutoPlay();
    }

    startAutoPlay() {
      if (this.stepIndex >= this.steps.length) return;
      this.autoPlayTimer = true;
      this.updatePlayButton(true);
      const tick = async () => {
        if (!this.autoPlayTimer) return;
        if (this.stepIndex >= this.steps.length) {
          this.stopAutoPlay();
          return;
        }
        await this.goToStep(this.stepIndex + 1);
        if (!this.autoPlayTimer) return;
        this.autoPlayTimer = setTimeout(tick, 2400);
      };
      this.autoPlayTimer = setTimeout(tick, 100);
    }

    stopAutoPlay() {
      if (this.autoPlayTimer && this.autoPlayTimer !== true) {
        clearTimeout(this.autoPlayTimer);
      }
      this.autoPlayTimer = null;
      this.updatePlayButton(false);
    }

    updateButtons() {
      const nextBtn = document.querySelector(`[data-vz="${this.rootId}"][data-action="next"]`);
      const playBtn = document.querySelector(`[data-vz="${this.rootId}"][data-action="play"]`);
      const done = this.stepIndex >= this.steps.length;
      if (nextBtn) {
        nextBtn.disabled = done;
        nextBtn.textContent = done ? 'Fine' : 'Step ▶';
      }
      if (playBtn) playBtn.disabled = done;
    }

    updatePlayButton(playing) {
      const playBtn = document.querySelector(`[data-vz="${this.rootId}"][data-action="play"]`);
      if (playBtn) playBtn.textContent = playing ? '⏸ Stop' : '▶ Auto';
    }
  }

  // ====== Bootstrap ======
  function init() {
    const vz1 = new LoopVisualizer('vz1', TURN_1_STEPS, 'empty');
    const vz2 = new LoopVisualizer('vz2', TURN_2_STEPS, [{ name: 'note.md', content: '"ciao mondo"' }]);
    const vznav = new FsNavVisualizer('vznav', NAV_STEPS);

    const instances = { vz1, vz2, vznav };

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.vz-btn');
      if (!btn) return;
      const vzId = btn.getAttribute('data-vz');
      const action = btn.getAttribute('data-action');
      const vz = instances[vzId];
      if (!vz) return;

      if (action === 'next') {
        vz.stopAutoPlay();
        vz.nextStep();
      } else if (action === 'reset') {
        vz.reset();
      } else if (action === 'play') {
        vz.toggleAutoPlay();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
