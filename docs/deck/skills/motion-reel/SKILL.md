# skills/motion-reel/SKILL.md

## Quando si attiva

Quando devi disegnare, modificare o riscrivere il visualizer del deck
(slide 9 e 11). Cioe' l'animazione step-by-step che mostra un turno di
loop runtime dal vivo.

> Questa skill NON e' "fai animazioni" in generale. E' specificamente
> il motion design del visualizer didattico del deck.

## Obiettivo

L'animazione deve essere **doppiamente buona**: didattica e riusabile
come reel social. Stessa cosa, due usi.

- **Didattica**: Mimmo guarda e capisce. Step chiari, narrazione testuale
  che accompagna, possibilita' di tornare indietro / fermarsi.
- **Reel**: catturando uno screen-recording da 15-30 secondi del visualizer
  che gira in auto, deve venire fuori un contenuto pubblicabile su
  Instagram Reels / TikTok / Shorts.

Se l'animazione e' didattica ma scarsa visivamente, ha fallito.
Se e' bella ma confusa, ha fallito.

## Principi di motion design

1. **Movimento vero, non highlight.** Quando un'azione passa da Tu →
   Harness → Modello, deve esserci una *particella* o *scia* che viaggia.
   Non basta accendere il prossimo box.

2. **Camera focus.** Quando un attore e' attivo, gli altri vanno in dim
   (~30% opacita'). L'attore attivo si ingrandisce leggermente (`transform:
   scale(1.04)`). Crea gerarchia visiva istantanea.

3. **Glow pulsante drammatico.** Non un border statico. Un alone che
   respira: `box-shadow` animato 0 → 24px blur, opacita' 0.4 → 0.8,
   loop a 2s con `cubic-bezier(0.4, 0, 0.2, 1)`.

4. **Typing effect** sul contenuto del file. Quando un file viene scritto,
   il contenuto compare carattere per carattere (`requestAnimationFrame`,
   ~30ms per char). Il momento "wow".

5. **Pulse wave** sul tool_call. Quando il modello produce una `tool_call`,
   un'onda concentrica (`@keyframes` + scale + opacity) parte dal box
   Modello verso il pannello Filesystem.

6. **Timing musical.** Tutti gli step hanno durate coerenti:
   - Transition di stato: 400-500ms
   - Particle travel: 600-800ms
   - Pausa tra step (in modalita' auto-play): 2.0-2.5s
   - Easing: `cubic-bezier(0.23, 1, 0.32, 1)` (ease-out-quart, forte)

7. **Filesystem cinematico.** Il pannello FS non e' una lista di file
   piatti. Quando un file appare, c'e':
   - Un cursore lampeggiante prima dell'apparizione (mostra "qualcosa sta per scrivere qui")
   - Il file slide in dal basso con leggero overshoot
   - Il contenuto si type-out

## Anti-pattern (cose che NON fare)

- **NO transition CSS basic** (`transition: all 200ms ease`). Lente, piatte, generiche. Usare keyframe animations e Web Animations API.
- **NO color change come unico segnale di stato.** Color e' supporto, non protagonista. Il movimento e' protagonista.
- **NO librerie esterne.** Niente GSAP, Lottie, Framer Motion. Vanilla JS only — il deck deve restare single-file portabile.
- **NO sound design.** Niente audio. Anche per i reel, l'audio si aggiungera' in post.
- **NO durate sotto i 300ms.** Sotto quella soglia il cervello non registra il movimento. Tutto sotto 300ms = "scattino", non motion.
- **NO durate sopra i 1000ms** per le transition di stato. Diventa lento, perde momentum.

## Stack tecnico

- **HTML/CSS**: per layout e stati statici degli attori (idle/active/dim)
- **CSS Animations / `@keyframes`**: per i loop (glow pulsante, breathe, ecc.)
- **Web Animations API** (`element.animate(...)`): per le sequenze
  scriptate (particle travel, pulse wave, file slide-in). E' nativa,
  potente, e ti da' callback `onfinish`.
- **`requestAnimationFrame`**: per il typing effect e qualunque cosa
  custom-tempo che non sta in keyframes.

## Esempi visuali di riferimento

Per chi cerca un benchmark estetico:
- Le animazioni del sito di Vercel quando ti spiegano l'edge function lifecycle
- Le visualizzazioni di Anthropic quando spiegano come funziona Claude Code
- I motion graphics di video YouTube tipo "Computerphile", "3Blue1Brown"

Tono visivo: **calmo, deliberato, premium**. Non "bouncy fun".

## Struttura del codice

```
assets/visualizer.js
├── const TURN_1_STEPS = [...]   // sequenza turno 1 (7 step)
├── const TURN_2_STEPS = [...]   // sequenza turno 2 (9 step)
├── class LoopVisualizer { ... } // engine riusabile
│   ├── constructor(rootId, steps, initialFs)
│   ├── render(stepIndex)        // applica stato visivo + narrazione
│   ├── animateTransition(from, to)  // motion vero tra step
│   ├── typewriter(el, text)     // typing effect
│   ├── pulseWave(fromEl, toEl)  // onda di tool_call
│   └── particle(fromEl, toEl)   // particella che viaggia
├── new LoopVisualizer('vz1', TURN_1_STEPS, null)
├── new LoopVisualizer('vz2', TURN_2_STEPS, [{ name: 'note.md', content: '"ciao mondo"' }])
└── attachControls()             // i bottoni step/play/reset
```

## Stato attuale

**v0.1**: animazione basic-CSS, cambio classe sugli attori, fade dei
puntini "thinking", file che appare con `@keyframes vz-file-in`.
Funzionante ma non reel-grade.

**v0.2 (da fare)**: riscrittura completa secondo questa skill. Vedi
issue / commit dedicato.
