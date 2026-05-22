// Shared helpers for the API functions. Underscore-prefixed and exports no
// default — Netlify won't mount it as a route, but esbuild bundles it into
// the functions that import it.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function isPngBuffer(buf) {
  if (!buf || buf.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
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
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
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
