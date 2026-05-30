// Carica maia3_simplified.onnx su Supabase Storage (bucket pubblico 'models').
// La service_role key si passa via env var, NON va su file ne' su git:
//   SUPABASE_SERVICE_KEY=eyJ... node upload-maia.mjs
// (opzionale) SUPABASE_REF=xxxx per override del project ref.

const ref = process.env.SUPABASE_REF || "zydvfgxqryzcxzdeztnu";
const base = `https://${ref}.supabase.co`;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!serviceKey) {
  console.error("Manca SUPABASE_SERVICE_KEY. Uso: SUPABASE_SERVICE_KEY=eyJ... node upload-maia.mjs");
  process.exit(1);
}

const BUCKET = "models";
const OBJECT = "maia3_simplified.onnx";
const MODEL_URL = "https://raw.githubusercontent.com/CSSLab/maia-platform-frontend/main/public/maia3/maia3_simplified.onnx";
const h = { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey };

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

console.log("scarico il modello da GitHub...");
const mr = await fetch(MODEL_URL);
if (!mr.ok) { console.error("ERRORE download:", mr.status); process.exit(1); }
const buf = Buffer.from(await mr.arrayBuffer());
console.log("scaricato:", (buf.length / 1048576).toFixed(2), "MB");

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
