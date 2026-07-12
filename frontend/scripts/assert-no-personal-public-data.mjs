import { readdir } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const publicRoot = fileURLToPath(new URL("../public/", import.meta.url));
const bannedNames = new Set([
  "metrics.json",
  "player_model.json",
  "coach_brief.json",
  "coach_journal.md",
  "aggregates.json",
  "positions.db",
]);
const bannedExtensions = new Set([".pgn", ".sqlite", ".db"]);
const bannedDirectories = new Set(["analysis", "raw", "quaderno"]);
const violations = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const relativePath = relative(publicRoot, path).split(sep).join("/");
    if (entry.isDirectory()) {
      if (bannedDirectories.has(entry.name.toLowerCase())) violations.push(`${relativePath}/`);
      else await visit(path);
      continue;
    }
    if (bannedNames.has(basename(entry.name).toLowerCase()) || bannedExtensions.has(extname(entry.name).toLowerCase())) {
      violations.push(relativePath);
    }
  }
}

await visit(publicRoot);
if (violations.length > 0) {
  throw new Error(`Refusing to publish personal chess data:\n${violations.map((path) => ` - ${path}`).join("\n")}`);
}
