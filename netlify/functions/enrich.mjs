import { getStore } from "@netlify/blobs";
import {
  bumpDayRevision,
  FISH_STORE,
  isSameOrigin,
  jsonResponse,
  requestBodyTooLarge,
  requireKioskToken,
  sanitizeBio,
  sanitizeName,
  todayKey,
} from "./_shared.mjs";

export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
  if (!isSameOrigin(req)) return jsonResponse(403, { error: "cross-origin blocked" });
  const kiosk = requireKioskToken(req);
  if (!kiosk.ok) return kiosk.response;
  if (requestBodyTooLarge(req, 16 * 1024)) return jsonResponse(413, { error: "too large" });

  let payload;
  try { payload = await req.json(); } catch { return jsonResponse(400, { error: "invalid json" }); }
  const day = String(payload?.day || "");
  const id = String(payload?.id || "");
  if (day !== todayKey() || !/^[a-f0-9]{16}$/.test(id)) {
    return jsonResponse(400, { error: "invalid submission" });
  }

  const store = getStore({ name: FISH_STORE, consistency: "strong" });
  const key = `${day}/${id}.json`;
  const current = await store.get(key, { type: "json" });
  if (!current) return jsonResponse(404, { error: "submission not found" });

  const nameSuggestion = sanitizeName(payload?.nameSuggestion || "");
  const bio = sanitizeBio(payload?.bio || "");
  const updated = {
    ...current,
    name: sanitizeName(current.name || nameSuggestion),
    bio: bio || sanitizeBio(current.bio || ""),
  };
  await store.setJSON(key, updated);
  const revision = await bumpDayRevision(store, day);
  return jsonResponse(200, { ok: true, revision, name: updated.name, bio: updated.bio });
};

export const config = {
  path: "/api/enrich",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
