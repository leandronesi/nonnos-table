import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL execution in-process; only Supabase's auth role/session
// primitives are supplied by the harness. Application SQL is read unchanged.
const db = new PGlite();
try {
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
 create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth, public to anon, authenticated, service_role;
 grant execute on function auth.uid() to anon, authenticated, service_role;
 alter default privileges in schema public grant all on tables to authenticated, service_role;
 `);
 for(const file of ["0001_init.sql","0003_coach_rate_limit.sql","0004_invite_codes.sql","0005_goal_deadline_and_refresh.sql","0006_ingest_status_two_tempo.sql","0007_foundations_trust.sql","0008_goal_time_class_contract.sql","0009_authenticated_telemetry_contract.sql","0010_atomic_analysis_runs.sql","0011_corpus_retention.sql","0012_ingest_job_leases.sql"]) {
  await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`,import.meta.url),"utf8"));
  console.log(`Applied ${file}`);
 }
 const owner="10000000-0000-4000-8000-000000000001", other="10000000-0000-4000-8000-000000000002", attempt="20000000-0000-4000-8000-000000000001";
 await db.query("insert into auth.users values ($1),($2)",[owner,other]);
 await db.exec("set role authenticated");
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 const saved = await db.query(`insert into public.training_attempts(id,user_id,anchor_key,mode,move_uci,verdict,correct,response_ms,occurred_at,created_at)
 values($1,$2,'time_reserve:blitz:300:0:middlegame','drill','e2e4','perfect',true,2200,'1900-01-01','1900-01-01') returning *`,[attempt,owner]);
 assert.equal(saved.rows.length,1);
 assert.ok(new Date(saved.rows[0].created_at).getTime()>Date.UTC(2020,0,1));
 await assert.rejects(db.query("insert into public.training_attempts(id,user_id,anchor_key) values($1,$2,'duplicate')",[attempt,owner]), /duplicate key/);
 await assert.rejects(db.query("insert into public.training_attempts(user_id,anchor_key) values($1,'foreign')",[other]), /row-level security/);
 await assert.rejects(db.query("update public.anchor_mastery set mastery_score=1 where user_id=$1",[owner]), /permission denied/);
 const key="time_reserve:blitz:300:0:middlegame";
 await db.query("select public.record_anchor_transfer($1,$2,true,$3,$4)",[key,"pattern-v1:game:21","game","game:21"]);
 await db.query("select public.record_anchor_transfer($1,$2,true,$3,$4)",[key,"pattern-v1:game:21","game","game:21"]);
 const mastery=await db.query("select training_attempts,game_opportunities,transfer_successes from public.anchor_mastery where anchor_key=$1",[key]);
 assert.deepEqual(mastery.rows,[{training_attempts:1,game_opportunities:1,transfer_successes:1}]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
 assert.equal((await db.query("select * from public.training_attempts")).rows.length,0);
 assert.equal((await db.query("select * from public.anchor_transfer_observations")).rows.length,0);
 console.log("PASS: server timestamps, idempotent attempts/transfers, projections and cross-account isolation.");
 await db.exec("reset role");
 await db.query(`insert into profiles(user_id,chess_com_username,goal_rating,goal_horizon_weeks,goal_time_class,weekly_minutes,onboarding_state)
 values($1,'fixture-one',1600,26,'blitz',120,'ready'),($2,'fixture-two',1600,26,'blitz',120,'ready')`,[owner,other]);
 await db.query(`insert into ingest_jobs(user_id,status,created_at) values
 ($1,'analyzing_rest','2020-01-01'),($1,'done','2021-01-01'),
 ($2,'analyzing_rest','2020-01-01'),($2,'done','2021-01-01'),($2,'queued','2022-01-01')`,[owner,other]);
 await db.query(`update ingest_jobs set lease_token=gen_random_uuid(),lease_expires_at=now()+interval '1 hour'
 where user_id=$1 and status='analyzing_rest'`,[other]);
 await db.exec("set role authenticated");
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
 await assert.rejects(db.query("select start_analysis_refresh('blitz',null)"),/analysis_run_in_progress/);
 await db.exec("reset role");
 await db.exec(await readFile(new URL("../../supabase/migrations/0014_retire_superseded_legacy_runs.sql",import.meta.url),"utf8"));
 const retired=await db.query("select status,error from ingest_jobs where user_id=$1 and created_at='2020-01-01'",[owner]);
 assert.deepEqual(retired.rows,[{status:"error",error:"superseded_by_completed_run"}]);
 const preserved=await db.query("select status from ingest_jobs where user_id=$1 order by created_at",[other]);
 assert.deepEqual(preserved.rows.map(r=>r.status),["analyzing_rest","done","queued"]);
 await db.exec("set role authenticated");
 assert.ok((await db.query("select start_analysis_refresh('blitz',null) as job")).rows[0].job);
 console.log("PASS: legacy refresh blocker reproduced and repaired; live leases and current paused runs preserved.");
} finally { await db.close(); }
