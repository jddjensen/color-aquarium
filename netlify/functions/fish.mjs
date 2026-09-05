import { getStore } from "@netlify/blobs";
import {
  bumpDayRevision,
  etagMatches,
  FISH_STORE,
  readDayRevision,
  responseHeaders,
  revisionEtag,
  todayKey,
} from "./_shared.mjs";

// GET /api/fish  — returns today's fish list. Hourly scheduled cleanup is the
// main retention path; this tiny opportunistic purge is a backup if scheduled
// invocations are delayed or disabled.
export default async (req) => {
  const day = todayKey();
  // Strong consistency — otherwise list() can lag new submissions by 10–60 s.
  const store = getStore({ name: FISH_STORE, consistency: "strong" });
  let revision = await readDayRevision(store, day);
  if (!revision) revision = await bumpDayRevision(store, day);
  const etag = revisionEtag(day, revision);
  if (etagMatches(req?.headers?.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: responseHeaders({ "ETag": etag, "Cache-Control": "no-cache" }),
    });
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
        let name = "", species = "", bio = "", createdAt = 0;
        if (e.hasJson) {
          try {
            const meta = await store.get(`${day}/${e.id}.json`, { type: "json" });
            if (meta) {
              name = (meta.name || "").trim();
              species = (meta.species || "").trim();
              bio = (meta.bio || "").trim();
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
          bio,
        };
      })
  );

  results.sort((a, b) => a.createdAt - b.createdAt);
  return new Response(JSON.stringify({ day, revision, fish: results }), {
    status: 200,
    headers: responseHeaders({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-cache",
      "ETag": etag,
    }),
  });
};

export const config = { path: "/api/fish" };
