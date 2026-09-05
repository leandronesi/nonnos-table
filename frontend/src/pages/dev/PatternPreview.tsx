import { useState } from "react";
import { AnalysisPreparation } from "../auth/AnalysisPreparation";
import { PatternHomeView, type PatternHomeData, type PatternHomeRun } from "../PatternHome";
import { buildTimingReport, assessDecisionTiming, type TimingGame } from "../../pipeline/decisionTiming";
import { buildPersonalPatternReport, type PatternOpportunity } from "../../pipeline/personalPatterns";
import { PersonalPatternDetail } from "../PatternLibrary";
import { PatternPracticeView, type PracticePersistence } from "../PatternPractice";
import { PatternProgressView } from "../PatternProgress";
import { buildPatternLearning, type LearningAttempt } from "../../pipeline/patternLearning";
import type { TrainingAttemptInput } from "../../trainingProgress";
import type { Aggregates } from "../../pipeline/aggregate";
import { CoachShell } from "../../components/AppShell";

// Explicitly synthetic, dev-only data for visual and interaction verification.
const games: TimingGame[] = Array.from({ length: 24 }, (_, i) => ({
  gameId: `synthetic-${i}`, playedAt: new Date(Date.UTC(2026, 7, i + 1)).toISOString(),
  timeClass: "rapid", baseSeconds: 600, incrementSeconds: 0,
  moves: Array.from({ length: 4 }, (_, j) => ({
    ply: 25 + j * 2, spentSeconds: j === 3 ? 18 : 2, clockBeforeSeconds: 360,
    clockRemaining: j === 3 ? 342 : 358,
    scoreBeforeCp: 30, cpLoss: j === 0 ? 150 : 0, stockfishChoiceGap: 0.65,
    legalMoveCount: 24, phase: "middlegame",
    fenBefore: "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 6",
    san: "a3", uci: "a2a3", bestMoveUci: "c1e3",
  })),
}));

const zeroPhase = { moves: 0, blunders: 0, mistakes: 0, inaccuracies: 0, blunder_pct: 0, mistake_pct: 0, inaccuracy_pct: 0, avg_cp_loss: 0 };
const opportunities: PatternOpportunity[] = games.flatMap((game) => game.moves.map((move) => ({
  id: `${game.gameId}:${move.ply}`, gameId: game.gameId, playedAt: game.playedAt, startedAt: new Date(Date.parse(game.playedAt) - 600_000).toISOString(),
  kinds: ["narrow_choice", "time_reserve"], scope: "rapid:600:0:middlegame",
  timeClass: "rapid", baseSeconds: 600, incrementSeconds: 0, opponentRating: 1250,
  phase: "middlegame", ply: move.ply, fen: move.fenBefore, color: "white",
  playedUci: move.uci, playedSan: move.san, bestUci: move.bestMoveUci,
  acceptableUcis: [move.bestMoveUci!], cpLoss: move.cpLoss, scoreBeforeCp: move.scoreBeforeCp,
  clockRemaining: move.clockRemaining,
  timing: assessDecisionTiming({ ...move, baseSeconds: 600, incrementSeconds: 0 }),
})));
const personalPatterns = buildPersonalPatternReport(opportunities, new Map(), 1200, 1400);
const previewPersistence: PracticePersistence = {
  read: () => sessionStorage.getItem("synthetic-pattern-practice"),
  write: (raw) => { sessionStorage.setItem("synthetic-pattern-practice", raw); return true; },
};
async function previewSaveAttempt(input: TrainingAttemptInput) {
  const saved: TrainingAttemptInput[] = JSON.parse(sessionStorage.getItem("synthetic-practice-saved") ?? "[]");
  const existed = saved.some((row) => row.clientAttemptId === input.clientAttemptId);
  if (!existed) {
    saved.push(input);
    sessionStorage.setItem("synthetic-practice-saved", JSON.stringify(saved));
    if (new URLSearchParams(location.search).has("failSave")) throw new Error("Simulated lost save response");
  }
  return { created_at: "2026-09-05T11:00:00Z" };
}
const previewAttempt: LearningAttempt = {
  id: "synthetic-attempt", anchor_key: personalPatterns.patterns[0].id, source_game_id: "synthetic-0", position_id: "synthetic-0:25",
  mode: "drill", verdict: "perfect", correct: true, used_hint: false, response_ms: 15000, created_at: "2026-08-10T12:00:00Z",
};
const zeroColor = { games: 0, wins: 0, draws: 0, losses: 0, win_rate: 0, avg_cp_loss: 0, blunder_pct: 0 };
const aggregates: Aggregates = {
  generated_at: "2026-09-05T00:00:00Z", games_analyzed: 24, player_moves_total: 96,
  blunder_pct: 0, mistake_pct: 25, inaccuracy_pct: 0, avg_cp_loss: 37.5,
  by_phase: { opening: zeroPhase, middlegame: zeroPhase, endgame: zeroPhase },
  by_color: { white: zeroColor, black: zeroColor }, by_time_class: {},
  anchors: [], weaknesses: [], timing: buildTimingReport(games),
  personal_patterns: personalPatterns,
};

