import { readFile } from "node:fs/promises";
const env = { ...process.env };
try {
 for(const line of (await readFile(new URL("../.env.local",import.meta.url),"utf8")).split(/\r?\n/)) {
  const match=line.match(/^\s*(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY)\s*=\s*(.*?)\s*$/);
  if(match && !env[match[1]])env[match[1]]=match[2].replace(/^['"]|['"]$/g,"");
 }
} catch(e) {if(e.code!=="ENOENT")throw e;}
if(!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error("Supabase URL and browser key are required");
let unavailable=0;
for(const table of ["profiles","games","ingest_jobs","training_attempts","anchor_mastery","anchor_transfer_observations"]) {
 const column=table==="profiles" || table==="anchor_mastery" ? "user_id" : "id";
 try {
  const r=await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${table}?select=${column}&limit=0`,{headers:{apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${env.VITE_SUPABASE_ANON_KEY}`},signal:AbortSignal.timeout(15_000)});
  const body=await r.json();
  const state=r.ok?"API reachable; authenticated writes unverified":body.code==="42501"?"Access restricted; authenticated verification required":body.code==="PGRST205"?"Not exposed in remote schema cache":"Unexpected API response";
  console.log(`${table}: ${r.status} ${body.code??""} — ${state}`);
  if(!r.ok && body.code!=="42501")unavailable++;
 } catch {console.log(`${table}: connection failed`);unavailable++;}
}
if(unavailable)process.exitCode=1;
