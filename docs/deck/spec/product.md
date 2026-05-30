# spec/product.md — il deck

## Cos'e'

Un deck HTML single-page didattico che spiega **come funzionano gli agent
AI moderni** a un principiante non-tecnico ma intelligente.

Il deck non e' un tutorial "come si usa ChatGPT". E' una decostruzione
del modello mentale comune ("AI = scatola magica che risponde") e una
ricostruzione del modello corretto ("AI = harness intorno a un LLM, con
loop runtime + filesystem + tool + skill").

## Perche' esiste

Tre motivi, in ordine di importanza:

1. **Spiegare a Mimmo (fratello del PO) come si usa Claude oggi.**
   Mimmo guardera' il deck dal computer del PO, di persona, una volta.
   ~45 minuti con commento dal vivo.

2. **Materiale riusabile.** Una volta che il deck funziona per Mimmo, e'
   potenzialmente riusabile per: management BIP, clienti che chiedono
   "ma come funziona davvero l'AI", recruiting tech, conferenze tecniche.

3. **Master per reel educativi.** Ogni slide e' potenzialmente uno script
   da 30-60 secondi per content social (Reels/Shorts/TikTok). Il visualizer
   del loop runtime e' il primo candidato — animazione che dura ~15 secondi.

## Obiettivi misurabili (per Mimmo)

Dopo il deck, Mimmo deve poter rispondere a queste 5 domande con parole sue:

1. Qual e' la differenza tra "l'LLM" e "ChatGPT"?
2. Cosa significa "il modello non ha memoria"? Come fa allora a ricordarsi?
3. Perche' Claude Code ti fa scrivere un `CLAUDE.md`?
4. Cos'e' una "skill"? Perche' non e' codice?
5. Cosa hanno in comune Cursor, Claude Code, Devin, ChatGPT con MCP?

Se dopo 45 minuti Mimmo risponde a 4/5 con parole sue, il deck ha funzionato.

## Non-obiettivi (cosa il deck NON fa)

- **Non insegna a programmare.** Mimmo non scrivera' codice.
- **Non spiega come si addestra un LLM.** Diamo per scontato che il modello
  esiste. Spieghiamo cosa gli sta intorno.
- **Non vende un prodotto.** Non e' un pitch BIP. E' didattico puro.
- **Non e' esaustivo.** Lascia fuori MCP, RAG approfondito, fine-tuning,
  multi-agent. Sono fuori scope.

## Struttura narrativa

26 slide in 4 parti:

- **Parte 0 — Preambolo** (slide 1-3): demolisce il modello mentale comune
- **Parte 1 — Harness** (slide 4-7): introduce la decomposizione modello+harness
- **Parte 2 — Il loop runtime** (slide 8-14): IL CUORE. Include i due
  visualizer interattivi (slide 9, 11) che mostrano un turno dal vivo
- **Parte 3 — I tre pilastri** (slide 15-23): filesystem, wiki, skills
  come conseguenze logiche del loop
- **Parte 4 — Mettere insieme** (slide 24-26): sintesi + test mentale +
  esempio reale (questo deck stesso)

Il "wow moment" e' la slide 11 (Visualizer turno 2). Li' Mimmo capisce
da solo perche' serve il filesystem persistente.

## Stato attuale

- **v0.1**: monolite `index.html` (1700 righe). Funzionante ma non
  manutenibile. Animazioni del visualizer basic-CSS — non reel-grade.
- **v0.2** (corrente): refactor modulare in `content/`, `assets/`, `spec/`.
  Build via `python build.py` → `dist/index.html`. Animazioni ancora v0.1.
- **v0.3** (prossima): visualizer riscritto reel-grade (motion design vero).
