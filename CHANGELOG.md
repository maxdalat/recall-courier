# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-07

### Added

- First release: a Claude plugin with a zero-dependency Node.js MCP server that controls the Anki desktop app through the AnkiConnect add-on.
- 40 tools covering the app (status, launch, sync, profiles), decks (list, create, rename, delete, options), note types, adding notes (batch, Basic, Cloze, reversed), finding and reading, editing, tagging, moving, card states, deletion, media, statistics, `.apkg` import and export, and Anki window helpers.
- Automatic detection and launch of Anki on macOS, Windows and Linux (including Flatpak), with clear guidance when Anki or the AnkiConnect add-on is missing.
- Plugin settings for the AnkiConnect URL, an optional API key, and automatic launching.
- The `anki-cards` skill for card-writing practice, MathJax formatting, batch previews, and confirmation before destructive actions.
- Unit, protocol and end-to-end tests, including a fake AnkiConnect server.

[0.1.0]: https://github.com/maxdalat/recall-courier/releases/tag/v0.1.0
