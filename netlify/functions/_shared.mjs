import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual } from "node:crypto";

// Shared helpers for the API functions. Underscore-prefixed and exports no
// default — Netlify won't mount it as a route, but esbuild bundles it into
// the functions that import it.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
export const RATE_LIMIT_STORE = "fish-rate-limits";

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
  return { ok: true, buffer };
}

// Day key in the timezone configured by the TZ env var on Netlify. Without TZ
// set this is UTC, which silently rolls the day over mid-event for evening
// shows in the Americas. We log once at cold start so misconfiguration is
// visible in function logs.
let warnedAboutTZ = false;
export function todayKey() {
  if (!process.env.TZ && !warnedAboutTZ) {
    warnedAboutTZ = true;
    console.warn("TZ env var is unset — day rollover will use UTC. Set TZ on the Netlify site config (e.g. America/New_York) to roll over at local midnight.");
  }
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  ];
  const [fish, rateLimits] = await Promise.all(
    stores.map((store) => purgeOldDaysFromStore(store, today))
  );
  return { fish, rateLimits };
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
