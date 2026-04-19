import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";

// POST /api/submit  — body: { image: "data:image/png;base64,...", name?, species? }
// Saves the PNG to the "fish" blob store under key `${day}/${id}.png`
// and a JSON sidecar at `${day}/${id}.json` containing { name, species, createdAt }.
export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }

  const image = typeof payload?.image === "string" ? payload.image : "";
  const PREFIX = "data:image/png;base64,";
  if (!image.startsWith(PREFIX)) return jsonResponse(400, { error: "invalid image" });

  let buf;
  try {
    buf = Buffer.from(image.slice(PREFIX.length), "base64");
  } catch {
    return jsonResponse(400, { error: "bad base64" });
  }
  if (buf.length === 0 || buf.length > 12 * 1024 * 1024) {
    return jsonResponse(413, { error: "too large" });
  }

  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 24) : "";
  const species = typeof payload.species === "string" ? payload.species.trim().slice(0, 24) : "";
  const day = todayKey();
  const id = randomBytes(8).toString("hex");
  const createdAt = Date.now();

  const store = getStore({ name: "fish", consistency: "strong" });
  await store.set(`${day}/${id}.png`, buf);
  await store.setJSON(`${day}/${id}.json`, { name, species, createdAt });

  return jsonResponse(200, {
    id,
    url: `/submissions/${day}/${id}.png`,
    day,
    name,
    species,
  });
};

function todayKey() {
  // Uses local time (respects the TZ env var set in the Netlify site config).
  // Without TZ set, this is UTC; set TZ (e.g. "America/New_York") so the
  // end-of-day rollover doesn't wipe the tank during your event.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/submit" };
