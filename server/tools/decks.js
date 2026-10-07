// Deck tools: list, create, rename, delete, and deck options.
import { ToolError } from '../errors.js';
import { matchName, quoteSearch, quoteSubdecks, uniq } from '../util.js';
import { defineTool, prop, requireConfirm } from './helpers.js';

const isDefaultDeck = (name) => name.toLowerCase() === 'default';

// Friendly names for the most useful options, mapped onto AnkiConnect's legacy config object.
const OPTION_MAP = {
  new_cards_per_day: { get: (c) => c.new?.perDay, set: (c, v) => { c.new.perDay = v; } },
  max_reviews_per_day: { get: (c) => c.rev?.perDay, set: (c, v) => { c.rev.perDay = v; } },
  learning_steps_minutes: { get: (c) => c.new?.delays, set: (c, v) => { c.new.delays = v; } },
  relearning_steps_minutes: { get: (c) => c.lapse?.delays, set: (c, v) => { c.lapse.delays = v; } },
  graduating_interval_days: { get: (c) => c.new?.ints?.[0], set: (c, v) => { c.new.ints = [v, c.new.ints?.[1] ?? 4, c.new.ints?.[2] ?? 7]; } },
  easy_interval_days: { get: (c) => c.new?.ints?.[1], set: (c, v) => { c.new.ints = [c.new.ints?.[0] ?? 1, v, c.new.ints?.[2] ?? 7]; } },
  starting_ease_percent: { get: (c) => (c.new?.initialFactor ? c.new.initialFactor / 10 : undefined), set: (c, v) => { c.new.initialFactor = Math.round(v * 10); } },
  maximum_interval_days: { get: (c) => c.rev?.maxIvl, set: (c, v) => { c.rev.maxIvl = v; } },
  leech_threshold: { get: (c) => c.lapse?.leechFails, set: (c, v) => { c.lapse.leechFails = v; } },
  bury_new_siblings: { get: (c) => c.new?.bury, set: (c, v) => { c.new.bury = v; } },
  bury_review_siblings: { get: (c) => c.rev?.bury, set: (c, v) => { c.rev.bury = v; } },
};

function summarizeConfig(config) {
  const summary = { options_group: config.name, options_group_id: config.id };
  for (const [key, def] of Object.entries(OPTION_MAP)) summary[key] = def.get(config);
  return summary;
}

function deepMerge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object') {
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

async function canonicalDeck(ctx, name) {
  const decks = await ctx.call('deckNamesAndIds');
  const found = matchName(name, Object.keys(decks));
  if (!found) throw new ToolError(`Deck "${name}" does not exist. Check the exact name with list_decks.`);
  return { name: found, decks };
}

const OPTION_PROPS = {
  new_cards_per_day: prop.int('Maximum new cards introduced per day.', { minimum: 0, maximum: 9999 }),
  max_reviews_per_day: prop.int('Maximum reviews per day.', { minimum: 0, maximum: 9999 }),
  learning_steps_minutes: { type: 'array', items: { type: 'number', minimum: 0 }, description: 'Learning steps in minutes, e.g. [1, 10].' },
  relearning_steps_minutes: { type: 'array', items: { type: 'number', minimum: 0 }, description: 'Relearning steps in minutes after a lapse, e.g. [10].' },
  graduating_interval_days: prop.int('Interval in days after finishing the learning steps.', { minimum: 1 }),
  easy_interval_days: prop.int('Interval in days when "Easy" is pressed on a new card.', { minimum: 1 }),
  starting_ease_percent: prop.int('Starting ease as a percentage, e.g. 250.', { minimum: 130, maximum: 999 }),
  maximum_interval_days: prop.int('Longest allowed review interval in days.', { minimum: 1 }),
  leech_threshold: prop.int('Lapses before a card is tagged as a leech.', { minimum: 1 }),
  bury_new_siblings: prop.bool('Bury new siblings until the next day.'),
  bury_review_siblings: prop.bool('Bury review siblings until the next day.'),
};

