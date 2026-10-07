# Privacy Policy

**Recall Courier for Anki** is an unofficial plugin for Claude that lets Claude control the Anki desktop app on your own computer. It is not affiliated with Anki or Ankitects. Effective date: 2026-10-07.

## Data collection

None. Recall Courier has no servers, accounts, analytics, advertising, or telemetry. The author does not receive any data from your use of the plugin.

## Usage and storage

The plugin reads and writes your flashcards, decks, tags, note types, and media only inside Anki on your own computer, through the AnkiConnect add-on, and only when you ask Claude to. All of that data stays on your device, in Anki. The plugin does not copy it anywhere. It makes network requests only to AnkiConnect on `127.0.0.1` (your own computer). When you ask Claude to add media from an https URL, Anki itself downloads that file.

## Third-party sharing

The plugin shares nothing with any third party. Card content that Claude reads or writes becomes part of your conversation with Claude, so it is handled under Anthropic's own terms and privacy policy. If you use Anki's sync, Anki sends your collection to AnkiWeb under Anki's own policies; the plugin only starts a sync when you ask for one.

## Data retention

The plugin keeps nothing. It has no database, cache, or log files, and the local Node.js process holds data only in memory while it handles a request. Your Anki collection is retained by Anki, on your device, until you delete it.

## Children

Recall Courier is a general-audience study tool and is not specifically intended for children under 18. It collects no personal data from anyone.

## Changes

If this policy changes, the new version will be published in this file with an updated effective date.

## Contact

Questions or concerns: open an issue at <https://github.com/maxdalat/recall-courier/issues>.
