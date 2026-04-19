import { getStore } from "@netlify/blobs";

// POST /api/reset  — wipes today's fish (used by the hidden aquarium hotspot).
export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  const day = todayKey();
  const store = getStore({ name: "fish", consistency: "strong" });
  const { blobs } = await store.list({ prefix: `${day}/` });
  const BATCH = 20;
  for (let i = 0; i < blobs.length; i += BATCH) {
    await Promise.all(blobs.slice(i, i + BATCH).map((b) => store.delete(b.key)));
  }
  return new Response(JSON.stringify({ ok: true, day }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export const config = { path: "/api/reset" };
