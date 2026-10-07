import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnkiClient } from '../server/ankiconnect.js';
import { loadConfig, DEFAULT_URL } from '../server/config.js';
import { AnkiConnectError, AnkiUnreachableError, ToolError } from '../server/errors.js';
import { validate } from '../server/schema.js';
import { escapeMathAngles, matchName, preview, quoteSearch, suggest } from '../server/util.js';
import { validateMediaSource, isPrivateHost } from '../server/mediasource.js';
import { FakeAnki } from './fake-ankiconnect.js';

test('config: defaults, overrides, placeholders and non-loopback rejection', () => {
  assert.equal(loadConfig({}).url, DEFAULT_URL);
  assert.equal(loadConfig({}).autoLaunch, true);
  assert.equal(loadConfig({ RECALL_COURIER_URL: 'http://localhost:9000/' }).url, 'http://localhost:9000');
  assert.equal(loadConfig({ RECALL_COURIER_URL: '${user_config.anki_connect_url}' }).url, DEFAULT_URL);
  assert.equal(loadConfig({ RECALL_COURIER_API_KEY: '${user_config.key}' }).apiKey, '');
  assert.equal(loadConfig({ RECALL_COURIER_API_KEY: ' secret ' }).apiKey, 'secret');
  assert.equal(loadConfig({ RECALL_COURIER_AUTO_LAUNCH: 'false' }).autoLaunch, false);
  for (const bad of ['http://example.com:8765', 'https://127.0.0.1:8765', 'not a url', 'http://192.168.1.5:8765']) {
    const c = loadConfig({ RECALL_COURIER_URL: bad });
    assert.ok(c.urlError, bad);
    assert.match(c.urlError, /this computer|valid URL|http:\/\//);
  }
  assert.equal(loadConfig({ RECALL_COURIER_URL: 'http://[::1]:8765' }).urlError, null);
});

test('client: success, AnkiConnect error, api key, unreachable, bad reply, multi', async () => {
  const fake = new FakeAnki({ apiKey: 'k1' });
  const url = await fake.listen();
  try {
    const good = new AnkiClient({ url, apiKey: 'k1' });
    assert.deepEqual(await good.invoke('deckNames'), ['Default']);
    assert.equal((await good.probe()).requireApiKey, true);

    const noKey = new AnkiClient({ url });
    await assert.rejects(() => noKey.invoke('deckNames'), (e) => e instanceof AnkiConnectError && /API key/.test(e.message) && /plugin/.test(e.message));

    await assert.rejects(() => good.invoke('nope'), (e) => e instanceof AnkiConnectError && /too old/.test(e.message));

    const multi = await good.multi([['deckNames'], ['modelFieldNames', { modelName: 'Missing' }]]);
    assert.deepEqual(multi[0], { result: ['Default'], error: null });
    assert.match(multi[1].error, /model was not found/);

    fake.garbage = true;
    await assert.rejects(() => good.invoke('deckNames'), (e) => e instanceof ToolError && /did not answer like AnkiConnect/.test(e.message));
  } finally {
    await fake.close();
  }
  const dead = new AnkiClient({ url: 'http://127.0.0.1:1' });
  await assert.rejects(() => dead.invoke('deckNames'), (e) => e instanceof AnkiUnreachableError && /anki_launch/.test(e.message));
});

test('client: slow Anki gives a timeout message', async () => {
  const slow = new AnkiClient({ url: 'http://127.0.0.1:9', timeoutMs: 50, fetchImpl: (_u, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'TimeoutError' })))) });
  await assert.rejects(() => slow.invoke('deckNames'), /did not answer within/);
});

