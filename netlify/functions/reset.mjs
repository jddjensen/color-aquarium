import { getStore } from "@netlify/blobs";
import { isSameOrigin, jsonResponse, requireResetToken, todayKey } from "./_shared.mjs";

// POST /api/reset  — wipes today's fish (used by the hidden aquarium hotspot).
export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });
  if (!isSameOrigin(req)) return jsonResponse(403, { error: "cross-origin blocked" });
  const token = requireResetToken(req);
  if (!token.ok) return token.response;

  const day = todayKey();
  const store = getStore({ name: "fish", consistency: "strong" });
  const { blobs } = await store.list({ prefix: `${day}/` });
  const BATCH = 20;
  for (let i = 0; i < blobs.length; i += BATCH) {
    await Promise.all(blobs.slice(i, i + BATCH).map((b) => store.delete(b.key)));
  }
  return jsonResponse(200, { ok: true, day });
};

export const config = { path: "/api/reset" };
