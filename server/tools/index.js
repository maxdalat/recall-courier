// Registry: collects every tool, validates arguments, runs handlers, and shapes results for MCP.
import { errorMessage } from '../errors.js';
import { validate } from '../schema.js';
import { appTools } from './app.js';
import { deckTools } from './decks.js';
import { noteTypeTools } from './notetypes.js';
import { addTools } from './add.js';
import { findTools } from './find.js';
import { editTools } from './edit.js';
import { cardTools } from './cards.js';
import { mediaTools } from './media.js';
import { statTools } from './stats.js';
import { transferTools } from './transfer.js';
import { guiTools } from './gui.js';

const MAX_TEXT = 60000;

export function allTools() {
  return [
    ...appTools,
    ...deckTools,
    ...noteTypeTools,
    ...addTools,
    ...findTools,
    ...editTools,
    ...cardTools,
    ...mediaTools,
    ...statTools,
    ...transferTools,
    ...guiTools,
  ];
}

function toText(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text.length <= MAX_TEXT) return text;
  return `${text.slice(0, MAX_TEXT)}\n… output truncated at ${MAX_TEXT} characters. Narrow the request (a smaller limit, a tighter query) to see the rest.`;
}

export function createToolRegistry(ctx, tools = allTools()) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    list() {
      return tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations }));
    },
    // Returns null for an unknown tool name; otherwise an MCP tool result.
    async call(name, args) {
      const tool = byName.get(name);
      if (!tool) return null;
      const { value, errors } = validate(tool.inputSchema, args ?? {});
      if (errors.length) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Invalid arguments for ${name}:\n- ${errors.join('\n- ')}\nFix these and call ${name} again.` }],
        };
      }
      try {
        const result = await tool.handler(value, ctx);
        return { content: [{ type: 'text', text: toText(result) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: errorMessage(err) }] };
      }
    },
  };
}
