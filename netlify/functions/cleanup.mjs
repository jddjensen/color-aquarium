import { jsonResponse, purgeApplicationStores, todayKey } from "./_shared.mjs";

// Hourly retention sweep for child artwork and API rate-limit counters.
// Netlify scheduled functions run in UTC, so an hourly cadence keeps cleanup
// close to the site's configured TZ rollover without hand-maintaining DST cron.
export default async () => {
  const day = todayKey();
  const purged = await purgeApplicationStores(day);
  return jsonResponse(200, { ok: true, day, purged });
};

export const config = {
  schedule: "@hourly",
};