test('schema: required, types, enums, unknown keys, coercion, array limits', () => {
  const schema = {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 2 },
      mode: { type: 'string', enum: ['a', 'b'] },
      n: { type: 'integer', minimum: 1 },
      flag: { type: 'boolean' },
      name: { type: 'string', minLength: 1 },
    },
    required: ['ids'],
    additionalProperties: false,
  };
  assert.deepEqual(validate(schema, { ids: [1] }).errors, []);
  assert.match(validate(schema, {}).errors[0], /ids is required/);
  assert.match(validate(schema, { ids: [] }).errors[0], /at least 1 item/);
  assert.match(validate(schema, { ids: [1, 2, 3] }).errors[0], /maximum per call is 2/);
  assert.match(validate(schema, { ids: ['x'] }).errors[0], /must be an integer/);
  assert.match(validate(schema, { ids: [1], mode: 'c' }).errors[0], /one of: "a", "b"/);
  assert.match(validate(schema, { ids: [1], extra: 1 }).errors[0], /not a recognised argument/);
  assert.match(validate(schema, { ids: [1], name: '' }).errors[0], /must not be empty/);
  const coerced = validate(schema, { ids: '[1,2]', n: '3', flag: 'true' });
  assert.deepEqual(coerced.errors, []);
  assert.deepEqual(coerced.value, { ids: [1, 2], n: 3, flag: true });
});

test('util: math escaping only touches angle brackets inside math spans', () => {
  assert.deepEqual(escapeMathAngles('\\(a<b\\)'), { text: '\\(a\\lt b\\)', changed: true });
  assert.deepEqual(escapeMathAngles('\\[x>y\\] and \\(p<q>r\\)'), { text: '\\[x\\gt y\\] and \\(p\\lt q\\gt r\\)', changed: true });
  assert.deepEqual(escapeMathAngles('<b>bold</b> \\(x^2\\)'), { text: '<b>bold</b> \\(x^2\\)', changed: false });
  assert.deepEqual(escapeMathAngles('1 < 2 outside math'), { text: '1 < 2 outside math', changed: false });
  assert.equal(escapeMathAngles('\\(a \\lt b\\)').changed, false);
  assert.equal(escapeMathAngles('{{c1::\\(a<b\\)}}').text, '{{c1::\\(a\\lt b\\)}}');
});

test('util: matching, suggestions, quoting, preview', () => {
  assert.equal(matchName('spanish', ['Default', 'Spanish']), 'Spanish');
  assert.equal(matchName('x', ['Default']), null);
  assert.deepEqual(suggest('Verbs', ['Spanish::Verbs', 'French::Nouns']), ['Spanish::Verbs']);
  assert.equal(quoteSearch('a_b*"c'), '"a\\_b\\*\\"c"');
  assert.equal(preview('<b>Hi</b>&nbsp;there<br>you'), 'Hi there you');
});

test('mediasource: path, url and data validation', () => {
  assert.throws(() => validateMediaSource({ filename: 'a.png' }), /exactly one source/);
  assert.throws(() => validateMediaSource({ filename: 'a.png', url: 'http://example.com/a.png' }), /https/);
  assert.throws(() => validateMediaSource({ filename: 'a.png', url: 'https://localhost/a.png' }), /local or private/);
  assert.throws(() => validateMediaSource({ filename: 'a.png', url: 'https://192.168.0.2/a.png' }), /local or private/);
  assert.throws(() => validateMediaSource({ filename: 'a.png', url: 'https://user:pw@example.com/a.png' }), /username/);
  assert.throws(() => validateMediaSource({ filename: 'a.exe', url: 'https://example.com/a.exe' }), /image, audio or video/);
  assert.throws(() => validateMediaSource({ filename: '../a.png', url: 'https://example.com/a.png' }), /not a usable media file name/);
  assert.throws(() => validateMediaSource({ url: 'https://example.com/a.png' }), /filename is required/);
  assert.throws(() => validateMediaSource({ path: 'relative/a.png' }), /absolute path/);
  assert.throws(() => validateMediaSource({ path: '/definitely/missing/a.png' }), /No file exists/);
  assert.throws(() => validateMediaSource({ filename: 'a.png', data_base64: '***' }), /not valid base64/);
  assert.deepEqual(validateMediaSource({ filename: 'a.png', data_base64: 'aGk=' }), { filename: 'a.png', data: 'aGk=' });
  assert.equal(validateMediaSource({ filename: 'a.png', url: 'https://example.com/a.png' }).url, 'https://example.com/a.png');
  assert.equal(isPrivateHost('example.com'), false);
  assert.equal(isPrivateHost('169.254.169.254'), true);
  assert.equal(isPrivateHost('[::1]'), true);
});

test('util: quoteSubdecks keeps the wildcard', async () => {
  const { quoteSubdecks } = await import('../server/util.js');
  assert.equal(quoteSubdecks('A_b'), '"A\\_b::*"');
});
