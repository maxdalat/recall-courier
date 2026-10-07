// Adding notes: the general add_notes tool plus Basic, Cloze and Reversed conveniences.
import { AnkiConnectError, ToolError } from '../errors.js';
import { mediaKind, validateMediaSource } from '../mediasource.js';
import { chunk, escapeMathAngles, isBlank, matchName, preview, suggest } from '../util.js';
import { defineTool, prop } from './helpers.js';
import { readNoteTypes } from './notetypes.js';

const MAX_NOTES = 500;
const DUP_SCOPES = ['deck', 'collection'];

const mediaItem = {
  type: 'object',
  properties: {
    filename: prop.str('File name to store in Anki\'s media folder, e.g. "cat.png". Optional when path is given.'),
    path: prop.str('Absolute path of a local image, audio or video file.'),
    url: prop.str('https:// URL of the file. Anki downloads it. Only use when the user asked for media from a URL.'),
    data_base64: prop.str('The file contents as standard base64.'),
    fields: prop.strings('Field names the media is appended to (an <img> tag or [sound:] tag). Default: the first field.'),
  },
  additionalProperties: false,
};

const duplicateProps = {
  allow_duplicates: prop.bool('Add notes even if Anki considers them duplicates (same first field). Default false: duplicates are skipped and reported.'),
  duplicate_scope: { type: 'string', enum: DUP_SCOPES, description: 'Where to look for duplicates: "collection" (default) or only the target "deck".' },
  create_deck_if_missing: prop.bool('Create the deck if it does not exist. Default false, which reports an error with similar deck names instead.'),
};

// Turns user-facing media items into AnkiConnect's audio/video/picture arrays.
function buildMedia(items, firstField, fieldNames) {
  const out = {};
  for (const item of items) {
    const source = validateMediaSource(item);
    const kind = mediaKind(source.filename);
    const targets = (item.fields?.length ? item.fields : [firstField]).map((f) => {
      const found = matchName(f, fieldNames);
      if (!found) throw new ToolError(`Media field "${f}" is not a field of this note type (fields: ${fieldNames.join(', ')}).`);
      return found;
    });
    (out[kind] ??= []).push({ ...source, fields: targets });
  }
  return out;
}

