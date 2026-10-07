// Finding and reading notes and cards.
import { chunk, preview } from '../util.js';
import { defineTool, prop } from './helpers.js';

const SEARCH_HELP =
  'Accepts Anki\'s full search syntax (https://docs.ankiweb.net/searching.html). Common queries: ' +
  '"deck:Spanish" (includes sub-decks); deck:"Languages::Spanish Verbs"; "tag:verb"; "-tag:leech"; "is:due"; "is:new"; "is:learn"; "is:review"; ' +
  '"is:suspended"; "added:7" (added in the last 7 days); "rated:1" (answered today); "prop:ivl>=21" (mature cards); "note:Cloze"; ' +
  '"front:*capital*" (field search); "\\"exact phrase\\""; words are ANDed, use "or" for alternatives; "deck:*" matches everything.';

const STATES = { 0: 'new', 1: 'learning', 2: 'review', 3: 'relearning' };

function describeCard(card) {
  const queue = card.queue;
  return {
    card_id: card.cardId,
    note_id: card.note,
    deck: card.deckName,
    note_type: card.modelName,
    state: STATES[card.type] ?? 'unknown',
    suspended: queue === -1,
    buried: queue === -2 || queue === -3,
    interval_days: card.interval,
    reps: card.reps,
    lapses: card.lapses,
    question: preview(card.question, 100),
  };
}

export async function cardInfos(ctx, ids) {
  const out = [];
  for (const group of chunk(ids, 200)) out.push(...(await ctx.call('cardsInfo', { cards: group })));
  return out;
}

const limitProp = prop.int('Maximum IDs to return (default 200, at most 5000). The reply always includes the total match count.', { minimum: 1, maximum: 5000 });

export const findTools = [
  defineTool({
    name: 'find_notes',
    title: 'Find notes',
    description: `Searches notes and returns matching note IDs and the total match count. ${SEARCH_HELP} Set details to also get fields and tags for the first matches.`,
    properties: {
      query: prop.nonEmpty('Anki search query.'),
      limit: limitProp,
      details: prop.bool('Also return note type, fields and tags for up to 50 matches. Default false.'),
    },
    required: ['query'],
    kind: 'read',
    handler: async ({ query, limit = 200, details }, ctx) => {
      const ids = await ctx.call('findNotes', { query });
      const shown = ids.slice(0, limit);
      const result = { query, total: ids.length, returned: shown.length, note_ids: shown };
      if (details && shown.length) {
        const infos = await ctx.call('notesInfo', { notes: shown.slice(0, 50) });
        result.notes = infos.map((n) => ({
          note_id: n.noteId,
          note_type: n.modelName,
          tags: n.tags,
          fields: Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, preview(v.value, 100)])),
        }));
      }
      return result;
    },
  }),

  defineTool({
    name: 'find_cards',
    title: 'Find cards',
    description: `Searches cards and returns matching card IDs and the total match count. ${SEARCH_HELP} Set details to also get deck, state, interval and question text for the first matches.`,
    properties: {
      query: prop.nonEmpty('Anki search query.'),
      limit: limitProp,
      details: prop.bool('Also return deck, state and question text for up to 50 matches. Default false.'),
    },
    required: ['query'],
    kind: 'read',
    handler: async ({ query, limit = 200, details }, ctx) => {
      const ids = await ctx.call('findCards', { query });
      const shown = ids.slice(0, limit);
      const result = { query, total: ids.length, returned: shown.length, card_ids: shown };
      if (details && shown.length) result.cards = (await cardInfos(ctx, shown.slice(0, 50))).map(describeCard);
      return result;
    },
  }),

  defineTool({
    name: 'get_notes',
    title: 'Get notes',
    description:
      'Returns full details for notes by ID: note type, every field value (raw HTML), tags, and each card with its deck, state and whether it is suspended. Up to 100 notes per call.',
    properties: { note_ids: prop.ids('Note IDs, e.g. from find_notes.', { maxItems: 100 }) },
    required: ['note_ids'],
    kind: 'read',
    handler: async ({ note_ids }, ctx) => {
      const infos = await ctx.call('notesInfo', { notes: note_ids });
      const cardIds = infos.flatMap((n) => (n && n.cards) || []);
      const cards = new Map((await cardInfos(ctx, cardIds)).map((c) => [c.cardId, c]));
      const notes = [];
      const not_found = [];
      infos.forEach((n, i) => {
        if (!n || !n.noteId) {
          not_found.push(note_ids[i]);
          return;
        }
        const noteCards = n.cards.map((id) => cards.get(id)).filter(Boolean).map(describeCard);
        notes.push({
          note_id: n.noteId,
          note_type: n.modelName,
          tags: n.tags,
          fields: Object.fromEntries(Object.entries(n.fields).map(([k, v]) => [k, v.value])),
          decks: [...new Set(noteCards.map((c) => c.deck))],
          cards: noteCards.map(({ card_id, deck, state, suspended, interval_days }) => ({ card_id, deck, state, suspended, interval_days })),
        });
      });
      return { note_count: notes.length, notes, ...(not_found.length ? { not_found } : {}) };
    },
  }),
];

export { describeCard };
