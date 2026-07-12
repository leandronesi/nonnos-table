import { createHash } from "node:crypto";

const MIN_MODEL_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is empty; configure it before a manual deploy`);
  return value;
}

function httpsUrl(raw, name) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  return url;
}

function httpsOrigin(raw, name) {
  const url = httpsUrl(raw, name);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without credentials, path, query or hash`);
  }
  return url.origin;
}

async function fetchHttps(url, init) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return { response, finalUrl: current };
    }
    if (hop === MAX_REDIRECTS) throw new Error("model endpoint exceeded the redirect limit");
    const location = response.headers.get("location");
    if (!location) throw new Error("model endpoint returned a redirect without Location");
    current = httpsUrl(new URL(location, current).toString(), "model redirect");
  }
  throw new Error("model endpoint redirect failure");
}

function assertCors(response, requestOrigin, finalUrl) {
  if (finalUrl.origin === requestOrigin) return;
  const allowed = response.headers.get("access-control-allow-origin")?.trim();
  if (allowed !== "*" && allowed !== requestOrigin) {
    throw new Error(
      `model CORS must allow ${requestOrigin} (received ${allowed || "no Access-Control-Allow-Origin"})`,
    );
  }
}

async function verify() {
  const modelUrl = httpsUrl(required("VITE_MAIA_MODEL_URL"), "VITE_MAIA_MODEL_URL");
  const expectedHash = required("MAIA_MODEL_SHA256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error("MAIA_MODEL_SHA256 must be a 64-character SHA-256 hex digest");
  }
  const requestOrigin = httpsOrigin(required("PUBLIC_SITE_ORIGIN"), "PUBLIC_SITE_ORIGIN");

  const { response, finalUrl } = await fetchHttps(modelUrl, {
    headers: { Origin: requestOrigin },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`model endpoint returned HTTP ${response.status}`);
  if (finalUrl.protocol !== "https:") throw new Error("model final URL must use HTTPS");
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    throw new Error("model endpoint returned HTML instead of an ONNX artifact");
  }
  assertCors(response, requestOrigin, finalUrl);

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength < MIN_MODEL_BYTES) {
    throw new Error(`downloaded model is unexpectedly small (${bytes.byteLength} bytes)`);
  }
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`SHA-256 mismatch: expected ${expectedHash}, received ${actualHash}`);
  }
  console.log(
    `[maia-preflight] HTTPS, browser CORS and SHA-256 verified (${bytes.byteLength} bytes)`,
  );
}

try {
  await verify();
} catch (error) {
  console.error(`[maia-preflight] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
