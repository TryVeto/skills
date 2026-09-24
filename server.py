#!/usr/bin/env python3
"""A read-only, loopback-only launcher for local SKILL.md packages."""
import argparse
import hashlib
import json
import mimetypes
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

APP = Path(__file__).resolve().parent
MAX_FILE = 1_000_000
SKIP = {".git", "node_modules", "__pycache__", ".venv", "venv"}


def read_text(path):
    if path.stat().st_size > MAX_FILE:
        raise ValueError("File exceeds the 1 MB reading limit")
    return path.read_bytes().decode("utf-8")


def metadata(text, fallback):
    """Read common YAML scalar frontmatter without executing YAML tags."""
    name, description = fallback.replace("-", " ").replace("_", " "), ""
    match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)", text, re.S)
    if match:
        lines = match[1].splitlines()
        for i, line in enumerate(lines):
            field = re.match(r"^(name|description):\s*(.*)$", line)
            if not field:
                continue
            key, value = field.groups()
            if value in (">", "|", ">-", "|-"):
                parts = []
                for next_line in lines[i + 1:]:
                    if next_line and not next_line[0].isspace():
                        break
                    parts.append(next_line.strip())
                value = " ".join(parts)
            value = value.strip().strip("'\"")
            if key == "description":
                description = value
            elif value:
                name = value
    body = text[match.end():] if match else text
    heading = re.search(r"^#\s+(.+)$", body, re.M)
    if heading:
        name = heading[1].strip()
    return name, description, body


