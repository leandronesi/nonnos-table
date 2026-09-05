import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const lock = JSON.parse(await readFile(new URL("./maia-model.lock.json", import.meta.url), "utf8"));
const directory = new URL("../public/maia3/", import.meta.url);
const target = new URL("maia3_simplified.onnx", directory);
const valid = bytes => bytes.byteLength === lock.bytes && createHash("sha256").update(bytes).digest("hex") === lock.sha256;
let existing;
try { existing = await readFile(target); } catch (error) { if (error.code !== "ENOENT") throw error; }
if (existing && valid(existing)) {
  console.log("Maia model already present; size and SHA-256 verified.");
} else {
  const response = await fetch(lock.source, { signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!response.ok || (response.headers.get("content-type") || "").includes("text/html")) throw new Error("Model download failed or returned HTML");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error("Model size or SHA-256 mismatch; local file unchanged");
  await mkdir(directory, { recursive: true });
  await writeFile(target, bytes);
  console.log(`Maia model installed locally: ${bytes.byteLength} bytes; SHA-256 verified.`);
}
