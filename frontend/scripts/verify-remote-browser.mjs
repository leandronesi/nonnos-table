import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";

const cli=process.env.SUPABASE_CLI || join(process.env.LOCALAPPDATA,"npm-cache/_npx/aa8e5c70f9d8d161/node_modules/@supabase/cli-windows-x64/bin/supabase.exe");
const ref=(await readFile("../supabase/.temp/project-ref","utf8")).trim();
let keys;
try { keys=JSON.parse(execFileSync(cli,["projects","api-keys","--project-ref",ref,"--output","json"],{encoding:"utf8",stdio:["ignore","pipe","pipe"]})); } catch { throw new Error("Cannot obtain administrative access through configured CLI"); }
const key=keys.find(k=>k.name==="service_role")?.api_key;
if(!key)throw new Error("Administrative key unavailable");
const admin=createClient(`https://${ref}.supabase.co`,key,{auth:{persistSession:false,autoRefreshToken:false}});
const checked = ({data,error}) => { if(error)throw new Error(error.message);return data; };
const input=JSON.parse(await readFile(".local-validation/input.json","utf8"));
const email=`pattern-validation-${randomUUID()}@example.invalid`, password=randomBytes(30).toString("base64url");
let owner, browser, page;
const manifest=".local-validation/remote-test-owner.json";
await mkdir(".local-validation",{recursive:true});
try {
 if(process.argv.includes("--cleanup-only")) {
  owner=JSON.parse(await readFile(manifest,"utf8")).id;
 } else {
 owner=checked(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{purpose:"pattern-validation"}})).user.id;
 await writeFile(manifest,JSON.stringify({id:owner,purpose:"pattern-validation"}));
 const analyses=[],rows=[];
 for(const game of input.games){
  const analysis=JSON.parse(await readFile(`.local-validation/analyses/${game.uuid}.json`,"utf8"));
  const color=game.white.username.toLowerCase()==="erik"?"white":"black", other=color==="white"?"black":"white";
  const result=game[color].result==="win"?"win":["agreed","repetition","stalemate","insufficient","50move","timevsinsufficient"].includes(game[color].result)?"draw":"loss";
  analysis.result=result;
  const raw=`${owner}/raw/2022-01/${game.uuid}.pgn`, path=`${owner}/analysis/${game.uuid}.json`;
  checked(await admin.storage.from("user-data").upload(raw,game.pgn,{contentType:"application/x-chess-pgn"}));
  checked(await admin.storage.from("user-data").upload(path,JSON.stringify(analysis),{contentType:"application/json"}));
  analyses.push(analysis);
  rows.push({id:game.uuid,user_id:owner,chess_com_uuid:game.uuid,played_at:new Date(game.end_time*1000).toISOString(),time_class:game.time_class,time_control:game.time_control,color,result,player_rating:game[color].rating,opponent_rating:game[other].rating,pgn_path:raw,analysis_path:path,analysis_status:"done",error:null});
 }
 checked(await admin.from("games").insert(rows));
 const profile=checked(await admin.from("profiles").insert({user_id:owner,chess_com_username:"erik",goal_rating:1914,goal_horizon_weeks:26,goal_time_class:"blitz",weekly_minutes:120,onboarding_state:"ready"}).select().single());
 checked(await admin.from("ingest_jobs").insert({user_id:owner,status:"done",games_total:10,games_done:10,finished_at:new Date().toISOString()}));
 console.log("Temporary account and ten real-game analyses prepared in private storage.");
 browser=await chromium.launch({channel:process.platform==="win32"?"chrome":undefined});
 page=await browser.newPage({viewport:{width:390,height:844},locale:"it-IT"});
 page.setDefaultTimeout(30_000);
 page.on("framenavigated",frame=>{if(frame===page.mainFrame())console.log("Route:",new URL(frame.url()).pathname);});
 await page.addInitScript(userId=>localStorage.setItem(`nt_newgames_check_${userId}`,String(Date.now())),owner);
 await page.goto("http://127.0.0.1:5173/login");
 await page.getByLabel("Email",{exact:true}).fill(email);
 await page.getByLabel("Password",{exact:true}).fill(password);
 await page.getByRole("button",{name:"Entra",exact:true}).click();
 await page.waitForURL("**/tavolo",{timeout:30_000});
 console.log("Real browser sign-in passed. Computing and saving aggregates as the authenticated user.");
 await page.goto("http://127.0.0.1:5173/maia-test");
 const report=await page.evaluate(async ({owner,rows,analyses,profile})=>{
  const {computeAggregates}=await import("/src/pipeline/aggregate.ts");
  const {buildPlayerModelLite}=await import("/src/pipeline/playerModelLite.ts");
  const {uploadJson}=await import("/src/auth/storage.ts");
  await uploadJson(`${owner}/quaderno/player_model_lite.json`,buildPlayerModelLite(rows,analyses,profile));
  const result=await computeAggregates(owner,"blitz",1714,1914);
  return result.personal_patterns;
 },{owner,rows,analyses,profile});
 assert.ok(report.patterns.some(p=>p.evidence==="recurring"));
 const chosen=report.patterns.find(p=>p.kind==="time_reserve"&&p.evidence==="recurring");
 assert.ok(chosen);
 console.log(`Remote aggregation passed: ${report.opportunities} opportunities, ${report.sampled} Maia-scored positions.`);
 await page.goto("http://127.0.0.1:5173/tavolo");
 await page.getByText("10 partite nella lettura",{exact:true}).waitFor({timeout:30_000});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:".local-validation/remote-home-390.png",fullPage:true});
 await page.goto(`http://127.0.0.1:5173/quaderno?pattern=${encodeURIComponent(chosen.id)}`);
 await page.getByRole("link",{name:"Allenati su questo pattern",exact:true}).waitFor({timeout:30_000});
 await page.goto(`http://127.0.0.1:5173/sessione?pattern=${encodeURIComponent(chosen.id)}`);
 await page.getByRole("button",{name:"Osserva la posizione",exact:true}).click();
 await page.getByRole("button",{name:"Mi fermo a controllare",exact:true}).click();
 const san=await page.evaluate(async pattern=>{
  const {createPatternPractice}=await import("/src/session/patternPractice.ts");
  const position=createPatternPractice(pattern).positions[0];
  return position.playedSan;
 },chosen);
 await page.getByLabel("La tua mossa (notazione SAN)").fill(san);
 await page.getByRole("button",{name:"Conferma la scelta",exact:true}).click();
 await page.getByText("Risultati salvati nel tuo account.",{exact:true}).waitFor({timeout:45_000});
 const attempts=checked(await admin.from("training_attempts").select("id,anchor_key,response_ms,created_at").eq("user_id",owner));
 assert.equal(attempts.length,1);assert.equal(attempts[0].anchor_key,chosen.id);
 await page.reload();
 await page.getByText("Risultati salvati nel tuo account.",{exact:true}).waitFor({timeout:30_000});
 await page.goto("http://127.0.0.1:5173/progressi");
 await page.getByRole("heading",{level:1}).waitFor();
 await page.getByRole("heading",{name:"In allenamento",exact:true}).waitFor();
 await page.screenshot({path:".local-validation/remote-progress-390.png",fullPage:true});
 const exported=await page.evaluate(async()=>{
  const {exportAccountData}=await import("/src/auth/accountData.ts");
  const data=await exportAccountData();return {version:data.export_version,tables:Object.keys(data.tables)};
 });
 assert.equal(exported.version,1);
 await writeFile(".local-validation/remote-browser-summary.json",JSON.stringify({verifiedAt:new Date().toISOString(),games:10,opportunities:report.opportunities,maiaScored:report.sampled,trainingAttempts:attempts.length,export:exported,checks:["real login","private storage read/write","aggregate persistence","mobile home","pattern practice","training persistence","reload","progress route","account export"]},null,2));
 console.log("PASS: authenticated browser, pattern practice, server save, reload, progress and account export.");
 }
} catch(error) {
 console.error("Browser validation failed:",error.message);
 await page?.screenshot({path:".local-validation/remote-failure.png",fullPage:true}).catch(()=>{});
 throw error;
} finally {
 await browser?.close();
 if(owner){
  const user=checked(await admin.auth.admin.getUserById(owner)).user;
  if(user.user_metadata.purpose!=="pattern-validation")throw new Error("Cleanup owner guard failed");
  async function files(prefix,depth=0){
   if(depth>6)throw new Error("Cleanup depth guard failed");
   const items=checked(await admin.storage.from("user-data").list(prefix,{limit:1000}));
   const paths=[];
   for(const item of items){const path=`${prefix}/${item.name}`;if(item.id||item.metadata)paths.push(path);else paths.push(...await files(path,depth+1));}
   return paths;
  }
  const paths=await files(owner);
  if(paths.some(p=>!p.startsWith(owner+"/")))throw new Error("Cleanup path guard failed");
  if(paths.length)checked(await admin.storage.from("user-data").remove(paths));
  checked(await admin.auth.admin.deleteUser(owner));
  await unlink(manifest);
  console.log("Temporary account and private test files removed.");
 }
}
