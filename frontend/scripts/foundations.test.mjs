import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontend = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../", import.meta.url));

function quotedValues(block) {
  return [...block.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function typescriptConstArray(source, name) {
  const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`));
  assert.ok(match, `missing TypeScript array ${name}`);
  return quotedValues(match[1]).sort();
}

function sqlConstantArray(source, name) {
  const match = source.match(new RegExp(`${name}[\\s\\S]*?:=\\s*array\\[([\\s\\S]*?)\\];`, "i"));
  assert.ok(match, `missing SQL array ${name}`);
  return quotedValues(match[1]).sort();
}

function testJwt(role) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role })}.test-signature`;
}

function runProductionPreflight(key, origin = "https://example.github.io/") {
  const script = join(frontend, "scripts/verify-production-env.mjs");
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_ANON_KEY: key,
      VITE_PRIVACY_CONTACT_EMAIL: "privacy@example.org",
      PUBLIC_SITE_ORIGIN: origin,
    },
  });
}

test("public assets contain no legacy personal datasets", async () => {
  const names = await readdir(join(frontend, "public"));
  assert.equal(names.includes("metrics.json"), false);
  assert.equal(names.includes("player_model.json"), false);
  assert.equal(names.includes("analysis"), false);
});

test("trust migration keeps projections server-owned and transfer idempotent", async () => {
  const sql = await readFile(join(repository, "supabase/migrations/0007_foundations_trust.sql"), "utf8");
  assert.match(sql, /drop constraint if exists profiles_chess_com_username_key/i);
  assert.match(sql, /alter table public\.anchor_mastery\s+enable row level security/i);
  assert.doesNotMatch(sql, /create policy anchor_mastery_self_(insert|update|delete)/i);
  assert.match(sql, /unique \(user_id, anchor_key, observation_key\)/i);
  assert.match(sql, /pg_column_size\(properties\) <= 8192/i);
  assert.match(sql, /before insert on public\.analytics_events/i);
  assert.match(sql, /new\.mode not in \('guided', 'drill', 'review'\)/i);
  assert.match(sql, /v_success::numeric \* 0\.6/i);
  assert.match(sql, /training_attempts > 0[\s\S]*for update/i);
  assert.match(sql, /record_authenticated_analytics_event/i);
  assert.doesNotMatch(sql, /create policy analytics_events_self_insert/i);
  assert.match(sql, /revoke insert on public\.analytics_events from authenticated/i);
});

