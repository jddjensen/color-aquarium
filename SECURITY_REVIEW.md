# Security Review

Date: 2026-05-22

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

### A06 Insecure Design / Privacy

Finding: The app collected and displayed child-created artwork without an accessible privacy notice.

Fix: Added a privacy page linked quietly from the landing page. The policy documents artwork/name/bio collection, public display, optional Hugging Face description use, current-day retention, and cache caveats.

## Residual Operational Notes

Set `RESET_TOKEN` in Netlify before relying on the hidden reset button in production.

If `HF_TOKEN` is configured, `/api/describe` sends a reduced PNG preview, fish species, and optional name to Hugging Face for the generated bio. Without `HF_TOKEN`, descriptions fall back locally.

This review did not include a dynamic penetration test of the deployed Netlify site.
