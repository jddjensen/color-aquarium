import { getStore } from "@netlify/blobs";

// GET /api/fish  — returns today's fish list. Opportunistically purges older-day
// blobs so the store doesn't accumulate across days. Purge runs on ~10% of polls
// to keep function duration down; within ~15 seconds of the day rolling over,
// stale data is gone.
export default async () => {
  const day = todayKey();
  // Strong consistency — otherwise list() can lag new submissions by 10–60 s.
  const store = getStore({ name: "fish", consistency: "strong" });

  if (Math.random() < 0.1) {
    purgeOldDays(store, day).catch((e) => console.warn("purge failed", e));
  }

  const { blobs } = await store.list({ prefix: `${day}/` });
  // Group png + json by id.
  const byId = new Map();
  for (const b of blobs) {
    const m = b.key.match(/^([^/]+)\/([a-f0-9]+)\.(png|json)$/);
    if (!m) continue;
    const id = m[2];
    const kind = m[3];
    let entry = byId.get(id);
    if (!entry) { entry = { id }; byId.set(id, entry); }
    if (kind === "png") entry.hasPng = true;
    else entry.hasJson = true;
  }

  const results = await Promise.all(
    [...byId.values()]
      .filter((e) => e.hasPng)
      .map(async (e) => {
        let name = "", species = "", createdAt = 0;
        if (e.hasJson) {
          try {
            const meta = await store.get(`${day}/${e.id}.json`, { type: "json" });
            if (meta) {
              name = (meta.name || "").trim();
              species = (meta.species || "").trim();
              createdAt = Number(meta.createdAt) || 0;
            }
          } catch {}
        }
        return {
          id: e.id,
          url: `/submissions/${day}/${e.id}.png`,
          createdAt,
          name,
          species,
        };
      })
  );

  results.sort((a, b) => a.createdAt - b.createdAt);

  return new Response(JSON.stringify({ day, fish: results }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};

async function purgeOldDays(store, today) {
  const { blobs } = await store.list();
  const stale = [];
  for (const b of blobs) {
    const slash = b.key.indexOf("/");
    if (slash <= 0) continue;
    if (b.key.slice(0, slash) !== today) stale.push(b.key);
  }
  const BATCH = 20;
  for (let i = 0; i < stale.length; i += BATCH) {
    await Promise.all(stale.slice(i, i + BATCH).map((k) => store.delete(k)));
  }
}

function todayKey() {
  // Local time; respects TZ env var configured in Netlify site settings.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const config = { path: "/api/fish" };
