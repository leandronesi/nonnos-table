# Ricostruzione del prodotto: pattern, livello e tempo

## Obiettivo concordato il 5 settembre 2026

Ricostruire un prodotto pienamente utilizzabile da telefono, rivolto ai
giocatori intermedi senza coach, che individui pattern ricorrenti su N partite,
includendo la gestione del tempo e la fretta nelle decisioni; li valuti rispetto
al livello attuale e all'obiettivo, indicativamente +200 Elo; proponga allenamento
pertinente e verifichi l'evoluzione nelle partite successive.

La direzione commerciale è dare accesso gratuito ai giocatori e costruire valore
che possa interessare in futuro Chess.com. Un'acquisizione non è un risultato
garantibile dal software. Gratuità, costi operativi sostenibili e valore
dimostrabile guidano le scelte; nessun paywall entra nel percorso essenziale.

Questo documento prevale sulle precedenti visioni di prodotto per il lavoro di
ricostruzione. Il Nonno può restare come identità, senza vincolare architettura,
navigazione o diagnosi. Usabilità da telefono non significa imporre un percorso
corto: gli approfondimenti devono restare disponibili e comodi.

Precisazione esplicita dell'utente durante l'esecuzione: rifacimento **totale del
frontend**, non un aggiornamento della home o della palette. Comprende identità
visiva, navigazione, onboarding/autenticazione, pattern e prove, allenamento,
progressi, profilo e stati operativi. I servizi possono essere riutilizzati dove
corretti; le vecchie schermate non sono il risultato finale.

## Esperienza da realizzare

1. Importo le mie partite e scelgo cadenza, livello e obiettivo.
2. Leggo quali situazioni ricorrono, quali gestisco già bene e dove lavorare.
3. Apro un pattern: vedo prove in partite diverse, opportunità riuscite e
   sbagliate, contesto del cronometro, confronto Maia e limiti del campione.
4. Mi alleno su quel pattern: riconoscimento, scelta, uso del tempo e feedback.
5. Torno a giocare; il prodotto distingue risultati negli esercizi e comportamento
   nelle nuove partite, mostrandomi cosa è cambiato e cosa non sappiamo ancora.

## Contratti da verificare

- Le priorità derivano da opportunità su più partite, non solo dai peggiori errori.
- Ogni prova conserva partita, posizione, data e dati che sostengono il claim.
- Il tempo disponibile PRIMA della decisione è distinto dal clock DOPO la mossa
  e dall'incremento. Dati assenti o incoerenti non diventano zeri.
- La velocità da sola non è un errore. Fretta con riserva e pressione di tempo
  sono fenomeni distinti; i confronti tengono separati cadenza e contesto.
- Le soglie temporali sono euristiche esplicite, non stime della difficoltà umana.
- Maia confronta policy condizionate dal livello sulle alternative valide
  osservate. Non produce percentuali umane calibrate né promesse di punti Elo.
- Allenamento e osservazioni successive hanno identità stabili e ordine temporale.
- I trend riportano denominatori, copertura e insufficienza del campione.
- Telefono: verifiche a 360/390/430 px, interazioni touch, scroll, focus, scacchiera,
  tastiera, safe area, ripresa di elaborazione e sessione, stati vuoti e di errore.
- Il percorso principale è gratuito. L'accesso al valore non richiede una quota LLM
  disponibile: la diagnosi verificabile deve funzionare anche senza narrazione.

## Stato del lavoro

Il GOAL resta aperto finché l'intero percorso è implementato e verificato.

- [x] Ricognizione di documenti e implementazione; branch isolato.
- [ ] Modello di opportunità e pattern, incluso cronometro su tutte le decisioni.
- [ ] Confronto Maia su un campione rappresentativo di opportunità.
- [ ] Nuova esperienza principale e dettaglio pattern utilizzabili da telefono.
- [ ] Allenamento pertinente con osservazione delle decisioni temporali.
- [ ] Collegamento automatico alle opportunità nelle partite successive.
- [ ] Onboarding, gratuità e accesso ai dati coerenti con il nuovo prodotto.
- [ ] Verifica integrata su dati reali, test e interazioni da telefono.

La verifica finale deve citare prove per ogni riga; una build verde da sola non
dimostra il raggiungimento dell'obiettivo.

