# CLAUDE.md — istruzioni per lavorare su questo deck

> Sei il modello che lavora su questo deck didattico. Prima di toccare
> qualunque file, leggi questo documento per intero. Ti dice **chi guarda**
> il deck, **come e' organizzato**, **come e' fatto il copy**, **come si
> modifica**, e **cosa non fare**.

## Cos'e' questo

Un deck HTML single-page che spiega a un principiante non-tecnico **cos'e'
un agent AI moderno**: il loop runtime, l'harness, il filesystem come
spina dorsale, i tre pilastri (Van Clieff / Karpathy / Anthropic skills).

Il deck e' **anche un esempio di se stesso**: la sua struttura applica
i pattern che insegna. Per questo la cartella e' organizzata cosi':

```
docs/deck/
├── CLAUDE.md                # questo file
├── spec/                    # specifiche di prodotto
│   ├── product.md           # cos'e' il deck, obiettivi
│   ├── audience.md          # chi guarda (Mimmo)
│   └── voice.md             # tono, registro, anti-pattern di copy
├── content/                 # le slide come HTML modulare
│   ├── 00-preambolo.html    # hero + slide 1-3
│   ├── 01-harness.html      # slide 4-7
│   ├── 02-loop.html         # slide 8-14 (include visualizer)
│   ├── 03-pilastri.html     # slide 15-23
│   └── 04-insieme.html      # slide 24-26
├── assets/
│   ├── deck.css             # tutto lo styling
│   ├── deck.js              # progress bar + side nav highlight
│   └── visualizer.js        # state machine del visualizer interattivo
├── skills/
│   └── motion-reel/         # skill per le animazioni reel-grade
│       └── SKILL.md
├── template.html            # shell HTML con {{CSS}} {{CONTENT}} {{JS}}
├── build.py                 # concatena tutto in dist/index.html
├── dist/
│   └── index.html           # OUTPUT single-file — doppio-click apre il deck
└── README.md                # come aprire / modificare
```

## Workflow per modificare il deck

1. **Vuoi cambiare il copy di una slide?** → apri `content/0X-*.html`,
   trova la `<!-- SLIDE N -->`, modifica.
2. **Vuoi cambiare uno stile?** → apri `assets/deck.css`. Componenti
   raggruppati semanticamente con commenti `/* ===== */`.
3. **Vuoi toccare il visualizer?** → `assets/visualizer.js` e la skill
   `skills/motion-reel/SKILL.md`. Le animazioni sono reel-grade — non
   downgradare a transition CSS basic.
4. **Hai finito?** → `python build.py` per rigenerare `dist/index.html`.
   Apri `dist/index.html` nel browser per verificare.

> **Non modificare mai `dist/index.html` direttamente.** E' output del
> build. Modifica i sorgenti modulari e ri-builda.

## Vincoli che DEVI rispettare

### Palette
- Background: `#fafaf7` (off-white tinted)
- Testo primario: `#1a1a1a`
- Testo soft: `#4a4a44`
- Faint: `#9a9685`
- Linea: `#e5e3dc`
- **Accent twilight: `#7c5cff`** (i pilastri, pull-quote, link attivi, hero accent)
- **Accent oro: `#f6c64a`** (enfasi forte, file system highlights, formula output)
- Rosso: `#c4322a` su `#fbecec` (anti-pattern only)
- Verde: `#2c8a3e` su `#ecf6ec` (positivi only)

NON aggiungere altri colori senza motivo. La palette e' chiusa.

### Tipografia
- Body: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`
- Headings + UI: system sans (Inter / SF / Segoe)
- Mono (code, formule): system mono

### Voce
Leggi `spec/voice.md` per il dettaglio. In breve: italiano colloquiale alto,
frasi corte, niente jargon non spiegato, niente em-dash (usa parentesi /
due punti / virgole), niente "in conclusione" e altri zombie. Pull-quote
sui momenti forti. Slide leggibili in 30-60 secondi.

## Anti-pattern (cose che NON devi fare)

- **NON aggiungere dipendenze esterne.** Niente npm, niente CDN, niente
  framework. Il deck deve essere portabile: `dist/index.html` apribile
  con doppio-click ovunque.
- **NON spostare HTML inline nel template.** Il template e' shell.
  Tutto il contenuto sostantivo va in `content/`.
- **NON duplicare il copy tra file.** Una slide vive in un solo posto.
- **NON modificare il monolite `index.html` legacy.** E' la versione v0.1.
  Il sorgente vivo e' `dist/index.html`, generato da `build.py`.
  *(Quando confermato che la build e' stabile, `index.html` legacy verra'
  rimosso.)*
- **NON ridurre le animazioni del visualizer a transition CSS basic.**
  Sono motion-reel-grade per design — devono restare. Vedi
  `skills/motion-reel/SKILL.md`.
- **NON usare em-dash (—).** Usa virgole, parentesi, due punti. Anche
  nei commenti.

## Quando il modello legge questo file

Tipicamente il modello arriva qui in due scenari:
1. **L'utente ha chiesto una modifica al deck.** → applica il workflow
   sopra, modifica i sorgenti modulari, ri-builda.
2. **L'utente sta dimostrando come si lavora con un agent.** → il file
   stesso e' la dimostrazione. Lo apre a fianco del deck e dice:
   "guarda, questo e' il primo file che Claude legge quando lavora qui".
   In questo caso non serve fare nulla — sii pronto a rispondere a domande
   sulla struttura.

## Riferimenti

- `spec/product.md` — cos'e' il deck, perche' esiste, audience
- `spec/audience.md` — chi e' Mimmo specifico, non audience generica
- `spec/voice.md` — il tono parlato-autorevole italiano, esempi buoni/cattivi
- `skills/motion-reel/SKILL.md` — il motion design del visualizer
- `README.md` — come aprire / buildare / modificare
