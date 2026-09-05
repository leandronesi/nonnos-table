/** PGN UTC start tags; never infer a start from the end or the time control. */
export function gameStartedAt(headers: Record<string, string>, endedAt: string): string | null {
  const date = headers.UTCDate;
  const time = headers.UTCTime;
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(date ?? "") || !/^\d{2}:\d{2}:\d{2}$/.test(time ?? "")) return null;
  const candidate = `${date.replaceAll(".", "-")}T${time}.000Z`;
  const start = Date.parse(candidate);
  const end = Date.parse(endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  // Date.parse may normalize invalid calendar days instead of rejecting them.
  return new Date(start).toISOString() === candidate ? candidate : null;
}
