// Shared helpers for the API functions. Underscore-prefixed and exports no
// default — Netlify won't mount it as a route, but esbuild bundles it into
// the functions that import it.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

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

// CSRF defense: if the browser sent an Origin header (it does for all
// cross-site POSTs since 2020), require it to match the request host.
// Missing Origin is allowed so curl-style same-origin tooling still works;
// browsers will not omit it on a cross-site write.
export function isSameOrigin(req) {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const reqHost = new URL(req.url).host;
    const originHost = new URL(origin).host;
    return reqHost === originHost;
  } catch {
    return false;
  }
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
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
  if (supplied !== expected) {
    return {
      ok: false,
      response: jsonResponse(403, { error: "invalid reset token" }),
    };
  }
  return { ok: true };
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
