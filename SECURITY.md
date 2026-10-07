# Security Policy

## Supported versions

The latest release on `main` is supported.

## Reporting a vulnerability

Please report security problems privately using GitHub's *Report a vulnerability* button on the [Security tab](https://github.com/maxdalat/recall-courier/security/advisories/new). If that is unavailable, open an issue that says only that you have a security report, without details, and a private channel will be arranged.

Please include the plugin version, your operating system, and the steps to reproduce. You can expect an acknowledgement within a week.

## What the plugin does and does not do

- It talks only to AnkiConnect on localhost and refuses other addresses.
- It never reads or writes Anki's database file directly.
- It never installs add-ons, downloads code, or runs shell commands built from user input. The only program it may start is the Anki app, with fixed arguments.
- Destructive tools require an explicit `confirm: true`.
- Media URLs must be public https addresses; localhost and private network addresses are refused. Anki, not this plugin, downloads them.
- The optional AnkiConnect API key is kept in the platform's secure credential storage by Claude Code and is never logged or echoed in messages.

## Out of scope

Weaknesses in Anki, AnkiConnect, Node.js, or Claude itself should be reported to those projects.
