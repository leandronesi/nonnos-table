---
name: Mygotham · Road to GranPa
description: Il tavolo quotidiano di Nonno O. — sistema visivo intimo, calmo, scacchistico in italiano.
register: product
colors:
  bg-night:          "#060814"
  bg-night-soft:     "#0a0d1c"
  surface-table:     "#0f1325"
  surface-table-2:   "#161a30"
  surface-table-3:   "#1c2138"
  line-ink:          "#1e2440"
  line-ink-strong:   "#2a3158"
  text-paper:        "#eef0fa"
  text-paper-soft:   "#b6bcd6"
  text-muted:        "#717892"
  text-faint:        "#4a5070"
  twilight:          "#7c5cff"
  twilight-soft:     "#a18bff"
  honey-onice:       "#f6c64a"
  honey-onice-soft:  "#ffd877"
  signal-good:       "#34d399"
  signal-warn:       "#f5a524"
  signal-danger:     "#f43f5e"
  signal-info:       "#60a5fa"
typography:
  display:
    fontFamily: "Inter Tight, Inter, system-ui, sans-serif"
    fontSize: "clamp(2.2rem, 5vw, 3.4rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter Tight, Inter, system-ui, sans-serif"
    fontSize: "1.8rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Inter Tight, Inter, system-ui, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 700
    letterSpacing: "0.12em"
  mono:
    fontFamily: "JetBrains Mono, SF Mono, ui-monospace, monospace"
    fontSize: "0.88rem"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "36px"
components:
  button-primary:
    backgroundColor: "{colors.twilight}"
    textColor: "{colors.text-paper}"
    rounded: "{rounded.md}"
    padding: "12px 22px"
    typography: "{typography.body}"
  button-primary-hover:
    backgroundColor: "{colors.twilight-soft}"
    textColor: "{colors.bg-night}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-paper-soft}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  card-default:
    backgroundColor: "{colors.surface-table}"
    rounded: "{rounded.lg}"
    padding: "24px 28px"
  card-hero:
    backgroundColor: "{colors.surface-table-2}"
    rounded: "{rounded.lg}"
    padding: "36px 40px"
  chip-pill:
    backgroundColor: "{colors.surface-table-3}"
    textColor: "{colors.text-paper-soft}"
    rounded: "{rounded.pill}"
    padding: "4px 14px"
    typography: "{typography.label}"
  input-text:
    backgroundColor: "{colors.surface-table-2}"
    textColor: "{colors.text-paper}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    typography: "{typography.body}"
---

# Design System: Mygotham · Road to GranPa

## 1. Overview

**Creative North Star: "Il Tavolo del Nonno"**

Mygotham è il tavolo quotidiano dove un nonno scacchista ti riceve, ti parla, ti rivede le partite, ti misura nel tempo. Il sistema visivo non è una dashboard, non è un puzzle trainer, non è uno strumento. È un **rituale** — pochi oggetti, scelti con cura, sempre nelle stesse posizioni. La lampada gialla (Miele d'Onice), il blu profondo della sera (Twilight), il legno scuro del tavolo (le superfici stratificate). Niente urla, niente flash, niente "achievement" gridati.

Il sistema rifiuta esplicitamente l'estetica delle dashboard chess.com / aimchess (cards affiancate piene di numeri colorati che competono per l'attenzione), il purple-glow generico dei tool AI 2024-2026, e qualsiasi gamification (badge, leaderboard, livelli). Non è un trainer. È un rapporto.

**Key Characteristics:**
- Una sola voce in tutto il prodotto (Nonno, seconda persona TU)
- Un solo CTA per schermo
- Profondità per stratificazione tonale, non per ombre
- Bordi morbidi, padding generoso, transizioni discrete
- Lessico scacchistico italiano vero (pezzo in presa, mediogioco, ottava traversa)
- Numeri solo quando Nonno li cita nel discorso — mai come "stat di sé stessi"

## 2. Colors

La palette è notturna: il giocatore apre l'app la sera, da solo, davanti a uno schermo. Twilight (viola crepuscolo) per le decisioni e i tuoi freni; Miele d'Onice (oro caldo) per l'Obiettivo e i momenti di luce. I neutri sono blu profondo (Notte), non grigi sterili.

