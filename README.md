# Skills

A small, keyboard-first launcher for local AI skills. Find a skill, read it, copy its exact instructions, and get back to work.

Inspired by [Prompts](https://github.com/tryveto/prompts): a narrow list, stable shortcuts, a focused reader, and your system's light or dark theme. No accounts, telemetry, model calls, build step, or runtime dependencies.

## Run

Requires Python 3.10 or newer.

```sh
git clone https://github.com/tryveto/skills.git
cd skills
python3 server.py
```

Open **http://127.0.0.1:8950**. By default, Skills reads `~/.codex/skills` and `~/.claude/skills`. It recursively finds regular `SKILL.md` files. Symbolic links, hidden directories, dependency directories, and files over 1 MB are skipped.

To use other folders:

```sh
python3 server.py --root ~/my-skills --root ~/another-library
```

Or copy `config.example.json` to `config.local.json` and edit it:

```json
{
  "roots": [
    {
      "path": "~/my-skills",
      "label": "My skills",
      "shortcuts": { "frontend-design": "f", "writing": "w" }
    }
  ]
}
```

Shortcut defaults use the skill's directory name. Roots can point to a collection or a single skill package. Search matches titles, directory names, descriptions, and source labels. Refresh picks up file additions and changes. Duplicate paths are indexed once.

## Organize the list

Each root can include an optional `display` map keyed by skill directory name:

```json
"display": {
  "frontend-design": { "label": "Design a product interface", "group": "Product", "order": 1 },
  "landing-page": { "label": "Design a landing page", "group": "Marketing", "order": 2 },
  "video": { "label": "Produce a video", "group": "Marketing", "order": 3 }
}
```

Labels describe the task; groups keep related work together. Lower order values appear first; pinned skills lead within each group. Search flattens the groups and matches both task labels and original skill names. The reader and copied source retain the original skill text. Restart the server after changing configuration.

## Keyboard

| Key | Action |
| --- | --- |
| ⌘ K / Ctrl K, or / | Focus search |
| ↑ / ↓ | Select a result |
| Enter | Open the selected skill |
| Assigned letter or number | Copy the exact SKILL.md and select its row |
| Escape | Return from reader, clear search, or leave search |
| ⌘ Shift C / Ctrl Shift C | Copy the open document |
| Tab | Navigate all controls |

Click a row to read it; click the copy icon to copy. In the reader, **Source & shortcut** lets you assign or remove a stable shortcut. Shortcuts pin skills above the rest. Keyboard shortcuts and pinned-only view can be changed in Options. Preferences are stored in this browser; single-key shortcuts do nothing while typing or while a dialog is open.

Copying preserves the entire file, including frontmatter, line endings, and whitespace. It does not install or run the skill. When browser clipboard permission is unavailable, a manual copy dialog appears. On browsers that require an immediate user gesture, the first asynchronous copy may use this fallback.

## Reader

The reader formats common Markdown, including headings, lists, code, tables, and links. Raw HTML is inert text. Relative Markdown/text links open documents inside the same skill package; external HTTP(S) links open separately. Images and executable files are not loaded. This is a deliberately small Markdown reader, not a full CommonMark renderer.

Deep links use `/skill/<id>`. IDs are derived from the local source path, so moving a package changes its ID and resets any browser-specific shortcut for it. Download exports the original SKILL.md, not the full package.

## skills.localhost

The built-in server binds only to `127.0.0.1`. With an existing local reverse proxy, route `skills.localhost` to `127.0.0.1:8950` and preserve the `Host: skills.localhost` header. For Caddy:

```caddy
http://skills.localhost {
    reverse_proxy 127.0.0.1:8950
}
```

The app does not install or change a global proxy. Direct loopback access works without one. Use `--port` to choose another port.

An optional `review_url` config value can link to an existing local review tool from Options. Only loopback HTTP addresses are accepted. The launcher neither starts that tool nor imports its database.

## Local examples

An optional `examples` array in `config.local.json` adds an **Examples** link to the launcher. Each entry supports `title`, `description`, `url`, `control_url`, `notes_url`, `review_url`, `brief`, `note`, and `kind` (`video` for a watch action). Example URLs open separately from the launcher; use an isolated local artifact server for executable examples. Keep private test outputs and configuration out of Git.

The gallery at `/?examples=1` distinguishes the skill result from the same task run without it. It does not infer a winner or approval.

## Local data and security

Your skills remain in their original folders. Config, local data, and verification output are ignored by Git. This repository distributes the launcher, not anyone's private skill library.

The server has no write or execution endpoints. It validates Host and Origin, denies cross-site requests, does not allow CORS, constrains document reads to the indexed skill package, rejects symlink documents and path traversal, and sends a restrictive Content Security Policy. It is a local personal tool, not a multi-user or internet-facing server; do not expose it publicly.

The reader copies instructions as text. Referenced files are not bundled in that copy; an agent using the skill still needs access to its package.

## Development and tests

```sh
python3 -m unittest discover -s tests -v
```

Browser checks need Node 22+ and an installed Chrome/Chromium. The suite starts its own temporary fixture library. Run:

```sh
CHROME=/path/to/chrome node tests/browser.mjs
```

Set `SKILLS_TEST_URL` to check a running app instead (it must include a skill searchable as “frontend”). The suite uses a fresh isolated browser profile, verifies the real clipboard, tests a denied-clipboard fallback, checks responsive/light/dark views, and writes screenshots and results to ignored `verification/`. It does not modify skill files.

MIT licensed. See [LICENSE](LICENSE).
