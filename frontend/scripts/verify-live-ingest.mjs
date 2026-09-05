// Live Chess.com import through authenticated browser and remote private storage.
﻿import { execFileSync } from "node:child_process";
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
const email=`pattern-validation-${randomUUID()}@example.invalid`, password=randomBytes(30).toString("base64url");
let owner,browser;
const manifest=".local-validation/live-ingest-owner.json";
await mkdir(".local-validation",{recursive:true});
try {
 if(process.argv.includes("--cleanup-only")) {
  owner=JSON.parse(await readFile(manifest,"utf8")).id;
 } else {
 owner=checked(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{purpose:"pattern-validation"}})).user.id;
 await writeFile(manifest,JSON.stringify({id:owner,purpose:"pattern-validation"}));
 checked(await admin.from("profiles").insert({user_id:owner,chess_com_username:"erik",goal_rating:2100,goal_horizon_weeks:26,goal_time_class:"blitz",weekly_minutes:120,onboarding_state:"ready"}));
 const job=checked(await admin.from("ingest_jobs").insert({user_id:owner,status:"queued",kind:"main"}).select("id").single());
 browser=await chromium.launch({channel:process.platform==="win32"?"chrome":undefined});
 const page=await browser.newPage({viewport:{width:390,height:844},locale:"it-IT"});
 await page.addInitScript(userId=>localStorage.setItem(`nt_newgames_check_${userId}`,String(Date.now())),owner);
 await page.goto("http://127.0.0.1:5173/maia-test");
 console.log("Importing ten current public blitz games through the real browser importer.");
 const summary=await page.evaluate(async ({email,password,owner,jobId})=>{
  const {supabase}=await import("/src/auth/supabaseClient.ts");
  const {runIngest}=await import("/src/pipeline/ingest.ts");
  const {acquireOrObserveIngestJob}=await import("/src/pipeline/jobLease.ts");
  const login=await supabase.auth.signInWithPassword({email,password});
  if(login.error)throw new Error("Browser sign-in failed");
  const acquired=await acquireOrObserveIngestJob({jobId,userId:owner,goalTimeClass:"blitz",expectedKind:"main"});
  if(acquired.outcome!=="owned")throw new Error("Lease not acquired");
  const lease=acquired.lease;
  const options={userId:owner,chessComUsername:"erik",goalTimeClass:"blitz",gameCap:10,requireAtLeastOne:true,jobId,leaseToken:lease.token,guardLease:()=>lease.guard()};
  try {
   await runIngest(options);
   const first=await supabase.from("games").select("id,chess_com_uuid,time_class,pgn_path").eq("user_id",owner);
   if(first.error||first.data.length!==10||first.data.some(g=>g.time_class!=="blitz"))throw new Error("First import has incorrect scope or count");
   const firstIds=first.data.map(g=>g.id).sort();
   let downloaded=0;
   for(const row of first.data){
    const file=await supabase.storage.from("user-data").download(row.pgn_path);
    if(file.error||!(await file.data.text()).includes('[Event '))throw new Error("Private PGN unavailable");
    downloaded++;
   }
   await runIngest(options);
   const second=await supabase.from("games").select("id").eq("user_id",owner);
   if(second.error||JSON.stringify(second.data.map(g=>g.id).sort())!==JSON.stringify(firstIds))throw new Error("Repeated import changed game identities");
   await lease.complete("done",null);
   return {games:firstIds.length,downloadedPrivatePgns:downloaded,duplicateRows:second.data.length-firstIds.length,scope:"blitz",liveChessCom:true};
  } finally { await lease.release(); }
 },{email,password,owner,jobId:job.id});
 assert.equal(summary.games,10);assert.equal(summary.duplicateRows,0);
 await writeFile(".local-validation/live-ingest-summary.json",JSON.stringify({verifiedAt:new Date().toISOString(),...summary},null,2));
 console.log("PASS:",JSON.stringify(summary));
 }
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
