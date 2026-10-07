---
name: anki-cards
description: Add, study, find, edit, organize, or delete flashcards in the user's Anki app with the Recall Courier tools. Use whenever the user asks to add something to Anki, make flashcards or cloze cards, create or reorganize decks, tag, move, suspend or delete cards, check what is due, or sync Anki, even if they do not say "Anki" explicitly but are clearly talking about their flashcard collection.
---

# Anki cards with Recall Courier

The Recall Courier tools drive the Anki desktop app on the user's own computer through the AnkiConnect add-on. Anki is launched automatically if it is closed. If a tool reports that Anki or the add-on is missing, relay the install steps from the error message; do not try to install anything yourself.

## 1. Look before adding

Before adding anything:

1. Call `list_decks` and match the user's wording to an existing deck ("my Spanish deck" means `Spanish` or `Languages::Spanish`). Ask which deck only when two or more are genuinely plausible. If nothing matches, tell the user and propose a deck name; create it only after they agree, or when they asked for a new deck.
2. Call `list_note_types` to see the available note types and their field names. Use `Basic` for simple front/back facts, `Cloze` for definitions and lists, and a custom note type when the user's collection already uses one for this subject.
3. If the user may already have the material, check with `find_notes` (for example `deck:Spanish hablar`) to avoid duplicates. `add_notes` also skips exact duplicates and reports them.

## 2. Write good cards

- One fact per card (minimum information principle). Split a paragraph into several small cards.
- Prompts must be clear and unambiguous on their own: "What does the Krebs cycle produce per turn?" beats "Krebs cycle".
- Keep answers short: a word, a phrase, or one short sentence. Move extra context to the `extra` field of a cloze card, or into a separate card.
- Use cloze cards for definitions, formulas with a missing part, and ordered lists (one deletion per item, `{{c1::...}}`, `{{c2::...}}`). Keep each deletion short.
- Use reversed cards only when both directions are worth knowing, such as vocabulary.
- Add a few useful tags, such as the subject or source, when the user would want them. Do not invent elaborate tag systems.
- Do not put anything in a card that the user did not ask for or that you are unsure is true. When facts come from the conversation or a file, stay faithful to them.

## 3. Math

Anki fields are HTML and math uses MathJax:

- Inline math: `\(x^2 + y^2 = z^2\)`. Display math: `\[ \int_0^1 x\,dx = \tfrac12 \]`. Do not use `$...$`.
- Inside math, write `<` as `\lt` and `>` as `\gt`, because a raw angle bracket can be read as an HTML tag: `\(a \lt b\)`, `\(x \gt 0\)`. The tools rewrite stray ones and report it, but write them correctly in the first place.
- The text sent to Anki must contain single backslashes. In JSON tool arguments that means `\\(` for the two characters `\(`.
- Inside a cloze, never let `}}` appear inside the deletion: write `{{c1::\(\frac{1}{2} \)}}` with a space before the closing `\)`.

## 4. Preview large batches

For more than about 20 cards, show the user a compact preview first (deck, note type, and a table or list of the cards, or the first 10 plus a count) and wait for their go-ahead before calling an add tool. Small batches can be added directly. When the user has already approved the exact list, do not ask again.

## 5. Destructive actions

`delete_deck`, `delete_notes`, `forget_cards`, `rename_deck`, `update_note_type` (removing fields or templates), `import_package`, and bulk `update_note_fields` or `set_due_date` change or remove existing data.

- Before any deletion or reset, tell the user exactly what will go: the deck or note names, how many notes and cards, and for `delete_deck` that every card in it and in its sub-decks is deleted too. Use `find_notes`, `find_cards` or `list_decks` to get the real numbers, and wait for a clear yes.
- Only then pass `confirm: true`. A call without it changes nothing and returns what would be removed.
- Prefer a reversible option when one meets the need: `suspend` instead of deleting, a tag instead of deleting, moving to an "Archive" deck with `change_deck`.

## 6. Report the result

After adding, say how many cards were added and to which deck. Mention duplicates that were skipped (`skipped_duplicates`), any per-note failures with the reason and the fix, any new decks created, and any math that was rewritten. For other operations, give the counts that matter ("moved 12 cards to Spanish::Verbs").

## 7. Offer to sync

When a session changed the collection, finish by offering to run `anki_sync` so the changes reach AnkiWeb and other devices. Run it only if the user agrees.

## Finding and studying

- `find_notes` and `find_cards` take Anki search syntax: `deck:Spanish`, `tag:verb`, `is:due`, `is:new`, `is:suspended`, `added:7`, `rated:1`, `prop:ivl>=21`, `front:*word*`, and `-` to negate. Words are ANDed; use `or` for alternatives.
- `get_notes` shows full fields, tags, and each card's deck and state. Use it before editing.
- `deck_stats`, `list_decks` and `cards_reviewed_today` answer "what is due" and "how am I doing". `open_browser_search` opens Anki's browser on a query when the user wants to look at cards themselves, and `open_add_cards_dialog` pre-fills Anki's Add window for the user to review.
- Studying itself happens in Anki. Offer to quiz the user in chat from `get_notes` content if they want, but reviews in chat are not recorded in Anki.

## Media

`store_media` copies an image or audio file into Anki from a local path, base64, or an https URL and returns the HTML to place in a field (`<img src="...">` or `[sound:...]`). Fetch media from a URL only when the user asked for that specific media.

## When something fails

Read the error: it says what went wrong and what to do. Typical fixes are a corrected deck or field name, `create_deck_if_missing: true` when the user wants a new deck, asking the user to open a profile or enter their AnkiConnect API key in the plugin settings, or retrying after Anki finishes starting.
