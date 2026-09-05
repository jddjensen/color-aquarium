import { getStore } from "@netlify/blobs";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Shared helpers for the API functions. Underscore-prefixed and exports no
// default — Netlify won't mount it as a route, but esbuild bundles it into
// the functions that import it.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
export const RATE_LIMIT_STORE = "fish-rate-limits";
export const FISH_STORE = "fish";
export const CAPACITY_STORE = "fish-capacity";
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 1600;
export const MAX_IMAGE_HEIGHT = 1200;
export const MAX_IMAGE_PIXELS = 2_000_000;

export const SPECIES_LABELS = {
  fish1: "Goldie",
  fish2: "Angel",
  fish3: "Clown",
  fish4: "Angler Fish",
  fish5: "Tropical Fish",
  puffer1: "Puffer",
  seahorse1: "Seahorse",
  eel1: "Eel",
  stingray1: "Sting Ray",
  seaslug1: "Sea Slug",
  shark1: "Shark",
  octo1: "Octopus",
  shrimp1: "Shrimp",
  squid1: "Squid",
  seastar1: "Sea Star",
};

const RATE_LIMIT_DEFAULTS = {
  submit: { limit: 20, windowMs: 60 * 1000 },
  describe: { limit: 30, windowMs: 60 * 1000 },
  reset: { limit: 6, windowMs: 60 * 1000 },
};

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "media-src 'none'",
  "font-src 'self' data:",
  "style-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), sync-xhr=(), usb=(), xr-spatial-tracking=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export function responseHeaders(headers = {}) {
  return { ...SECURITY_HEADERS, ...headers };
}

function positiveIntegerEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function isPngBuffer(buf) {
  if (!buf || buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

export function decodePngDataUrl(value, { maxBytes = 12 * 1024 * 1024 } = {}) {
  if (typeof value !== "string" || !value.startsWith(PNG_DATA_URL_PREFIX)) {
    return { ok: false, status: 400, error: "invalid image" };
  }
  const encoded = value.slice(PNG_DATA_URL_PREFIX.length);
  if (encoded.length === 0 || encoded.length > Math.ceil(maxBytes * 4 / 3) + 4) {
    return { ok: false, status: 413, error: "too large" };
  }
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    return { ok: false, status: 400, error: "bad base64" };
  }
  let buffer;
  try {
    buffer = Buffer.from(encoded, "base64");
  } catch {
    return { ok: false, status: 400, error: "bad base64" };
  }
  if (buffer.length === 0 || buffer.length > maxBytes) {
    return { ok: false, status: 413, error: "too large" };
  }
  if (!isPngBuffer(buffer)) return { ok: false, status: 400, error: "not a png" };
  const dimensions = pngDimensions(buffer);
  if (!dimensions) return { ok: false, status: 400, error: "invalid png header" };
  if (dimensions.width > MAX_IMAGE_WIDTH || dimensions.height > MAX_IMAGE_HEIGHT
      || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS) {
    return { ok: false, status: 413, error: "image dimensions too large" };
  }
  return { ok: true, buffer, ...dimensions };
}

export function pngDimensions(buffer) {
  if (!isPngBuffer(buffer) || buffer.length < 24) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

export const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || "America/Denver";

// Day keys are explicitly formatted in the exhibit timezone so function-host
// process settings cannot silently move an evening event into the next day.
export function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// CSRF / public-write guard: browsers send Origin on same-origin POST fetches.
// Production rejects missing Origin so anonymous curl-style writes cannot bypass
// browser-origin checks. Set ALLOW_NO_ORIGIN_POSTS=1 only for trusted local tests.
export function isSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return process.env.ALLOW_NO_ORIGIN_POSTS === "1";
  try {
    return new URL(req.url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

export function requestBodyTooLarge(req, maxBytes) {
  const raw = req.headers.get("content-length");
  if (!raw) return false;
  const length = Number(raw);
  return Number.isFinite(length) && length > maxBytes;
}

export function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    }),
  });
}

