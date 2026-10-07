import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAnki } from './fake-ankiconnect.js';
import { StdioClient } from './stdio-client.js';
import { VERSION } from '../server/version.js';

async function withServer(fakeOptions, envExtra, fn) {
  const fake = new FakeAnki(fakeOptions);
  const url = await fake.listen();
  const client = new StdioClient({ RECALL_COURIER_URL: url, RECALL_COURIER_AUTO_LAUNCH: 'false', ...envExtra });
  try {
    await fn(client, fake);
  } finally {
    const code = await client.close();
    await fake.close();
    assert.equal(code, 0, `server should exit cleanly, stderr: ${client.stderr}`);
  }
}

test('initialize, notifications, ping', async () => {
  await withServer({}, {}, async (c) => {
    const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.jsonrpc, '2.0');
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'recall-courier');
    assert.equal(init.result.serverInfo.version, VERSION);
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
    assert.ok(init.result.instructions.length > 10);

    c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    c.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 99 } });
    const ping = await c.request('ping');
    assert.deepEqual(ping.result, {}); // the notifications produced no replies in between

    const old = await c.request('initialize', { protocolVersion: '1999-01-01' });
    assert.equal(old.result.protocolVersion, '2025-11-25');
    const older = await c.request('initialize', { protocolVersion: '2024-11-05' });
    assert.equal(older.result.protocolVersion, '2024-11-05');
  });
});

test('tools/list returns every tool with title and read-only/destructive annotations', async () => {
  await withServer({}, {}, async (c) => {
    const { result } = await c.request('tools/list');
    assert.ok(result.tools.length >= 40);
    for (const t of result.tools) {
      assert.ok(t.title, `${t.name} title`);
      assert.equal(t.annotations.title, t.title);
      assert.ok(t.annotations.readOnlyHint === true || typeof t.annotations.destructiveHint === 'boolean', `${t.name} hints`);
      assert.equal(t.inputSchema.type, 'object');
    }
    const byName = Object.fromEntries(result.tools.map((t) => [t.name, t]));
    assert.equal(byName.list_decks.annotations.readOnlyHint, true);
    assert.equal(byName.delete_notes.annotations.destructiveHint, true);
    assert.equal(byName.add_notes.annotations.destructiveHint, false);
    assert.ok(byName.delete_deck.inputSchema.required.includes('confirm'));
  });
});

test('tools/call: a realistic session against the fake Anki', async () => {
  await withServer({}, {}, async (c, fake) => {
    await c.request('initialize', { protocolVersion: '2025-06-18' });
    const decks = JSON.parse((await c.call('list_decks', {})).text);
    assert.equal(decks.deck_count, 1);

    const made = await c.call('create_deck', { names: ['Chemistry::Organic'] });
    assert.equal(made.isError, false);
    const added = JSON.parse((await c.call('add_cloze_cards', { deck: 'Chemistry::Organic', cards: [{ text: 'Water is {{c1::H\\(_2\\)O}}' }, { text: 'Is \\({{c1::x<y}}\\) valid?' }] })).text);
    assert.equal(added.added_count, 2);
    assert.ok(fake.noteByFirstField('Is \\({{c1::x\\lt y}}\\) valid?'));

    const found = JSON.parse((await c.call('find_notes', { query: 'deck:"Chemistry::Organic"' })).text);
    assert.equal(found.total, 2);

    const refused = await c.call('delete_deck', { names: ['Chemistry::Organic'], confirm: false });
    assert.equal(refused.isError, true);
    assert.match(refused.text, /confirm was not true/);
    assert.equal(fake.notes.size, 2);

    const bad = await c.call('add_basic_cards', { deck: 'X' });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /cards is required/);

    const deleted = JSON.parse((await c.call('delete_deck', { names: ['Chemistry::Organic'], confirm: true })).text);
    assert.equal(deleted.cards_also_deleted, true);
    assert.equal(fake.notes.size, 0);
  });
});

test('protocol errors: unknown tool, unknown method, parse error, batch, bad request', async () => {
  await withServer({}, {}, async (c) => {
    const unknownTool = await c.request('tools/call', { name: 'nope', arguments: {} });
    assert.equal(unknownTool.error.code, -32602);
    assert.match(unknownTool.error.message, /Unknown tool: nope/);
    const noName = await c.request('tools/call', {});
    assert.equal(noName.error.code, -32602);
    const method = await c.request('resources/list');
    assert.equal(method.error.code, -32601);

    c.send('this is not json');
    const parse = await c.read();
    assert.equal(parse.error.code, -32700);
    assert.equal(parse.id, null);

    c.send({ jsonrpc: '2.0', id: 'x', params: {} });
    const invalid = await c.read();
    assert.equal(invalid.error.code, -32600);

    c.send([{ jsonrpc: '2.0', id: 11, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 12, method: 'ping' }]);
    const batch = await c.read();
    assert.deepEqual(batch.map((r) => r.id), [11, 12]);
  });
});

test('Anki not running: status works, tools explain what to do', async () => {
  const gone = new FakeAnki();
  const url = await gone.listen();
  await gone.close();
  const c = new StdioClient({ RECALL_COURIER_URL: url, RECALL_COURIER_AUTO_LAUNCH: 'false' });
  try {
    await c.request('initialize', { protocolVersion: '2025-06-18' });
    const status = JSON.parse((await c.call('anki_status', {})).text);
    assert.equal(status.ankiconnect_reachable, false);
    assert.ok(status.next_step);
    const res = await c.call('list_decks', {});
    assert.equal(res.isError, true);
    assert.match(res.text, /not answering.*launching is turned off.*start Anki/s);
  } finally {
    assert.equal(await c.close(), 0);
  }
});

test('Anki not installed: friendly install guidance (no launch is attempted)', { skip: process.platform === 'darwin' || process.platform === 'win32' }, async () => {
  const gone = new FakeAnki();
  const url = await gone.listen();
  await gone.close();
  // An empty PATH and a fake HOME mean no Anki can be found, so nothing can be launched.
  const c = new StdioClient({ RECALL_COURIER_URL: url, PATH: '', HOME: '/nonexistent-home', XDG_DATA_HOME: '/nonexistent-data' });
  try {
    const res = await c.call('anki_launch', {});
    assert.equal(res.isError, true);
    assert.match(res.text, /not appear to be installed.*https:\/\/apps\.ankiweb\.net/s);
  } finally {
    assert.equal(await c.close(), 0);
  }
});

test('API key from plugin settings reaches AnkiConnect; wrong key is explained', async () => {
  await withServer({ apiKey: 'sekret' }, { RECALL_COURIER_API_KEY: 'sekret' }, async (c) => {
    assert.equal((await c.call('list_decks', {})).isError, false);
    assert.ok(c.stderr === '', 'the key is never logged');
  });
  await withServer({ apiKey: 'sekret' }, { RECALL_COURIER_API_KEY: 'nope' }, async (c) => {
    const res = await c.call('list_decks', {});
    assert.equal(res.isError, true);
    assert.match(res.text, /API key/);
    assert.ok(!res.text.includes('nope') && !res.text.includes('sekret'), 'keys never appear in messages');
  });
});

test('stdout carries only JSON-RPC lines and a closed stdin ends the process', async () => {
  await withServer({}, {}, async (c) => {
    await c.request('initialize', { protocolVersion: '2025-06-18' });
    await c.call('list_decks', {});
    assert.equal(c.lines.length, 0);
    assert.equal(c.buffer, '');
  });
});
