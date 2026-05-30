-- Nonno's Table — bucket Storage utente-isolato.
--
-- Bucket: 'user-data' (privato).
-- Layout: <user_id>/raw/<YYYY-MM>/<chess_com_uuid>.pgn
--         <user_id>/analysis/<chess_com_uuid>.json
--         <user_id>/quaderno/coach_brief.json
--         <user_id>/quaderno/coach_journal.md
--         <user_id>/quaderno/aggregates.json
--
-- Policy: l'utente autenticato CRUD SOLO sui propri file (primo segmento
-- del path = auth.uid()).

insert into storage.buckets (id, name, public)
values ('user-data', 'user-data', false)
on conflict (id) do nothing;

create policy "user_data_select_self" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_data_insert_self" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_data_update_self" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "user_data_delete_self" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'user-data'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
