import { getStore } from "@netlify/blobs";
import {
  APP_TIMEZONE,
  FISH_STORE,
  getDayUsage,
  jsonResponse,
  readDayRevision,
  requireResetToken,
  todayKey,
} from "./_shared.mjs";

export default async (req) => {
  if (req.method !== "GET") return jsonResponse(405, { error: "method not allowed" });
  const auth = requireResetToken(req);
  if (!auth.ok) return auth.response;
  const day = todayKey();
  const store = getStore({ name: FISH_STORE, consistency: "strong" });
  const [usage, revision] = await Promise.all([getDayUsage(store, day), readDayRevision(store, day)]);
  return jsonResponse(200, {
    ok: true,
    day,
    timezone: APP_TIMEZONE,
    usage,
    limits: {
      submissions: Number.parseInt(process.env.MAX_DAILY_SUBMISSIONS || "500", 10),
      bytes: Number.parseInt(process.env.MAX_DAILY_STORAGE_BYTES || String(250 * 1024 * 1024), 10),
    },
    revision,
    kioskProtection: Boolean((process.env.KIOSK_TOKEN || "").trim()),
    aiDescriptions: Boolean((process.env.HF_TOKEN || "").trim()),
    checkedAt: Date.now(),
  });
};

export const config = {
  path: "/api/status",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
