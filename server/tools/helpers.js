// Shared building blocks for tool definitions and handlers.
import { ToolError } from '../errors.js';
import { chunk, matchName, suggest, uniq } from '../util.js';

// kind: "read" (no changes), "write" (changes data but never destroys any), "destructive" (deletes or overwrites).
export function defineTool({ name, title, description, properties = {}, required = [], kind, idempotent = false, openWorld = false, handler }) {
  const annotations = { title, openWorldHint: openWorld };
  if (kind === 'read') {
    annotations.readOnlyHint = true;
  } else {
    annotations.readOnlyHint = false;
    annotations.destructiveHint = kind === 'destructive';
    if (idempotent) annotations.idempotentHint = true;
  }
  return {
    name,
    title,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations,
    handler,
  };
}

export const prop = {
  str: (description, extra = {}) => ({ type: 'string', description, ...extra }),
  nonEmpty: (description, extra = {}) => ({ type: 'string', minLength: 1, description, ...extra }),
  bool: (description) => ({ type: 'boolean', description }),
  int: (description, extra = {}) => ({ type: 'integer', description, ...extra }),
  strings: (description, extra = {}) => ({ type: 'array', items: { type: 'string', minLength: 1 }, description, ...extra }),
  ids: (description, extra = {}) => ({ type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 1000, description, ...extra }),
  confirm: (what) => ({
    type: 'boolean',
    description: `Must be true to proceed. Set it only after the user has agreed to: ${what}`,
  }),
};

export async function allDeckNames(ctx) {
  return ctx.call('deckNames');
}

// Returns the canonical deck name for a user-supplied one, creating it when asked.
export async function resolveDeck(ctx, wanted, { create = false, names } = {}) {
  const existing = names ?? (await allDeckNames(ctx));
  const found = matchName(wanted, existing);
  if (found) return { name: found, created: false };
  if (create) {
    await ctx.call('createDeck', { deck: wanted });
    return { name: wanted, created: true };
  }
  const hints = suggest(wanted, existing);
  throw new ToolError(
    `Deck "${wanted}" does not exist.${hints.length ? ` Similar decks: ${hints.join('; ')}.` : ''} ` +
      `Check the name with list_decks, or pass create_deck_if_missing: true to create it.`,
  );
}

// Accepts card_ids and/or note_ids and returns a de-duplicated list of card ids.
export async function resolveCardIds(ctx, { card_ids = [], note_ids = [] }) {
  if (card_ids.length === 0 && note_ids.length === 0) {
    throw new ToolError('Provide card_ids or note_ids. Find them with find_cards or find_notes.');
  }
  const ids = [...card_ids];
  for (const group of chunk(note_ids, 200)) {
    const infos = await ctx.call('notesInfo', { notes: group });
    infos.forEach((info, i) => {
      if (!info || !info.noteId) throw new ToolError(`Note ${group[i]} does not exist. Check the ID with find_notes.`);
      ids.push(...info.cards);
    });
  }
  return uniq(ids);
}

export function requireConfirm(args, preview) {
  if (args.confirm !== true) {
    throw new ToolError(`Nothing was changed because confirm was not true. ${preview} Ask the user to confirm, then call again with confirm: true.`);
  }
}

export function noteTypeKeys(fields) {
  return Object.keys(fields);
}

export function chunked(items, size, fn) {
  return Promise.all(chunk(items, size).map(fn));
}
