// Importing and exporting .apkg packages.
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ToolError } from '../errors.js';
import { matchName } from '../util.js';
import { defineTool, prop } from './helpers.js';

function absolute(p, what) {
  const expanded = p === '~' || p.startsWith('~/') ? path.join(homedir(), p.slice(1)) : p;
  if (!path.isAbsolute(expanded)) throw new ToolError(`${what} must be an absolute path (got "${p}"), e.g. /Users/me/Documents/deck.apkg.`);
  return expanded;
}

export const transferTools = [
  defineTool({
    name: 'import_package',
    title: 'Import an .apkg package',
    description:
      'Imports a shared deck package (.apkg) from a local file into the open collection. Notes that already exist (same note ID) may be updated by the imported versions. ' +
      'Full-collection backups (.colpkg) are refused because importing one replaces the entire collection.',
    properties: { path: prop.nonEmpty('Absolute path of the .apkg file on this computer.') },
    required: ['path'],
    kind: 'destructive',
    handler: async ({ path: p }, ctx) => {
      const file = absolute(p, 'path');
      if (/\.colpkg$/i.test(file)) {
        throw new ToolError('Collection backups (.colpkg) are not imported by this tool because they replace the whole collection. Ask the user to restore it in Anki via File > Import.');
      }
      if (!/\.apkg$/i.test(file)) throw new ToolError(`"${p}" is not an .apkg file. Pass the path of a deck package ending in .apkg.`);
      if (!existsSync(file) || !statSync(file).isFile()) throw new ToolError(`No file exists at "${p}". Check the path and try again.`);
      const ok = await ctx.call('importPackage', { path: file }, { timeoutMs: 300000 });
      if (ok !== true) throw new ToolError('Anki could not import that package. It may be corrupt or from an unsupported Anki version; ask the user to try File > Import in Anki to see the error.');
      return { imported: true, file };
    },
  }),

  defineTool({
    name: 'export_deck',
    title: 'Export a deck as .apkg',
    description:
      'Exports a deck (with its sub-decks) to a .apkg file on this computer, optionally including scheduling data. ' +
      'Refuses to overwrite an existing file; choose a new file name instead.',
    properties: {
      deck: prop.nonEmpty('Full deck name to export.'),
      path: prop.nonEmpty('Absolute path of the .apkg file to create.'),
      include_scheduling: prop.bool('Include review scheduling (intervals, due dates). Default false.'),
    },
    required: ['deck', 'path'],
    kind: 'write',
    handler: async ({ deck, path: p, include_scheduling }, ctx) => {
      const file = absolute(p, 'path');
      if (!/\.apkg$/i.test(file)) throw new ToolError('The export path must end in .apkg, e.g. /Users/me/Documents/spanish.apkg.');
      if (existsSync(file)) throw new ToolError(`A file already exists at "${p}", and it will not be overwritten. Choose a different file name.`);
      if (!existsSync(path.dirname(file))) throw new ToolError(`The folder "${path.dirname(file)}" does not exist. Create it or choose another location.`);
      const known = Object.keys(await ctx.call('deckNamesAndIds'));
      const name = matchName(deck, known);
      if (!name) throw new ToolError(`Deck "${deck}" does not exist. Check names with list_decks.`);
      const ok = await ctx.call('exportPackage', { deck: name, path: file, includeSched: Boolean(include_scheduling) }, { timeoutMs: 300000 });
      if (ok !== true) throw new ToolError('Anki could not write the export. Check that the location is writable and retry.');
      return { exported: true, deck: name, file, includes_scheduling: Boolean(include_scheduling) };
    },
  }),
];
