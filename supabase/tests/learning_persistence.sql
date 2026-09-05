-- Remote/local PostgreSQL integration check. Everything is rolled back,
-- including synthetic auth users. No email or external service is invoked.
begin;
select set_config('test.owner',gen_random_uuid()::text,true);
select set_config('test.other',gen_random_uuid()::text,true);
select set_config('test.attempt',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.owner')::uuid),(current_setting('test.other')::uuid);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.owner'),true);
insert into public.training_attempts(id,user_id,anchor_key,mode,move_uci,verdict,correct,response_ms,occurred_at,created_at)
values(current_setting('test.attempt')::uuid,auth.uid(),'verification:time_reserve','drill','e2e4','perfect',true,2200,'1900-01-01','1900-01-01');
do $$
begin
 if not exists(select 1 from public.training_attempts where id=current_setting('test.attempt')::uuid and created_at > '2020-01-01') then raise exception 'server timestamp not applied'; end if;
 begin
  insert into public.training_attempts(id,user_id,anchor_key) values(current_setting('test.attempt')::uuid,auth.uid(),'duplicate');
  raise exception 'duplicate attempt accepted';
 exception when unique_violation then null;
 end;
 begin
  insert into public.training_attempts(user_id,anchor_key) values(current_setting('test.other')::uuid,'foreign');
  raise exception 'foreign owner accepted';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.anchor_mastery set mastery_score=1 where user_id=auth.uid();
  raise exception 'client projection edit accepted';
 exception when insufficient_privilege then null;
 end;
end $$;
select public.record_anchor_transfer('verification:time_reserve','verification:game:21',true,'verification:game','verification:game:21');
select public.record_anchor_transfer('verification:time_reserve','verification:game:21',true,'verification:game','verification:game:21');
do $$
begin
 if not exists(select 1 from public.anchor_mastery where user_id=auth.uid() and anchor_key='verification:time_reserve' and training_attempts=1 and game_opportunities=1 and transfer_successes=1) then raise exception 'projection or deduplication failed'; end if;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.other'),true);
do $$
begin
 if exists(select 1 from public.training_attempts) or exists(select 1 from public.anchor_transfer_observations) then raise exception 'cross-account read allowed'; end if;
end $$;
rollback;
select 'passed: timestamps, deduplication, projections, RLS; all fixtures rolled back' as verification;