export const deckTools = [
  defineTool({
    name: 'list_decks',
    title: 'List decks',
    description:
      'Lists every deck with its ID, total card count, and the number of new, learning and review cards due today ' +
      '(counts respect the daily limits set in the deck options). Optionally filter by a substring of the deck name.',
    properties: { name_contains: prop.str('Only return decks whose full name contains this text (case-insensitive).') },
    kind: 'read',
    handler: async ({ name_contains }, ctx) => {
      const decks = await ctx.call('deckNamesAndIds');
      let names = Object.keys(decks).sort((a, b) => a.localeCompare(b));
      if (name_contains) names = names.filter((n) => n.toLowerCase().includes(name_contains.toLowerCase()));
      const stats = names.length ? await ctx.call('getDeckStats', { decks: names }) : {};
      const byName = new Map(Object.values(stats).map((s) => [s.name, s]));
      return {
        deck_count: names.length,
        decks: names.map((name) => {
          const s = byName.get(name) ?? {};
          return {
            name,
            id: decks[name],
            total_cards: s.total_in_deck ?? null,
            new_due: s.new_count ?? null,
            learning_due: s.learn_count ?? null,
            review_due: s.review_count ?? null,
          };
        }),
      };
    },
  }),

  defineTool({
    name: 'create_deck',
    title: 'Create decks',
    description:
      'Creates one or more empty decks. Use "::" in a name for nested decks, e.g. "Languages::Spanish::Verbs" ' +
      '(missing parent decks are created too). Decks that already exist are left untouched and reported.',
    properties: { names: prop.strings('Deck names to create.', { minItems: 1, maxItems: 100 }) },
    required: ['names'],
    kind: 'write',
    idempotent: true,
    handler: async ({ names }, ctx) => {
      const existing = Object.keys(await ctx.call('deckNamesAndIds'));
      const created = [];
      const already_existed = [];
      const failed = [];
      for (const name of uniq(names.map((n) => n.trim()))) {
        if (name.startsWith('::') || name.endsWith('::') || name.includes(':::')) {
          failed.push({ name, error: 'Deck names cannot start or end with "::". Use e.g. "Parent::Child".' });
          continue;
        }
        const found = matchName(name, existing);
        if (found) {
          already_existed.push(found);
          continue;
        }
        try {
          await ctx.call('createDeck', { deck: name });
          created.push(name);
        } catch (err) {
          failed.push({ name, error: err.message });
        }
      }
      return { created, already_existed, failed };
    },
  }),

  defineTool({
    name: 'rename_deck',
    title: 'Rename a deck',
    description:
      'Renames a deck, or moves it under another parent by giving a "::" path (e.g. "Spanish" to "Languages::Spanish"). ' +
      'Sub-decks are renamed with it. Cards, deck options and scheduling are kept. ' +
      'AnkiConnect has no rename action, so this creates the new deck, moves the cards, and removes the emptied old deck only after checking it is empty. ' +
      'Filtered decks and the Default deck cannot be renamed. Fails if the new name already exists.',
    properties: {
      name: prop.nonEmpty('Current full deck name.'),
      new_name: prop.nonEmpty('New full deck name.'),
    },
    required: ['name', 'new_name'],
    kind: 'destructive',
    handler: async ({ name, new_name }, ctx) => {
      const { name: oldName, decks } = await canonicalDeck(ctx, name);
      const newName = new_name.trim();
      if (isDefaultDeck(oldName)) throw new ToolError('The Default deck cannot be renamed. Create a new deck and move cards with change_deck instead.');
      if (newName.startsWith('::') || newName.endsWith('::')) throw new ToolError('The new name cannot start or end with "::".');
      if (matchName(newName, Object.keys(decks))) {
        throw new ToolError(`A deck named "${newName}" already exists, so nothing was renamed. Pick another name, or use change_deck to merge cards into it.`);
      }
      if (newName.toLowerCase().startsWith(`${oldName.toLowerCase()}::`)) {
        throw new ToolError('A deck cannot be moved inside itself. Choose a new name that is not under the current one.');
      }
      const affected = Object.keys(decks)
        .filter((n) => n === oldName || n.startsWith(`${oldName}::`))
        .sort((a, b) => a.split('::').length - b.split('::').length);
      const target = (n) => newName + n.slice(oldName.length);

      // Filtered decks hold borrowed cards; renaming them this way would break them.
      const configs = await ctx.multi(affected.map((n) => ['getDeckConfig', { deck: n }]));
      configs.forEach((c, i) => {
        if (c.error || !c.result || c.result.dyn) {
          throw new ToolError(`"${affected[i]}" is a filtered deck (or could not be read), so it cannot be renamed here. Rename it in Anki's deck list instead.`);
        }
      });

      for (const n of affected) await ctx.call('createDeck', { deck: target(n) });
      let moved = 0;
      for (const n of affected) {
        const ids = await ctx.call('findCards', { query: `deck:${quoteSearch(n)} -deck:${quoteSubdecks(n)}` });
        if (ids.length) {
          await ctx.call('changeDeck', { cards: ids, deck: target(n) });
          moved += ids.length;
        }
      }
      for (let i = 0; i < affected.length; i += 1) {
        const configId = configs[i].result.id;
        try {
          await ctx.call('setDeckConfigId', { decks: [target(affected[i])], configId });
        } catch {
          // keeping the options group is a nicety; the rename itself is already done
        }
      }
      const left = await ctx.call('findCards', { query: `deck:${quoteSearch(oldName)}` });
      if (left.length) {
        throw new ToolError(
          `The cards were copied to "${newName}", but ${left.length} card(s) are still in "${oldName}", so the old deck was NOT removed. ` +
            'Nothing was lost. Check both decks with list_decks and finish in Anki if needed.',
        );
      }
      await ctx.call('deleteDecks', { decks: [...affected].reverse(), cardsToo: true });
      return { renamed: { from: oldName, to: newName }, decks_renamed: affected.length, cards_moved: moved };
    },
  }),

  defineTool({
    name: 'delete_deck',
    title: 'Delete decks',
    description:
      'Permanently deletes decks AND every card in them, including cards in their sub-decks. AnkiConnect cannot keep the cards. ' +
      'Requires confirm: true; without it nothing is deleted and the call reports how many cards the deletion would remove. ' +
      'The Default deck cannot be deleted.',
    properties: {
      names: prop.strings('Full names of the decks to delete.', { minItems: 1, maxItems: 50 }),
      confirm: prop.confirm('permanently deleting these decks and all the cards inside them'),
    },
    required: ['names', 'confirm'],
    kind: 'destructive',
    handler: async (args, ctx) => {
      const all = Object.keys(await ctx.call('deckNamesAndIds'));
      const targets = [];
      for (const n of args.names) {
        const found = matchName(n, all);
        if (!found) throw new ToolError(`Deck "${n}" does not exist, so nothing was deleted. Check names with list_decks.`);
        if (isDefaultDeck(found)) throw new ToolError('The Default deck cannot be deleted.');
        targets.push(found);
      }
      const unique = uniq(targets);
      const counts = await ctx.multiStrict(unique.map((n) => ['findCards', { query: `deck:${quoteSearch(n)}` }]));
      const plan = unique.map((n, i) => ({
        deck: n,
        cards: counts[i].length,
        subdecks: all.filter((d) => d.startsWith(`${n}::`)),
      }));
      const total = counts.reduce((sum, ids) => sum + ids.length, 0);
      requireConfirm(
        args,
        `Deleting would permanently remove ${unique.length} deck(s) and ${total} card(s) (including sub-decks): ` +
          plan.map((p) => `"${p.deck}" (${p.cards} cards${p.subdecks.length ? `, sub-decks: ${p.subdecks.join(', ')}` : ''})`).join('; ') + '.',
      );
      await ctx.call('deleteDecks', { decks: unique, cardsToo: true });
      return { deleted_decks: plan, cards_deleted: total, cards_also_deleted: true };
    },
  }),

  defineTool({
    name: 'get_deck_config',
    title: 'Get deck options',
    description:
      'Returns the options group of a deck: new cards per day, maximum reviews per day, learning and relearning steps, ' +
      'intervals, starting ease, leech threshold, plus the raw options object. The options group may be shared by several decks.',
    properties: { deck: prop.nonEmpty('Full deck name.') },
    required: ['deck'],
    kind: 'read',
    handler: async ({ deck }, ctx) => {
      const { name } = await canonicalDeck(ctx, deck);
      const config = await ctx.call('getDeckConfig', { deck: name });
      if (!config || config.dyn) throw new ToolError(`"${name}" is a filtered deck and has no standard options group.`);
      return { deck: name, ...summarizeConfig(config), raw: config };
    },
  }),

  defineTool({
    name: 'set_deck_config',
    title: 'Change deck options',
    description:
      'Changes options for a deck, such as new cards per day or maximum reviews per day. Only the fields provided are changed. ' +
      'Options live in a group that other decks may share, so the change applies to every deck using that group (the result lists the group name). ' +
      'The "advanced" object is deep-merged into AnkiConnect\'s raw options object for anything not covered by the named fields.',
    properties: {
      deck: prop.nonEmpty('Full deck name whose options group should change.'),
      ...OPTION_PROPS,
      advanced: { type: 'object', description: 'Raw AnkiConnect options fields to merge in, e.g. {"rev": {"ease4": 1.3}}. The "id" field cannot be changed.' },
    },
    required: ['deck'],
    kind: 'destructive',
    idempotent: true,
    handler: async ({ deck, advanced, ...changes }, ctx) => {
      const { name } = await canonicalDeck(ctx, deck);
      const config = await ctx.call('getDeckConfig', { deck: name });
      if (!config || config.dyn) throw new ToolError(`"${name}" is a filtered deck and has no standard options group.`);
      const before = summarizeConfig(config);
      let touched = 0;
      for (const [key, value] of Object.entries(changes)) {
        OPTION_MAP[key].set(config, value);
        touched += 1;
      }
      if (advanced) {
        if ('id' in advanced) throw new ToolError('"advanced" cannot change the options group id. Remove it and retry.');
        deepMerge(config, advanced);
        touched += 1;
      }
      if (touched === 0) throw new ToolError('No option was provided, so nothing changed. Pass at least one option, e.g. new_cards_per_day.');
      const ok = await ctx.call('saveDeckConfig', { config });
      if (ok !== true) throw new ToolError('Anki refused to save the options group. Check the values and retry.');
      const after = summarizeConfig(await ctx.call('getDeckConfig', { deck: name }));
      return { deck: name, options_group: config.name, applies_to_all_decks_using_group: true, before, after };
    },
  }),
];
