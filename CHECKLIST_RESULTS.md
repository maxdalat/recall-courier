# Pre-submission checklist results

Self-review of this repository against the [plugin pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist) and the [connector review criteria](https://claude.com/docs/connectors/building/review-criteria), checked line by line on 2026-10-07 (plugin version 0.1.0).

The **If violated** column is the checklist's severity: **Blocks** (cannot submit), **Hold** (a reviewer reads it first), **Warning**, or **Note**. The **Status** column is this repository's result:

- **OK**: the requirement is met, with evidence.
- **N/A**: the rule does not apply to this plugin.
- **EXPECT HOLD**: the rule is met as far as the repository can tell, but a reviewer will probably look anyway.
- **UNVERIFIED**: cannot be checked outside the developer portal.

Automated evidence comes from `npm test` (91 tests; the file-level rules are enforced by `test/repo.test.js`) and `claude plugin validate .`, which passes with four warnings (see the `claude plugin validate` section).

## Repository and folder layout

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 1 | Submit a folder that contains `.claude-plugin/plugin.json` | Blocks | OK | The plugin is at the repository root. |
| 2 | One plugin at a time; no multi-plugin marketplace repo | Blocks | OK | `marketplace.json` lists exactly one plugin (this one, source `./`); `repo.test.js` asserts it. |
| 3 | Everything the plugin runs is inside the plugin folder; component paths stay inside it | Blocks | OK | Server, skill and icon are all under the root; no `..` paths. |
| 4 | Regular files only: no symlinks, submodules, LFS pointers | Blocks | OK | Test walks every file and rejects symlinks; no `.gitmodules`. |
| 5 | No `.DS_Store`, `Thumbs.db`, `desktop.ini`, `__MACOSX` | Blocks | OK | Banned by test and listed in `.gitignore`. |
| 6 | File names valid on Windows and macOS (no colon, trailing dot/space, device names, case-only collisions) | Validation stops | OK | Test checks characters and case-insensitive collisions. |
| 7 | Folders on the plugin path use only letters, digits, dots, hyphens, underscores | Validation stops | OK | Plugin is at the root. |
| 8 | No `export-ignore`, `export-subst` or content-rewriting `.gitattributes` | Validation stops | OK | There is no `.gitattributes` at all (test enforces). |
| 9 | Repository under 50 MiB archived, under 256 MiB unpacked, fewer than 10,000 entries, files under 5 MiB | Validation stops | OK | 60 files, about 294 KiB in total, largest file 24 KiB. |

## Manifest and plugin name

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 10 | `name` is lowercase letters, digits, hyphens, at most 64 characters, starts and ends alphanumeric | Blocks (non-ASCII) / Warning | OK | `recall-courier` (14 characters). |
| 11 | Name built around a distinctive project name; not a reserved word; nothing presenting it as official | Blocks / Hold (generic) | OK | Not reserved, not generic, no "claude", "anthropic", "official", "mcp", "plugin", "test", or "anki" in the name (test enforces). |
| 12 | Name not used by another organization's plugin; no look-alikes | Blocks / Hold | UNVERIFIED | The directory cannot be searched before submitting. GitHub and npm have no `recall-courier`. |
| 13 | Name, `displayName`, `author.name` cannot be mistaken for a known brand, listing or publisher | Hold | EXPECT HOLD | `displayName` "Recall Courier for Anki" contains the brand "Anki" as a compatibility statement, with an "unofficial, not affiliated with Anki or Ankitects" notice in the manifest description and README. Author is the individual maintainer. |
| 14 | A fork uses its own name | Hold | N/A | Not a fork; code written from scratch (other Anki MCP projects were only skimmed for ideas). |
| 15 | `displayName` and `author.name` in one writing system, no look-alike or invisible characters | Blocks | OK | Plain ASCII. |
| 16 | Component keys spelled as in the reference; none inside `experimental` | Blocks | OK | Only standard keys; the MCP server is in `.mcp.json`. |
| 17 | `description`, `author`, `version` set | Warning | OK | All three present; version `0.1.0`. |

## README and license

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 18 | README of at least 40 words outside code blocks | Blocks | OK | About 1,400 words outside code blocks. |
| 19 | `LICENSE` file or `license` field | Blocks | OK | MIT `LICENSE`, and `"license": "MIT"` in the manifest. |

## Files in the plugin folder

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 20 | Every non-image, non-font file under 256 KiB | Hold | OK | Largest file is 24 KiB (test asserts the limit for every file). |
| 21 | At most 512 files | Hold | OK | 60 files. |
| 22 | Only text files, SVG, complete PNG/JPEG/GIF/WebP, and fonts | Hold | OK | Only text files and one SVG icon; the test rejects NUL bytes. |
| 23 | Bundled images shown in the README only with Markdown image syntax; not named in commands, hooks, scripts, backticks or code blocks | Hold | OK | The icon is referenced only by the manifest `icon` field; no markdown file mentions its path (test enforces). |
| 24 | MCP servers declared with `command` and `args` (or `url`), not `.mcpb` or `.dxt` | Hold | OK | `node` plus one argument. |

## What the plugin runs and connects to

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 25 | Pin packages run by a launcher (`npx`, `uvx`, …) | Blocks | N/A | No launcher is used. |
| 26 | No package-manager config (`.npmrc`, `bunfig.toml`, `uv.toml`) alongside a launcher or install | Blocks / Hold | OK | None present (test enforces `.npmrc`). |
| 27 | No real credentials in any file | Blocks | OK | Secret-pattern scan over all files in `repo.test.js`; the API key is a sensitive `userConfig` entry. |
| 28 | Do not read a credential already in the user's environment | Hold | OK, see note | The server reads only `RECALL_COURIER_API_KEY`, which exists solely because the plugin's own sensitive setting fills it through `${user_config.*}`; ambient variables are never read. A scanner may still notice an environment read of a key-like variable. |
| 29 | `.mcp.json` is valid JSON matching the MCP schema | Blocks | OK | Valid; `claude plugin install` and `claude mcp list` connect to it. |
| 30 | Remote MCP servers use `type` and https/wss `url` | Blocks | N/A | Local server only. |
| 31 | Local MCP server runs a file in the plugin with plain arguments, no shell, `-c` or `npm run` | Hold | OK | Exactly `node ${CLAUDE_PLUGIN_ROOT}/server/index.js`. |
| 32 | Hook and MCP command paths written in full from `${CLAUDE_PLUGIN_ROOT}`; no other variable, substitution or wildcard | Blocks (subfolder plugins only) | OK | `command` and `args` contain only that one variable. The separate `env` block holds only `${user_config.*}` references, the docs' mechanism for settings. |
| 33 | Keep launchers and package installs out of scripts the server runs | Hold | OK | No package installs or launchers. The server starts one process, the Anki app, from a fixed argument list; the test limits `child_process` to `server/setup.js`. |

## Choices a reviewer always checks

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 34 | Package from a registry via a pinned launcher | Hold | N/A | None. |
| 35 | `package.json` beside a lockfile at the plugin root | Hold | N/A | `package.json` has no dependencies and there is no lockfile (test enforces both). |
| 36 | Non-shell program the validator cannot follow, when the plugin is in a subfolder | Hold | N/A | The plugin is at the repository root, which the docs name as the way to avoid this hold. The server entry is a Node file, not a shell script. |

## Hooks, skills, commands and agents

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 37 | Valid `hooks/hooks.json` | Blocks | N/A | No hooks. |
| 38 | `hooks.json` not repeated in the manifest | Warning | N/A | No hooks. |
| 39 | Valid YAML front matter; `description` a single text value | Blocks / Warning | OK | `skills/anki-cards/SKILL.md` has `name` and a one-line plain-scalar `description` (test checks both, including that no `: ` could break YAML). |
| 40 | Component folders and files spelled exactly (`skills/`, `SKILL.md`) | Blocks | OK | `skills/anki-cards/SKILL.md`; the folder name matches the skill name. |

## Security scan preparation

| # | Requirement | If violated | Status | Evidence |
| - | - | - | - | - |
| 41 | README describes everything the plugin runs, sends or fetches | Scan | OK | README section "What this plugin runs and connects to"; a test checks its claims against the source (network only in `server/ankiconnect.js`, no shell or `eval`, environment reads confined to `config.js` and `setup.js`). |
| 42 | Readable source, not compiled, packed or minified | Hold | OK | Plain ES modules, longest file about 350 lines; test rejects very long lines. |

## `claude plugin validate`

Result: **passes** (`✔ Validation passed with warnings`). The four warnings are `icon`, `documentationUrl`, `supportUrl` and `privacyPolicyUrl` reported as "Unknown field", because the installed CLI (2.1.274) predates v2.1.281, which the manifest reference says accepts them. They are directory listing fields and are intentionally kept. The CLI version predates the MCP-entry checks, so the MCP configuration was verified by installing the plugin instead (see DECISIONS.md).

## Connector review criteria applied to the bundled tools

These criteria are written for remote connectors, but the plugin's tools were held to them anyway.

| Criterion | Status | Evidence |
| - | - | - |
| Separate read and write tools; no catch-all request tool | OK | 40 purpose-built tools; no tool takes a method or raw endpoint. |
| Custom query tools must reference the target API | N/A | No tool accepts freeform endpoints; `find_*` tools document Anki's search syntax and link its manual. |
| Every tool has a `title` plus `readOnlyHint` or `destructiveHint` | OK | Enforced by `errors.test.js` and the stdio protocol test. |
| Tool names at most 64 characters | OK | Longest is 22 characters. |
| Narrow, accurate descriptions; no prompt-injection patterns | OK | Descriptions state behavior and syntax only; a test rejects instruction-like phrases. Behavioral guidance lives in the skill. |
| Useful errors, validated inputs, reasonably sized responses | OK | Schema validation with per-field messages; every error says what happened and what to do; listing tools cap output and report totals. |
| Does not read memory, chat history or user files beyond need | OK | Files are read only for explicitly requested media, import or export paths. |
| First-party or legitimately proxied APIs | OK, see note | The server calls only localhost AnkiConnect, an add-on the user installs; there is no remote API. |
| No money movement or AI media generation | OK | Neither exists. |
| Public documentation | OK | README, PRIVACY.md. |

## Checked after publishing

| Item | Status |
| - | - |
| `PRIVACY.md` loads at `https://github.com/maxdalat/recall-courier/blob/main/PRIVACY.md` | OK: HTTP 200 and the policy text is served (also 200 at the raw URL). |
| `/plugin marketplace add maxdalat/recall-courier` from GitHub | OK: in an isolated Claude Code config, `claude plugin marketplace add maxdalat/recall-courier` and `claude plugin install recall-courier@recall-courier` succeeded and `claude mcp list` showed the `anki` server connected. |
| Fresh clone of the public repository | OK: all 91 tests pass and `claude plugin validate` passes with the four expected warnings. |
