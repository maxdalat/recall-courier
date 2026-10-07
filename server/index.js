#!/usr/bin/env node
// Entry point: node ${CLAUDE_PLUGIN_ROOT}/server/index.js
import { AnkiClient } from './ankiconnect.js';
import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { McpServer } from './protocol.js';
import { createToolRegistry } from './tools/index.js';

const config = loadConfig();
const client = new AnkiClient({ url: config.url, apiKey: config.apiKey });
const ctx = createContext({ config, client });
const log = (text) => process.stderr.write(`[recall-courier] ${text}\n`);

const server = new McpServer({
  tools: createToolRegistry(ctx),
  input: process.stdin,
  output: process.stdout,
  log,
});

server.start().then(() => process.exit(0));