// Validates and adds notes. Returns per-note outcomes so partial failures are visible.
export async function addNotesCore(ctx, opts) {
  const { notes } = opts;
  const allowDuplicates = Boolean(opts.allow_duplicates);
  const scope = opts.duplicate_scope ?? 'collection';
  const createMissing = Boolean(opts.create_deck_if_missing);

  const failed = [];
  const warnings = [];
  const planned = [];
  const duplicates = [];
  const seen = new Set();
  const pendingDecks = new Map(); // decks this call will create, keyed by lower-case name

  const [deckNames, typeIds] = await ctx.multiStrict([['deckNames'], ['modelNamesAndIds']]);
  const modelNames = Object.keys(typeIds);
  const fieldCache = new Map();
  const fieldsOf = async (model) => {
    if (!fieldCache.has(model)) fieldCache.set(model, await ctx.call('modelFieldNames', { modelName: model }));
    return fieldCache.get(model);
  };

  for (let index = 0; index < notes.length; index += 1) {
    const note = notes[index];
    const fail = (error) => failed.push({ index, error });
    try {
      const deckWanted = note.deck ?? opts.deck;
      const typeWanted = note.note_type ?? opts.note_type;
      if (isBlank(deckWanted)) throw new ToolError('No deck given. Set "deck" on the call or on this note.');
      if (isBlank(typeWanted)) throw new ToolError('No note type given. Set "note_type" on the call or on this note (see list_note_types).');

      const model = matchName(typeWanted, modelNames);
      if (!model) {
        const hints = suggest(typeWanted, modelNames);
        throw new ToolError(`Note type "${typeWanted}" does not exist. ${hints.length ? `Similar: ${hints.join('; ')}. ` : ''}Available: ${modelNames.join(', ')}.`);
      }
      const fieldNames = await fieldsOf(model);
      const fields = {};
      for (const [key, value] of Object.entries(note.fields ?? {})) {
        const canonical = matchName(key, fieldNames);
        if (!canonical) throw new ToolError(`Note type "${model}" has no field "${key}". Its fields are: ${fieldNames.join(', ')}.`);
        const text = value === null || value === undefined ? '' : String(value);
        const fixed = escapeMathAngles(text);
        if (fixed.changed) warnings.push(`Note ${index}: rewrote "<" and ">" inside math in field "${canonical}" as \\lt and \\gt, because Anki fields are HTML.`);
        fields[canonical] = fixed.text;
      }
      if (isBlank(fields[fieldNames[0]])) throw new ToolError(`The first field "${fieldNames[0]}" is empty. Anki needs it filled in to create a card.`);

      const deck = matchName(deckWanted, deckNames) ?? null;
      if (!deck && !createMissing) {
        const hints = suggest(deckWanted, deckNames);
        throw new ToolError(`Deck "${deckWanted}" does not exist.${hints.length ? ` Similar decks: ${hints.join('; ')}.` : ''} Check list_decks, or set create_deck_if_missing: true.`);
      }

      const tags = [...(opts.tags ?? []), ...(note.tags ?? [])].map((t) => {
        const clean = String(t).trim().replace(/\s+/g, '_');
        if (clean !== String(t).trim()) warnings.push(`Note ${index}: tag "${t}" contained spaces, stored as "${clean}".`);
        return clean;
      }).filter(Boolean);

      let deckName = deck;
      if (!deckName) {
        const wantedName = String(deckWanted).trim();
        if (!pendingDecks.has(wantedName.toLowerCase())) pendingDecks.set(wantedName.toLowerCase(), wantedName);
        deckName = pendingDecks.get(wantedName.toLowerCase());
      }
      const payload = {
        deckName,
        modelName: model,
        fields,
        tags: [...new Set(tags)],
        options: { allowDuplicate: allowDuplicates, duplicateScope: scope },
        ...buildMedia(note.media ?? [], fieldNames[0], fieldNames),
      };
      const first = fields[fieldNames[0]];
      if (!allowDuplicates) {
        const key = JSON.stringify([model, scope === 'deck' ? deckName.toLowerCase() : '', first.replace(/<[^>]+>/g, '').trim()]);
        if (seen.has(key)) {
          duplicates.push({ index, first_field: preview(first), note: 'same as an earlier note in this batch' });
          continue;
        }
        seen.add(key);
      }
      planned.push({ index, payload, needsDeck: !deck, first });
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      fail(err.message);
    }
  }

  const decks_created = [];
  for (const name of new Set(planned.filter((p) => p.needsDeck).map((p) => p.payload.deckName))) {
    await ctx.call('createDeck', { deck: name });
    decks_created.push(name);
  }

  // Pre-check against Anki so duplicates are reported separately from real failures.
  const candidates = [];
  for (const group of chunk(planned, 200)) {
    let verdicts;
    try {
      verdicts = await ctx.call('canAddNotesWithErrorDetail', { notes: group.map((p) => p.payload) });
    } catch (err) {
      if (!(err instanceof AnkiConnectError) || !/unsupported action/i.test(err.ankiMessage)) throw err;
      const plain = await ctx.call('canAddNotes', { notes: group.map((p) => p.payload) });
      verdicts = plain.map((ok) => (ok ? { canAdd: true } : { canAdd: false, error: 'cannot create note because it is a duplicate or invalid' }));
    }
    group.forEach((p, i) => {
      const v = verdicts[i] ?? { canAdd: false, error: 'Anki gave no verdict for this note.' };
      if (v.canAdd) candidates.push(p);
      else if (/duplicate/i.test(v.error ?? '')) duplicates.push({ index: p.index, first_field: preview(p.first) });
      else failed.push({ index: p.index, error: v.error ?? 'Anki cannot add this note.' });
    });
  }

  const added = [];
  for (const group of chunk(candidates, 200)) {
    let ids;
    try {
      ids = await ctx.call('addNotes', { notes: group.map((p) => p.payload) });
    } catch (err) {
      if (!(err instanceof ToolError)) throw err;
      group.forEach((p) => failed.push({ index: p.index, error: err.message }));
      continue;
    }
    group.forEach((p, i) => {
      if (ids[i]) added.push({ index: p.index, note_id: ids[i], deck: p.payload.deckName });
      else failed.push({ index: p.index, error: 'Anki did not add this note (most likely it duplicates another note in the same batch).' });
    });
  }

  const byIndex = (a, b) => a.index - b.index;
  return {
    requested: notes.length,
    added_count: added.length,
    duplicate_count: duplicates.length,
    failed_count: failed.length,
    decks_created,
    added: added.sort(byIndex),
    skipped_duplicates: duplicates.sort(byIndex),
    failed: failed.sort(byIndex),
    ...(warnings.length ? { warnings } : {}),
  };
}

