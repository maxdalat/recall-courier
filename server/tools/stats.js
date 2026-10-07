// Statistics and review history.
import { ToolError } from '../errors.js';
import { matchName, quoteSearch } from '../util.js';
import { defineTool, prop } from './helpers.js';

const REVIEW_TYPES = ['learn', 'review', 'relearn', 'filtered', 'manual'];

function namedReview(id, ease, ivl, lastIvl, factor, time, type) {
  return {
    reviewed_at: new Date(id).toISOString(),
    rating: ease,
    new_interval: ivl,
    previous_interval: lastIvl,
    ease_percent: factor ? factor / 10 : null,
    seconds_taken: Math.round((time ?? 0) / 100) / 10,
    type: REVIEW_TYPES[type] ?? String(type),
  };
}

export const statTools = [
  defineTool({
    name: 'deck_stats',
    title: 'Deck statistics',
    description:
      'Returns statistics for decks: total cards, how many are new, learning, review, suspended, mature (interval of 21+ days) or tagged leech, ' +
      'and how many are due today. Sub-decks are included in each deck\'s numbers.',
    properties: { decks: prop.strings('Full deck names.', { minItems: 1, maxItems: 20 }) },
    required: ['decks'],
    kind: 'read',
    handler: async ({ decks }, ctx) => {
      const known = Object.keys(await ctx.call('deckNamesAndIds'));
      const names = decks.map((d) => {
        const found = matchName(d, known);
        if (!found) throw new ToolError(`Deck "${d}" does not exist. Check names with list_decks.`);
        return found;
      });
      const counts = [['total', ''], ['new', 'is:new'], ['learning', 'is:learn'], ['review', 'is:review'], ['suspended', 'is:suspended'], ['mature', 'prop:ivl>=21'], ['leeches', 'tag:leech']];
      const calls = names.flatMap((n) => counts.map(([, q]) => ['findCards', { query: `deck:${quoteSearch(n)} ${q}`.trim() }]));
      const [due, found] = await Promise.all([ctx.call('getDeckStats', { decks: names }), ctx.multiStrict(calls)]);
      const dueByName = new Map(Object.values(due).map((s) => [s.name, s]));
      return {
        decks: names.map((name, i) => {
          const row = { deck: name };
          counts.forEach(([label], j) => { row[`${label === 'total' ? 'total_cards' : `${label}_cards`}`] = found[i * counts.length + j].length; });
          const d = dueByName.get(name) ?? {};
          row.due_today = { new: d.new_count ?? null, learning: d.learn_count ?? null, review: d.review_count ?? null };
          return row;
        }),
      };
    },
  }),

  defineTool({
    name: 'cards_reviewed_today',
    title: 'Cards reviewed today',
    description: 'Returns how many cards were reviewed today (using the day rollover time set in Anki). With days, also returns the per-day review counts for the last N days.',
    properties: { days: prop.int('Also return counts for each of the last N days (1 to 365).', { minimum: 1, maximum: 365 }) },
    kind: 'read',
    handler: async ({ days }, ctx) => {
      const today = await ctx.call('getNumCardsReviewedToday');
      if (!days) return { reviewed_today: today };
      const byDay = await ctx.call('getNumCardsReviewedByDay');
      return { reviewed_today: today, per_day: byDay.slice(0, days).map(([date, count]) => ({ date, reviewed: count })) };
    },
  }),

  defineTool({
    name: 'get_card_reviews',
    title: 'Get review history',
    description:
      'Returns the review log: for given card_ids, every review of each card; or for a deck, all reviews in the last N days. ' +
      'Each entry has the time, the rating pressed (1 Again, 2 Hard, 3 Good, 4 Easy), the new and previous interval, ease and seconds taken. Newest first, at most 500 entries.',
    properties: {
      card_ids: prop.ids('Card IDs to fetch the full history of.', { maxItems: 100 }),
      deck: prop.str('Deck name to fetch recent reviews for (use with since_days).'),
      since_days: prop.int('With deck: how many days back to look (default 7).', { minimum: 1, maximum: 3650 }),
    },
    kind: 'read',
    handler: async ({ card_ids, deck, since_days = 7 }, ctx) => {
      if (!card_ids && !deck) throw new ToolError('Provide card_ids, or a deck (optionally with since_days).');
      if (card_ids) {
        const logs = await ctx.call('getReviewsOfCards', { cards: card_ids });
        const out = [];
        for (const [cardId, entries] of Object.entries(logs ?? {})) {
          for (const e of entries) out.push({ card_id: Number(cardId), ...namedReview(e.id, e.ease, e.ivl, e.lastIvl, e.factor, e.time, e.type) });
        }
        out.sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at));
        return { review_count: out.length, reviews: out.slice(0, 500) };
      }
      const known = Object.keys(await ctx.call('deckNamesAndIds'));
      const name = matchName(deck, known);
      if (!name) throw new ToolError(`Deck "${deck}" does not exist. Check names with list_decks.`);
      const rows = await ctx.call('cardReviews', { deck: name, startID: Date.now() - since_days * 86400000 });
      const out = rows.map(([id, cardId, , ease, ivl, lastIvl, factor, time, type]) => ({ card_id: cardId, ...namedReview(id, ease, ivl, lastIvl, factor, time, type) }));
      out.sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at));
      return { deck: name, since_days, review_count: out.length, reviews: out.slice(0, 500) };
    },
  }),
];
