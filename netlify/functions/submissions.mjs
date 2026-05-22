import { getStore } from "@netlify/blobs";
import { responseHeaders } from "./_shared.mjs";

// GET /submissions/{day}/{id}.png  — streams the PNG from the blob store.
// Route matches via netlify.toml redirect; the original path is passed in `path`.
export default async (req) => {
  const url = new URL(req.url);
  // The redirect sends us `/submissions/<day>/<id>.png` on req.url's path.
  const match = url.pathname.match(/^\/submissions\/([^/]+)\/([a-f0-9]+)\.png$/);
  if (!match) return new Response("Not found", { status: 404, headers: responseHeaders() });
  const [, day, id] = match;

  // Basic validation: day must be YYYY-MM-DD, id must be 16 hex chars.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-f0-9]{16}$/.test(id)) {
    return new Response("Bad request", { status: 400, headers: responseHeaders() });
  }

  const store = getStore({ name: "fish", consistency: "strong" });
  const key = `${day}/${id}.png`;
  const blob = await store.get(key, { type: "arrayBuffer" });
  if (!blob) return new Response("Not found", { status: 404, headers: responseHeaders() });

  return new Response(blob, {
    status: 200,
    headers: responseHeaders({
      "Content-Type": "image/png",
      // Keep same-day display reloads fast without making child artwork
      // effectively permanent in shared caches.
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
    }),
  });
};

export const config = { path: "/submissions/*" };
