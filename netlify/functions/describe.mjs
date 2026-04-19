const SPECIES_LABELS = {
  fish1: "Goldie",
  fish2: "Angel",
  fish3: "Clown",
  fish4: "Blue Tang",
  fish5: "Tropical Fish",
  puffer1: "Puffer",
  seahorse1: "Seahorse",
  eel1: "Eel",
  stingray1: "Sting Ray",
  seaslug1: "Sea Slug",
  shark1: "Shark",
};

export default async (req) => {
  if (req.method !== "POST") return jsonResponse(405, { error: "method not allowed" });

  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }

  const image = typeof payload?.image === "string" ? payload.image : "";
  if (!image.startsWith("data:image/png;base64,")) {
    return jsonResponse(400, { error: "invalid image" });
  }

  const rawName = typeof payload?.name === "string" ? sanitizeName(payload.name) : "";
  const species = typeof payload?.species === "string" ? payload.species.trim().slice(0, 24) : "";

  const described = await hfDescribeFish(image, species, rawName);
  const fallback = fallbackDescription(species, rawName, image.slice(-256));

  return jsonResponse(200, {
    nameSuggestion: rawName ? "" : sanitizeName(described?.nameSuggestion || fallback.nameSuggestion || ""),
    bio: sanitizeBio(described?.bio || fallback.bio || ""),
  });
};

function normalizeSpace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeName(value) {
  return normalizeSpace(value).replace(/[^A-Za-z0-9 '\-]/g, "").slice(0, 20).trim();
}

function sanitizeBio(value) {
  return normalizeSpace(value).slice(0, 120);
}

function stablePick(seedText, options) {
  if (!options.length) return "";
  const seed = [...String(seedText || "")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return options[seed % options.length];
}

function fallbackDescription(species, rawName, seedText = "") {
  const speciesLabel = SPECIES_LABELS[species] || "Fish";
  const starters = ["Bubbles", "Coral", "Sunny", "Ripple", "Pebble", "Comet", "Marble", "Splash"];
  const endings = ["Star", "Dash", "Glow", "Flip", "Scout", "Skipper", "Spark", "Drift"];
  const bioTemplates = [
    "A cheerful {species} who loves showing off bright colors in the reef.",
    "A gentle {species} with a talent for dramatic aquarium entrances.",
    "A curious {species} who patrols the tank like a tiny explorer.",
    "A playful {species} who swims like it already knows the spotlight.",
  ];

  const finalName = rawName
    ? sanitizeName(rawName)
    : sanitizeName(`${stablePick(seedText || speciesLabel, starters)} ${stablePick((seedText || speciesLabel).split("").reverse().join(""), endings)}`);

  return {
    nameSuggestion: rawName ? "" : finalName,
    bio: sanitizeBio(stablePick(`${speciesLabel}:${seedText}`, bioTemplates).replace("{species}", speciesLabel.toLowerCase())),
  };
}

function parseJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function hfDescribeFish(image, species, rawName) {
  const token = process.env.HF_TOKEN;
  if (!token) return null;

  const preferred = (process.env.HF_VISION_MODEL || "").trim();
  const models = [
    preferred,
    "HuggingFaceTB/SmolVLM-256M-Instruct",
    "Qwen/Qwen2.5-VL-3B-Instruct",
  ].filter(Boolean);

  const speciesLabel = SPECIES_LABELS[species] || species || "Fish";
  const prompt =
    "You write short, delightful aquarium placards for a children's coloring exhibit. " +
    "Return strict JSON only with keys nameSuggestion and bio. " +
    "If the child already supplied a name, leave nameSuggestion empty and only write the bio. " +
    "Keep the bio to one sentence under 100 characters. " +
    "Keep any suggested name to 1-2 words under 20 characters. " +
    `Species hint: ${speciesLabel}. Child name: ${rawName || "none"}.`;

  for (const model of [...new Set(models)]) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: image } },
            ],
          }],
          temperature: 0.4,
          max_tokens: 140,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content || "";
      const parsed = parseJsonObject(text);
      if (!parsed || typeof parsed !== "object") continue;
      const bio = sanitizeBio(parsed.bio || "");
      if (!bio) continue;
      return {
        nameSuggestion: sanitizeName(parsed.nameSuggestion || ""),
        bio,
      };
    } catch (error) {
      console.warn("hf describe failed", model, error);
    }
  }
  return null;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const config = { path: "/api/describe" };