export function requireResetToken(req) {
  const expected = (process.env.RESET_TOKEN || "").trim();
  if (expected.length < 8) {
    return {
      ok: false,
      response: jsonResponse(503, { error: "reset token not configured" }),
    };
  }
  const supplied = (req.headers.get("x-reset-token") || "").trim();
  if (!constantTimeEqual(supplied, expected)) {
    return {
      ok: false,
      response: jsonResponse(403, { error: "invalid reset token" }),
    };
  }
  return { ok: true };
}

export function requireKioskToken(req) {
  const expected = (process.env.KIOSK_TOKEN || "").trim();
  // Optional in development, but production documentation requires it.
  if (!expected) return { ok: true, configured: false };
  if (expected.length < 8) {
    return {
      ok: false,
      response: jsonResponse(503, { error: "kiosk token is misconfigured" }),
    };
  }
  const supplied = (req.headers.get("x-kiosk-token") || "").trim();
  if (!constantTimeEqual(supplied, expected)) {
    return {
      ok: false,
      response: jsonResponse(401, { error: "kiosk authorization required" }),
    };
  }
  return { ok: true, configured: true };
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function clientFingerprint(req) {
  const forwarded = req.headers.get("x-nf-client-connection-ip")
    || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
    || req.headers.get("client-ip")
    || req.headers.get("x-real-ip")
    || "unknown";
  const agent = req.headers.get("user-agent") || "";
  return createHash("sha256")
    .update(`${forwarded}|${agent}`)
    .digest("hex")
    .slice(0, 32);
}

function rateLimitConfig(bucket) {
  const defaults = RATE_LIMIT_DEFAULTS[bucket] || { limit: 30, windowMs: 60 * 1000 };
  const prefix = bucket.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return {
    limit: positiveIntegerEnv(`${prefix}_RATE_LIMIT`, defaults.limit),
    windowMs: positiveIntegerEnv(`${prefix}_RATE_WINDOW_MS`, defaults.windowMs),
  };
}

export async function requireRateLimit(req, bucket) {
  if (process.env.DISABLE_API_RATE_LIMIT === "1") return { ok: true };

  const { limit, windowMs } = rateLimitConfig(bucket);
  const now = Date.now();
  const day = todayKey();
  const key = `${day}/${bucket}/${clientFingerprint(req)}.json`;
  const store = getStore({ name: RATE_LIMIT_STORE, consistency: "strong" });

  let record;
  try {
    record = await store.get(key, { type: "json" });
  } catch (error) {
    console.warn("rate limit read failed", bucket, error);
    return {
      ok: false,
      response: jsonResponse(503, { error: "rate limit unavailable" }),
    };
  }

  let count = Number(record?.count) || 0;
  let resetAt = Number(record?.resetAt) || 0;
  if (!resetAt || resetAt <= now) {
    count = 0;
    resetAt = now + windowMs;
  }

  if (count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    return {
      ok: false,
      response: jsonResponse(429, { error: "too many requests" }, {
        "Retry-After": String(retryAfter),
      }),
    };
  }

  try {
    await store.setJSON(key, { count: count + 1, resetAt, updatedAt: now });
  } catch (error) {
    console.warn("rate limit write failed", bucket, error);
    return {
      ok: false,
      response: jsonResponse(503, { error: "rate limit unavailable" }),
    };
  }

  return { ok: true };
}

export async function purgeOldDaysFromStore(store, today) {
  const { blobs } = await store.list();
  const stale = [];
  for (const b of blobs) {
    const slash = b.key.indexOf("/");
    if (slash <= 0) continue;
    if (b.key.slice(0, slash) !== today) stale.push(b.key);
  }
  const BATCH = 20;
  for (let i = 0; i < stale.length; i += BATCH) {
    await Promise.all(stale.slice(i, i + BATCH).map((key) => store.delete(key)));
  }
  return stale.length;
}

export async function purgeApplicationStores(today = todayKey()) {
  const stores = [
    getStore({ name: "fish", consistency: "strong" }),
    getStore({ name: RATE_LIMIT_STORE, consistency: "strong" }),
    getStore({ name: CAPACITY_STORE, consistency: "strong" }),
  ];
  const [fish, rateLimits, capacity] = await Promise.all(
    stores.map((store) => purgeOldDaysFromStore(store, today))
  );
  return { fish, rateLimits, capacity };
}

export function revisionKey(day) {
  return `${day}/_revision.json`;
}

export async function readDayRevision(store, day) {
  try {
    const record = await store.get(revisionKey(day), { type: "json" });
    return typeof record?.value === "string" ? record.value : "";
  } catch {
    return "";
  }
}

export async function bumpDayRevision(store, day) {
  const value = `${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
  await store.setJSON(revisionKey(day), { value, updatedAt: Date.now() });
  return value;
}

export function revisionEtag(day, revision) {
  const hash = createHash("sha1").update(`${day}:${revision}`).digest("base64url").slice(0, 24);
  return `"fish-${hash}"`;
}

export function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").map((value) => value.trim()).includes(etag);
}

export async function getDayUsage(store, day) {
  const { blobs } = await store.list({ prefix: `${day}/` });
  const metaKeys = blobs
    .map((blob) => blob.key)
    .filter((key) => /^[^/]+\/[a-f0-9]{16}\.json$/.test(key));
  let bytes = 0;
  const records = await Promise.all(metaKeys.map(async (key) => {
    try { return await store.get(key, { type: "json" }); } catch { return null; }
  }));
  for (const record of records) bytes += Number(record?.imageBytes) || 0;
  return { count: metaKeys.length, bytes };
}

export async function requireDailyCapacity(_fishStore, day, incomingBytes) {
  const maxCount = positiveIntegerEnv("MAX_DAILY_SUBMISSIONS", 500);
  const maxBytes = positiveIntegerEnv("MAX_DAILY_STORAGE_BYTES", 250 * 1024 * 1024);
  const store = getStore({ name: CAPACITY_STORE, consistency: "strong" });
  const key = `${day}/usage.json`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "json" });
    const usage = {
      count: Number(entry?.data?.count) || 0,
      bytes: Number(entry?.data?.bytes) || 0,
    };
    if (usage.count >= maxCount || usage.bytes + incomingBytes > maxBytes) {
      return {
        ok: false,
        response: jsonResponse(503, { error: "aquarium capacity reached; ask an operator to reset it" }),
      };
    }
    const next = { count: usage.count + 1, bytes: usage.bytes + incomingBytes, updatedAt: Date.now() };
    const result = await store.setJSON(key, next, entry
      ? { onlyIfMatch: entry.etag }
      : { onlyIfNew: true });
    if (result.modified) {
      return { ok: true, usage: next, limits: { count: maxCount, bytes: maxBytes }, reservation: { day, bytes: incomingBytes } };
    }
  }
  return { ok: false, response: jsonResponse(503, { error: "aquarium is busy; please try again" }) };
}

export async function releaseDailyCapacity(day, releasedBytes) {
  const store = getStore({ name: CAPACITY_STORE, consistency: "strong" });
  const key = `${day}/usage.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await store.getWithMetadata(key, { type: "json" });
    if (!entry) return;
    const next = {
      count: Math.max(0, (Number(entry.data?.count) || 0) - 1),
      bytes: Math.max(0, (Number(entry.data?.bytes) || 0) - releasedBytes),
      updatedAt: Date.now(),
    };
    const result = await store.setJSON(key, next, { onlyIfMatch: entry.etag });
    if (result.modified) return;
  }
}

export async function resetDailyCapacity(day) {
  const store = getStore({ name: CAPACITY_STORE, consistency: "strong" });
  await store.delete(`${day}/usage.json`);
}

export function sanitizeAndValidateSpecies(value) {
  const species = sanitizeSpecies(value);
  return SPECIES_LABELS[species] ? species : "";
}

export function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function sanitizeName(value) {
  return normalizeSpace(value).replace(/[^A-Za-z0-9 '\-]/g, "").slice(0, 20).trim();
}

export function sanitizeBio(value) {
  return normalizeSpace(value).slice(0, 120);
}

// Species ids are client-controlled but must look like a valid identifier;
// they're used as Map keys in the aquarium and could appear in future UI.
export function sanitizeSpecies(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
}
