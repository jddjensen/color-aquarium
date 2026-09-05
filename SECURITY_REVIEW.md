# Security Review

Date: 2026-05-22
Updated: 2026-09-03

Scope: static pages, browser JavaScript, Netlify Functions, Netlify headers, and the local `server.py` development server.

## OWASP-Oriented Findings And Fixes

### A02 Security Misconfiguration

Finding: Static pages and API responses did not have a strict baseline security-header set.

Fix: Added CSP, HSTS, `Referrer-Policy`, `X-Content-Type-Options`, clickjacking protections, cross-origin isolation guardrails, and a restrictive `Permissions-Policy` in `netlify.toml`, Netlify Function responses, and the local Python server.

### A03 Software Supply Chain Failures

Finding: The coloring page dynamically imported third-party browser-side ML code from jsDelivr. That forced a looser CSP and created a runtime supply-chain dependency for an optional enhancement.

Fix: Removed the browser-side third-party ML import. Fish submission still works with the locally generated PNG, and the CSP can now keep `script-src 'self'`.

### A05 Injection

Finding: Sticker picker markup used `innerHTML`, and image endpoints accepted data URLs with only partial validation in some paths.

Fix: Replaced dynamic sticker markup with DOM node creation. Added shared strict PNG data URL decoding, base64 validation, byte-size caps, and PNG magic-byte checks for submit and describe endpoints.

### A01 Broken Access Control

Finding: The reset endpoint was same-origin protected, but it was still a destructive action with no server-side reset code.

Fix: Netlify reset now requires a `RESET_TOKEN` environment variable of at least 8 characters and the matching `X-Reset-Token` request header. The aquarium UI prompts for the code and stores it for the browser session. Local `server.py` supports the same header when `RESET_TOKEN` is set.

Follow-up: Local `server.py` now also requires a configured `RESET_TOKEN` of at least 8 characters before reset will run. Missing or short tokens return `503` instead of allowing an unauthenticated wipe.

### A04 Insecure Design / Abuse Controls

Finding: Public write endpoints accepted missing-Origin requests and did not rate-limit submission, description, or reset attempts.

Fix: Production functions now reject missing `Origin` headers unless `ALLOW_NO_ORIGIN_POSTS=1` is explicitly set for trusted testing, enforce request-size caps before JSON parsing, and apply per-client rate limits backed by Netlify Blobs. The local Python server mirrors the missing-Origin block and in-memory rate limits.

### A06 Insecure Design / Privacy

Finding: The app collected and displayed child-created artwork without an accessible privacy notice.

Fix: Added a privacy page linked quietly from the landing page. The policy documents artwork/name/bio collection, public display, optional Hugging Face description use, current-day retention, and cache caveats.

Follow-up: Production now includes an hourly scheduled cleanup function for old-day fish and rate-limit blobs. Local cleanup is enabled by default and can be disabled only with `CLEANUP_LOCAL_SUBMISSIONS=0`.

## Residual Operational Notes

Set `RESET_TOKEN` in Netlify before relying on the hidden reset button in production.

If `HF_TOKEN` is configured, `/api/describe` sends a reduced PNG preview, fish species, and optional name to Hugging Face for the generated bio. Without `HF_TOKEN`, descriptions fall back locally.

This review did not include a dynamic penetration test of the deployed Netlify site.

## September 2026 Hardening

- Public write functions now use Netlify platform rate limits instead of a non-atomic Blob read/modify/write counter.
- Optional `KIOSK_TOKEN` authorization restricts submit, describe, and enrichment calls to configured exhibit devices.
- PNG uploads are capped at 3 MiB and validated for IHDR dimensions, maximum width/height, and total pixels.
- Known species are allow-listed server-side.
- Daily submission and storage ceilings use conditional Blob writes so concurrent requests cannot over-reserve capacity.
- Metadata is committed before its PNG marker, preventing the TV from discovering partially published submissions.
- Fish list polling checks one revision object before listing metadata, dramatically reducing idle read volume.
- Child artwork responses now use `private, no-store` caching.
- Staff health and reset operations live on `/operator` and require the reset token.
- Three.js is pinned, built locally, and served from the same origin under the existing strict CSP.
