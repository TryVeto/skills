import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

spec = importlib.util.spec_from_file_location("skills_server", Path(__file__).resolve().parents[1] / "server.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class SkillsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "example" / "references").mkdir(parents=True)
        self.raw = b"---\r\nname: example\r\ndescription: >-\r\n  A careful skill\r\n  for testing.\r\n---\r\n# Example skill\r\n\r\nKeep  exact spacing.\r\n"
        (self.root / "example" / "SKILL.md").write_bytes(self.raw)
        (self.root / "example" / "references" / "guide.md").write_text("# Guide\nWorks.")
        self.server = app.make_server({"roots": [{"path": str(self.root), "label": "Test"}]}, 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.key = next(iter(self.server.catalog.items))

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def get(self, path, headers=None, method="GET"):
        request = urllib.request.Request(f"http://127.0.0.1:{self.port}" + path, headers=headers or {}, method=method)
        try:
            response = urllib.request.urlopen(request)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.read(), response.headers

    def test_metadata_and_exact_bytes(self):
        code, body, _ = self.get("/api/skill/" + self.key)
        doc = json.loads(body)
        self.assertEqual(code, 200)
        self.assertEqual(doc["text"].encode(), self.raw)
        self.assertEqual(doc["name"], "Example skill")
        self.assertEqual(doc["description"], "A careful skill for testing.")

    def test_reference_and_download(self):
        self.assertEqual(self.get("/api/skill/" + self.key + "?file=references%2Fguide.md")[0], 200)
        code, body, headers = self.get("/api/skill/" + self.key + "?download=1")
        self.assertEqual((code, body), (200, self.raw))
        self.assertIn("attachment", headers["Content-Disposition"])

    def test_traversal_and_nontext_denied(self):
        for relative in ["../secret.md", "/etc/passwd", ".env", "references/../../secret.md", "run.py", "references\\guide.md"]:
            from urllib.parse import quote
            self.assertEqual(self.get("/api/skill/" + self.key + "?file=" + quote(relative))[0], 400)

    def test_symlink_denied(self):
        (self.root / "outside.md").write_text("Not a skill document")
        (self.root / "example" / "leak.md").symlink_to(self.root / "outside.md")
        self.assertEqual(self.get("/api/skill/" + self.key + "?file=leak.md")[0], 400)

    def test_bad_host_and_origin_denied(self):
        self.assertEqual(self.get("/", {"Host": "attacker.example"})[0], 403)
        self.assertEqual(self.get("/api/skills", {"Origin": "https://attacker.example"})[0], 403)
        self.assertEqual(self.get("/api/skills", {"Sec-Fetch-Site": "cross-site"})[0], 403)

    def test_read_only_and_csp(self):
        self.assertEqual(self.get("/api/run", method="POST")[0], 405)
        _, _, headers = self.get("/")
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_refresh_does_not_modify_sources(self):
        before = (self.root / "example" / "SKILL.md").read_bytes()
        self.get("/api/skills")
        self.assertEqual(before, (self.root / "example" / "SKILL.md").read_bytes())
        (self.root / "new").mkdir()
        (self.root / "new" / "SKILL.md").write_text("# New skill")
        self.assertEqual(len(json.loads(self.get("/api/skills")[1])["skills"]), 2)

    def test_missing_and_oversize_files(self):
        self.assertEqual(self.get("/api/skill/missing")[0], 404)
        (self.root / "example" / "large.md").write_bytes(b"x" * (app.MAX_FILE + 1))
        self.assertEqual(self.get("/api/skill/" + self.key + "?file=large.md")[0], 400)

    def test_empty_catalog_and_missing_root(self):
        catalog = app.Catalog({"roots": [{"path": str(self.root / "missing"), "label": "Missing"}]})
        self.assertEqual(catalog.listing()["skills"], [])
        self.assertEqual(len(catalog.warnings), 1)

    def test_shell_and_head(self):
        self.assertEqual(self.get("/skill/" + self.key)[0], 200)
        self.assertEqual(self.get("/", method="HEAD")[1], b"")
        self.assertEqual(self.get("/server.py")[0], 404)


if __name__ == "__main__":
    unittest.main()
