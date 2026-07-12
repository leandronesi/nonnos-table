// Carica maia3_simplified.onnx su Supabase Storage (bucket pubblico 'models').
// Destinazione, sorgente, hash e service_role key si passano via ambiente,
// NON vanno salvati nello script:
//   SUPABASE_REF=xxxx SUPABASE_SERVICE_KEY=<service-role-key> \
//   MAIA_MODEL_SOURCE_URL=https://raw.githubusercontent.com/org/repo/<commit>/model.onnx \
//   MAIA_MODEL_SHA256=<64-hex> node upload-maia.mjs

import { createHash, timingSafeEqual } from "node:crypto";

const MIN_MODEL_BYTES = 1_000_000;
const MAX_MODEL_BYTES = 60 * 1024 * 1024;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Manca ${name}.`);
    process.exit(1);
  }
  return value;
}

function sourceUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    console.error("MAIA_MODEL_SOURCE_URL deve essere un URL assoluto.");
    process.exit(1);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    console.error("MAIA_MODEL_SOURCE_URL deve essere HTTPS e non contenere credenziali.");
    process.exit(1);
  }
  if (url.hostname === "raw.githubusercontent.com") {
    const revision = url.pathname.split("/").filter(Boolean)[2] ?? "";
    if (!/^[a-f0-9]{40}$/i.test(revision)) {
      console.error("Per raw.githubusercontent.com usa un URL fissato a un commit di 40 caratteri, non un branch.");
      process.exit(1);
    }
  }
  return url;
}

async function downloadVerifiedModel(url, expectedHash) {
  console.log("scarico il modello dalla sorgente HTTPS configurata...");
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(120_000) });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("la sorgente modello risponde con un redirect; configura direttamente l'URL finale");
  }
  if (!response.ok) throw new Error(`download modello fallito (HTTP ${response.status})`);
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_MODEL_BYTES) {
    throw new Error("il modello supera il limite di 60 MiB");
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) throw new Error("la sorgente ha restituito HTML, non un modello ONNX");

  if (!response.body) throw new Error("la sorgente non ha restituito un corpo");
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MODEL_BYTES) {
      await reader.cancel();
      throw new Error("il modello supera il limite di 60 MiB");
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks, total);
  if (bytes.length < MIN_MODEL_BYTES) {
    throw new Error("dimensione modello fuori dall'intervallo atteso");
  }
  const actual = createHash("sha256").update(bytes).digest();
  const expected = Buffer.from(expectedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("SHA-256 del modello non corrispondente; upload annullato");
  }
  console.log("modello verificato prima di qualsiasi modifica a Supabase");
  return bytes;
}

const ref = required("SUPABASE_REF");
if (!/^[a-z0-9]+$/.test(ref)) {
  console.error("SUPABASE_REF non valido.");
  process.exit(1);
}
const base = `https://${ref}.supabase.co`;
const serviceKey = required("SUPABASE_SERVICE_KEY");
const expectedHash = required("MAIA_MODEL_SHA256").toLowerCase();
if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
  console.error("MAIA_MODEL_SHA256 deve contenere esattamente 64 caratteri esadecimali.");
  process.exit(1);
}
const modelSource = sourceUrl(required("MAIA_MODEL_SOURCE_URL"));

const BUCKET = "models";
const OBJECT = "maia3_simplified.onnx";
const h = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

let buf;
try {
  // Verify provenance/integrity before the first request carrying the service
  // key or any bucket mutation. A mismatch leaves Supabase untouched.
  buf = await downloadVerifiedModel(modelSource, expectedHash);
} catch (error) {
  console.error("ERRORE verifica modello:", error instanceof Error ? error.message : "errore sconosciuto");
  process.exit(1);
}

{
  const r = await fetch(`${base}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 62914560 }),
  });
  const t = await r.text();
  if (r.ok) console.log("bucket 'models' creato (pubblico)");
  else if (r.status === 409 || /already exists/i.test(t)) console.log("bucket 'models' gia' esistente");
  else { console.error("ERRORE bucket:", r.status, t); process.exit(1); }
}

console.log("carico su Supabase Storage...");
const ur = await fetch(`${base}/storage/v1/object/${BUCKET}/${OBJECT}`, {
  method: "POST",
  headers: { ...h, "Content-Type": "application/octet-stream", "x-upsert": "true" },
  body: buf,
});
const ut = await ur.text();
if (!ur.ok) { console.error("ERRORE upload:", ur.status, ut); process.exit(1); }

console.log("OK.");
console.log("PUBLIC_URL=" + `${base}/storage/v1/object/public/${BUCKET}/${OBJECT}`);