test("beta invite is enforced at the hosted Auth boundary", async () => {
  const sql = await readFile(join(repository, "supabase/migrations/0007_foundations_trust.sql"), "utf8");
  const signup = await readFile(join(frontend, "src/pages/auth/Signup.tsx"), "utf8");
  assert.match(sql, /event->'user'->'user_metadata'->>'invite_code'/i);
  assert.match(sql, /grant usage on schema public to supabase_auth_admin/i);
  assert.match(sql, /grant execute on function public\.hook_validate_invite_code\(jsonb\) to supabase_auth_admin/i);
  assert.match(sql, /revoke execute on function public\.hook_validate_invite_code\(jsonb\)[\s\S]*from public, anon, authenticated/i);
  assert.match(signup, /options:\s*\{[\s\S]{0,400}data:\s*\{\s*invite_code:/i);
});

test("onboarding saves the public profile and leaves job creation to the orchestrator", async () => {
  const onboarding = await readFile(join(frontend, "src/pages/auth/Onboarding.tsx"), "utf8");
  assert.match(onboarding, /from\("profiles"\)\.insert/);
  assert.doesNotMatch(onboarding, /from\("ingest_jobs"\)\.insert/);
  assert.doesNotMatch(onboarding, /already linked to another account/i);
  assert.doesNotMatch(onboarding, /gia' collegato a un altro account/i);
  assert.match(onboarding, /await refreshProfile\(\)/);
  assert.match(onboarding, /nav\("\/onboarding\/waiting", \{ replace: true \}\)/);
});

test("account lifecycle derives identity from JWT, never request body", async () => {
  const source = await readFile(join(repository, "supabase/functions/account-data/index.ts"), "utf8");
  assert.match(source, /auth\.getUser\(jwt\)/);
  assert.doesNotMatch(source, /body\.user_id/);
  assert.match(source, /deleteAuthUserIdempotently\(service, user\.id\)/);
  assert.match(source, /removeStorageFilesCompletely\(service, user\.id\)/);
  assert.match(source, /MAX_BODY_BYTES/);
  assert.doesNotMatch(source, /req\.json\(\)/);
});

test("account deletion fences stale JWT storage before destructive cleanup", async () => {
  const sql = await readFile(
    join(repository, "supabase/migrations/0013_account_deletion_fence.sql"),
    "utf8",
  );
  const source = await readFile(
    join(repository, "supabase/functions/account-data/index.ts"),
    "utf8",
  );
  const privacy = await readFile(join(frontend, "src/pages/Privacy.tsx"), "utf8");

  assert.match(sql, /create table if not exists public\.account_deletion_fences/i);
  assert.match(sql, /references auth\.users\(id\) on delete cascade/i);
  assert.match(sql, /alter table public\.account_deletion_fences enable row level security/i);
  assert.match(sql, /revoke all on public\.account_deletion_fences from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, delete on public\.account_deletion_fences to service_role/i);
  assert.doesNotMatch(sql, /create policy[^;]+account_deletion_fences/i);
  assert.match(
    sql,
    /create or replace function public\.user_storage_access_allowed\(\)[\s\S]*security definer[\s\S]*exists \([\s\S]*public\.profiles[\s\S]*not exists \([\s\S]*public\.account_deletion_fences/i,
  );
  assert.equal(
    [...sql.matchAll(/and public\.user_storage_access_allowed\(\)/gi)].length,
    5,
  );
  for (const operation of ["select", "insert", "update", "delete"]) {
    assert.match(sql, new RegExp(`create policy "user_data_${operation}_self"`, "i"));
  }

  assert.match(source, /ignoreDuplicates: true/);
  assert.match(source, /error\.code === "23503"[\s\S]*waitForAdminUserMissing/);
  assert.match(source, /errorStatus\(error\) === 404 \|\| errorCode\(error\) === "user_not_found"/);
  assert.match(source, /auth\.admin\.getUserById\(userId\)/);
  assert.match(source, /"account_deletion_fences"/);
  assert.doesNotMatch(source, /removedAfterDelete/);

  const stageAt = source.indexOf("await stageAccountDeletionFence(service, user.id)");
  const anonymousAt = source.indexOf("await deleteLinkedAnonymousEvents(service, anonymousIds)");
  const storageAt = source.indexOf("await removeStorageFilesCompletely(service, user.id)");
  const authAt = source.indexOf("await deleteAuthUserIdempotently(service, user.id)");
  assert.ok(stageAt >= 0 && stageAt < anonymousAt);
  assert.ok(anonymousAt < storageAt && storageAt < authAt);
  assert.match(source, /const remaining = await listStorageFiles\(service, userId\)/);
  assert.match(privacy, /blocchiamo subito nuove operazioni sui file privati/i);
});

test("telemetry honors privacy signals before anonymous identifiers", async () => {
  const source = await readFile(join(frontend, "src/lib/telemetry.ts"), "utf8");
  const landing = await readFile(join(frontend, "src/pages/Landing.tsx"), "utf8");
  assert.match(source, /browserDoNotTrackEnabled/);
  assert.match(source, /globalPrivacyControl/);
  assert.match(source, /if \(typeof window === "undefined" \|\| !telemetryEnabled\(\)\) return;/);
  assert.doesNotMatch(source, /window\.plausible/);
  assert.doesNotMatch(source, /new CustomEvent/);
  assert.match(source, /record_authenticated_analytics_event/);
  assert.doesNotMatch(source, /from\("analytics_events"\)\.insert/);
  assert.match(source, /telemetryConsentStatus\(\) === "granted"/);
  assert.match(source, /stored === "granted" \|\| stored === "denied"/);
  assert.match(landing, /telemetryChoice === "unknown"/);
  assert.match(landing, /setTelemetryEnabled\(enabled\)/);
  assert.match(landing, /if \(enabled\) trackLandingView\(\)/);
});

test("authenticated telemetry client and database allowlists stay identical", async () => {
  const client = await readFile(join(frontend, "src/lib/telemetry.ts"), "utf8");
  const sql = await readFile(
    join(repository, "supabase/migrations/0009_authenticated_telemetry_contract.sql"),
    "utf8",
  );
  assert.deepEqual(
    typescriptConstArray(client, "AUTHENTICATED_EVENT_NAMES"),
    sqlConstantArray(sql, "v_allowed_events"),
  );
  assert.deepEqual(
    typescriptConstArray(client, "AUTHENTICATED_PROPERTY_KEYS"),
    sqlConstantArray(sql, "v_allowed_properties"),
  );
  assert.match(sql, /properties->>'analysis_completion_id'/i);
  assert.match(sql, /pg_advisory_xact_lock[\s\S]*background_analysis_partial[\s\S]*return true/i);
});

test("edge boundaries cap untrusted input and coach cost", async () => {
  const coach = await readFile(join(repository, "supabase/functions/coach-llm/index.ts"), "utf8");
  const telemetry = await readFile(join(repository, "supabase/functions/telemetry/index.ts"), "utf8");
  assert.match(coach, /MAX_REQUEST_BYTES/);
  assert.match(coach, /MAX_AGGREGATES_BYTES/);
  assert.match(coach, /parseAggregates\(parsed\)/);
  assert.match(coach, /rpc\("consume_coach_quota"/);
  assert.match(coach, /quota_unavailable/);
  assert.match(coach, /origin_not_allowed/);
  assert.doesNotMatch(coach, /profile non trovato:/i);
  assert.doesNotMatch(coach, /ctx\.chess_com_username/);
  assert.match(coach, /hasForbiddenCoachClaim\(parsed\.lesson\)/);
  assert.match(coach, /return !hasForbiddenCoachClaim\(userText\)/);
  assert.match(coach, /isNonEmptyBoundedString\(x\.one_line_diagnosis/);
  assert.match(coach, /computeAnchorDelta\(historySnapshots, lang\)/);
  assert.match(coach, /SAMPLE COMPARISON/);
  assert.match(coach, /CONFRONTO TRA CAMPIONI/);
  assert.match(coach, /finiteNumber\(s\.games_analyzed, 20, 10_000\)/);
  assert.doesNotMatch(coach, /sali verso il target/i);
  assert.doesNotMatch(coach, /confronto col tuo livello/i);
  assert.doesNotMatch(coach, /sta calando|sta crescendo/i);
  assert.doesNotMatch(coach, /te lo portavi a casa gratis/i);
  const fallbackStart = coach.indexOf("function fallbackBrief");
  const fallbackEnd = coach.indexOf("function moveNumber", fallbackStart);
  const fallback = coach.slice(fallbackStart, fallbackEnd);
  assert.doesNotMatch(fallback, /centipawn/i);
  assert.doesNotMatch(fallback, /\.label_it/);
  assert.match(coach, /renderExamples\(agg\.examples, lang\)/);
  assert.match(coach, /renderAnchors\(agg\.anchors, lang\)/);
  assert.match(coach, /\(\?:Sessione\|Session\)/);
  assert.match(telemetry, /MAX_BODY_BYTES/);
  assert.match(telemetry, /TELEMETRY_TRUST_X_FORWARDED_FOR/);
  assert.match(telemetry, /anonymous:\$\{anonymousId\}/);
  assert.ok(coach.indexOf("const teachQuota = await consumeCoachQuota") < coach.indexOf("lesson = await callOpenAiTeach"));
  assert.ok(coach.indexOf("const briefQuota = await consumeCoachQuota") < coach.indexOf("const raw = await callOpenAi"));
});

test("personal browser state is namespaced by authenticated user", async () => {
  const storage = await readFile(join(frontend, "src/auth/userStorage.ts"), "utf8");
  const auth = await readFile(join(frontend, "src/auth/AuthContext.tsx"), "utf8");
  assert.match(storage, /mygotham:user/);
  assert.match(auth, /setStorageUserScope\(nextUserId\)/);
  assert.doesNotMatch(auth, /clearUserLocalStorage/);
});

test("legacy goal cadence recovery is explicit, atomic and user-owned", async () => {
  const sql = await readFile(join(repository, "supabase/migrations/0008_goal_time_class_contract.sql"), "utf8");
  const context = await readFile(join(frontend, "src/pipeline/OnboardingRunContext.tsx"), "utf8");
  const waiting = await readFile(join(frontend, "src/pages/auth/OnboardingWaiting.tsx"), "utf8");
  assert.match(sql, /check \(goal_time_class in \('rapid', 'blitz'\)\) not valid/i);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /set goal_time_class = p_goal_time_class/i);
  assert.match(sql, /insert into public\.ingest_jobs/i);
  assert.match(sql, /revoke all on function public\.recover_legacy_goal_time_class\(text\)[\s\S]*from public, anon/i);
  assert.match(context, /!isAnalyzedTimeClass\(profile\.goal_time_class\)/);
  assert.match(waiting, /recover_legacy_goal_time_class/);
  assert.doesNotMatch(waiting, /goal_time_class\s*===\s*["'](?:bullet|daily|classical)["']/i);
});

test("user-triggered refresh and reanalysis transitions are atomic and user-owned", async () => {
  const sql = await readFile(join(repository, "supabase/migrations/0010_atomic_analysis_runs.sql"), "utf8");
  const orchestrator = await readFile(join(frontend, "src/pipeline/orchestrator.ts"), "utf8");
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /create or replace function public\.start_analysis_refresh/i);
  assert.match(sql, /create or replace function public\.start_full_reanalysis/i);
  assert.match(sql, /create or replace function public\.start_silent_refresh/i);
  assert.match(sql, /add column if not exists is_silent boolean not null default false/i);
  assert.match(sql, /refresh_after, is_silent[\s\S]*p_refresh_after, true/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('analysis-run:'/i);
  assert.match(sql, /onboarding_state = 'ready'/i);
  assert.match(sql, /update public\.games[\s\S]*insert into public\.ingest_jobs[\s\S]*update public\.profiles/i);
  assert.match(sql, /revoke all on function public\.start_analysis_refresh[\s\S]*from public, anon/i);
  assert.match(orchestrator, /rpc\("start_analysis_refresh"/);
  assert.match(orchestrator, /rpc\("start_full_reanalysis"/);
  assert.match(orchestrator, /"start_silent_refresh"/);
  assert.match(orchestrator, /\.eq\("kind", "main"\)/);
  assert.doesNotMatch(orchestrator, /export async function runRefresh[\s\S]{0,900}from\("ingest_jobs"\)\.insert/);
  assert.match(orchestrator, /updateJobOrThrow[\s\S]*rpc\("patch_ingest_job_lease"/);
});

test("browser pipeline jobs use auth-scoped crash-safe DB leases", async () => {
  const sql = await readFile(join(repository, "supabase/migrations/0012_ingest_job_leases.sql"), "utf8");
  const lease = await readFile(join(frontend, "src/pipeline/jobLease.ts"), "utf8");
  const ingest = await readFile(join(frontend, "src/pipeline/ingest.ts"), "utf8");
  const analyze = await readFile(join(frontend, "src/pipeline/analyze.ts"), "utf8");
  const orchestrator = await readFile(join(frontend, "src/pipeline/orchestrator.ts"), "utf8");
  const runtime = [lease, ingest, analyze, orchestrator].join("\n");
  const silentRuntime = orchestrator.slice(orchestrator.indexOf("export async function runSilentRefresh"));

  assert.match(sql, /add column if not exists kind text not null default 'main'/i);
  assert.match(sql, /add column if not exists lease_token uuid/i);
  assert.match(sql, /add column if not exists lease_expires_at timestamptz/i);
  assert.match(sql, /create or replace function public\.claim_ingest_job_lease/i);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(sql, /pg_advisory_xact_lock\(hashtext\('analysis-run:'/i);
  assert.match(sql, /where id = p_job_id and user_id = v_user_id[\s\S]*for update/i);
  assert.match(sql, /create or replace function public\.patch_ingest_job_lease[\s\S]*jsonb_object_keys\(p_patch\)[\s\S]*lease_token = p_lease_token[\s\S]*lease_expires_at > now\(\)/i);
  assert.match(sql, /create or replace function public\.complete_ingest_job_lease[\s\S]*p_status not in \('done', 'error'\)[\s\S]*lease_token = p_lease_token[\s\S]*lease_expires_at > now\(\)/i);
  assert.match(sql, /reap_expired_ingest_leases[\s\S]*set lease_token = null,[\s\S]*lease_expires_at = null[\s\S]*lease_expires_at <= now\(\)/i);
  assert.doesNotMatch(sql, /silent_lease_expired/i);
  assert.match(sql, /p_refresh_after, 'main', false/i);
  assert.match(sql, /p_refresh_after, 'silent', true/i);
  assert.match(sql, /revoke insert, update, delete on table public\.ingest_jobs from authenticated, anon/i);
  assert.match(sql, /drop policy if exists "ingest_jobs_self_update"/i);

  assert.match(lease, /claim_ingest_job_lease/);
  assert.match(lease, /releaseClaimToken\(claimRow\.job_id, claimRow\.lease_token\)/);
  assert.match(lease, /expectedKind: IngestJobKind/);
  assert.match(lease, /\.order\("played_at", \{ ascending: false \}\)[\s\S]*\.limit\(FREE_GAME_CAP\)/);
  assert.match(lease, /filter\(row => row.analysis_status === "done" && row.analysis_path\)/);
  assert.match(orchestrator, /expectedKind: "main"/);
  assert.match(orchestrator, /expectedKind: "silent"/);
  assert.ok(
    silentRuntime.indexOf("resumableSilentJob = await currentSilentJob")
      < silentRuntime.indexOf("newGameCount = await probeNewChessComGames"),
  );
  assert.match(orchestrator, /const persistedRefreshAfter = persistedSilentJob\.refresh_after/);
  assert.match(orchestrator, /refreshAfter: persistedRefreshAfter \?\? undefined/);
  assert.doesNotMatch(silentRuntime, /silentLease\.complete\("error"/);
  assert.match(ingest, /rpc\("patch_ingest_job_lease"/);
  assert.match(analyze, /rpc\("patch_ingest_job_lease"/);
  assert.match(analyze, /evalBefore = await engine\.evaluate[\s\S]*await pulseLease\?\.\(\)[\s\S]*evalAfter = await engine\.evaluate[\s\S]*await pulseLease\?\.\(\)/);
  assert.match(orchestrator, /pulseLease: \(\) => lease\.pulse\(\)/);
  assert.match(orchestrator, /rpc\("patch_ingest_job_lease"/);
  assert.doesNotMatch(
    runtime,
    /\.from\("ingest_jobs"\)[\s\S]{0,180}\.(?:insert|update|delete)\(/,
  );
});

test("rolling corpus retention is queued, bounded and exportable", async () => {
  const sql = await readFile(join(repository, "supabase/migrations/0011_corpus_retention.sql"), "utf8");
  const orchestrator = await readFile(join(frontend, "src/pipeline/orchestrator.ts"), "utf8");
  const accountData = await readFile(join(repository, "supabase/functions/account-data/index.ts"), "utf8");
  const privacy = await readFile(join(frontend, "src/pages/Privacy.tsx"), "utf8");
  assert.match(sql, /row_number\(\) over \(partition by time_class order by played_at desc\)/i);
  assert.match(sql, /recency_rank > p_keep/i);
  assert.match(sql, /insert into public\.corpus_prune_batches[\s\S]*delete from public\.games/i);
  assert.match(sql, /coalesce\(array_agg\(distinct paths\.path\), '\{\}'::text\[\]\)/i);
  assert.doesNotMatch(sql, /cardinality\(object_paths\) > 0/i);
  assert.match(sql, /status in \('done', 'error'\)[\s\S]*limit 20/i);
  assert.match(orchestrator, /rpc\("stage_corpus_prune"/);
  assert.match(orchestrator, /\.from\(STORAGE_BUCKET\)[\s\S]*\.remove\(paths\)/);
  assert.match(accountData, /"corpus_prune_batches"/);
  assert.match(privacy, /100 partite più recenti/);
});

test("pipeline checkpoints distinguish required state from best-effort progress", async () => {
  const ingest = await readFile(join(frontend, "src/pipeline/ingest.ts"), "utf8");
  const analyze = await readFile(join(frontend, "src/pipeline/analyze.ts"), "utf8");
  assert.match(ingest, /updateIngestJobRequired[\s\S]*rpc\("patch_ingest_job_lease"/);
  assert.match(ingest, /ingest_start_checkpoint_failed/);
  assert.match(ingest, /ingest_final_checkpoint_failed/);
  assert.match(analyze, /updateGameRequired[\s\S]*\.select\("id"\)[\s\S]*\.maybeSingle\(\)/);
  assert.match(analyze, /persistAnalyzeProgress\(jobId, leaseToken, progress\.processed, true\)/);
  assert.match(analyze, /persistAnalyzeProgress\(jobId, leaseToken, progress\.processed, false\)/);
  assert.match(analyze, /failed to persist game error state/);
});

test("manual deploy requires an explicit reachable Maia model", async () => {
  const workflow = await readFile(join(repository, ".github/workflows/build-and-deploy.yml"), "utf8");
  const preflight = await readFile(join(frontend, "scripts/verify-maia-model.mjs"), "utf8");
  const production = await readFile(join(frontend, "scripts/verify-production-env.mjs"), "utf8");
  const uploader = await readFile(join(repository, "upload-maia.mjs"), "utf8");
  assert.match(workflow, /VITE_MAIA_MODEL_URL:\s*\$\{\{ vars\.VITE_MAIA_MODEL_URL \}\}/);
  assert.match(workflow, /if: github\.event_name == 'workflow_dispatch'[\s\S]*npm run preflight:maia/);
  assert.match(workflow, /npm run preflight:production/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'[\s\S]*github\.ref/);
  assert.doesNotMatch(workflow, /group:\s*pages\s*$/m);
  assert.match(preflight, /required\("VITE_MAIA_MODEL_URL"\)/);
  assert.match(preflight, /required\("MAIA_MODEL_SHA256"\)/);
  assert.match(preflight, /required\("PUBLIC_SITE_ORIGIN"\)/);
  assert.match(preflight, /httpsOrigin\(required\("PUBLIC_SITE_ORIGIN"\)/);
  assert.match(preflight, /access-control-allow-origin/i);
  assert.match(preflight, /redirect: "manual"/);
  assert.match(preflight, /SHA-256 mismatch/);
  assert.match(production, /requireHttpsUrl\("VITE_SUPABASE_URL"\)/);
  assert.match(production, /requirePublicSupabaseKey\("VITE_SUPABASE_ANON_KEY"\)/);
  assert.match(production, /requireValue\("VITE_PRIVACY_CONTACT_EMAIL"\)/);
  assert.match(production, /requireHttpsOrigin\("PUBLIC_SITE_ORIGIN"\)/);
  assert.match(uploader, /required\("SUPABASE_REF"\)/);
  assert.match(uploader, /required\("MAIA_MODEL_SOURCE_URL"\)/);
  assert.match(uploader, /required\("MAIA_MODEL_SHA256"\)/);
  assert.match(uploader, /timingSafeEqual\(actual, expected\)/);
  assert.match(uploader, /downloadVerifiedModel[\s\S]*fetch\(url[\s\S]*SHA-256 del modello non corrispondente/i);
  assert.ok(
    uploader.indexOf("await downloadVerifiedModel") < uploader.indexOf('fetch(`${base}/storage/v1/bucket`'),
    "the model must be verified before the first Supabase mutation",
  );
  assert.doesNotMatch(uploader, /raw\.githubusercontent\.com\/[^\s"']+\/main\//i);
  assert.doesNotMatch(uploader, /https:\/\/[a-z0-9-]+\.supabase\.co/i);
});

test("production preflight admits only browser-safe Supabase keys and exact origins", () => {
  const acceptedKeys = [
    ["sb", "publishable", "abcdefghijklmnopqrstuv", "12345678"].join("_"),
    testJwt("anon"),
  ];
  for (const key of acceptedKeys) {
    const result = runProductionPreflight(key);
    assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(key), false);
  }

  const rejectedKeys = [
    ["sb", "secret", "synthetic-test-value"].join("_"),
    testJwt("service_role"),
    testJwt("supabase_admin"),
    "not-a-supabase-key",
    "one.two",
  ];
  for (const key of rejectedKeys) {
    const result = runProductionPreflight(key);
    assert.equal(result.status, 1, `unexpectedly accepted ${key.slice(0, 12)}`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(key), false);
  }

  const publicKey = acceptedKeys[0];
  for (const origin of [
    "http://example.github.io",
    "https://example.github.io/project",
    "https://example.github.io/?preview=1",
    "https://example.github.io/#preview",
    "https://user:password@example.github.io/",
  ]) {
    const result = runProductionPreflight(publicKey, origin);
    assert.equal(result.status, 1, `unexpectedly accepted origin ${origin}`);
    assert.equal(`${result.stdout}${result.stderr}`.includes(origin), false);
  }
});
