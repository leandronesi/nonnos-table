// Run against an existing local Vite server. Input is an archived Chess.com
// payload {source, games}; no account credentials or remote writes are used.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
const inputPath = process.argv[2] || ".local-validation/input.json";
const input = JSON.parse(await readFile(inputPath, "utf8"));
if (!input.games?.length) throw new Error("No games supplied");
await mkdir(".local-validation/analyses", {recursive:true});
const browser = await chromium.launch({channel:process.platform === "win32" ? "chrome" : undefined});
try {
 const page = await browser.newPage({viewport:{width:390,height:844}});
 await page.goto("http://127.0.0.1:5173/maia-test");
 const analyses=[];
 for (const game of input.games) {
  if (!/^[\w-]+$/.test(game.uuid)) throw new Error("Invalid game UUID");
  const path=`.local-validation/analyses/${game.uuid}.json`;
  let analysis;
  try { analysis=JSON.parse(await readFile(path,"utf8")); } catch(e) {if(e.code!=="ENOENT")throw e;}
  if(!analysis) {
   analysis=await page.evaluate(async (game)=>{
    const {analyzePgn}=await import("/src/pipeline/analyze.ts");
    const {StockfishEngine}=await import("/src/pipeline/stockfishWorker.ts");
    const engine=new StockfishEngine();
    const color=game.white.username.toLowerCase()==="erik"?"white":"black";
    const opponent=color==="white"?"black":"white";
    const row={id:game.uuid,user_id:"local-corpus-validation",chess_com_uuid:game.uuid,played_at:new Date(game.end_time*1000).toISOString(),time_class:game.time_class,time_control:game.time_control,color,result:game[color].result==="win"?"win":["agreed","repetition","stalemate","insufficient","50move","timevsinsufficient"].includes(game[color].result)?"draw":"loss",player_rating:game[color].rating,opponent_rating:game[opponent].rating,pgn_path:"local",analysis_path:null,analysis_status:"pending",error:null,created_at:new Date().toISOString()};
    try {return await analyzePgn(row,game.pgn,engine);} finally {engine.destroy();}
   },game);
   if(!analysis)throw new Error("Analysis returned no result");
   await writeFile(path,JSON.stringify(analysis));
  }
  analyses.push({analysis,baseSeconds:analysis.time_control_base_seconds,incrementSeconds:analysis.time_control_increment_seconds,opponentRating:game.white.username.toLowerCase()==="erik"?game.black.rating:game.white.rating});
  console.log(`Analysed ${analyses.length}/${input.games.length} games`);
 }
 const report=await page.evaluate(async sources=>{
  const {collectPatternOpportunities,selectPatternSample,buildPersonalPatternReport}=await import("/src/pipeline/personalPatterns.ts");
  const {getMaiaEngine}=await import("/src/pipeline/maia/maiaEngine.ts");
  const {scoreMaiaPolicies}=await import("/src/pipeline/maia/policySemantics.ts");
  const opportunities=collectPatternOpportunities(sources);
  const sample=selectPatternSample(opportunities,400);
  const engine=getMaiaEngine(); await engine.waitReady();
  const policies=new Map();
  for(const o of sample) {
   const mine=await engine.evaluate(o.fen,1714,o.opponentRating??1714);
   const target=await engine.evaluate(o.fen,1914,o.opponentRating??1714);
   const metrics=scoreMaiaPolicies({policyMine:mine.policy,policyTarget:target.policy,playedUci:o.playedUci,bestUci:o.bestUci,acceptableObservedUcis:o.acceptableUcis});
   policies.set(o.id,{status:metrics?"scored":"unavailable",metrics:metrics??undefined});
  }
  return buildPersonalPatternReport(opportunities,policies,1714,1914);
 },analyses);
 await writeFile(".local-validation/report.json",JSON.stringify({source:input.source,verifiedAt:new Date().toISOString(),report},null,2));
 console.log(JSON.stringify({games:analyses.length,opportunities:report.opportunities,sampled:report.sampled,patterns:report.patterns.map(p=>({kind:p.kind,games:p.games,opportunities:p.opportunities,evidence:p.evidence,maia:p.maia}))}));
} finally { await browser.close(); }