### Primary
- **Twilight** (`#7c5cff`): l'accento principale. Bottoni primari, link, marcatori dei freni, brand mark. Compare ≤15% di ogni schermo; è una voce, non una vernice.
- **Twilight Soft** (`#a18bff`): hover di Twilight, badge categoria pattern, eyebrow nelle card.

### Secondary
- **Miele d'Onice** (`#f6c64a`): il colore dell'Obiettivo. Hero del north star in Home (Da X a Y), evidenziazioni rare ed eleganti. Mai usato per UI generica — è riservato al "dove vuoi arrivare".
- **Miele d'Onice Soft** (`#ffd877`): label, valori dell'obiettivo, accenti caldi.

### Tertiary (segnali)
- **Signal Good** (`#34d399`): conferme, perfect verdict, win-rate alti. Mai decorativo.
- **Signal Warn** (`#f5a524`): "consolidare", giocabile-non-perfetto. Stato intermedio.
- **Signal Danger** (`#f43f5e`): errori gravi, win-rate bassi, freni da allenare.
- **Signal Info** (`#60a5fa`): info contestuale rara.

### Neutral
- **Notte Profonda** (`#060814`): sfondo base di tutto.
- **Notte Morbida** (`#0a0d1c`): header sticky con backdrop-blur.
- **Tavolo** (`#0f1325`): superficie base delle card (livello 1).
- **Tavolo Sollevato** (`#161a30`): card secondarie (livello 2), hero containers.
- **Tavolo Elevato** (`#1c2138`): chip, pill, micro-elementi (livello 3).
- **Linea d'Inchiostro** (`#1e2440`): bordi standard, divisori.
- **Linea d'Inchiostro Forte** (`#2a3158`): hover dei bordi, focus.
- **Foglio** (`#eef0fa`): testo principale.
- **Foglio Morbido** (`#b6bcd6`): testo secondario, body soft.
- **Inchiostro Muto** (`#717892`): didascalie, metadata.
- **Inchiostro Sbiadito** (`#4a5070`): caption ultra-tertiari.

### Named Rules
**La Regola del Miele.** L'oro è riservato all'Obiettivo. Mai bottoni gialli generici, mai badge gold per cose che non riguardano "dove vuoi arrivare a 1600". Quando l'utente vede il miele, sta vedendo il suo target.

**La Regola dell'Una Voce.** Twilight occupa ≤15% di superficie su qualsiasi schermo. La sua rarità è il moat. Se tutto diventa viola, niente è importante.

**La Regola dei Tre Tavoli.** Tre livelli di superficie (surface-table 1/2/3) bastano per qualsiasi gerarchia. Mai un quarto livello — se ti serve, hai sbagliato a strutturare la pagina.

## 3. Typography

**Display Font:** Inter Tight (con fallback Inter, system-ui)
**Body Font:** Inter (con fallback system-ui)
**Mono Font:** JetBrains Mono (con fallback SF Mono, ui-monospace) — usato esclusivamente per numeri tabulari (rating, cp_loss, percentuali) e codice tecnico (SAN, FEN).

**Character:** Inter Tight è la voce con cui Nonno apre frasi ("Sediamoci"), Inter è la voce con cui le racconta. Il mono è il libro mastro: numeri precisi, allineati, mai disinvolti. La pairing è disciplinata: nessun serif decorativo, nessun script. Il tono è quello di un quaderno serio, non di una rivista.

### Hierarchy
- **Display** (800, clamp 2.2-3.4rem, line-height 1.1): solo per il rating dell'Obiettivo in Home ("Da 1229 a 1600"). Mai altrove.
- **Headline** (700, 1.8rem, line-height 1.2): titoli delle sezioni principali ("I tuoi freni", "Le strutture in cui cadi").
- **Title** (700, 1.35rem, line-height 1.3): titoli card e modali ("Pezzo in presa", "Allenamento completato").
- **Body** (400, 0.95rem, line-height 1.6): copia normale, frasi di Nonno. Cap a 65-75ch.
- **Label** (700, 0.72rem, letter-spacing 0.12em, UPPERCASE): eyebrow piccoli sopra titoli e in card head ("OBIETTIVO DICHIARATO", "NONNO DICE").
- **Mono** (600, 0.88rem): tutti i numeri (rating, %, cp_loss, mosse SAN).

