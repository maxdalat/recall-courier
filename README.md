# Recall Courier for Anki

Let Claude control the [Anki](https://apps.ankiweb.net) flashcard app on your own computer. Tell Claude "add these to my Spanish deck" or "make cloze cards from my notes", and it adds the cards, creates and reorganizes decks, finds and edits notes, suspends or moves cards, and checks what is due. Everything runs locally on your machine: there is no hosted server and no account.

> **Unofficial project.** Recall Courier is an independent, community plugin. It is **not affiliated with, endorsed by, or sponsored by Anki, Ankitects, or AnkiWeb**. "Anki" is used only to say which program the plugin works with. The plugin talks to Anki through the free third-party [AnkiConnect](https://ankiweb.net/shared/info/2055492159) add-on.

## What you can ask

- "Add 'la biblioteca = library' to my Spanish vocabulary deck."
- "Turn the key points of this article into cloze cards in a new deck called `Biology::Cell`."
- "Show me a preview of 30 flashcards for the French Revolution, then add them once I say yes."
- "Which of my decks have the most cards due today?"
- "Find every card tagged `leech`, suspend them, and tell me how many there were."
- "Move all cards that mention 'subjunctive' into `Spanish::Grammar` and tag them `subjunctive`."
- "Rename my `Maths` deck to `School::Maths`."
- "Fix the typo in the card about mitochondria."
- "Export my `Chemistry` deck as an .apkg file in my Documents folder."
- "Set new cards per day to 10 for my `Medicine` deck."

## Requirements

- **Anki desktop** (Windows, macOS or Linux), from <https://apps.ankiweb.net>.
- The **AnkiConnect add-on**, code `2055492159`. In Anki: *Tools → Add-ons → Get Add-ons…*, enter `2055492159`, press OK, then restart Anki. Recall Courier never installs add-ons for you.
- **Node.js 18 or newer** on your computer (check with `node --version`). The plugin's server is plain Node.js with no dependencies to install.
- **Claude Code** (terminal, IDE extensions, or the Code tab of the Claude desktop app) or a **Claude Cowork** task running on your computer. It does **not** work in a browser-only claude.ai session or in the mobile apps, because those cannot start a program on your computer. Plugins that run a local server are ignored in regular claude.ai chat.

## Install

Run these once, exactly as written.

**Claude Code (terminal or IDE):**

```text
/plugin marketplace add maxdalat/recall-courier
/plugin install recall-courier@recall-courier
```

Or from a shell:

```bash
claude plugin marketplace add maxdalat/recall-courier
claude plugin install recall-courier@recall-courier
```

**Claude desktop app, Code tab:** open a session and run the same two `/plugin` commands as above.

**Claude desktop app, Cowork:** go to *Customize → Plugins → Add → Add marketplace*, enter `maxdalat/recall-courier`, then install Recall Courier. Use a Cowork task that runs on your computer. Cowork does not ask for plugin settings, so the defaults apply (see *Settings*).

**Once the plugin is listed in Anthropic's directory:** find it under *Customize → Plugins → Discover* (claude.ai and Cowork) or `/plugin directory` (Claude Code), and add it there.

After installing, start a new session and ask Claude: "Check my Anki status." If Anki is closed, Claude launches it for you.

## Settings

Claude Code asks for these when you enable the plugin (change them later under `/plugin`):

| Setting | Default | What it does |
| --- | --- | --- |
| AnkiConnect URL | `http://127.0.0.1:8765` | Where AnkiConnect listens. Only localhost addresses are accepted. |
| AnkiConnect API key | empty | Only if you set `apiKey` in AnkiConnect's own settings. Stored in your system's secure credential storage. |
| Start Anki automatically | on | Lets the plugin launch Anki when it is not running. |

## Tools

Read-only tools never change your collection. Tools marked **confirm** refuse to run unless the call includes `confirm: true`, which Claude sets only after you agree.

| Area | Tools |
| --- | --- |
| App | `anki_status`, `anki_launch`, `anki_sync`, `anki_list_profiles`, `anki_switch_profile` |
| Decks | `list_decks`, `create_deck` (nested with `::`), `rename_deck`, `delete_deck` (**confirm**; also deletes the cards inside), `get_deck_config`, `set_deck_config` |
| Note types | `list_note_types`, `create_note_type`, `update_note_type` (**confirm** when removing fields or templates) |
| Adding | `add_notes` (batch, duplicate controls, optional deck creation, media), `add_basic_cards`, `add_cloze_cards`, `add_reversed_cards` |
| Finding | `find_notes`, `find_cards` (full Anki search syntax), `get_notes` |
| Editing | `update_note_fields`, `add_tags`, `remove_tags`, `replace_tags`, `change_deck` |
| Card states | `suspend`, `unsuspend`, `forget_cards` (**confirm**), `set_due_date` |
| Deleting | `delete_notes` (**confirm**) |
| Media | `store_media` (local file, base64 or https URL), `list_media` |
| Stats | `deck_stats`, `cards_reviewed_today`, `get_card_reviews` |
| Import / export | `import_package`, `export_deck` (`.apkg` files; `.colpkg` backups are refused; never overwrites a file) |
| Anki windows | `open_browser_search`, `open_add_cards_dialog` |

Batch tools accept lists and report per-item results: IDs, counts, skipped duplicates, and individual failures. Changing the note type of existing notes is deliberately not offered, because AnkiConnect cannot do it safely; use *Change Note Type* in Anki's browser.

The bundled `anki-cards` skill teaches Claude to check your decks and note types first, write one-fact-per-card flashcards, format math with MathJax (`\(...\)`), preview big batches, confirm before deleting, report results, and offer to sync.

## What this plugin runs and connects to

- It starts **one local Node.js process** (`node ${CLAUDE_PLUGIN_ROOT}/server/index.js`) that talks to Claude over standard input and output. It uses no packages from the internet.
- That process makes HTTP requests **only to `127.0.0.1`** (AnkiConnect, by default port 8765). A different address in the settings is refused unless it is also localhost.
- It may **launch the Anki app** on your computer (`open -a Anki` on macOS, `anki.exe` on Windows, `anki` or the Flatpak on Linux) when Anki is not running, if you left automatic launching on.
- It **fetches an https URL only when you ask** Claude to add media from a URL: the request is made by Anki itself (through AnkiConnect), and the plugin refuses non-https, private, and localhost addresses.
- It reads a file only when you ask Claude to store media from a path, import an `.apkg`, or export a deck. It never reads or writes Anki's database file directly.
- It never reads credentials from your environment. The optional AnkiConnect API key comes only from the plugin's own setting.

## Privacy Policy

This is the same text as [PRIVACY.md](PRIVACY.md), available at <https://github.com/maxdalat/recall-courier/blob/main/PRIVACY.md>.

- **Data collection:** none. Recall Courier has no servers, accounts, analytics, or telemetry.
- **Use and storage:** the plugin reads and writes your cards, decks and tags only inside Anki on your own computer, at your request. All data stays on your device, in Anki.
- **Third-party sharing:** the plugin shares nothing with anyone. Card content that Claude reads or writes becomes part of your conversation with Claude and is handled under Anthropic's own terms and privacy policy. If you use Anki's sync, Anki itself sends your collection to AnkiWeb under Anki's policies; the plugin only triggers that sync when you ask.
- **Retention:** the plugin keeps nothing. It has no database, cache, or log files.
- **Contact:** open an issue at <https://github.com/maxdalat/recall-courier/issues>.

## Troubleshooting

- **"Anki does not appear to be installed":** install Anki from <https://apps.ankiweb.net>, open it once, and try again. If Anki lives somewhere unusual, start it yourself.
- **"The AnkiConnect add-on folder was not found":** in Anki choose *Tools → Add-ons → Get Add-ons…*, enter `2055492159`, press OK, restart Anki.
- **AnkiConnect is installed but nothing answers:** make sure Anki finished starting and no profile picker or dialog is open; check that the add-on is enabled; confirm its `webBindPort` matches the plugin's *AnkiConnect URL*; allow Anki through your firewall (Windows asks on first start).
- **"A valid API key must be provided":** enter the key from AnkiConnect's config in the plugin's *AnkiConnect API key* setting, or clear `apiKey` in Anki.
- **"No profile is loaded":** open a profile in Anki; the profile picker may be showing.
- **macOS: AnkiConnect stops answering when Anki is in the background:** disable App Nap for Anki as described in [AnkiConnect's notes](https://git.sr.ht/~foosoft/anki-connect#notes-for-macos-users).
- **Updates to a note are ignored:** close the note in Anki's card browser editor, then retry.
- **The tools do not appear in a chat:** make sure you are in Claude Code or a Cowork task on your computer, not browser-only claude.ai, and that Node.js 18+ is installed (`node --version`). In Claude Code run `/mcp` to see whether the `anki` server is connected.

Still stuck? Open an issue with the exact error text.

## Development

```bash
npm test          # unit and protocol tests against a fake AnkiConnect server
npm run test:e2e  # end-to-end test against your real Anki (see CONTRIBUTING.md)
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md). Design decisions are in [DECISIONS.md](DECISIONS.md).

## License

[MIT](LICENSE). Anki is a trademark of its respective owners; this project is unaffiliated.
