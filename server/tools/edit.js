// Editing notes: fields, tags, deck moves, deletion.
import { ToolError } from '../errors.js';
import { escapeMathAngles, matchName, preview } from '../util.js';
import { defineTool, prop, requireConfirm, resolveCardIds, resolveDeck } from './helpers.js';

// Splits ids into those that exist and those that do not.
async function existingNotes(ctx, ids) {
  const infos = await ctx.call('notesInfo', { notes: ids });
  const found = [];
  const missing = [];
  infos.forEach((n, i) => (n && n.noteId ? found.push(n) : missing.push(ids[i])));
  return { found, missing };
}

function cleanTags(tags, warnings) {
  return [...new Set(tags.map((t) => {
    const clean = t.trim().replace(/\s+/g, '_');
    if (clean !== t.trim()) warnings.push(`Tag "${t}" contained spaces, used "${clean}".`);
    return clean;
  }).filter(Boolean))];
}

const noteIds = prop.ids('Note IDs, e.g. from find_notes.');
const tagList = prop.strings('Tags (no spaces; use "::" for hierarchy, e.g. "lang::es").', { minItems: 1, maxItems: 100 });

function tagTool({ name, title, description, action, kind }) {
  return defineTool({
    name,
    title,
    description,
    properties: { note_ids: noteIds, tags: tagList },
    required: ['note_ids', 'tags'],
    kind,
    idempotent: true,
    handler: async ({ note_ids, tags }, ctx) => {
      const warnings = [];
      const clean = cleanTags(tags, warnings);
      const { found, missing } = await existingNotes(ctx, note_ids);
      if (found.length) await ctx.call(action, { notes: found.map((n) => n.noteId), tags: clean.join(' ') });
      return { tags: clean, notes_updated: found.length, ...(missing.length ? { not_found: missing } : {}), ...(warnings.length ? { warnings } : {}) };
    },
  });
}

