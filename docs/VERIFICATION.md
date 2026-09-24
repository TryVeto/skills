# Release verification

The launcher is implemented against the existing Prompts application's launcher and reader design. No generated concept was needed: the requested reference was the working local app.

## Checked

- 10 Python tests passed: exact source bytes, metadata, references, download, refresh, read-only routes, Host/Origin restrictions, traversal, symlinks, missing files, oversized files, and response headers.
- 27 browser assertions passed using both a temporary fixture library and the installed local library.
- The same 27 assertions passed through the final skills.localhost address.
- Actual clipboard contents matched the source, including frontmatter and whitespace. Clipboard denial displayed the exact manual-copy text.
- Search, Enter, Escape, shortcut reassignment and persistence, pinned-only mode, disabled shortcuts, reference navigation, reload, and stale-response recovery were checked.
- The prior review harness remains accessible at /review on the same origin. Its persisted records and curated source bytes were compared before and after and were unchanged.
- Public files were reviewed to exclude local configuration, personal paths, skill content, databases, screenshots, logs, and credentials.

## Visual review

Reference and implementation screenshots were captured with isolated, local Chrome profiles using the installed browser helper and native CDP. This was necessary because the apps run on the local Mac; the available cloud browser does not represent that host's localhost. No personal browser session was attached.

Actual screenshot pixels were inspected at 1200 × 800 and 390 × 844, in light and dark themes. Reference and implementation were compared for:

1. Narrow, centered launcher and header alignment.
2. Compact search field, type scale, and row rhythm.
3. Stable shortcut keys and visible keyboard selection.
4. White/neutral light palette and system-driven dark palette.
5. Open list layout, spacing, and restrained secondary controls.
6. Focused document column, persistent copy action, and mobile wrapping.

The implementation follows the requested reference faithfully. Intentional differences: skill-specific copy; a bounded scrolling list for a larger library; a copy icon on each row; pinned skills before unpinned skills; package-document links and source details. The monochrome palette follows the newer Prompts reader. No decorative headings, marketing copy, or card grid were added. A small viewport-height overflow was repaired before the final browser pass.

Visible copy is limited to the skill library, its search and actions, status and error feedback, and the secondary reader/options controls. No material visual mismatch remained in the inspected views.

## Limits

- Verified with local desktop Chrome and mobile viewport emulation, not a physical phone or Safari.
- The Markdown reader intentionally supports a limited subset and does not render raw HTML or images.
- GitHub Actions was configured, but the first run was blocked before any steps started: GitHub reported that the account is locked due to a billing issue. This is not a hosted test pass. Local test results above are separate.
