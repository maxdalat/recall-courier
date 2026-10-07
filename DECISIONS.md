# Decisions

Choices made while building Recall Courier, in the order they came up. Where the brief and Anthropic's docs disagreed, the docs won, and the entry says so.

## Name

- **`recall-courier`**, display name **Recall Courier for Anki**. Searched GitHub and npm: dozens of `anki-mcp*` repositories exist, so the name avoids "anki" and "mcp". Nothing named `recall-courier` was found on GitHub or npm. The directory's own name list cannot be queried before submitting, so uniqueness there is unverified.
- "for Anki" appears only in the display name and descriptions, as a statement of compatibility, next to an explicit "unofficial, not affiliated with Anki or Ankitects" notice in the manifest description, README and privacy policy. The directory may still hold it for a brand-name review; see SUBMISSION.md.
- Author is `Maxim Dalat` with `https://github.com/maxdalat` (from `gh api user`); no email appears in any file. Commits in this repository use the GitHub noreply address (`63883235+maxdalat@users.noreply.github.com`) rather than the personal email in the global git configuration, because commit authorship is public.

## Conflicts between the brief and the docs (docs won)

1. **"No other variables" in the launch command.** `command` is exactly `node` and `args` is exactly `["${CLAUDE_PLUGIN_ROOT}/server/index.js"]`, as required. But the plugin docs say `${user_config.KEY}` values reach a stdio server only through `command`, `args` or `env`, so the three settings arrive through an `env` block that contains nothing but `${user_config.*}` references. A test enforces this. Verified with a probe plugin in Claude Code: defaults, an empty sensitive default, a boolean, and explicit values all arrive as expected.
2. **"Never read credentials from environment variables."** The only documented way to hand a sensitive `userConfig` value to a local server is an environment variable set by `.mcp.json`. The server therefore reads exactly one credential variable, `RECALL_COURIER_API_KEY`, which exists only because the plugin's own sensitive setting fills it. It never falls back to ambient variables such as `ANKI_API_KEY`, and never logs or echoes it (a protocol test checks messages for leaks). A source-scanning test pins the list of variables `server/config.js` may read.
3. **Which apps run it.** The brief says "Claude desktop app or Claude Code". The platform docs say a local MCP server in a plugin loads in Claude Code (terminal, IDE, and the desktop app's Code tab) and in Cowork sessions running on the user's computer, and is ignored in chat (claude.ai web, mobile, and desktop-app chat). The README says exactly that, plus that it does not work in a browser-only claude.ai session. Node 18+ must be installed by the user on every surface; the docs do not promise a bundled runtime.
4. **Cowork does not prompt for `userConfig`** and ignores a server whose referenced option has no default. Every option therefore has a default (the API key defaults to an empty string). Cowork users get the defaults and cannot enter an API key; the README says so.
5. **`destructiveHint`.** The connector criteria say `destructiveHint: true` is for tools that "modify or delete data". Tools that change existing data (rename, update, tag, move, suspend, set options, sync, import, set due date, delete, reset) are therefore `true`, even where reversible. Only tools that purely create new things or only affect windows and processes (`add_*`, `create_*`, `store_media`, `export_deck`, `anki_launch`, `anki_switch_profile`, `open_add_cards_dialog`) are `false`. Read-only tools carry `readOnlyHint: true` and no destructive hint. `idempotentHint` is set where repeating a call changes nothing more. `open_browser_search` is `readOnlyHint: true` because it only changes what is on screen.
6. **Manifest listing fields.** `icon`, `documentationUrl`, `supportUrl` and `privacyPolicyUrl` are read by the directory but `claude plugin validate` only knows them from Claude Code 2.1.281. The local CLI is 2.1.274 and prints four "Unknown field" warnings; it exits successfully. They are kept because the directory uses them.
7. **MCP server declared in `.mcp.json`**, not inline in `plugin.json`, following the plugin docs' own examples.
8. **AnkiConnect docs.** `git.foosoft.net` failed with a TLS error here; the GitHub mirror says the project moved to `git.sr.ht/~foosoft/anki-connect`, so the API was read there. Parameter names in the code were cross-checked against that README.

## Architecture

- Zero dependencies, ES modules, built-in `fetch`, Node 18-compatible APIs only. 24 small files under `server/`; the largest is about 350 lines. `package.json` has `"type": "module"`, test scripts and no dependencies or lockfile.
- The MCP stdio protocol is implemented by hand (`server/protocol.js`): initialize with version negotiation, ping, `tools/list`, `tools/call`, notifications, JSON-RPC batches, parse and invalid-request errors. stdout carries only protocol lines; diagnostics go to stderr.
- Bad arguments get a plain-language tool result (`isError: true`) naming each problem, so Claude can correct and retry, rather than a protocol error. A tiny JSON Schema validator (`server/schema.js`) does this, with light coercion (numeric strings, JSON-encoded arrays).
- Only `127.0.0.1`, `localhost` and `::1` are accepted as the AnkiConnect URL, so the README's "requests only to localhost" is enforced rather than promised.
- Anki's collection file is never opened. Everything goes through AnkiConnect, using `multi` to batch reads (note types, deck stats, statistics, per-item results).
- Setup logic lives in `server/setup.js`: detects Anki per platform (macOS app folders, Windows `LOCALAPPDATA` and Program Files, Linux `PATH` and Flatpak), launches it detached, polls for about 30 seconds, then diagnoses: not installed (points to apps.ankiweb.net), add-on folder missing (exact install steps, nothing installed automatically), add-on present but silent (likely causes). A "start Anki automatically" setting lets users turn launching off.
- `anki_status` never launches Anki and reports problems as status, not errors. `anki_launch` always re-checks.

## Tool decisions

- **40 tools**: everything in the brief except `change_note_type`.
- **`change_note_type` omitted.** The brief allowed it only "if AnkiConnect supports it safely". `updateNoteModel` cannot be exercised without a real Anki here, and a wrong card-template mapping would silently lose cards. The README points users to Anki's own *Change Note Type*.
- **`rename_deck`** has no AnkiConnect action. It creates the new deck tree, moves each deck's own cards (`changeDeck`), re-attaches the options group, verifies the old tree is empty, and only then deletes it (deepest first). If anything fails before the verification, nothing is deleted. It refuses the Default deck, filtered decks, name collisions, and moving a deck inside itself. A test caught an early bug where an escaped `*` stopped the "direct cards only" search from excluding sub-decks.
- **`delete_deck`** states that cards are always deleted too (AnkiConnect requires `cardsToo: true`), requires `confirm: true`, and without it reports the deck, card and sub-deck counts. **`delete_notes`**, **`forget_cards`** and removals in **`update_note_type`** work the same way.
- **`add_notes`** pre-checks with `canAddNotesWithErrorDetail` (falling back to `canAddNotes` on older add-ons) so duplicates are reported separately from real failures, detects duplicates inside one batch itself, matches deck, note type and field names case-insensitively, suggests similar deck names, and creates decks only with `create_deck_if_missing`. A mistyped deck never creates a new deck by accident (AnkiConnect's `changeDeck` would; this plugin checks first).
- **Convenience card tools** find the stock note types by name and fall back to structure (two fields and one template for Basic, two templates for reversed, cloze flag) for localized or renamed collections. The localized path is covered only by fake-server tests.
- **Math.** A raw `<` or `>` inside `\(...\)` or `\[...\]` is rewritten to `\lt` / `\gt` and reported as a warning, in addition to the skill teaching Claude to write them correctly. Text outside math spans is never touched.
- **Media.** Files are never overwritten (`deleteExisting: false`); extensions are limited to image, audio and video types; URLs must be public https (no credentials, localhost, private or link-local hosts). Anki, not Node, downloads URLs. Paths must be absolute and exist.
- **`import_package`** refuses `.colpkg` (importing one replaces the whole collection). **`export_deck`** refuses to overwrite files.
- Tool descriptions describe behavior and syntax only; they do not tell Claude how to behave beyond the tool's own function. Behavioral guidance lives in the bundled skill.
- The skill is a single `SKILL.md`; the docs allow supporting folders but nothing needed one.

## Testing

- Fake AnkiConnect (`test/fake-ankiconnect.js`): in-memory decks, note types, notes, cards, tags, media, profiles and reviews, a small Anki search parser, and the real add-on's quirks (null results from `addNotes`, `{}` for unknown notes, error strings, API key checks, "collection is not available"). It also supports fault injection.
- Suites: core units, setup and launch logic with injected platform facts, every tool against the fake (success, AnkiConnect errors, Anki not running, add-on missing, duplicates, partial failures, math), the real server over stdio, repository invariants from the checklist, and the end-to-end scenario run against the fake.
- **Real-Anki end-to-end test was not run: Anki is not installed on this machine** and the brief forbids installing it. `npm run test:e2e` runs the same lifecycle script (`test/e2e-scenario.js`) against a real, already-running Anki, only touching decks named `zz-plugin-test*`, never launching Anki, and verifying that all other decks are unchanged. That script is exercised in CI against the fake, but the real add-on's behavior (search syntax edge cases, `getDeckStats`, rename) is unverified end to end.
- **Install test.** In an isolated Claude Code config directory, the repository was added as a local marketplace and installed; `claude mcp list` showed the `anki` server connected. A model-driven session could not be run because the CLI's OAuth session on this machine has expired, so the tool list as seen by a model was not checked; `tools/list` over stdio is covered by protocol tests.

## Not done on purpose

- No automatic add-on installation, no downloading of anything, no bundled Node runtime.
- No tool that reads or writes Anki's database file, edits sync credentials, or touches AnkiWeb directly.
- No hosted server, telemetry, or logging to disk.
