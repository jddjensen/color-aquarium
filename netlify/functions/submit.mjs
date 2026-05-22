import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import {
  isPngBuffer,
  isSameOrigin,
  jsonResponse,
  sanitizeBio,
  sanitizeName,
  sanitizeSpecies,
  todayKey,
} from "./_shared.mjs";

// POST /api/submit  — body: { image: "data:image/png;base64,...", name?, species? }
// Saves the PNG to the "fish" blob store under key `${day}/${id}.png`
// and a JSON sidecar at `${day}/${id}.json` containing { name, species, bio, createdAt }.
export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
  if (!isSameOrigin(req)) return jsonResponse(403, { error: "cross-origin blocked" });

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
  // The data URL prefix is trivial to spoof; require the decoded bytes to
  // start with the PNG magic so the blob store doesn't get filled with
  // arbitrary content masquerading as fish art.
  if (!isPngBuffer(buf)) return jsonResponse(400, { error: "not a png" });

  const name = typeof payload.name === "string" ? sanitizeName(payload.name) : "";
  const species = sanitizeSpecies(payload.species);
  const bio = typeof payload.bio === "string" ? sanitizeBio(payload.bio) : "";
  const day = todayKey();
  const id = randomBytes(8).toString("hex");
  const createdAt = Date.now();

  const store = getStore({ name: "fish", consistency: "strong" });
  await store.set(`${day}/${id}.png`, buf);
  await store.setJSON(`${day}/${id}.json`, { name, species, bio, createdAt });

  return jsonResponse(200, {
    id,
    url: `/submissions/${day}/${id}.png`,
    day,
    name,
    species,
    bio,
  });
};

export const config = { path: "/api/submit" };
