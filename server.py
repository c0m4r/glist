#!/usr/bin/env python3
"""glist - personal games library. Zero-dependency: Python stdlib + SQLite."""

import json
import os
import re
import sqlite3
import threading
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
COVERS = os.path.join(ROOT, "covers")
DB_PATH = os.path.join(ROOT, "glist.db")
PORT = int(os.environ.get("GLIST_PORT", "8420"))

MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB

# magic bytes -> file extension, for validating uploaded covers
IMAGE_SIGNATURES = (
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
    (b"GIF87a", ".gif"),
    (b"GIF89a", ".gif"),
)

PLATFORMS = {"steam", "gog", "ea", "ubisoft", "epic", "physical-original", "physical-cdaction"}

STEAM_SEARCH = "https://store.steampowered.com/api/storesearch/?term={q}&cc=US&l=english"
STEAM_DETAILS = "https://store.steampowered.com/api/appdetails?appids={appid}&l=english"

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


def sniff_image_ext(data):
    for sig, ext in IMAGE_SIGNATURES:
        if data.startswith(sig):
            return ext
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    return None


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    os.makedirs(COVERS, exist_ok=True)
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS games (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                platform TEXT NOT NULL,
                steam_appid INTEGER,
                cover TEXT DEFAULT '',
                hero TEXT DEFAULT '',
                description TEXT DEFAULT '',
                genres TEXT DEFAULT '',
                release_date TEXT DEFAULT '',
                developer TEXT DEFAULT '',
                publisher TEXT DEFAULT '',
                notes TEXT DEFAULT '',
                added_at TEXT DEFAULT (datetime('now'))
            )
        """)


def cache_image(url):
    """Download a remote image into covers/ and return its local URL.
    Returns the input unchanged if it is already local, empty, or the
    download fails (the frontend falls back gracefully on broken covers)."""
    if not url or not url.startswith(("http://", "https://")):
        return url
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "glist/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = resp.read(MAX_UPLOAD + 1)
        if len(data) > MAX_UPLOAD:
            return url
        ext = sniff_image_ext(data)
        if ext is None:
            return url
        name = uuid.uuid4().hex + ext
        with open(os.path.join(COVERS, name), "wb") as f:
            f.write(data)
        return f"/covers/{name}"
    except Exception:
        return url


def cache_existing_images():
    """One-shot startup pass: localize remote cover/hero URLs already in the DB."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, cover, hero FROM games WHERE cover LIKE 'http%' OR hero LIKE 'http%'"
        ).fetchall()
    for row in rows:
        updates = {}
        for field in ("cover", "hero"):
            local = cache_image(row[field])
            if local != row[field]:
                updates[field] = local
        if updates:
            with db() as conn:
                conn.execute(
                    f"UPDATE games SET {', '.join(f'{f}=?' for f in updates)} WHERE id=?",
                    [*updates.values(), row["id"]])
    if rows:
        print(f"image cache: processed {len(rows)} game(s)")


def remove_local_cover(url):
    """Delete an uploaded cover file when it is no longer referenced."""
    if not url or not url.startswith("/covers/"):
        return
    fpath = os.path.normpath(os.path.join(COVERS, url[len("/covers/"):]))
    if fpath.startswith(COVERS) and os.path.isfile(fpath):
        os.remove(fpath)


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "glist/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read().decode("utf-8"))


def steam_search(query):
    data = fetch_json(STEAM_SEARCH.format(q=urllib.parse.quote(query)))
    items = []
    for it in data.get("items", []):
        appid = it.get("id")
        items.append({
            "appid": appid,
            "title": it.get("name", ""),
            "thumb": it.get("tiny_image", ""),
            "cover": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/library_600x900_2x.jpg",
            "hero": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{appid}/header.jpg",
        })
    return items


def steam_details(appid):
    data = fetch_json(STEAM_DETAILS.format(appid=int(appid)))
    entry = data.get(str(appid), {})
    if not entry.get("success"):
        return None
    d = entry["data"]
    return {
        "appid": int(appid),
        "title": d.get("name", ""),
        "description": d.get("short_description", ""),
        "genres": ", ".join(g["description"] for g in d.get("genres", [])),
        "release_date": d.get("release_date", {}).get("date", ""),
        "developer": ", ".join(d.get("developers", []) or []),
        "publisher": ", ".join(d.get("publishers", []) or []),
        "hero": d.get("header_image", ""),
        "cover": f"https://cdn.cloudflare.steamstatic.com/steam/apps/{int(appid)}/library_600x900_2x.jpg",
    }