// Re-maps result indexes when some items were rejected before reaching addNotesCore.
function remap(result, indexMap, preFailed) {
  const fix = (list) => list.map((item) => ({ ...item, index: indexMap[item.index] }));
  const failed = [...fix(result.failed), ...preFailed].sort((a, b) => a.index - b.index);
  return {
    ...result,
    requested: result.requested + preFailed.length,
    added: fix(result.added),
    skipped_duplicates: fix(result.skipped_duplicates),
    failed,
    failed_count: failed.length,
  };
}

const STOCK = {
  basic: { name: 'Basic', fits: (t) => t.fields.length === 2 && t.templates.length === 1 && !t.is_cloze },
  reversed: { name: 'Basic (and reversed card)', fits: (t) => t.fields.length === 2 && t.templates.length === 2 && !t.is_cloze },
  cloze: { name: 'Cloze', fits: (t) => t.is_cloze },
};

// Finds the stock note type, falling back to structure when Anki is localized or the type was renamed.
async function resolveStockType(ctx, kind, requested) {
  const ids = await ctx.call('modelNamesAndIds');
  const names = Object.keys(ids);
  if (requested) {
    const found = matchName(requested, names);
    if (!found) throw new ToolError(`Note type "${requested}" does not exist. Available: ${names.join(', ')}.`);
    return { name: found, fields: await ctx.call('modelFieldNames', { modelName: found }) };
  }
  const exact = matchName(STOCK[kind].name, names);
  if (exact) return { name: exact, fields: await ctx.call('modelFieldNames', { modelName: exact }) };
  const types = (await readNoteTypes(ctx)).filter(STOCK[kind].fits).sort((a, b) => a.id - b.id);
  if (!types.length) {
    throw new ToolError(`No "${STOCK[kind].name}" note type was found (it may have been renamed or deleted). Pass note_type with one of: ${names.join(', ')}.`);
  }
  return { name: types[0].name, fields: types[0].fields };
}

const batchProps = {
  deck: prop.nonEmpty('Full deck name to add the cards to, e.g. "Languages::Spanish".'),
  tags: prop.strings('Tags applied to every card (use "::" for hierarchy, no spaces).'),
  note_type: prop.str('Override the note type. Default: the standard one for this tool.'),
  ...duplicateProps,
};

const cardSchema = (extra, required) => ({
  type: 'array',
  minItems: 1,
  maxItems: MAX_NOTES,
  items: { type: 'object', properties: { ...extra, tags: prop.strings('Extra tags for this card only.') }, required, additionalProperties: false },
});

async function addSimple(ctx, args, kind, build) {
  const type = await resolveStockType(ctx, kind, args.note_type);
  const notes = [];
  const indexMap = [];
  const preFailed = [];
  args.cards.forEach((card, i) => {
    try {
      notes.push(build(card, type));
      indexMap.push(i);
    } catch (err) {
      preFailed.push({ index: i, error: err.message });
    }
  });
  const base = { ...args, note_type: type.name, notes };
  if (!notes.length) {
    return { requested: args.cards.length, added_count: 0, duplicate_count: 0, failed_count: preFailed.length, note_type_used: type.name, added: [], skipped_duplicates: [], failed: preFailed };
  }
  const result = remap(await addNotesCore(ctx, base), indexMap, preFailed);
  return { ...result, note_type_used: type.name };
}

