# Maia locale: artefatto riproducibile

Dalla cartella `frontend`:

```powershell
npm.cmd run setup:maia
npm.cmd run dev
```

Il comando scarica il modello definito in
`scripts/maia-model.lock.json`, controlla dimensione e SHA-256 e lo scrive in
`public/maia3/maia3_simplified.onnx`. Un file già valido viene riutilizzato.
Il binario generato non è versionato; la sorgente è fissata a un commit.

Fonte: [CSSLab/maia-platform-frontend](https://github.com/CSSLab/maia-platform-frontend/tree/a6e52f5c811ee18863cb2f0e81f2433a5b9905de),
percorso `public/maia3/maia3_simplified.onnx`.
Conservare la provenienza e le condizioni del progetto originale quando si
prepara una distribuzione; il download locale non modifica il deploy remoto.

La verifica browser con modello reale si esegue con:

```powershell
npm.cmd run test:mobile -- maia-real.spec.ts
```

Controlla entrambe le parti al tratto, tutte le mosse legali, normalizzazione,
coerenza batch/singola inferenza e confronto 1200→1400 con avversario fisso a
1300. Il report allegato al test contiene le policy effettive. Non prova che
queste siano frequenze umane calibrate, né che allenarsi faccia guadagnare Elo.

Per il corpus pubblico di verifica, `scripts/verify-real-corpus.mjs` legge un
payload Chess.com `{source, games}` in `.local-validation/input.json`, analizza
le partite attraverso `analyzePgn` e salva checkpoint e report esclusivamente
in `.local-validation/`. La verifica corrente usa il profilo pubblico `erik`,
blitz di gennaio 2022, e riferimento 1714→1914. Questo script è una verifica
specifica del corpus, non un importatore per l'utente finale. Non scrive su
Supabase. I checkpoint permettono di riprendere il controllo dopo una chiusura
senza ripetere le partite già analizzate.
