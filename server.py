"""
Coloring Fish - a tiny standalone HTTP server.

Serves:
  /                  landing page
  /color             coloring page
  /aquarium          aquarium page
  /privacy           privacy policy
  /style.css, /*.js  static files from ./public
  /assets/*          static files from ./public/assets
  /submissions/*     saved fish PNGs

API:
  POST /api/submit   body: {"image": "data:image/png;base64,..."}  -> {id, url, day}
  POST /api/describe body: {"image": "data:image/png;base64,...", "species": "...", "name": "..."} -> {nameSuggestion, bio}
  POST /api/reset    header: X-Reset-Token -> clears today's fish when RESET_TOKEN is configured
  GET  /api/fish     -> {day, fish: [{id, url, createdAt}]}

No external dependencies. Run with:  python server.py
"""

import base64
import datetime as dt
import json
import mimetypes
import os
import secrets
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
SUBMISSIONS = os.path.join(ROOT, "submissions")
PORT = int(os.environ.get("PORT", "3000"))
# Default to loopback so a laptop on shared wifi doesn't expose the dev API.
# Set HOST=0.0.0.0 to run as a kiosk that other devices on the LAN can hit.
HOST = os.environ.get("HOST", "127.0.0.1")
MAX_SUBMIT_BODY_BYTES = 16 * 1024 * 1024
MAX_DESCRIBE_BODY_BYTES = 2 * 1024 * 1024
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PNG_DATA_URL_PREFIX = "data:image/png;base64,"
RESET_TOKEN = os.environ.get("RESET_TOKEN", "").strip()
CLEANUP_LOCAL_SUBMISSIONS = os.environ.get("CLEANUP_LOCAL_SUBMISSIONS", "1") != "0"
ALLOW_NO_ORIGIN_POSTS = os.environ.get("ALLOW_NO_ORIGIN_POSTS") == "1"


def positive_int_env(name: str, fallback: int) -> int:
    try:
        parsed = int(os.environ.get(name, ""))
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


def rate_window_seconds(prefix: str, fallback: int) -> int:
    window_ms = positive_int_env(f"{prefix}_RATE_WINDOW_MS", 0)
    if window_ms > 0:
        return max(1, (window_ms + 999) // 1000)
    return positive_int_env(f"{prefix}_RATE_WINDOW_SECONDS", fallback)


RATE_LIMITS = {}
RATE_LIMIT_LOCK = threading.Lock()
RATE_LIMIT_CONFIG = {
    "submit": (
        positive_int_env("SUBMIT_RATE_LIMIT", 20),
        rate_window_seconds("SUBMIT", 60),
    ),
    "describe": (
        positive_int_env("DESCRIBE_RATE_LIMIT", 30),
        rate_window_seconds("DESCRIBE", 60),
    ),
    "reset": (
        positive_int_env("RESET_RATE_LIMIT", 6),
        rate_window_seconds("RESET", 60),
    ),
}

CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "media-src 'none'",
    "font-src 'self' data:",
    "style-src 'self'",
    "script-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
])
SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Permitted-Cross-Domain-Policies": "none",
    "X-XSS-Protection": "0",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), sync-xhr=(), usb=(), xr-spatial-tracking=()",
}

SPECIES_LABELS = {
    "fish1": "Goldie",
    "fish2": "Angel",
    "fish3": "Clown",
    "fish4": "Angler Fish",
    "fish5": "Tropical Fish",
    "puffer1": "Puffer",
    "seahorse1": "Seahorse",
    "eel1": "Eel",
    "stingray1": "Sting Ray",
    "seaslug1": "Sea Slug",
    "shark1": "Shark",
    "octo1": "Octopus",
    "shrimp1": "Shrimp",
    "squid1": "Squid",
    "seastar1": "Sea Star",
}

os.makedirs(SUBMISSIONS, exist_ok=True)
mimetypes.add_type("application/javascript", ".js")