### Named Rules
**La Regola del Mono.** Ogni numero che si confronta con un altro numero usa mono. Rating 1229 vs 1600, freq 24%, cp_loss −1.20: tutti mono. I numeri non-confrontativi (data, "5 minuti") possono restare in Inter.

## 4. Elevation

Stratificazione tonale, **niente ombre**. La profondità si percepisce attraverso 3 livelli di superficie (surface-table 1/2/3) e attraverso la linea (line-ink standard, line-ink-strong per hover/focus). Niente `box-shadow` decorative. Niente glow effects (eccezione: backdrop-blur sull'header sticky e il `box-shadow: 0 0 60px var(--color-brand-glow)` esclusivo per il pulse dell'hero quando lo stato dichiara "sei sulla rotta giusta").

Le ombre, quando appaiono, sono **funzionali**, mai decorative: la train-bar fluttuante in `/patterns` quando selezioni N freni ha shadow di elevazione perché è davvero sollevata rispetto al contenuto sottostante. Tutto il resto è piatto.

### Named Rules
**La Regola del Piatto.** Le card sono piatte a riposo. Le ombre appaiono solo come risposta funzionale (elemento davvero sollevato / focus a11y). Niente "depth" decorativa.

## 5. Components

### Buttons
- **Shape:** rounded-md (10px). Mai pill per CTA principali — la pill è per chip/badge, non per azioni.
- **Primary:** Twilight (`#7c5cff`) bg + Foglio testo, padding 12px 22px, transition 160ms ease-out. Hover: Twilight Soft. Active: `transform: scale(0.97)`. Mai gradient su bottoni primari.
- **Ghost:** transparent bg + Foglio Morbido testo, bordo Linea d'Inchiostro, hover sposta a Linea Forte e testo a Foglio pieno. Per azioni secondarie o terziarie.
- **Lg (CTA hero):** padding 14px 28px, font-weight 700. Esempi: "Sediamoci", "Allena questo pattern", "Inizia allenamento (N)".
- **Sm:** padding 6px 12px, font-size 0.85rem. Per azioni inline (Esci, Modifica, Annulla).

### Chips / Pills
- **Style:** bg surface-table-3, testo Foglio Morbido, rounded-pill (999px), padding 4px 14px, label typography (UPPERCASE 0.72rem 0.12em letter-spacing).
- **Categoria (Pattern):** colorate per famiglia (Tattica = Twilight-soft, Tempo = Miele, Mentale = Danger, Decisione = Good, Fase = purple variante, Colore = Info). Solo per metadati, mai per CTA.
- **Stato SRS:** bordo currentColor, contenuto in caps (DA ALLENARE, CONSOLIDARE, DOMINATO, NON ANCORA OSSERVATO).

### Cards / Containers
- **Corner Style:** rounded-lg (14px) per card principali; rounded-md (10px) per micro-card e pill ribbons.
- **Background:** surface-table (livello 1) per default. Surface-table-2 per hero card (Obiettivo, "Quaderno di Nonno"). Surface-table-3 mai come card — solo per pill/chip interni.
- **Shadow Strategy:** flat. Eccezione: card hero Obiettivo ha radial-gradient di `--color-brand-glow` al top-right, NON una shadow.
- **Border:** line-ink (1px) standard. Line-ink-strong su hover di card cliccabili (Link patterns, drill).
- **Internal Padding:** lg (24-28px) per card normali, xl (36-40px) per hero. Mai meno di 16px (md).

### Inputs / Fields
- **Style:** surface-table-2 bg, line-ink-strong bordo, rounded-md, testo Foglio. Padding 10px 14px.
- **Focus:** bordo Twilight, outline none. Niente focus ring esterno (il bordo che cambia colore basta).
- **Disabled:** opacity 0.4, cursor not-allowed.

