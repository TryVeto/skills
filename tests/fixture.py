"""Temporary browser-test library. No user skill folders are read."""
import importlib.util
from pathlib import Path
import tempfile

spec = importlib.util.spec_from_file_location("skills_server", Path(__file__).resolve().parents[1] / "server.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)
with tempfile.TemporaryDirectory(prefix="skills-fixture-") as folder:
    root = Path(folder)
    skill = root / "frontend"
    (skill / "references").mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: frontend\ndescription: A harmless frontend fixture for launcher tests.\n---\n# Frontend test skill\n\nThis document exists only to test the launcher. Preserve exact text and whitespace when copying.\n\n## Read\nRead the [guide](references/guide.md).\n\n## Check\n- Inspect the result.\n- Report what happened.\n")
    (skill / "references/guide.md").write_text("# Reference guide\n\nA local reference document.\n")
    other = root / "writing"
    other.mkdir()
    (other / "SKILL.md").write_text("# Writing\n\nA second harmless fixture.")
    server = app.make_server({"roots": [{"path": str(root), "label": "Tests", "shortcuts": {"frontend": "f"}}]}, 0)
    print("http://127.0.0.1:" + str(server.server_address[1]), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
