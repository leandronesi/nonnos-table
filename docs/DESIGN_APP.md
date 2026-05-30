# DESIGN_APP — direzione d'app (familiare + craft)

> v1 · 2026-05-30 · Dopo il feedback PO: "serve un'app come quelle usate tanto, la gente ci si deve
> ritrovare; ma restituiscimi una cosa di cui sei orgoglioso, come il pitch. Cerca ispirazioni."
> Questa direzione la prende il design (io). Convenzione dove serve, craft dove conta.

## 0. La tesi di design
**Struttura familiare (la gente si ritrova al primo tocco) + anima del pitch (il Tavolo, la sera).**
Riferimenti reali: Chess.com v4 (bottom-nav), pattern bottom-tab (Apple HIG / NN/g), Duolingo (rituale
quotidiano + streak + milestone). Le app di scacchi non sono spettacolari: la nostra vince sull'ANIMA e sulla
CHIAREZZA, non sugli effetti.

## 1. Navigazione (il fix di "non ci si ritrova" + mobile)
- **Mobile = bottom tab bar fissa**, 3 voci: **Tavolo · Sessione · Quaderno** (icona + 1 parola, attivo in
  twilight, raggiungibile col pollice, indicatore di posizione chiaro). Niente label-stepper in fila, niente
  nav sepolta in fondo alla pagina.
- **Desktop = sidebar slim** a sinistra (stesse 3 voci) + contenuto centrato. (oppure top-bar; la sidebar e' piu' "app".)
- Un solo shell (`AppShell`) avvolge le pagine autenticate: le pagine NON hanno piu' header propri ridondanti.
- Profilo/Esci/tema in un punto fisso (fondo sidebar su desktop, sotto un "tu" nel Tavolo su mobile).

## 2. Tavolo = rituale quotidiano (modello Duolingo, anima Nonno)
- In alto: **una cosa chiara da fare oggi** = "Sediamoci" (la sessione del giorno) + lo **streak** (giorni di
  fila, caldo se vivo) + la riga di Nonno. Calma: una decisione, non venti numeri.
- Sotto, in second'ordine: Obiettivo (oro) + le 3 ancore. Il dettaglio analitico vive nel Quaderno.
- Lo streak/loss-aversion e' onesto (dai dati drill_log), non gamification finta.

## 3. Craft (la faccia, il mestiere)
- **Landing**: il Tavolo la sera. Scacchiera VERA come oggetto (un Momento reale con la mossa giusta), lampada
  (radial honey), asimmetria con un senso, ritmo (sezioni che MOSTRANO, non elencano), la voce. NIENTE template
  IA (meta' destra vuota, lista 1-2-3, testo-su-viola). Riferimento di qualita' = `docs/pitch/`.
- **Una voce** (Nonno), dark di default, oro solo per l'Obiettivo, flat, token --color-*.
- Mobile-first verificato a mano: zero overflow orizzontale, tap target >= 44px, board che scala.

## 4. Ordine di esecuzione
1. **AppShell + bottom-tab/sidebar** (lo scheletro: familiare + sistema il mobile-nav). Spec stretta.
2. **Landing** ri-craftata a mano (la faccia). 
3. **Mobile correctness** sweep (overflow + stepper fasi) su tutte le superfici.
4. **R3 Repertorio drill-into** (gia' speccato §6.7 BUILD.md).
5. Unifica le superfici allo shell + craft, verifica a mano (niente "verde = fatto").

## Fonti
- Chess.com v4 (bottom-nav): https://www.chess.com/news/view/chesscom-v4-ios-android
- Bottom tab bar best practices: https://www.nngroup.com/articles/mobile-navigation-patterns/ · https://developer.apple.com/design/human-interface-guidelines/tab-bars
- Duolingo home/streak: https://blog.duolingo.com/new-duolingo-home-screen-design/
