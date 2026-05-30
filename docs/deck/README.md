# docs/deck — un deck didattico su come si usano gli agent AI

Single-page HTML, single-file output. Niente dipendenze. Niente build tools.

## Cosa c'e' qui

- **`dist/index.html`** — il deck. **Doppio click e funziona.** E' il file
  che apre nel browser e mostra le 26 slide.
- Tutto il resto e' sorgenti modulari che si compongono in `dist/index.html`
  tramite `build.py`.

## Come aprirlo

```
docs/deck/dist/index.html
```

Doppio click. Si apre nel browser. Scrolla.

Se vuoi proiettarlo a qualcuno, e' meglio aprirlo in finestra browser
intera (F11 per fullscreen su molti browser).

## Come modificarlo

1. **Modifica il sorgente** (non `dist/index.html` direttamente):
   - Copy di una slide → `content/0X-*.html`
   - Stili → `assets/deck.css`
   - Visualizer → `assets/visualizer.js`
   - Nav, progress, scroll → `assets/deck.js`

2. **Rigenera l'output**:

```bash
python build.py
```

3. **Ricarica** `dist/index.html` nel browser.

## Struttura

```
docs/deck/
├── README.md              # questo file
├── CLAUDE.md              # istruzioni per il modello che lavora sul deck
├── spec/                  # specifiche di prodotto (audience, voice, ecc.)
├── content/               # le slide come HTML modulare
├── assets/                # CSS + JS
├── skills/                # skill specifiche per pezzi complessi (visualizer)
├── template.html          # shell HTML con placeholder
├── build.py               # concatena sorgenti in dist/index.html
└── dist/index.html        # OUTPUT — apri questo
```

## Perche' la struttura e' organizzata cosi'

Perche' il deck stesso e' un esempio di cio' che spiega. Vai a leggere
`CLAUDE.md` per il razionale completo.

## Stampare il deck (PDF)

`dist/index.html` ha un media-query `@print` che impagina ogni slide su una
pagina separata. Apri in Chrome → Stampa → "Salva come PDF". Ogni slide
diventa un foglio A4.