## Evidenze di implementazione, primo incremento

- `decisionTiming.ts`: opportunità su tutte le decisioni, riserva prima della
  mossa, incremento, copertura, esclusioni, conteggi riusciti/sbagliati, esempi da
  partite diverse, separazione per cadenza/fase/tipo di scelta, finestre di 10
  partite e frequenza della decisione rapida sulle opportunità con riserva.
- `analyze.ts` conserva clock iniziale, incremento e numero di mosse legali;
  `aggregate.ts` produce la lettura temporale, recuperando l'incremento storico
  dal controllo di tempo della partita quando disponibile.
- Nuova `PatternHome`, componente `TimingPatterns` e `CoachShell` con un solo
  albero React fra desktop e telefono. Nuova base visiva carta/inchiostro verde,
  temi chiaro/scuro e navigazione touch.
- Nuova `PatternLibrary`: catalogo personale e dettaglio raggiungibile tramite
  URL, esempi riusciti/sbagliati di partite diverse, scacchiera e alternative,
  cronometro e confronto di livello con copertura visibile.
- `personalPatterns.ts` definisce opportunità, identità e campione Maia condiviso
  fra pattern e lettori precedenti. La selezione è indipendente dagli esiti,
  bilanciata per pattern e partita; il confronto mantiene fisso l'avversario.
  Il campione non viene presentato come una stima casuale della popolazione.
- Il refresh esplicito può ricostruire una lettura di vecchia versione anche
  senza nuove partite, riusando le analisi esistenti tramite il job persistito.
- Anteprima locale `/dev/patterns`, esplicitamente sintetica e disponibile solo
  in sviluppo. Non è prova di diagnosi su dati reali né di completamento del GOAL.
- Verificati 17 test di fondazione, 162 test di logica e 6 test browser su
  360/390/430/1280 px, apertura delle prove, cambio partita, tema, stati vuoti
  e continuità del dettaglio passando da telefono a desktop.

## Evidenze di implementazione, secondo incremento

- `/sessione` monta ora `PatternPractice`: posizioni del pattern selezionato,
  mosse touch o SAN, valutazione Stockfish, alternative e risposta avversaria.
  Cronometro attivo solo durante la decisione; pausa, ripresa e ricaricamento
  conservano la sessione senza contare attese del motore o preparazione.
- I tentativi hanno UUID stabili e isolamento per utente. Una risposta persa
  dopo il salvataggio può essere ritentata senza duplicare il risultato.
- `patternLearning.ts` distingue pratica e opportunità nelle partite concluse
  dopo il primo allenamento, escludendo le partite usate come esercizio.
  Campioni insufficienti restano espliciti; i confronti non dichiarano causalità.
- L'aggregazione conserva un ledger di opportunità; il refresh sincronizza
  osservazioni di trasferimento con identità stabili. `/progressi` mostra
  esercizi, aiuti, denominatori e confronto prima/dopo separatamente.
- Nuovo layout condiviso per accesso e pagine auth, con campi da 16 px e almeno
  48 px di altezza. Verifica browser del login a 360 px senza overflow.
- Passano 17 test di fondazione, 172 test di logica e 8 verifiche browser;
  queste ultime includono Stockfish reale, pausa, reload e ritentativo di un
  salvataggio con risposta persa, oltre alle viste progressi e pattern.

Restano necessari: completare landing, onboarding e profilo secondo il nuovo
prodotto; verificare importazione, Maia e persistenza nel percorso completo su
dati reali. Le anteprime sintetiche non sostituiscono questa verifica.

## Evidenze di implementazione, terzo incremento

- Landing ricostruita: identità Nonno coerente, valore su N partite, esempio
  interattivo esplicitamente illustrativo con riserva e pressione temporale,
  accesso beta e scelta telemetria. Nessuna animazione automatica di una
  singola mossa presentata come diagnosi personale.
- Onboarding ricostruito: verifica del profilo, rating disponibili, scelta
  rapid/blitz e riferimento circa +200 Elo aggiornato al cambio categoria.
  Preferenze di impegno espandibili; conferma immediata senza attesa ornamentale.
  Errori di rete durante il salvataggio consentono un nuovo tentativo.