GAME_FIELDS = ("title", "platform", "steam_appid", "cover", "hero", "description",
               "genres", "release_date", "developer", "publisher", "notes")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    # ---- helpers ----
    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        if path.startswith("/covers/"):
            base, rel = COVERS, path[len("/covers/"):]
        else:
            base, rel = STATIC, path.lstrip("/")
        fpath = os.path.normpath(os.path.join(base, rel))
        if not fpath.startswith(base) or not os.path.isfile(fpath):
            self.send_json({"error": "not found"}, 404)
            return
        ext = os.path.splitext(fpath)[1]
        with open(fpath, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ---- routing ----
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path, qs = parsed.path, urllib.parse.parse_qs(parsed.query)
        try:
            if path == "/api/games":
                with db() as conn:
                    rows = conn.execute("SELECT * FROM games ORDER BY title COLLATE NOCASE").fetchall()
                self.send_json([dict(r) for r in rows])
            elif path == "/api/search":
                q = (qs.get("q") or [""])[0].strip()
                if not q:
                    self.send_json([])
                else:
                    self.send_json(steam_search(q))
            elif path == "/api/details":
                appid = (qs.get("appid") or [""])[0]
                if not appid.isdigit():
                    self.send_json({"error": "bad appid"}, 400)
                else:
                    info = steam_details(appid)
                    if info is None:
                        self.send_json({"error": "no details"}, 404)
                    else:
                        self.send_json(info)
            elif path.startswith("/api/"):
                self.send_json({"error": "not found"}, 404)
            else:
                self.serve_static(path)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def handle_upload(self):
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            self.send_json({"error": "empty upload"}, 400)
            return
        if length > MAX_UPLOAD:
            self.send_json({"error": "file too large (max 10 MB)"}, 413)
            return
        data = self.rfile.read(length)
        ext = sniff_image_ext(data)
        if ext is None:
            self.send_json({"error": "unsupported image type (use jpg/png/gif/webp)"}, 400)
            return
        name = uuid.uuid4().hex + ext
        with open(os.path.join(COVERS, name), "wb") as f:
            f.write(data)
        self.send_json({"url": f"/covers/{name}"}, 201)

    def do_POST(self):
        if self.path == "/api/upload":
            try:
                self.handle_upload()
            except Exception as e:
                self.send_json({"error": str(e)}, 500)
            return
        if self.path != "/api/games":
            self.send_json({"error": "not found"}, 404)
            return
        try:
            data = self.read_body()
            title = (data.get("title") or "").strip()
            platform = data.get("platform") or ""
            if not title or platform not in PLATFORMS:
                self.send_json({"error": "title and valid platform required"}, 400)
                return
            values = {f: data.get(f) or ("" if f != "steam_appid" else None) for f in GAME_FIELDS}
            values["title"], values["platform"] = title, platform
            values["cover"] = cache_image(values["cover"])
            values["hero"] = cache_image(values["hero"])
            with db() as conn:
                cur = conn.execute(
                    f"INSERT INTO games ({', '.join(GAME_FIELDS)}) VALUES ({', '.join('?' for _ in GAME_FIELDS)})",
                    [values[f] for f in GAME_FIELDS])
                row = conn.execute("SELECT * FROM games WHERE id=?", (cur.lastrowid,)).fetchone()
            self.send_json(dict(row), 201)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_PUT(self):
        m = re.fullmatch(r"/api/games/(\d+)", self.path)
        if not m:
            self.send_json({"error": "not found"}, 404)
            return
        gid = int(m.group(1))
        try:
            data = self.read_body()
            updates = {f: data[f] for f in GAME_FIELDS if f in data}
            if "platform" in updates and updates["platform"] not in PLATFORMS:
                self.send_json({"error": "invalid platform"}, 400)
                return
            if not updates:
                self.send_json({"error": "nothing to update"}, 400)
                return
            for field in ("cover", "hero"):
                if field in updates:
                    updates[field] = cache_image(updates[field])
            with db() as conn:
                old = conn.execute("SELECT cover, hero FROM games WHERE id=?", (gid,)).fetchone()
                conn.execute(
                    f"UPDATE games SET {', '.join(f'{f}=?' for f in updates)} WHERE id=?",
                    [*updates.values(), gid])
                row = conn.execute("SELECT * FROM games WHERE id=?", (gid,)).fetchone()
            if row is None:
                self.send_json({"error": "not found"}, 404)
            else:
                for field in ("cover", "hero"):
                    if field in updates and old and old[field] != updates[field]:
                        remove_local_cover(old[field])
                self.send_json(dict(row))
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def do_DELETE(self):
        m = re.fullmatch(r"/api/games/(\d+)", self.path)
        if not m:
            self.send_json({"error": "not found"}, 404)
            return
        with db() as conn:
            old = conn.execute("SELECT cover, hero FROM games WHERE id=?", (int(m.group(1)),)).fetchone()
            cur = conn.execute("DELETE FROM games WHERE id=?", (int(m.group(1)),))
        if old:
            remove_local_cover(old["cover"])
            remove_local_cover(old["hero"])
        self.send_json({"deleted": cur.rowcount > 0})


if __name__ == "__main__":
    init_db()
    threading.Thread(target=cache_existing_images, daemon=True).start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"glist running on http://localhost:{PORT}")
    server.serve_forever()
