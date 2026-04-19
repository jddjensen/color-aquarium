import { getStore } from "@netlify/blobs";

// GET /submissions/{day}/{id}.png  — streams the PNG from the blob store.
// Route matches via netlify.toml redirect; the original path is passed in `path`.
export default async (req) => {
  const url = new URL(req.url);
  // The redirect sends us `/submissions/<day>/<id>.png` on req.url's path.
  const match = url.pathname.match(/^\/submissions\/([^/]+)\/([a-f0-9]+)\.png$/);
  if (!match) return new Response("Not found", { status: 404 });
  const [, day, id] = match;

  // Basic validation: day must be YYYY-MM-DD, id must be 16 hex chars.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-f0-9]{16}$/.test(id)) {
    return new Response("Bad request", { status: 400 });
  }

  const store = getStore("fish");
  const key = `${day}/${id}.png`;
  const blob = await store.get(key, { type: "arrayBuffer" });
  if (!blob) return new Response("Not found", { status: 404 });

  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // Submissions are immutable once saved; safe to cache for a while.
      "Cache-Control": "public, max-age=300",
    },
  });
};

export const config = { path: "/submissions/*" };
