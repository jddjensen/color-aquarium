"""
Coloring Fish - a tiny standalone HTTP server.

Serves:
  /                  landing page
  /color             coloring page
  /aquarium          aquarium page
  /style.css, /*.js  static files from ./public
  /assets/*          static files from ./public/assets
  /submissions/*     saved fish PNGs (today's only; older days auto-deleted)

API:
  POST /api/submit   body: {"image": "data:image/png;base64,..."}  -> {id, url, day}
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
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
SUBMISSIONS = os.path.join(ROOT, "submissions")
PORT = int(os.environ.get("PORT", "3000"))
MAX_UPLOAD_BYTES = 15 * 1024 * 1024

os.makedirs(SUBMISSIONS, exist_ok=True)
mimetypes.add_type("application/javascript", ".js")


def today_key() -> str:
    return dt.date.today().isoformat()


def day_dir(key: str) -> str:
    return os.path.join(SUBMISSIONS, key)


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
        meta_path = os.path.join(d, fish_id + ".json")
        if os.path.isfile(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                fish_name = (meta.get("name") or "").strip()
                species = (meta.get("species") or "").strip()
            except Exception:
                pass
        out.append({
            "id": fish_id,
            "url": f"/submissions/{key}/{name}",
            "createdAt": int(st.st_mtime * 1000),
            "name": fish_name,
            "species": species,
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
    def _send_json(self, status: int, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: str, cache: str = "public, max-age=300"):
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
        self.wfile.write(data)

    # --- routing ---
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/" or path == "/index.html":
            return self._send_file(os.path.join(PUBLIC, "index.html"), cache="no-store")
        if path == "/color":
            return self._send_file(os.path.join(PUBLIC, "color.html"), cache="no-store")
        if path == "/aquarium":
            return self._send_file(os.path.join(PUBLIC, "aquarium.html"), cache="no-store")

        if path == "/api/fish":
            key = today_key()
            return self._send_json(200, {"day": key, "fish": read_fish_for_day(key)})

        if path.startswith("/submissions/"):
            rel = path[len("/submissions/"):]
            full = safe_join(SUBMISSIONS, rel)
            if not full:
                return self.send_error(400, "Bad path")
            return self._send_file(full, cache="no-store")

        # Everything else from /public
        rel = path.lstrip("/") or "index.html"
        full = safe_join(PUBLIC, rel)
        if full and os.path.isfile(full):
            return self._send_file(full)
        self.send_error(404, "Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/reset":
            reset_today()
            return self._send_json(200, {"ok": True, "day": today_key()})
        if parsed.path != "/api/submit":
            return self.send_error(404, "Not found")

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_UPLOAD_BYTES:
            return self._send_json(413, {"error": "too large"})

        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            return self._send_json(400, {"error": "invalid json"})

        image = payload.get("image") if isinstance(payload, dict) else None
        prefix = "data:image/png;base64,"
        if not isinstance(image, str) or not image.startswith(prefix):
            return self._send_json(400, {"error": "invalid image"})

        try:
            buf = base64.b64decode(image[len(prefix):], validate=True)
        except Exception:
            return self._send_json(400, {"error": "bad base64"})
        if len(buf) > 12 * 1024 * 1024:
            return self._send_json(413, {"error": "too large"})

        raw_name = payload.get("name") if isinstance(payload, dict) else None
        if isinstance(raw_name, str):
            fish_name = raw_name.strip()[:24]
        else:
            fish_name = ""

        raw_species = payload.get("species") if isinstance(payload, dict) else None
        if isinstance(raw_species, str):
            species = raw_species.strip()[:24]
        else:
            species = ""

        key = today_key()
        d = day_dir(key)
        os.makedirs(d, exist_ok=True)
        fish_id = secrets.token_hex(8)
        with open(os.path.join(d, fish_id + ".png"), "wb") as f:
            f.write(buf)
        if fish_name or species:
            with open(os.path.join(d, fish_id + ".json"), "w", encoding="utf-8") as f:
                json.dump({"name": fish_name, "species": species}, f)

        return self._send_json(200, {
            "id": fish_id,
            "url": f"/submissions/{key}/{fish_id}.png",
            "day": key,
            "name": fish_name,
            "species": species,
        })

    # Quieter console
    def log_message(self, fmt, *args):
        # Uncomment to enable request logging:
        # super().log_message(fmt, *args)
        return


def main():
    cleanup_old_days()
    t = threading.Thread(target=cleanup_loop, daemon=True)
    t.start()

    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Coloring Fish running at http://localhost:{PORT}")
    print(f"  Color page:    http://localhost:{PORT}/color")
    print(f"  Aquarium page: http://localhost:{PORT}/aquarium")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
