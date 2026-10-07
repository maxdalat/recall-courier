# Contributing

Thanks for helping! Bug reports and small, focused pull requests are welcome.

## Ground rules

- **Zero dependencies.** The server is plain Node.js 18+ (ES modules, built-in `fetch`). Please do not add packages, a lockfile, or a build step.
- **Readable source only.** No minified or bundled code; keep each file under 256 KiB and split large modules.
- **Local only.** The server may talk only to AnkiConnect on localhost. Never read or write Anki's SQLite file directly.
- **Helpful errors.** Every error should say what went wrong and what to do next.
- **Annotations.** Every tool needs a `title` and either `readOnlyHint: true` or an explicit `destructiveHint`. Tools that delete data need a `confirm` argument.

## Development

```bash
npm test            # all tests against a fake AnkiConnect server (no Anki needed)
node --test test/add.test.js   # one file
```

Layout: `server/` (protocol, AnkiConnect client, setup, `tools/`), `test/` (fake AnkiConnect plus tests), `skills/anki-cards/SKILL.md`, `.claude-plugin/` (manifests).

To try the plugin in Claude Code from a checkout:

```bash
claude plugin validate .
claude --plugin-dir .
```

## End-to-end test against real Anki

`npm run test:e2e` drives the real server against a running Anki that has AnkiConnect installed. It only creates and deletes a deck named `zz-plugin-test` and refuses to run if that deck already exists. Use a throwaway profile if you want to be extra careful. It never launches Anki; start it first. Set `E2E_URL` to point at a different AnkiConnect address.

## Pull requests

Add or update tests for behavior changes, run `npm test` and `claude plugin validate .`, update `CHANGELOG.md`, and bump the version in `package.json`, `.claude-plugin/plugin.json` and `server/version.js` together when releasing.