export default function PatternPreview() {
  const [compared, setCompared] = useState(36);
  const params = new URLSearchParams(window.location.search);
  if (params.has("preparation")) return <><AnalysisPreparation
    progress={{ activity: params.has("maia") ? { stage: "maia", completed: compared, total: 200 } : undefined, phase: params.has("maia") ? "coaching" : "analyzing", monthsTotal: 2, monthsDone: 2, gamesTotal: 24, gamesDone: 6, gamesAnalyzed: 5, corpusFinalized: true }}
    error={params.has("error") ? "Esempio sintetico: connessione interrotta." : null}
    ready={params.has("ready")} username="ANTEPRIMA SINTETICA"
    onEnter={() => { window.location.href = window.location.pathname; }}
    onRetry={() => { window.location.search = "?preparation"; }} onExit={() => { window.location.href = "/login"; }}
  />{params.has("maia") && <button onClick={() => setCompared(n => n + 12)}>Simula 12 confronti completati</button>}</>;
  const empty = params.has("empty");
  const missing = params.has("missing");
  const legacy = { ...aggregates, personal_patterns: undefined, timing: undefined,
    anchors: [{ type: "fork", label_it: "Doppi attacchi", action_it: "Controlla i bersagli", meaning_it: "Un tema ricorrente", count: 8, games_with: 4, mine_pct: 42, target_pct: 55 }] } as unknown as Aggregates;
  const data: PatternHomeData = {
    aggregates: empty ? null : params.has("legacy") ? legacy : missing ? { ...aggregates, timing: undefined } : aggregates,
    loading: false, refreshing: false, reanalyzing: false,
    error: null, refreshError: null, refreshNotice: null,
    currentRating: params.has("new-rating") ? 1250 : 1200, targetRating: 1400, liveGoal: undefined,
    runRefreshHandler: async () => {},
  };
  const run: PatternHomeRun = {
    backgroundDone: params.has("completed"), backgroundRunning: false, silentRefreshing: false, backgroundError: null,
    backgroundCoverage: null, retryBackground: () => {},
  };
  return <CoachShell username="Giocatore demo" onSignOut={async () => {}}>
    <p role="note" style={{ padding: 12, textAlign: "center" }}>Anteprima di sviluppo · dati sintetici, non una diagnosi reale</p>
    {params.has("practice") ? <PatternPracticeView pattern={personalPatterns.patterns[0]} persistence={previewPersistence} saveAttempt={previewSaveAttempt} />
      : params.has("progress") ? <div className="pattern-coach"><PatternProgressView patterns={buildPatternLearning((personalPatterns.observations ?? []).map(o => params.has("missing-start") ? { ...o, startedAt: null } : o), [previewAttempt]).patterns} coverageKnown /></div>
      : params.has("detail") ? <div className="pattern-coach"><PersonalPatternDetail pattern={personalPatterns.patterns[0]} report={personalPatterns} /></div>
      : <PatternHomeView data={data} run={run} />}</CoachShell>;
}
