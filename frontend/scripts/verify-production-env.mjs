function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for a manual production deploy`);
  return value;
}

function requireHttpsUrl(name) {
  const raw = requireValue(name);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${name} must not contain credentials`);
  return url;
}

function requireHttpsOrigin(name) {
  const url = requireHttpsUrl(name);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without path, query or hash`);
  }
  return url.origin;
}

function requirePublicSupabaseKey(name) {
  const key = requireValue(name);
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/.test(key)) return key;
  if (key.startsWith("sb_")) {
    throw new Error(`${name} must be a publishable key, never a secret key`);
  }

  const parts = key.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
    throw new Error(`${name} must be a Supabase publishable key or legacy anon JWT`);
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error(`${name} legacy JWT payload is malformed`);
  }
  if (!payload || typeof payload !== "object" || payload.role !== "anon") {
    throw new Error(`${name} legacy JWT must carry the anon role`);
  }
  return key;
}

try {
  requireHttpsUrl("VITE_SUPABASE_URL");
  requirePublicSupabaseKey("VITE_SUPABASE_ANON_KEY");
  const privacyContact = requireValue("VITE_PRIVACY_CONTACT_EMAIL");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacyContact)) {
    throw new Error("VITE_PRIVACY_CONTACT_EMAIL must be a valid contact address");
  }
  requireHttpsOrigin("PUBLIC_SITE_ORIGIN");
  console.log("[production-preflight] required public configuration is present");
} catch (error) {
  // Never print secret values; diagnostics identify only the missing/invalid key.
  console.error(`[production-preflight] ${error instanceof Error ? error.message : "invalid configuration"}`);
  process.exitCode = 1;
}
