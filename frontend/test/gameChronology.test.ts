import { expect, it } from "vitest";
import { gameStartedAt } from "../src/pipeline/gameChronology";

it("uses PGN UTC start tags across midnight", () => {
  expect(gameStartedAt({ UTCDate: "2026.08.14", UTCTime: "23:58:01" }, "2026-08-15T00:06:00Z")).toBe("2026-08-14T23:58:01.000Z");
});

it("rejects missing, impossible, ambiguous and post-finish start times", () => {
  for (const headers of [
    {}, { Date: "2026.08.15", Time: "11:00:00" },
    { UTCDate: "2026.02.30", UTCTime: "11:00:00" },
    { UTCDate: "2026.08.15", UTCTime: "24:00:00" },
    { UTCDate: "2026.08.15", UTCTime: "13:00:00" },
  ]) expect(gameStartedAt(headers as Record<string, string>, "2026-08-15T12:00:00Z")).toBeNull();
});
