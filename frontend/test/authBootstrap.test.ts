import { afterEach, describe, expect, it, vi } from "vitest";
import { runBoundedAuthBootstrap } from "../src/auth/authBootstrap";
import { createLatestRequestGate } from "../src/auth/latestRequest";

describe("runBoundedAuthBootstrap", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a successful bootstrap value", async () => {
    await expect(runBoundedAuthBootstrap(async () => "session", 50)).resolves.toEqual({
      ok: true,
      value: "session",
    });
  });

  it("turns rejection into a safe result", async () => {
    await expect(runBoundedAuthBootstrap(
      async () => { throw new Error("private provider detail"); },
      50,
    )).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("also contains a synchronous provider failure", async () => {
    await expect(runBoundedAuthBootstrap(
      () => { throw new Error("private provider detail"); },
      50,
    )).resolves.toEqual({ ok: false, reason: "rejected" });
  });

  it("settles a pending bootstrap after the timeout", async () => {
    vi.useFakeTimers();
    const result = runBoundedAuthBootstrap(
      () => new Promise<string>(() => undefined),
      50,
    );
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
  });
});

describe("createLatestRequestGate", () => {
  it("lets concurrent requests run but only applies the newest result", async () => {
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    const firstResult = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const secondResult = new Promise<string>((resolve) => { resolveSecond = resolve; });
    const gate = createLatestRequestGate();
    const firstIsCurrent = gate.begin();
    const applied: string[] = [];
    const first = firstResult.then((value) => {
      if (firstIsCurrent()) applied.push(value);
    });
    const secondIsCurrent = gate.begin();
    const second = secondResult.then((value) => {
      if (secondIsCurrent()) applied.push(value);
    });

    resolveSecond("second");
    await second;
    resolveFirst("first");
    await first;

    expect(applied).toEqual(["second"]);
  });

  it("invalidates in-flight work during cleanup", () => {
    const gate = createLatestRequestGate();
    const isCurrent = gate.begin();
    gate.invalidate();
    expect(isCurrent()).toBe(false);
  });
});
