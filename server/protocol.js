// MCP over stdio, implemented by hand: newline-delimited JSON-RPC 2.0.
// Handles initialize, ping, tools/list, tools/call and notifications. stdout carries protocol messages only.
import { SERVER_NAME, SERVER_TITLE, VERSION } from './version.js';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 };

export const INSTRUCTIONS =
  'Recall Courier controls the Anki desktop app on this computer through the AnkiConnect add-on. ' +
  'Tools launch Anki when needed. Card content stays in Anki on this computer.';

export class McpServer {
  // tools: { list(): [toolDescriptor], call(name, args): Promise<{content, isError?}> | null for unknown }
  constructor({ tools, input, output, log = () => {} }) {
    this.tools = tools;
    this.input = input;
    this.output = output;
    this.log = log;
    this.pending = new Set();
    this.buffer = '';
  }

  start() {
    this.input.setEncoding('utf8');
    this.input.on('data', (chunk) => this.#onData(chunk));
    return new Promise((resolve) => {
      this.input.on('end', async () => {
        if (this.buffer.trim()) this.#handleLine(this.buffer);
        await Promise.allSettled([...this.pending]);
        resolve();
      });
    });
  }

  #onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.#handleLine(line);
    }
  }

  #send(message) {
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.#send({ jsonrpc: '2.0', id: null, error: { code: ERR.parse, message: 'Parse error: the message was not valid JSON.' } });
      return;
    }
    const task = this.#dispatch(message).catch((err) => this.log(`internal error: ${err && err.stack ? err.stack : err}`));
    this.pending.add(task);
    task.finally(() => this.pending.delete(task));
  }

  async #dispatch(message) {
    if (Array.isArray(message)) {
      const replies = (await Promise.all(message.map((m) => this.#process(m)))).filter(Boolean);
      if (replies.length) this.output.write(`${JSON.stringify(replies)}\n`);
      return;
    }
    const reply = await this.#process(message);
    if (reply) this.#send(reply);
  }

  // Returns a response object for requests, or null for notifications.
  async #process(message) {
    if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      // A response to a request we never send is ignored; anything else is malformed.
      if (message && typeof message === 'object' && message.method === undefined && ('result' in message || 'error' in message)) return null;
      return { jsonrpc: '2.0', id: message && message.id !== undefined ? message.id : null, error: { code: ERR.invalidRequest, message: 'Invalid JSON-RPC request.' } };
    }
    const isNotification = !('id' in message);
    const respond = (result) => (isNotification ? null : { jsonrpc: '2.0', id: message.id, result });
    const fail = (code, text) => (isNotification ? null : { jsonrpc: '2.0', id: message.id, error: { code, message: text } });
    const params = message.params ?? {};

    try {
      switch (message.method) {
        case 'initialize': {
          const asked = params.protocolVersion;
          const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0];
          return respond({
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, title: SERVER_TITLE, version: VERSION },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping':
          return respond({});
        case 'tools/list':
          return respond({ tools: this.tools.list() });
        case 'tools/call': {
          if (typeof params.name !== 'string') return fail(ERR.invalidParams, 'tools/call needs a string "name".');
          const result = await this.tools.call(params.name, params.arguments ?? {});
          if (result === null) return fail(ERR.invalidParams, `Unknown tool: ${params.name}`);
          return respond(result);
        }
        default:
          if (message.method.startsWith('notifications/')) return null;
          return fail(ERR.methodNotFound, `Method not found: ${message.method}`);
      }
    } catch (err) {
      this.log(`handler error for ${message.method}: ${err && err.stack ? err.stack : err}`);
      return fail(ERR.internal, `Internal error: ${err && err.message ? err.message : err}`);
    }
  }
}
