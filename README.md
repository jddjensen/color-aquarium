# Coloring Fish

Coloring Fish is a two-screen aquarium exhibit for Loveland Living Planet Aquarium. A guest colors an animal on an iPad, submits it, and watches that exact artwork arrive on a shared TV aquarium.

## Experience

- `/color` — touch-first animal selection and canvas coloring
- `/aquarium` — live animated tank with cinematic arrivals
- `/operator` — staff authorization, health, capacity, and reset controls
- `/privacy` — guest-facing data-use and retention notice

The aquarium uses Three.js to place each submitted PNG on a flexible GPU mesh. The existing DOM animation remains the automatic fallback for low-power devices or unavailable WebGL. Add `?domRenderer=1` to the aquarium URL to force the fallback during troubleshooting.

## Architecture

The static browser application lives in `public/`. Production APIs are Netlify Functions backed by Netlify Blobs. `server.py` mirrors the production API for local exhibit testing without external services.

Submission is deliberately two-phase:

1. The artwork and guest-entered name are committed immediately.
2. The TV detects a tiny day-revision change and fetches the updated list.
3. Optional AI description generation runs after submission and enriches metadata without delaying the arrival.

Metadata is written before the PNG. The PNG is the commit marker, so the TV never discovers a half-published fish. Unchanged TV polls read one revision object and return `304` without listing every submission.

## Requirements

- Node.js 20 or newer
- pnpm 10 or newer
- Python 3.9 or newer for the standalone local server

## Local setup

```sh
cp .env.example .env
pnpm install
pnpm run build
set -a; source .env; set +a
python3 server.py
```

Open `http://localhost:3000/operator` first. Save the kiosk and reset codes on each exhibit device, then use `/color` on the iPad and `/aquarium` on the TV.

The build copies the pinned Three.js browser module from `node_modules` into `public/vendor`. The generated vendor directory is intentionally not committed.

## Production configuration

Set these environment variables in Netlify:

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_TIMEZONE` | Recommended | Exhibit day boundary; defaults to `America/Denver` |
| `KIOSK_TOKEN` | Yes | Event code required by submit, describe, and enrich endpoints |
| `RESET_TOKEN` | Yes | Separate staff code for status and reset |
| `MAX_DAILY_SUBMISSIONS` | No | Daily submission ceiling; defaults to 500 |
| `MAX_DAILY_STORAGE_BYTES` | No | Daily artwork ceiling; defaults to 250 MiB |
| `HF_TOKEN` | No | Enables AI-written names and bios |
| `HF_VISION_MODEL` | No | Preferred Hugging Face vision model |

Use different random values of at least 16 characters for the kiosk and reset codes. Never place either value in committed files, client source, screenshots, or public URLs.

After deployment, confirm the function rate-limit rules appear in the Netlify deploy log. The functions use Netlify’s platform rate limits, and daily capacity reservations use conditional Blob writes so concurrent submissions cannot bypass the event ceiling.

## Operations

1. Open `/operator` on every iPad and save the kiosk code.
2. Open `/operator` on the TV and save the reset code.
3. Check that status reports the correct timezone and healthy storage limits.
4. Open `/aquarium` full-screen on the TV.
5. Submit one test fish from `/color` before doors open.
6. Use the operator page to reset the test fish.

The TV keeps its last successful snapshot during network interruptions and retries with exponential backoff. Artwork is served with `private, no-store` so reset and cleanup are not undermined by public caches. Old event days are removed by the hourly scheduled cleanup function.

## Verification

```sh
pnpm run build
pnpm run check
python3 -m py_compile server.py
pnpm exec playwright install chromium
pnpm run test:e2e
```

`pnpm run check` validates every JavaScript module and runs unit tests. The Playwright test launches the local server and exercises animal selection, coloring, submission, and aquarium receipt in a real browser. GitHub Actions runs the complete sequence on every push and pull request.

## Security and privacy

- Same-origin checks and platform rate limits protect public write endpoints.
- A kiosk code can restrict submissions to configured exhibit devices.
- Uploads are restricted by encoded size, decoded PNG dimensions, pixel count, known species, daily count, and daily storage.
- Reset/status use a separate staff secret and constant-time comparison.
- Strict security headers and a self-hosted Three.js build keep the content policy limited to the site origin.
- Submitted artwork, names, and optional bios are current-day data. See `/privacy` and `SECURITY_REVIEW.md` for the complete policy and review notes.

## Main modules

- `public/color.js` — coloring workflow and immediate submission
- `public/aquarium.js` — behavioral simulation and cinematic orchestration
- `public/js/aquarium-config.js` — species traits, personalities, and arrivals
- `public/js/three-aquarium.js` — Three.js texture meshes and shader motion
- `public/js/api-client.js` — browser API and session authorization helpers
- `netlify/functions/_shared.mjs` — validation, auth, revision, capacity, and retention primitives
- `server.py` — local parity server
