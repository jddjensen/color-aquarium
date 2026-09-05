import { getStore } from "@netlify/blobs";
import {
  bumpDayRevision,
  FISH_STORE,
  isSameOrigin,
  jsonResponse,
  resetDailyCapacity,
  requireResetToken,
  todayKey,
} from "./_shared.mjs";

// POST /api/reset  — wipes today's fish (used by the hidden aquarium hotspot).
export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
  if (!isSameOrigin(req)) return jsonResponse(403, { error: "cross-origin blocked" });
  const token = requireResetToken(req);
  if (!token.ok) return token.response;

  const day = todayKey();
  const store = getStore({ name: FISH_STORE, consistency: "strong" });
  const { blobs } = await store.list({ prefix: `${day}/` });
  const BATCH = 20;
  for (let i = 0; i < blobs.length; i += BATCH) {
    await Promise.all(blobs.slice(i, i + BATCH).map((b) => store.delete(b.key)));
  }
  await resetDailyCapacity(day);
  const revision = await bumpDayRevision(store, day);
  return jsonResponse(200, { ok: true, day, revision });
};

export const config = {
  path: "/api/reset",
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
