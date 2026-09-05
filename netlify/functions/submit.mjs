import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import {
  decodePngDataUrl,
  bumpDayRevision,
  FISH_STORE,
  isSameOrigin,
  jsonResponse,
  MAX_UPLOAD_BYTES,
  requestBodyTooLarge,
  requireDailyCapacity,
  requireKioskToken,
  releaseDailyCapacity,
  sanitizeBio,
  sanitizeName,
  sanitizeAndValidateSpecies,
  todayKey,
} from "./_shared.mjs";

// POST /api/submit  — body: { image: "data:image/png;base64,...", name?, species? }
// Saves the PNG to the "fish" blob store under key `${day}/${id}.png`
// and a JSON sidecar at `${day}/${id}.json` containing { name, species, bio, createdAt }.
export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
  if (!isSameOrigin(req)) return jsonResponse(403, { error: "cross-origin blocked" });
  const kiosk = requireKioskToken(req);
  if (!kiosk.ok) return kiosk.response;
  if (requestBodyTooLarge(req, 4.5 * 1024 * 1024)) {
    return jsonResponse(413, { error: "too large" });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }

  const decoded = decodePngDataUrl(payload?.image, { maxBytes: MAX_UPLOAD_BYTES });
  if (!decoded.ok) return jsonResponse(decoded.status, { error: decoded.error });
  const buf = decoded.buffer;

  const name = typeof payload?.name === "string" ? sanitizeName(payload.name) : "";
  const species = sanitizeAndValidateSpecies(payload?.species);
  if (!species) return jsonResponse(400, { error: "invalid species" });
  const bio = typeof payload?.bio === "string" ? sanitizeBio(payload.bio) : "";
  const day = todayKey();
  const id = randomBytes(8).toString("hex");
  const createdAt = Date.now();

  const store = getStore({ name: FISH_STORE, consistency: "strong" });
  const capacity = await requireDailyCapacity(store, day, buf.length);
  if (!capacity.ok) return capacity.response;

  const metadataKey = `${day}/${id}.json`;
  const imageKey = `${day}/${id}.png`;
  try {
    await store.setJSON(metadataKey, {
      name, species, bio, createdAt,
      imageBytes: buf.length,
      width: decoded.width,
      height: decoded.height,
    });
    // The PNG is the commit marker. Readers ignore metadata-only records.
    await store.set(imageKey, buf);
    const revision = await bumpDayRevision(store, day);
    return jsonResponse(200, {
      id,
      url: `/submissions/${day}/${id}.png`,
      day,
      name,
      species,
      bio,
      revision,
    });
  } catch (error) {
    await store.delete(metadataKey).catch(() => {});
    await store.delete(imageKey).catch(() => {});
    await releaseDailyCapacity(day, buf.length).catch(() => {});
    throw error;
  }
};

export const config = {
  path: "/api/submit",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
