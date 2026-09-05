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

const email=`pattern-validation-${randomUUID()}@example.invalid`, password=randomBytes(30).toString("base64url");
let owner,browser;
const manifest=".local-validation/full-journey-owner.json";
const summary={startedAt:new Date().toISOString(),milestones:[],completed:false};
async function mark(event,detail={}){summary.milestones.push({at:new Date().toISOString(),event,...detail});await writeFile('.local-validation/full-journey-summary.json',JSON.stringify(summary,null,2));console.log(event,JSON.stringify(detail));}
await mkdir('.local-validation',{recursive:true});
try {
 if(process.argv.includes('--cleanup-only')){owner=JSON.parse(await readFile(manifest,'utf8')).id;} else {
 owner=checked(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{purpose:'pattern-validation'}})).user.id;
 await writeFile(manifest,JSON.stringify({id:owner,purpose:'pattern-validation'}));
 checked(await admin.from('profiles').insert({user_id:owner,chess_com_username:'erik',goal_rating:2100,goal_horizon_weeks:26,goal_time_class:'blitz',weekly_minutes:120,onboarding_state:'pending'}));
 browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined});
 const page=await browser.newPage({viewport:{width:390,height:844},locale:'it-IT'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/login');
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Entra',exact:true}).click();
 await mark('Signed in with an empty corpus');
 let firstReady=false,lastStatus='',finished=false;
 const deadline=Date.now()+90*60*1000;
 while(Date.now()<deadline){
  const jobs=checked(await admin.from('ingest_jobs').select('status,error,games_done,games_total').eq('user_id',owner).eq('kind','main').order('created_at',{ascending:false}).limit(1));
  const job=jobs[0];
  const {count,error}=await admin.from('games').select('id',{count:'exact',head:true}).eq('user_id',owner).eq('analysis_status','done');if(error)throw error;
  const status=JSON.stringify({job:job?.status,analysed:count});
  if(status!==lastStatus){console.log('Progress',status);lastStatus=status;}
  if(job?.status==='error')throw new Error(`Pipeline stopped: ${job.error}`);
  if(!firstReady && (await page.getByRole('heading',{name:'Conosci il tuo gioco.',exact:true}).count())){
   firstReady=true;assert.notEqual(job?.status,'done');
   await page.getByRole('link',{name:'Prova sulle tue posizioni',exact:true}).waitFor({timeout:30000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:'.local-validation/full-journey-first-reading.png',fullPage:true});
   await mark('First reading usable while remaining games run',{analysed:count,job:job.status});
  }
  if(job?.status==='done'){finished=true;break;}
  const open=page.getByRole('button',{name:'Apri il tuo gioco',exact:true});if(await open.isVisible())await open.click();
  await new Promise(resolve=>setTimeout(resolve,15000));
 }
 assert.ok(finished,'Full journey exceeded 90 minutes');assert.ok(firstReady,'No early access to first reading');assert.deepEqual(errors,[]);
 const games=checked(await admin.from('games').select('id,analysis_status,analysis_path,time_class').eq('user_id',owner));
 assert.equal(games.length,100);assert.ok(games.every(g=>g.analysis_status==='done'&&g.analysis_path&&g.time_class==='blitz'));
 const stored=checked(await admin.storage.from('user-data').download(`${owner}/quaderno/aggregates.json`));
 const report=JSON.parse(await stored.text());assert.equal(report.games_analyzed,100);assert.ok(report.personal_patterns.sampled>0);
 await page.reload();await page.getByText('100 partite nella lettura',{exact:true}).waitFor({timeout:30000});
 const practice=page.getByRole('link',{name:'Prova sulle tue posizioni',exact:true});
 const href=await practice.getAttribute('href');const patternId=new URL(href,page.url()).searchParams.get('pattern');
 const pattern=report.personal_patterns.patterns.find(p=>p.id===patternId);assert.ok(pattern);
 await practice.click();await page.getByRole('button',{name:'Osserva la posizione',exact:true}).click();
 await page.getByRole('button',{name:'Mi fermo a controllare',exact:true}).click();
 const san=await page.evaluate(async pattern=>{const {createPatternPractice}=await import('/src/session/patternPractice.ts');return createPatternPractice(pattern).positions[0].playedSan;},pattern);
 await page.getByLabel('La tua mossa (notazione SAN)').fill(san);await page.getByRole('button',{name:'Conferma la scelta',exact:true}).click();
 await page.getByText('Risultati salvati nel tuo account.',{exact:true}).waitFor({timeout:60000});
 const attempts=checked(await admin.from('training_attempts').select('anchor_key').eq('user_id',owner));assert.equal(attempts.length,1);assert.equal(attempts[0].anchor_key,patternId);
 await page.reload();await page.getByText('Risultati salvati nel tuo account.',{exact:true}).waitFor({timeout:30000});
 summary.completed=true;await mark('PASS full import, first reading, background completion, Maia, contextual exercise and saved reload',{games:100,maia:report.personal_patterns.sampled});
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
