// Card state tools: suspend, unsuspend, forget, due dates.
import { ToolError } from '../errors.js';
import { defineTool, prop, requireConfirm, resolveCardIds } from './helpers.js';

const targets = {
  card_ids: prop.ids('Card IDs, e.g. from find_cards.'),
  note_ids: prop.ids('Note IDs; every card of these notes is affected.'),
};

export const cardTools = [
  defineTool({
    name: 'suspend',
    title: 'Suspend cards',
    description: 'Suspends cards so they stop appearing in reviews. Reversible with unsuspend. Give card_ids, or note_ids for all cards of those notes.',
    properties: targets,
    kind: 'destructive',
    idempotent: true,
    handler: async (args, ctx) => {
      const ids = await resolveCardIds(ctx, args);
      await ctx.call('suspend', { cards: ids });
      return { cards_targeted: ids.length, state: 'suspended' };
    },
  }),

  defineTool({
    name: 'unsuspend',
    title: 'Unsuspend cards',
    description: 'Makes suspended cards available for review again. Cards that are not suspended are unaffected.',
    properties: targets,
    kind: 'destructive',
    idempotent: true,
    handler: async (args, ctx) => {
      const ids = await resolveCardIds(ctx, args);
      await ctx.call('unsuspend', { cards: ids });
      return { cards_targeted: ids.length, state: 'unsuspended' };
    },
  }),

  defineTool({
    name: 'forget_cards',
    title: 'Reset cards to new',
    description:
      'Resets cards to the "new" state, discarding their interval, ease and review scheduling (the review history log is kept). ' +
      'Requires confirm: true. Anki\'s Undo can revert it.',
    properties: { ...targets, confirm: prop.confirm('resetting the scheduling of these cards back to new') },
    required: ['confirm'],
    kind: 'destructive',
    idempotent: true,
    handler: async (args, ctx) => {
      const ids = await resolveCardIds(ctx, args);
      requireConfirm(args, `This would reset ${ids.length} card(s) to new and discard their scheduling.`);
      await ctx.call('forgetCards', { cards: ids });
      return { cards_reset: ids.length, state: 'new' };
    },
  }),

  defineTool({
    name: 'set_due_date',
    title: 'Set card due date',
    description:
      'Sets when cards are next due, turning new cards into review cards. "days" is Anki\'s due-date syntax: "0" = today, "3" = in 3 days, ' +
      '"3-7" = a random number of days between 3 and 7, "1!" = tomorrow and also set the interval to 1 day (a "!" after the number resets the interval).',
    properties: {
      ...targets,
      days: { type: 'string', minLength: 1, pattern: '^\\d+(-\\d+)?!?$', patternHint: 'use e.g. "0", "3", "3-7" or "1!"', description: 'Due date in days from today: "0", "3", "3-7" or "1!".' },
    },
    required: ['days'],
    kind: 'destructive',
    idempotent: true,
    handler: async ({ days, ...rest }, ctx) => {
      const ids = await resolveCardIds(ctx, rest);
      const range = days.replace('!', '').split('-').map(Number);
      if (range.length === 2 && range[0] > range[1]) throw new ToolError(`The range "${days}" runs backwards. Use the smaller number first, e.g. "3-7".`);
      const ok = await ctx.call('setDueDate', { cards: ids, days });
      if (ok === false) throw new ToolError('Anki did not change the due date. Check that the card IDs exist (find_cards).');
      return { cards_updated: ids.length, due: days };
    },
  }),
];
