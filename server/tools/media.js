// Media files stored in Anki's media folder.
import { ToolError } from '../errors.js';
import { mediaKind, validateMediaSource } from '../mediasource.js';
import { defineTool, prop } from './helpers.js';

const embed = (name) => (mediaKind(name) === 'picture' ? `<img src="${name}">` : `[sound:${name}]`);

export const mediaTools = [
  defineTool({
    name: 'store_media',
    title: 'Store media files',
    description:
      'Copies images, audio or video into Anki\'s media folder from a local file path, a base64 string, or an https URL (Anki itself downloads URLs; only public https addresses are accepted). ' +
      'An existing file with the same name is never overwritten; Anki picks a free name and the result reports the name actually used and the HTML to put in a card field ' +
      '(<img src="..."> for images, [sound:...] for audio and video).',
    properties: {
      files: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          properties: {
            filename: prop.str('Name to store the file under, e.g. "cat.png". Optional when path is given (defaults to the file\'s own name).'),
            path: prop.str('Absolute path of a local file.'),
            url: prop.str('https:// URL of the file.'),
            data_base64: prop.str('File contents as standard base64.'),
          },
          additionalProperties: false,
        },
        description: 'Files to store. Each needs exactly one of path, url or data_base64.',
      },
    },
    required: ['files'],
    kind: 'write',
    openWorld: true,
    handler: async ({ files }, ctx) => {
      const results = [];
      for (let index = 0; index < files.length; index += 1) {
        try {
          const source = validateMediaSource(files[index]);
          const stored = await ctx.call('storeMediaFile', { ...source, deleteExisting: false }, { timeoutMs: 120000 });
          if (!stored) throw new ToolError('Anki did not store the file. Check that the source is reachable and is a real media file.');
          results.push({ index, stored: true, stored_as: stored, html: embed(stored) });
        } catch (err) {
          if (!(err instanceof ToolError)) throw err;
          results.push({ index, stored: false, error: err.message });
        }
      }
      return {
        requested: files.length,
        stored_count: results.filter((r) => r.stored).length,
        failed_count: results.filter((r) => !r.stored).length,
        results,
      };
    },
  }),

  defineTool({
    name: 'list_media',
    title: 'List media files',
    description: 'Lists file names in Anki\'s media folder, optionally filtered by a glob pattern such as "*.png" or "cat*". Returns the total count and up to `limit` names.',
    properties: {
      pattern: prop.str('Glob pattern matched against file names, e.g. "*.mp3". Default: all files.'),
      limit: prop.int('Maximum names to return (default 200, at most 2000).', { minimum: 1, maximum: 2000 }),
    },
    kind: 'read',
    handler: async ({ pattern, limit = 200 }, ctx) => {
      const names = await ctx.call('getMediaFilesNames', pattern ? { pattern } : {});
      return { pattern: pattern ?? '*', total: names.length, returned: Math.min(limit, names.length), files: names.slice(0, limit) };
    },
  }),
];