def today_key() -> str:
    return dt.date.today().isoformat()


def day_dir(key: str) -> str:
    return os.path.join(SUBMISSIONS, key)


def normalize_space(value: str) -> str:
    return " ".join((value or "").split())


def sanitize_name(value: str) -> str:
    cleaned = normalize_space(value)
    cleaned = "".join(ch for ch in cleaned if ch.isalnum() or ch in " '-")
    return cleaned[:20].strip()


def sanitize_bio(value: str) -> str:
    return normalize_space(value)[:120].strip()


def sanitize_species(value: str) -> str:
    cleaned = "".join(ch for ch in (value or "").lower() if ch.isalnum() or ch == "_")
    return cleaned[:24]


def is_png(buf: bytes) -> bool:
    return len(buf) >= 8 and buf[:8] == PNG_SIGNATURE


def decode_png_data_url(value: str, max_bytes: int = 12 * 1024 * 1024):
    if not isinstance(value, str) or not value.startswith(PNG_DATA_URL_PREFIX):
        return None, 400, "invalid image"
    encoded = value[len(PNG_DATA_URL_PREFIX):]
    if not encoded or len(encoded) > ((max_bytes * 4 + 2) // 3) + 4:
        return None, 413, "too large"
    if len(encoded) % 4 != 0:
        return None, 400, "bad base64"
    try:
        buf = base64.b64decode(encoded, validate=True)
    except Exception:
        return None, 400, "bad base64"
    if not buf or len(buf) > max_bytes:
        return None, 413, "too large"
    if not is_png(buf):
        return None, 400, "not a png"
    return buf, None, None


def stable_pick(seed_text: str, options):
    if not options:
        return ""
    seed = sum(ord(ch) for ch in (seed_text or ""))
    return options[seed % len(options)]


def fallback_description(species: str, raw_name: str, seed_text: str = "", supplied_label: str = ""):
    species_label = SPECIES_LABELS.get(species) or supplied_label or "Fish"
    seed = seed_text or species_label
    starters = ["Bubbles", "Coral", "Sunny", "Ripple", "Pebble", "Comet", "Marble", "Splash"]
    endings = ["Star", "Dash", "Glow", "Flip", "Scout", "Skipper", "Spark", "Drift"]
    bio_templates = [
        "A cheerful {species} who loves showing off bright colors in the reef.",
        "A gentle {species} with a talent for dramatic aquarium entrances.",
        "A curious {species} who patrols the tank like a tiny explorer.",
        "A playful {species} who swims like it already knows the spotlight.",
    ]

    name_suggestion = ""
    if raw_name:
        final_name = sanitize_name(raw_name)
    else:
        final_name = sanitize_name(f"{stable_pick(seed, starters)} {stable_pick(seed[::-1], endings)}")
        name_suggestion = final_name

    bio = sanitize_bio(stable_pick(seed + species_label, bio_templates).format(species=species_label.lower()))
    return {"nameSuggestion": name_suggestion, "bio": bio}


def parse_json_object(text: str):
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def hf_describe_fish(image_data_url: str, species: str, raw_name: str, supplied_label: str = ""):
    token = os.environ.get("HF_TOKEN")
    if not token:
        return None

    species_label = SPECIES_LABELS.get(species) or supplied_label or species or "Fish"
    model_candidates = []
    preferred = os.environ.get("HF_VISION_MODEL", "").strip()
    if preferred:
        model_candidates.append(preferred)
    model_candidates.extend([
        "HuggingFaceTB/SmolVLM-256M-Instruct",
        "Qwen/Qwen2.5-VL-3B-Instruct",
    ])

    prompt = (
        "You write short, delightful aquarium placards for a children's coloring exhibit. "
        "Return strict JSON only with keys nameSuggestion and bio. "
        "If the child already supplied a name, leave nameSuggestion empty and write only the bio. "
        "Keep the bio to one sentence under 100 characters. "
        "Keep any suggested name to 1-2 words under 20 characters. "
        f"Species hint: {species_label}. Child name: {raw_name or 'none'}."
    )

    seen = set()
    for model in model_candidates:
        if not model or model in seen:
            continue
        seen.add(model)
        body = {
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            }],
            "temperature": 0.4,
            "max_tokens": 140,
        }
        req = Request(
            "https://router.huggingface.co/v1/chat/completions",
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(req, timeout=10) as res:
                payload = json.loads(res.read().decode("utf-8"))
            text = (((payload.get("choices") or [{}])[0]).get("message") or {}).get("content") or ""
            parsed = parse_json_object(text)
            if not isinstance(parsed, dict):
                continue
            return {
                "nameSuggestion": sanitize_name(parsed.get("nameSuggestion") or ""),
                "bio": sanitize_bio(parsed.get("bio") or ""),
            }
        except Exception as e:
            print("hf describe failed:", model, e)
            continue
    return None


def read_fish_for_day(key: str):
    d = day_dir(key)
    if not os.path.isdir(d):
        return []
    out = []
    for name in os.listdir(d):
        if not name.endswith(".png"):
            continue
        path = os.path.join(d, name)
        st = os.stat(path)
        fish_id = name[:-4]
        fish_name = ""
        species = ""
        bio = ""
        meta_path = os.path.join(d, fish_id + ".json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                fish_name = (meta.get("name") or "").strip()
                species = (meta.get("species") or "").strip()
                bio = (meta.get("bio") or "").strip()
            except Exception:
                pass
        out.append({
            "id": fish_id,
            "url": f"/submissions/{key}/{name}",
            "createdAt": int(st.st_mtime * 1000),
            "name": fish_name,
            "species": species,
            "bio": bio,
        })
    out.sort(key=lambda f: f["createdAt"])
    return out


def cleanup_old_days():
    today = today_key()
    if not os.path.isdir(SUBMISSIONS):
        return
    for entry in os.listdir(SUBMISSIONS):
        full = os.path.join(SUBMISSIONS, entry)
        if os.path.isdir(full) and entry != today:
            shutil.rmtree(full, ignore_errors=True)


def reset_today():
    today = today_key()
    d = day_dir(today)
    if os.path.isdir(d):
        shutil.rmtree(d, ignore_errors=True)


def cleanup_loop():
    if not CLEANUP_LOCAL_SUBMISSIONS:
        return
    # Run hourly so a long-running server wipes at midnight.
    while True:
        try:
            cleanup_old_days()
        except Exception as e:
            print("cleanup error:", e)
        threading.Event().wait(3600)


SAFE_STATIC_ROOTS = {
    "public": PUBLIC,
    "submissions": SUBMISSIONS,
}


def safe_join(base: str, rel_path: str):
    """Join base + rel_path, refusing traversal outside base. Returns abs path or None."""
    rel_path = rel_path.lstrip("/").replace("\\", "/")
    candidate = os.path.abspath(os.path.join(base, rel_path))
    base_abs = os.path.abspath(base)
    if not (candidate == base_abs or candidate.startswith(base_abs + os.sep)):
        return None
    return candidate


class Handler(BaseHTTPRequestHandler):
    server_version = "ColoringFish/1.0"

    # --- helpers ---
    def _same_origin(self) -> bool:
        """Block cross-site writes and missing-origin curl writes by default."""
        origin = self.headers.get("Origin")
        if not origin:
            return ALLOW_NO_ORIGIN_POSTS
        try:
            parsed_origin = urlparse(origin)
            origin_host = parsed_origin.netloc
        except Exception:
            return False
        expected = self.headers.get("Host") or ""
        return parsed_origin.scheme in ("http", "https") and bool(origin_host) and origin_host == expected

    def _reset_auth_error(self):
        if len(RESET_TOKEN) < 8:
            return 503, "reset token not configured"
        supplied = (self.headers.get("X-Reset-Token") or "").strip()
        if not secrets.compare_digest(supplied, RESET_TOKEN):
            return 403, "invalid reset token"
        return None, None

    def _client_key(self) -> str:
        forwarded = (self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
        if forwarded:
            return forwarded
        if self.client_address:
            return self.client_address[0]
        return "unknown"

    def _rate_limit_retry_after(self, bucket: str):
        if os.environ.get("DISABLE_API_RATE_LIMIT") == "1":
            return None
        limit, window_seconds = RATE_LIMIT_CONFIG.get(bucket, (30, 60))
        now = time.time()
        key = (bucket, self._client_key())
        with RATE_LIMIT_LOCK:
            record = RATE_LIMITS.get(key)
            if not record or record["reset_at"] <= now:
                RATE_LIMITS[key] = {"count": 1, "reset_at": now + window_seconds}
                return None
            if record["count"] >= limit:
                return max(1, int(record["reset_at"] - now + 0.999))
            record["count"] += 1
            return None

    def _enforce_rate_limit(self, bucket: str) -> bool:
        retry_after = self._rate_limit_retry_after(bucket)
        if retry_after is None:
            return True
        self._send_json(429, {"error": "too many requests"}, {
            "Retry-After": str(retry_after),
        })
        return False

    def end_headers(self):
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()

    def _send_json(self, status: int, obj, extra_headers=None, head_only: bool = False):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if not head_only:
            self.wfile.write(body)

    def _send_file(self, path: str, cache: str = "public, max-age=300", head_only: bool = False):
        if not os.path.isfile(path):
            self.send_error(404, "Not found")
            return
        ctype, _ = mimetypes.guess_type(path)
        if ctype is None:
            ctype = "application/octet-stream"
        try:
            with open(path, "rb") as f:
                data = f.read()
        except OSError:
            self.send_error(500, "Read error")
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        if not head_only:
            self.wfile.write(data)

    # --- routing ---
    def _route_get(self, head_only: bool = False):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            return self._send_file(os.path.join(PUBLIC, "index.html"), cache="no-store", head_only=head_only)
        if path == "/color":
            return self._send_file(os.path.join(PUBLIC, "color.html"), cache="no-store", head_only=head_only)
        if path == "/aquarium":
            return self._send_file(os.path.join(PUBLIC, "aquarium.html"), cache="no-store", head_only=head_only)
        if path == "/privacy":
            return self._send_file(os.path.join(PUBLIC, "privacy.html"), cache="no-store", head_only=head_only)

        if path == "/api/fish":
            key = today_key()
            if CLEANUP_LOCAL_SUBMISSIONS:
                cleanup_old_days()
            return self._send_json(200, {"day": key, "fish": read_fish_for_day(key)}, head_only=head_only)

        if path.startswith("/submissions/"):
            rel = path[len("/submissions/"):]
            full = safe_join(SUBMISSIONS, rel)
            if not full:
                return self.send_error(400, "Bad path")
            return self._send_file(full, cache="no-store", head_only=head_only)

        # Everything else from /public
        rel = path.lstrip("/") or "index.html"
        full = safe_join(PUBLIC, rel)
        if full and os.path.isfile(full):
            return self._send_file(full, head_only=head_only)
        self.send_error(404, "Not found")

    def do_GET(self):
        return self._route_get(head_only=False)

    def do_HEAD(self):
        return self._route_get(head_only=True)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/api/reset", "/api/describe", "/api/submit") and not self._same_origin():
            return self._send_json(403, {"error": "cross-origin blocked"})
        if parsed.path == "/api/reset":
            if not self._enforce_rate_limit("reset"):
                return
            status, error = self._reset_auth_error()
            if status:
                return self._send_json(status, {"error": error})
            reset_today()
            return self._send_json(200, {"ok": True, "day": today_key()})
        if parsed.path == "/api/describe":
            if not self._enforce_rate_limit("describe"):
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > MAX_DESCRIBE_BODY_BYTES:
                return self._send_json(413, {"error": "too large"})

            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                return self._send_json(400, {"error": "invalid json"})

            image = payload.get("image") if isinstance(payload, dict) else None
            _, status, error = decode_png_data_url(image, max_bytes=1536 * 1024)
            if status:
                return self._send_json(status, {"error": error})

            raw_name = payload.get("name") if isinstance(payload, dict) else None
            fish_name = sanitize_name(raw_name) if isinstance(raw_name, str) else ""
            raw_species = payload.get("species") if isinstance(payload, dict) else None
            species = sanitize_species(raw_species) if isinstance(raw_species, str) else ""
            raw_label = payload.get("speciesLabel") if isinstance(payload, dict) else None
            supplied_label = normalize_space(raw_label)[:40] if isinstance(raw_label, str) else ""

            described = hf_describe_fish(image, species, fish_name, supplied_label) \
                or fallback_description(species, fish_name, image[-256:], supplied_label)
            if fish_name:
                described["nameSuggestion"] = ""
            return self._send_json(200, described)
        if parsed.path != "/api/submit":
            return self.send_error(404, "Not found")

        if not self._enforce_rate_limit("submit"):
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_SUBMIT_BODY_BYTES:
            return self._send_json(413, {"error": "too large"})

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json(400, {"error": "invalid json"})

        image = payload.get("image") if isinstance(payload, dict) else None
        buf, status, error = decode_png_data_url(image, max_bytes=MAX_UPLOAD_BYTES)
        if status:
            return self._send_json(status, {"error": error})

        raw_name = payload.get("name") if isinstance(payload, dict) else None
        if isinstance(raw_name, str):
            fish_name = sanitize_name(raw_name)
        else:
            fish_name = ""

        raw_species = payload.get("species") if isinstance(payload, dict) else None
        species = sanitize_species(raw_species) if isinstance(raw_species, str) else ""
        raw_bio = payload.get("bio") if isinstance(payload, dict) else None
        if isinstance(raw_bio, str):
            bio = sanitize_bio(raw_bio)
        else:
            bio = ""

        key = today_key()
        d = day_dir(key)
        os.makedirs(d, exist_ok=True)
        fish_id = secrets.token_hex(8)
        with open(os.path.join(d, fish_id + ".png"), "wb") as f:
            f.write(buf)
        if fish_name or species or bio:
            with open(os.path.join(d, fish_id + ".json"), "w", encoding="utf-8") as f:
                json.dump({"name": fish_name, "species": species, "bio": bio}, f)

        return self._send_json(200, {
            "id": fish_id,
            "url": f"/submissions/{key}/{fish_id}.png",
            "day": key,
            "name": fish_name,
            "species": species,
            "bio": bio,
        })

    # Quieter console
    def log_message(self, fmt, *args):
        # Uncomment to enable request logging:
        # super().log_message(fmt, *args)
        return


def main():
    if CLEANUP_LOCAL_SUBMISSIONS:
        cleanup_old_days()
        t = threading.Thread(target=cleanup_loop, daemon=True)
        t.start()

    server = ThreadingHTTPServer((HOST, PORT), Handler)
    display_host = "localhost" if HOST in ("127.0.0.1", "0.0.0.0") else HOST
    print(f"Coloring Fish running at http://{display_host}:{PORT}  (bound to {HOST})")
    print(f"  Color page:    http://{display_host}:{PORT}/color")
    print(f"  Aquarium page: http://{display_host}:{PORT}/aquarium")
    if HOST == "127.0.0.1":
        print("  (set HOST=0.0.0.0 to expose on the LAN for kiosk devices.)")
    if len(RESET_TOKEN) < 8:
        print("  (set RESET_TOKEN to at least 8 characters to enable aquarium reset.)")
    if not CLEANUP_LOCAL_SUBMISSIONS:
        print("  (local old-day cleanup is disabled; unset CLEANUP_LOCAL_SUBMISSIONS or set it to 1 to enable.)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