class Catalog:
    def __init__(self, config):
        self.config = config
        self.items = {}
        self.warnings = []
        self.refresh()

    def refresh(self):
        items, warnings = {}, []
        for spec in self.config.get("roots", []):
            root = Path(spec["path"]).expanduser()
            label = spec.get("label", root.name)
            if not root.is_dir():
                warnings.append(f"{label}: folder unavailable")
                continue
            root = root.resolve()
            for directory, folders, names in os.walk(root, followlinks=False):
                folders[:] = sorted(n for n in folders if n not in SKIP and not n.startswith(".") and not (Path(directory) / n).is_symlink())
                if "SKILL.md" not in names:
                    continue
                path = Path(directory) / "SKILL.md"
                if path.is_symlink():
                    continue
                key = hashlib.sha256(str(path).encode()).hexdigest()[:20]
                if key in items:
                    continue
                try:
                    text = read_text(path)
                    name, description, _ = metadata(text, path.parent.name)
                    shortcut = spec.get("shortcuts", {}).get(path.parent.name, "")
                    display = spec.get("display", {}).get(path.parent.name, {})
                    items[key] = {"id": key, "name": name, "description": description,
                                  "label": display.get("label", name), "group": display.get("group", ""),
                                  "order": float(display.get("order", 1000000)),
                                  "source": label, "folder": path.parent.name,
                                  "shortcut": shortcut.lower(), "_path": path}
                except (OSError, UnicodeError, ValueError):
                    warnings.append(f"{label} / {path.parent.name}: could not read SKILL.md")
        self.items = items
        self.warnings = warnings

    def listing(self):
        return {"skills": [{k: v for k, v in item.items() if not k.startswith("_")} for item in self.items.values()],
                "warnings": self.warnings, "review_url": self.config.get("review_url", ""),
                "examples": self.config.get("examples", [])}

    def document(self, key, relative="SKILL.md"):
        if key not in self.items:
            raise FileNotFoundError("Skill not found. Refresh the library.")
        item = self.items[key]
        root = item["_path"].parent
        # Both catalog entry and document are checked again on every read.
        if item["_path"].is_symlink():
            raise ValueError("Symbolic links are not served")
        if "\\" in relative or "\x00" in relative:
            raise ValueError("Invalid document path")
        parts = relative.split("/")
        if any(p in ("", ".", "..") or p.startswith(".") for p in parts):
            raise ValueError("Invalid document path")
        path = root.joinpath(*parts)
        for ancestor in [path, *path.parents]:
            if ancestor == root:
                break
            if ancestor.is_symlink():
                raise ValueError("Symbolic links are not served")
        if not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Document is outside the skill")
        if path.suffix.lower() not in (".md", ".txt"):
            raise ValueError("Only Markdown and text documents can be opened")
        raw = read_text(path)
        name, description, body = metadata(raw, path.stem)
        if relative == "SKILL.md":
            name, description = item["name"], item["description"]
        return {"id": key, "name": name, "description": description, "text": raw,
                "body": body, "file": relative, "source": item["source"],
                "path": str(path), "sha256": hashlib.sha256(raw.encode()).hexdigest()}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send(self, status, data, mime="application/json; charset=utf-8", extra=None):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        for key, value in {
            "Content-Type": mime, "Content-Length": str(len(raw)), "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
            **(extra or {}),
        }.items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def do_GET(self):
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or hosts[0] not in self.server.allowed_hosts:
            return self.send(403, {"error": "Unrecognized host"})
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            return self.send(403, {"error": "Cross-site requests are not accepted"})
        origin = self.headers.get("Origin")
        if origin and origin not in self.server.allowed_origins:
            return self.send(403, {"error": "Unrecognized origin"})
        url = urlsplit(self.path)
        path = unquote(url.path)
        try:
            if path == "/api/skills":
                self.server.catalog.refresh()
                return self.send(200, self.server.catalog.listing())
            if path.startswith("/api/skill/"):
                key = path[len("/api/skill/"):]
                query = parse_qs(url.query)
                doc = self.server.catalog.document(key, query.get("file", ["SKILL.md"])[0])
                if query.get("download") == ["1"]:
                    return self.send(200, doc["text"].encode(), "text/plain; charset=utf-8",
                                     {"Content-Disposition": 'attachment; filename="SKILL.md"'})
                return self.send(200, doc)
            assets = {"/": "index.html", "/app.js": "app.js", "/markdown.js": "markdown.js",
                      "/style.css": "style.css", "/favicon.svg": "favicon.svg"}
            if path in assets or path.startswith("/skill/"):
                asset = APP / "web" / assets.get(path, "index.html")
                mime = mimetypes.guess_type(asset)[0] or "application/octet-stream"
                return self.send(200, asset.read_bytes(), mime + ("; charset=utf-8" if mime.startswith("text/") else ""))
            return self.send(404, {"error": "Not found"})
        except FileNotFoundError:
            return self.send(404, {"error": "Document not found. Refresh the library."})
        except (OSError, UnicodeError, ValueError):
            return self.send(400, {"error": "This document cannot be read safely."})

    do_HEAD = do_GET

    def do_POST(self):
        self.send(405, {"error": "Skills is read-only"})
    do_PUT = do_PATCH = do_DELETE = do_POST


def make_server(config, port):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    actual_port = server.server_address[1]
    server.catalog = Catalog(config)
    server.allowed_hosts = {"skills.localhost", f"skills.localhost:{actual_port}",
                            f"127.0.0.1:{actual_port}", f"localhost:{actual_port}"}
    server.allowed_origins = {"http://" + host for host in server.allowed_hosts}
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8950)
    parser.add_argument("--config", type=Path, default=APP / "config.local.json")
    parser.add_argument("--root", action="append", type=Path, help="Skill directory; repeat to index several")
    args = parser.parse_args()
    config = json.loads(args.config.read_text()) if args.config.is_file() else {
        "roots": [{"path": "~/.codex/skills", "label": "Codex"}, {"path": "~/.claude/skills", "label": "Claude"}]
    }
    if args.root:
        config["roots"] = [{"path": str(p), "label": p.name} for p in args.root]
    server = make_server(config, args.port)
    print(f"Skills · http://127.0.0.1:{server.server_address[1]} · {len(server.catalog.items)} skills", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