export const addTools = [
  defineTool({
    name: 'add_notes',
    title: 'Add notes',
    description:
      'Adds one or more notes (cards) to Anki in a batch. Each note has a deck, a note type, field values and optional tags and media. ' +
      '"deck", "note_type" and "tags" on the call act as defaults for notes that do not set their own. ' +
      'Duplicates (same first field) are skipped and listed unless allow_duplicates is true. Returns note IDs, skipped duplicates and per-note failures. ' +
      'Fields are HTML; write math as \\(...\\) or \\[...\\] (a raw < or > inside math is rewritten to \\lt and \\gt). Cloze fields use {{c1::text}}.',
    properties: {
      notes: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_NOTES,
        description: `Notes to add (up to ${MAX_NOTES} per call).`,
        items: {
          type: 'object',
          properties: {
            deck: prop.str('Deck for this note (overrides the call default).'),
            note_type: prop.str('Note type for this note (overrides the call default), e.g. "Basic" or "Cloze".'),
            fields: { type: 'object', description: 'Field name to HTML/text value, e.g. {"Front": "Capital of France?", "Back": "Paris"}.' },
            tags: prop.strings('Tags for this note.'),
            media: { type: 'array', items: mediaItem, description: 'Images, audio or video to attach to this note.' },
          },
          required: ['fields'],
          additionalProperties: false,
        },
      },
      deck: prop.str('Default deck for notes that do not set one.'),
      note_type: prop.str('Default note type for notes that do not set one.'),
      tags: prop.strings('Tags added to every note.'),
      ...duplicateProps,
    },
    required: ['notes'],
    kind: 'write',
    openWorld: true,
    handler: (args, ctx) => addNotesCore(ctx, args),
  }),

  defineTool({
    name: 'add_basic_cards',
    title: 'Add Basic cards',
    description:
      'Adds front/back flashcards using the Basic note type (one card per pair). Duplicates are skipped and reported. ' +
      'Front and back are HTML; math goes in \\(...\\).',
    properties: {
      ...batchProps,
      cards: cardSchema({ front: prop.nonEmpty('Front (question) side.'), back: prop.nonEmpty('Back (answer) side.') }, ['front', 'back']),
    },
    required: ['deck', 'cards'],
    kind: 'write',
    handler: (args, ctx) =>
      addSimple(ctx, args, 'basic', (card, type) => ({ fields: { [type.fields[0]]: card.front, [type.fields[1]]: card.back }, tags: card.tags })),
  }),

  defineTool({
    name: 'add_cloze_cards',
    title: 'Add Cloze cards',
    description:
      'Adds cloze-deletion cards using the Cloze note type. Each text must contain at least one deletion written as {{c1::answer}} ' +
      '(optionally {{c1::answer::hint}}); different numbers (c1, c2) make separate cards from one note. "extra" is shown on the back.',
    properties: {
      ...batchProps,
      cards: cardSchema({ text: prop.nonEmpty('Text containing {{c1::...}} deletions.'), extra: prop.str('Optional extra info shown on the back.') }, ['text']),
    },
    required: ['deck', 'cards'],
    kind: 'write',
    handler: (args, ctx) =>
      addSimple(ctx, args, 'cloze', (card, type) => {
        if (!/\{\{c\d+::/.test(card.text)) {
          throw new ToolError('The text has no cloze deletion. Wrap the answer like {{c1::answer}}, e.g. "The capital of France is {{c1::Paris}}."');
        }
        if (card.extra && type.fields.length < 2) throw new ToolError(`The note type "${type.name}" has no second field for "extra".`);
        const fields = { [type.fields[0]]: card.text };
        if (card.extra && type.fields[1]) fields[type.fields[1]] = card.extra;
        return { fields, tags: card.tags };
      }),
  }),

  defineTool({
    name: 'add_reversed_cards',
    title: 'Add reversed cards',
    description:
      'Adds front/back pairs using the "Basic (and reversed card)" note type, so each pair produces two cards: front-to-back and back-to-front.',
    properties: {
      ...batchProps,
      cards: cardSchema({ front: prop.nonEmpty('Front side.'), back: prop.nonEmpty('Back side.') }, ['front', 'back']),
    },
    required: ['deck', 'cards'],
    kind: 'write',
    handler: (args, ctx) =>
      addSimple(ctx, args, 'reversed', (card, type) => ({ fields: { [type.fields[0]]: card.front, [type.fields[1]]: card.back }, tags: card.tags })),
  }),
];