- Build riuscita. I 17 test di fondazione passano. Due ulteriori verifiche
  browser a 360 px coprono landing/accesso e onboarding con risposte sintetiche
  di Chess.com e Supabase, incluso salvataggio fallito e ripetuto.
  Verificata assenza di overflow dopo il caricamento dei font.
- Queste prove non dimostrano ancora l'importazione e persistenza remota reali.
  Restano la schermata di preparazione delle analisi, il profilo/impostazioni
  e la verifica integrata con corpus reale e Maia.

## Evidenze di implementazione, quarto incremento

- Nuova `AnalysisPreparation`: raccolta, decisioni e pattern con conteggi di
  analisi riuscite, corpus ancora sconosciuto esplicito, prima lettura accessibile
  senza attendere il brief LLM, recupero dal checkpoint attraverso il provider.
- Profilo/impostazioni ridisegnato con obiettivo e impegno visibili, sezioni
  leggibili da telefono, controlli touch e campo di conferma eliminazione con
  etichetta accessibile. Il link dalla home raggiunge il riferimento salvato.
- Build riuscita. Dieci verifiche browser passate nel run completo; l'undicesima
  ha rilevato il suffisso `?` nell'URL di uscita della sola anteprima. Corretto
  l'URL e verificato nuovamente il test di preparazione con esito positivo.
- Primo smoke test Maia reale: fallisce perché `/maia3/maia3_simplified.onnx`
  restituisce HTML (fallback Vite), non un artefatto ONNX. Modello locale assente.
  Questo è un requisito ancora non soddisfatto, non un confronto validato.
- Corretto il worker: rifiuto HTML, cache solo dopo sessione valida, recupero di
  cache corrotta, inferenza consentita anche se la cache browser è indisponibile.
  Tre test dedicati passano. Occorre procurare e verificare il modello e poi
  eseguire la pipeline su corpus reale e controllare la persistenza remota.

## Evidenze di implementazione, quinto incremento

- Modello Maia recuperato dal repository CSSLab, commit
  `a6e52f5c811ee18863cb2f0e81f2433a5b9905de`: 45.683.686 byte,
  SHA-256 `405bf76c15727dad8728b352c06a8f3c1b80fb2760e8d666b32485c63d75b856`.
  Verificata corrispondenza del blob Git. `npm run setup:maia` rende ripetibile
  la preparazione locale; lock e documentazione conservano la provenienza.
- Test browser reale riuscito: entrambe le parti al tratto, mosse legali,
  normalizzazione, coerenza batch/singola chiamata e policy 1200→1400 con
  avversario fisso a 1300. Non è una prova di calibrazione delle policy.
- `analyzePgn` espone il nucleo condiviso con l'analisi del prodotto, permettendo
  il controllo locale del corpus senza sostituire il motore con simulazioni.
- Corpus pubblico di dieci blitz del profilo `erik`, gennaio 2022: dieci analisi
  Stockfish completate, 392 decisioni con clock. Checkpoint in
  `frontend/.local-validation/analyses/`. Report finale completato: 263 opportunit?, 200 posizioni valutate con Maia.
  Verificate identit? univoche, copertura coerente e riferimenti degli esempi.
  Pattern ricorrenti osservati: pressione temporale, mantenimento del vantaggio,
  scelte delicate e uso del tempo con riserva. I campioni piccoli restano
  insufficienti; Maia non produce confronti sulle posizioni sotto i 30 secondi.
- Build riuscita e 175 test di logica passati. Persistenza remota e percorso
  completo autenticato non sono ancora dimostrati da queste verifiche locali.

## Evidenze di implementazione, sesto incremento: Supabase remoto

- Individuato e usato l'accesso amministrativo CLI già configurato. Il progetto
  collegato coincide con quello del frontend; nessuna nuova credenziale richiesta.
- Ispezionati tabelle, colonne, vincoli, indici, policy e bucket privato esistenti:
  corrispondevano alle migrazioni 0001–0006, ma mancava lo storico. Registrato
  questo baseline e applicate 0007–0013 dopo dry-run delle sole migrazioni mancanti.
- Il successivo `db push --dry-run --linked` conferma `upToDate: true` e nessuna
  migrazione pendente. Tabelle allenamenti, proiezioni e osservazioni create.
