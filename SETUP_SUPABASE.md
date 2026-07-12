# Setup Supabase

La procedura operativa canonica è nel [README](README.md), nelle sezioni
“Setup Supabase” e “Deploy”. Questo file resta solo come indice per evitare che
istruzioni storiche producano un ambiente hosted incompleto o insicuro.

Checklist minima, da non eseguire parzialmente:

1. installa e autentica la Supabase CLI, poi collega esplicitamente il progetto;
2. esegui `supabase db push`: vanno applicate **tutte** le migration ordinate in
   `supabase/migrations/`, non singoli file copiati a mano;
3. abilita in Auth il Before User Created hook creato dalle migration e verifica
   signup senza invito, con invito errato e con invito valido;
4. configura URL e redirect esatti per localhost e per l’origine pubblica;
5. pubblica `coach-llm`, `account-data` e `telemetry` con i flag indicati nel
   README, poi configura origin allowlist, quota e secret server-side;
6. configura in GitHub Secrets/Variables tutte le env richieste dal preflight:
   Supabase URL/publishable key (o legacy `anon`, mai secret/service-role),
   contatto privacy, origine pubblica, URL Maia e SHA-256;
7. lancia il workflow corrente
   [build-and-deploy.yml](.github/workflows/build-and-deploy.yml) manualmente.

Non inserire service-role key nel frontend o in GitHub Pages. Non usare URL,
project ref o origini personali come fallback nel repository. Il deploy deve
fallire se una configurazione pubblica obbligatoria manca.