export const editTools = [
  defineTool({
    name: 'update_note_fields',
    title: 'Update note fields',
    description:
      'Overwrites field values on existing notes (batch). Only the fields given are changed; others keep their content. ' +
      'Values are HTML; math goes in \\(...\\) and a raw < or > inside math is rewritten to \\lt and \\gt. ' +
      'Anki may refuse to update a note that is open in the card browser editor; close it there if an update has no effect.',
    properties: {
      updates: {
        type: 'array',
        minItems: 1,
        maxItems: 200,
        items: {
          type: 'object',
          properties: { note_id: prop.int('Note ID.'), fields: { type: 'object', description: 'Field name to new value, e.g. {"Back": "Paris"}.' } },
          required: ['note_id', 'fields'],
          additionalProperties: false,
        },
        description: 'One entry per note to change.',
      },
    },
    required: ['updates'],
    kind: 'destructive',
    handler: async ({ updates }, ctx) => {
      const { found } = await existingNotes(ctx, updates.map((u) => u.note_id));
      const byId = new Map(found.map((n) => [n.noteId, n]));
      const results = [];
      const calls = [];
      const owners = [];
      const warnings = [];
      for (const u of updates) {
        const note = byId.get(u.note_id);
        if (!note) {
          results.push({ note_id: u.note_id, updated: false, error: 'Note does not exist. Check the ID with find_notes.' });
          continue;
        }
        const names = Object.keys(note.fields);
        const fields = {};
        let bad = null;
        for (const [key, value] of Object.entries(u.fields)) {
          const canonical = matchName(key, names);
          if (!canonical) {
            bad = `Note type "${note.modelName}" has no field "${key}". Its fields are: ${names.join(', ')}.`;
            break;
          }
          const fixed = escapeMathAngles(String(value ?? ''));
          if (fixed.changed) warnings.push(`Note ${u.note_id}: rewrote "<" and ">" inside math in "${canonical}" as \\lt and \\gt.`);
          fields[canonical] = fixed.text;
        }
        if (bad) {
          results.push({ note_id: u.note_id, updated: false, error: bad });
          continue;
        }
        calls.push(['updateNoteFields', { note: { id: u.note_id, fields } }]);
        owners.push({ note_id: u.note_id, changed: Object.keys(fields) });
      }
      const outcomes = await ctx.multi(calls);
      outcomes.forEach((o, i) => results.push(o.error === null ? { ...owners[i], updated: true } : { note_id: owners[i].note_id, updated: false, error: o.error }));
      results.sort((a, b) => a.note_id - b.note_id);
      return {
        requested: updates.length,
        updated_count: results.filter((r) => r.updated).length,
        failed_count: results.filter((r) => !r.updated).length,
        results,
        ...(warnings.length ? { warnings } : {}),
      };
    },
  }),

  tagTool({
    name: 'add_tags',
    title: 'Add tags',
    description: 'Adds tags to notes. Tags a note already has are left as they are.',
    action: 'addTags',
    kind: 'destructive',
  }),
  tagTool({
    name: 'remove_tags',
    title: 'Remove tags',
    description: 'Removes the given tags from notes. Notes without a tag are unaffected. The notes themselves are never deleted.',
    action: 'removeTags',
    kind: 'destructive',
  }),

  defineTool({
    name: 'replace_tags',
    title: 'Replace a tag',
    description: 'On the given notes, replaces one tag with another (for example renaming "verbs" to "grammar::verbs"). Notes without the old tag are unaffected.',
    properties: {
      note_ids: noteIds,
      tag_to_replace: prop.nonEmpty('Existing tag to replace.'),
      replace_with: prop.nonEmpty('Tag to put in its place.'),
    },
    required: ['note_ids', 'tag_to_replace', 'replace_with'],
    kind: 'destructive',
    idempotent: true,
    handler: async ({ note_ids, tag_to_replace, replace_with }, ctx) => {
      if (/\s/.test(tag_to_replace) || /\s/.test(replace_with)) throw new ToolError('Tags cannot contain spaces. Use "_" or "::" instead, e.g. "lang::es".');
      const { found, missing } = await existingNotes(ctx, note_ids);
      const hadTag = found.filter((n) => n.tags.some((t) => t.toLowerCase() === tag_to_replace.toLowerCase()));
      if (hadTag.length) await ctx.call('replaceTags', { notes: hadTag.map((n) => n.noteId), tag_to_replace, replace_with });
      return { notes_changed: hadTag.length, notes_without_tag: found.length - hadTag.length, ...(missing.length ? { not_found: missing } : {}) };
    },
  }),

  defineTool({
    name: 'change_deck',
    title: 'Move cards to a deck',
    description:
      'Moves cards to another deck. Give card_ids, or note_ids to move every card of those notes. ' +
      'Fails if the target deck does not exist unless create_deck_if_missing is true.',
    properties: {
      deck: prop.nonEmpty('Full name of the destination deck.'),
      card_ids: prop.ids('Card IDs to move.'),
      note_ids: prop.ids('Note IDs whose cards should all move.'),
      create_deck_if_missing: prop.bool('Create the destination deck if it does not exist. Default false.'),
    },
    required: ['deck'],
    kind: 'destructive',
    idempotent: true,
    handler: async (args, ctx) => {
      const ids = await resolveCardIds(ctx, args);
      const target = await resolveDeck(ctx, args.deck, { create: Boolean(args.create_deck_if_missing) });
      await ctx.call('changeDeck', { cards: ids, deck: target.name });
      return { moved_cards: ids.length, deck: target.name, deck_created: target.created };
    },
  }),

  defineTool({
    name: 'delete_notes',
    title: 'Delete notes',
    description:
      'Permanently deletes notes and all their cards. Requires confirm: true; without it nothing is deleted and the call reports how many notes and cards would go. ' +
      'Deleted notes can only be recovered through Anki\'s Undo or a backup.',
    properties: { note_ids: prop.ids('IDs of the notes to delete.'), confirm: prop.confirm('permanently deleting these notes and their cards') },
    required: ['note_ids', 'confirm'],
    kind: 'destructive',
    handler: async (args, ctx) => {
      const { found, missing } = await existingNotes(ctx, args.note_ids);
      if (!found.length) throw new ToolError(`None of the ${args.note_ids.length} note IDs exist, so nothing was deleted. Check them with find_notes.`);
      const cards = found.reduce((sum, n) => sum + n.cards.length, 0);
      const sample = found.slice(0, 5).map((n) => `#${n.noteId} "${preview(Object.values(n.fields)[0]?.value, 50)}"`);
      requireConfirm(args, `This would permanently delete ${found.length} note(s) and ${cards} card(s), for example ${sample.join(', ')}${found.length > 5 ? ', …' : ''}.`);
      await ctx.call('deleteNotes', { notes: found.map((n) => n.noteId) });
      return { deleted_notes: found.length, deleted_cards: cards, ...(missing.length ? { not_found: missing } : {}) };
    },
  }),
];