- Eseguito `supabase/tests/learning_persistence.sql` sul database remoto: insert
  riuscito con timestamp del server, UUID duplicato respinto, scritture per altro
  account respinte, proiezioni non modificabili dal client, trasferimento
  idempotente, letture isolate. Tutti i fixture, inclusi gli utenti sintetici,
  annullati con rollback; nessuna email inviata.
- Aggiunto `npm run test:database`: PostgreSQL incorporato esegue le migrazioni
  applicative e verifica i medesimi contratti. Il controllo passa.
- Corretto un limite concreto del payload: decisioni oltre un'ora conservano la
  durata reale nel contesto, senza superare il vincolo della colonna response_ms
  e senza impedire il salvataggio dell'esercizio. Test dedicato passato.
- Resta da verificare il percorso browser autenticato completo, comprese Edge
  Functions effettivamente distribuite, importazione e continuità dopo login.

## Evidenze di rilascio: browser autenticato e persistenza

- Distribuita `account-data` e configurata l'origine GitHub Pages nelle API.
- Verifica reale su account temporaneo: login, dieci analisi private, aggregazione
  di 263 opportunita con 200 posizioni Maia, esercizio Stockfish, salvataggio di
  un tentativo, ricaricamento, pagina progressi ed export account completati.
  Account e file di prova rimossi al termine. Nessuna email inviata.
- Corretto il redirect durante il caricamento del profilo: i collegamenti diretti
  agli esercizi attendono il profilo senza tornare prematuramente alla home.
- Build, 17 controlli foundation, 175 test di logica, verifica PostgreSQL e
  12 test browser passati. Il test remoto usa analisi reali precaricate e non
  dimostra ancora l'intera importazione iniziale da Chess.com.
- Per il deploy configurati modello Maia con versione e hash verificabili e
  origine pubblica. Il workflow richiede avvio manuale dopo il push su main.

## Verifica dell'importazione live e chiarezza della lettura

- `verify-live-ingest.mjs` ha importato dal browser dieci blitz correnti di un
  profilo pubblico Chess.com, con sessione autenticata, lease PostgreSQL e
  scrittura privata Supabase. Riletti tutti i dieci PGN; un secondo passaggio
  conserva le stesse identita senza duplicati. Account e file temporanei rimossi.
- La prova copre l'importatore reale, separatamente dalle verifiche di analisi,
  aggregazione e allenamento. Il ciclo completo iniziale con continuazione in
  background resta da verificare come singola esecuzione.
- La fase della partita e ora visibile nelle righe chiuse del cronometro.
  Un rating live diverso non viene presentato come il rating usato dal confronto
  Maia gia calcolato; un nuovo obiettivo forza il ricalcolo anche senza nuove
  partite. Build e controlli browser della lettura passati.

## Ordine temporale di allenamento e partite

- Le nuove analisi conservano l'inizio UTC dichiarato nel PGN, verificato contro
  l'orario di fine. Date impossibili o mancanti restano sconosciute.
- La finestra successiva richiede partite iniziate dopo il primo esercizio;
  quelle gia in corso non diventano prove di apprendimento. Gli orari mancanti
  nelle analisi precedenti escludono la partita dal confronto successivo e sono
  riportati nella pagina progressi. Il baseline usa ancora le partite concluse
  prima dell'esercizio.
- Report pattern v2: il normale aggiornamento rigenera gli aggregati precedenti.
  Non inventa orari per le vecchie analisi e non richiede migrazioni SQL.
- Build e 178 test di logica passati; verificata a 360 px anche la spiegazione
  delle partite escluse e dell'insufficienza del campione.

## Riduzione delle scelte ripetute nella home

- Il tema prioritario collega direttamente ai suoi esercizi tramite l'identita
  del pattern; le prove conservano la stessa identita. Non si torna al catalogo
  per riselezionare il tema appena proposto.
- Il cronometro resta una sezione della home. I conteggi, i contesti e le
  scacchiere si aprono su richiesta; il messaggio sui dati mancanti resta visibile.
- Rimossa la seconda proposta generica di allenamento a fondo pagina.
- Sei test browser passati: 360/390/430/1280 px, identita del tema nei due
  collegamenti, apertura delle prove temporali, cambio partita, tema visivo,
  dati mancanti e continuita del dettaglio. Ispezionata anche la home renderizzata
  a 390 px. Queste prove non chiudono la verifica integrata dell'intero GOAL.
