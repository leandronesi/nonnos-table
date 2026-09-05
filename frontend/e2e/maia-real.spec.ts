import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";

test("real Maia returns legal normalized policies at current and target levels", async ({ page }) => {
  test.skip(!existsSync("public/maia3/maia3_simplified.onnx"), "Run npm run setup:maia to install the pinned model");
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/maia-test");
  const result = await page.evaluate(async () => {
    const { getMaiaEngine } = await import("/src/pipeline/maia/maiaEngine.ts");
    const engine = getMaiaEngine();
    const start = performance.now();
    await engine.waitReady();
    const fens = [
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
      "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
      "r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 6",
    ];
    const samples = [];
    for (const fen of fens) {
      const current = await engine.evaluate(fen, 1200, 1300);
      const target = await engine.evaluate(fen, 1400, 1300);
      samples.push({ fen, current, target });
    }
    // Batch and single-position calls must implement the same policy contract.
    const batch = await engine.batchEvaluate(fens, [1200,1200,1200], [1300,1300,1300]);
    return { samples, batch, elapsedMs: performance.now() - start, status: engine.getStatus() };
  });
  const { Chess } = await import("chess.js");
  expect(result.status).toBe("ready");
  for (const [index, sample] of result.samples.entries()) {
    const legal = new Set(new Chess(sample.fen).moves({ verbose: true }).map(m => m.from + m.to + (m.promotion ?? "")));
    for (const policy of [sample.current.policy, sample.target.policy]) {
      expect(Object.keys(policy).sort()).toEqual([...legal].sort());
      expect(Object.values(policy).every(p => Number.isFinite(p) && p >= 0 && p <= 1)).toBe(true);
      expect(Object.values(policy).reduce((a,b) => a+b, 0)).toBeCloseTo(1, 5);
    }
    for (const move of legal) expect(result.batch[index].policy[move]).toBeCloseTo(sample.current.policy[move], 5);
  }
  expect(result.samples.some(s => Object.keys(s.current.policy).some(m => Math.abs(s.current.policy[m] - s.target.policy[m]) > 0.0001))).toBe(true);
  await test.info().attach("maia-runtime-evidence", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
});
