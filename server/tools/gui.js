// Helpers that open Anki windows for the user.
import { ToolError } from '../errors.js';
import { escapeMathAngles, matchName } from '../util.js';
import { defineTool, prop } from './helpers.js';

export const guiTools = [
  defineTool({
    name: 'open_browser_search',
    title: 'Open card browser with a search',
    description:
      'Opens Anki\'s card browser window showing the results of a search query (same syntax as find_cards, e.g. "deck:Spanish is:due"). Only changes what is on screen; no data is modified.',
    properties: { query: prop.nonEmpty('Anki search query to show in the browser.') },
    required: ['query'],
    kind: 'read',
    handler: async ({ query }, ctx) => {
      const ids = await ctx.call('guiBrowse', { query });
      return { opened: true, query, matching_cards: Array.isArray(ids) ? ids.length : null };
    },
  }),

  defineTool({
    name: 'open_add_cards_dialog',
    title: 'Open the Add Cards dialog',
    description:
      'Opens Anki\'s Add Cards window pre-filled with a deck, note type, optional field values and tags, so the user can review and press Add themselves. Nothing is saved until the user confirms in Anki.',
    properties: {
      deck: prop.nonEmpty('Deck to preselect.'),
      note_type: prop.nonEmpty('Note type to preselect, e.g. "Basic".'),
      fields: { type: 'object', description: 'Optional field name to value pairs to pre-fill.' },
      tags: prop.strings('Optional tags to pre-fill.'),
    },
    required: ['deck', 'note_type'],
    kind: 'write',
    handler: async (args, ctx) => {
      const [decks, types] = await ctx.multiStrict([['deckNames'], ['modelNames']]);
      const deck = matchName(args.deck, decks);
      if (!deck) throw new ToolError(`Deck "${args.deck}" does not exist. Check names with list_decks.`);
      const model = matchName(args.note_type, types);
      if (!model) throw new ToolError(`Note type "${args.note_type}" does not exist. Available: ${types.join(', ')}.`);
      const names = await ctx.call('modelFieldNames', { modelName: model });
      const fields = Object.fromEntries(names.map((n) => [n, '']));
      for (const [key, value] of Object.entries(args.fields ?? {})) {
        const canonical = matchName(key, names);
        if (!canonical) throw new ToolError(`Note type "${model}" has no field "${key}". Its fields are: ${names.join(', ')}.`);
        fields[canonical] = escapeMathAngles(String(value ?? '')).text;
      }
      await ctx.call('guiAddCards', { note: { deckName: deck, modelName: model, fields, tags: args.tags ?? [] } });
      return { opened: true, deck, note_type: model, note: 'The dialog is open in Anki; nothing has been saved yet.' };
    },
  }),
];
