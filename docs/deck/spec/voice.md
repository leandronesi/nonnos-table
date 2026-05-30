# spec/voice.md — tono e voce del copy

## Profilo della voce

Italiano colloquiale alto. Come se stessi spiegando una cosa importante
a un amico intelligente che pero' non e' del settore. Non sei a una
conferenza accademica, ma neanche al bar.

### Tre coordinate

- **Diretto, non aggressivo.** "Quello che chiami AI non e' l'LLM" e' diretto.
  "Voi non avete capito un cazzo" e' aggressivo. La prima va bene, la seconda no.
- **Autorevole, non saccente.** "Lo dice Karpathy" autorevole.
  "Come *ovviamente* sai..." saccente. Mai presumere conoscenza pregressa.
- **Asciutto, non telegrafico.** Frasi corte ma complete. Niente bullet
  point selvaggi senza sintassi.

## Regole concrete

### Lessico

- Italiano. **Mai** mescolare italiano e inglese senza necessita'.
  Esempio buono: "loop runtime" (concetto tecnico, ok inglese).
  Esempio cattivo: "fai il tweak del prompt nel modo migliore".
- Termini tecnici inglesi vanno **spiegati la prima volta** che compaiono.
  ("Un *harness*, cioe' l'impalcatura che gira intorno al modello").
- Nessun jargon non spiegato. Mai.

### Punteggiatura

- **Niente em-dash** (—). Usa virgole, parentesi, due punti, punto e virgola.
  Vale anche per il double-hyphen (`--`).
- Frasi corte. **Mai** frasi di piu' di 3 subordinate.
- Punto fermo > virgola lunga. Quando una frase dura piu' di una riga,
  probabilmente spezzala.

### Parole zombie da evitare

Sono parole che riempiono ma non aggiungono. Bannate per default:

- "infatti" (quasi sempre sostituibile con un punto)
- "in conclusione", "in sintesi", "in definitiva"
- "tuttavia" (quasi sempre = "ma")
- "ovviamente", "chiaramente" (presumono cose nella testa del lettore)
- "potremmo dire che" (perimetra, indebolisce)
- "vale la pena notare che" (rumore)

### Pull-quote

I momenti forti vanno isolati in `<div class="pull">`. Una pull-quote
ben fatta:
- E' una frase, due al massimo
- Reggerebbe da sola anche estratta
- Non e' una semplice ripetizione del titolo della slide
- Vale la pena memorizzarla

Esempi buoni nel deck:
> "Il valore di guida non sta nel motore. Sta in come il resto dell'auto gli sta intorno."
> "Il modello non sa nulla di te tra un turno e il successivo. L'unica cosa che sopravvive e' cio' che e' scritto sul filesystem."

## Esempi di voce — buoni vs cattivi

### Slide 1 — Hook

**Cattivo (saccente, presuntuoso):**
> "Bene, vediamo se hai capito come funziona davvero l'AI. Sicuramente
> hai sentito parlare di ChatGPT, ma in realta'..."

**Buono (diretto, rispettoso):**
> "Provo a indovinare. Pensi a una specie di interlocutore intelligente
> a cui fai una domanda e che ti risponde."

### Slide 12 — Ah moment

**Cattivo (telegrafico, freddo):**
> "Il modello non ha memoria. La memoria sta sul disco. Fine."

**Buono (autorevole, ritmato):**
> "Il modello non sa nulla di te tra un turno e il successivo.
> L'unica cosa che sopravvive e' cio' che e' scritto sul filesystem."

### Slide 17 — Anti-pattern P1

**Cattivo (generico):**
> "Non usare database per lo stato. Usa cartelle."

**Buono (motivato, concreto):**
> "Postgres, Mongo, Redis per memorizzare 'dove e' l'agente'. Overkill.
> Stai introducendo concorrenza, transazioni, schema migration — per
> leggere e scrivere 5 file di stato. → Usa il filesystem."

## Quanto puo' essere lunga una slide

Target: **leggibile in 30-60 secondi** lettura silenziosa. Significa:
- Max 200 parole di testo "scorrevole"
- O 5-7 voci di lista
- O 1 pull-quote + 100 parole di contorno

Se una slide non sta in questi limiti, va spezzata in due o ridotta.

Le slide con codice (es. snippet API, file tree, skill markdown) possono
essere piu' lunghe — i blocchi code si "leggono" piu' velocemente perche'
sono visivamente compatti.
