export type InsertOutcome = "inserted" | "duplicate" | "failed";

export interface InsertErrorLike {
  code?: string | null;
  message?: string | null;
}

/** Solo insert riuscito o duplicate confermata possono avanzare la quota. */
export function classifyInsertOutcome(error: InsertErrorLike | null): InsertOutcome {
  if (error === null) return "inserted";
  if (
    error.code === "23505" ||
    /duplicate key value violates unique constraint/i.test(error.message ?? "")
  ) {
    return "duplicate";
  }
  return "failed";
}