### Navigation (topbar Home)
- **Style:** sticky top, backdrop-filter blur(14px), bg header-bg (rgba 10/12/24, 0.85), bottom border line-ink.
- **Link:** pill rounded-pill, padding 8px 14px, testo Foglio Morbido. Hover: bg rgba(255,255,255,0.04), bordo line-ink, testo Foglio.
- **Coach chip (Nonno O.):** sempre presente in alto-left, bg `color-mix(twilight, 12%, transparent)`, color Twilight Soft, font-weight 700.
- **Streak badge:** `🔥 N` in pill con gradiente Danger→Warn (è il fuoco della catena). Padding ridotto (4px 12px), font-mono.

### Hero Obiettivo (signature component)
La card più importante del prodotto. Bg con radial-gradient da brand-glow + linear-gradient da twilight 8% verso surface-table. Bordo `rgba(246,198,74,0.3)` (Miele tinted). Stella ★ in display-large color Miele d'Onice con text-shadow `0 0 24px rgba(246,198,74,0.5)`. Headline "Da [current] a [target] [tc]" con i numeri in mono e l'oro per il target. Il verdict pill colorato (on_track green / in_ritardo warn / stagnante neutral / regressione danger / raggiunto twilight).

## 6. Do's and Don'ts

### Do:
- **Do** usare Twilight per ≤15% della superficie di qualsiasi schermo. Una voce, non vernice.
- **Do** riservare Miele d'Onice all'Obiettivo. Hero, target rating, "verso 1600 rapid" sempre miele.
- **Do** usare mono per ogni numero che si confronta (rating, %, cp_loss, mosse SAN).
- **Do** padding generoso (24-28px nelle card, 36-40px nelle hero). Lo spazio è parte del rispetto verso chi legge.
- **Do** `transform: scale(0.97)` sui bottoni primari `:active`. Il bottone sente la pressione.
- **Do** transizioni 160-220ms con `cubic-bezier(0.23, 1, 0.32, 1)` (strong ease-out). Mai `ease-in`, mai `transition: all`.
- **Do** stratificare con tonal layers (surface-table 1/2/3). Le ombre sono funzionali, non decorative.
- **Do** Italian vero scacchistico (pezzo in presa, mediogioco, ottava traversa, scacco di scoperta). Mai "blunder", mai "hanging piece" calco inglese.
- **Do** Un solo CTA per schermo. Niente affiancamenti di pulsanti competitivi.
- **Do** Numeri solo quando Nonno li cita nel discorso ("8 secondi", "1 su 8"). Mai come stat di sé stessi sul Tavolo.

### Don't:
- **Don't** dashboard chess.com / aimchess / lichess insights con card affiancate piene di stat colorate. È la categoria sbagliata.
- **Don't** purple gradient hero generici, mesh dark con neon glow. È l'estetica AI 2024-2026 saturata.
- **Don't** badge, livelli, leaderboard, achievement gridati. È gamification finta.
- **Don't** glassmorphism decorativo (backdrop-blur su tutto). Eccezione unica: header sticky.
- **Don't** card dentro card. Mai nested. Surface-table-3 NON è una card — è una pill/chip.
- **Don't** `box-shadow` decorative sotto le card. Profondità via tonal layering only.
- **Don't** `transform: scale(0)` per entrate. Sempre da `scale(0.95)` con `opacity: 0`. Nulla appare dal nulla.
- **Don't** `ease-in` su elementi UI — fa sentire la UI lenta. Sempre ease-out o curve custom.
- **Don't** `transition: all` (mai). Specifica le proprietà animate.
- **Don't** font Serif decorativi (Cormorant, Playfair). Inter + Inter Tight + JetBrains Mono, niente altro.
- **Don't** Em dash (`—` usato come connettore). Usa virgole, due punti, parentesi, periodi.
- **Don't** Multi-page navigation con `/cruscotto`, `/storia`, `/repertorio` separate. È UN flusso (Tavolo + Sessione + Quaderno), non un menu.
- **Don't** Side-stripe borders (`border-left: 3px solid X`) come accento decorativo su card. Mai. Usa bordo pieno tinted o sfondo tinted invece.
- **Don't** "drill" / "drillare" come termini utente. Usa "allenare" / "allenamento" / "esercizio".
- **Don't** "MAIA 1600" come label utente. È "avversario 1600 rapid" o "il livello che vuoi diventare".
