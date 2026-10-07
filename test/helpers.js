import assert from 'node:assert/strict';
import { AnkiClient } from '../server/ankiconnect.js';
import { loadConfig } from '../server/config.js';
import { createContext } from '../server/context.js';
import { createToolRegistry } from '../server/tools/index.js';
import { FakeAnki } from './fake-ankiconnect.js';

// Spins up a fake Anki and a tool registry wired to it. Nothing here can launch a real Anki.
export async function makeEnv({ apiKey = '', clientKey = apiKey, autoLaunch = false, url } = {}) {
  const fake = new FakeAnki({ apiKey });
  const fakeUrl = await fake.listen();
  const config = loadConfig({
    RECALL_COURIER_URL: url ?? fakeUrl,
    RECALL_COURIER_API_KEY: clientKey,
    RECALL_COURIER_AUTO_LAUNCH: String(autoLaunch),
  });
  const client = new AnkiClient({ url: config.url, apiKey: config.apiKey, timeoutMs: 5000 });
  const ctx = createContext({ config, client, setupDeps: { platform: 'linux', exists: () => false, env: { PATH: '' }, home: '/nowhere' }, launchTimeoutMs: 300, pollMs: 20 });
  const registry = createToolRegistry(ctx);

  async function call(name, args = {}) {
    const result = await registry.call(name, args);
    assert.ok(result, `unknown tool ${name}`);
    const text = result.content[0].text;
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      // plain-text message
    }
    return { isError: Boolean(result.isError), data, text };
  }

  // Calls a tool and asserts success.
  async function ok(name, args = {}) {
    const res = await call(name, args);
    assert.equal(res.isError, false, `${name} failed: ${res.text}`);
    return res.data;
  }

  // Calls a tool and asserts a helpful failure; returns the message.
  async function fails(name, args = {}, pattern) {
    const res = await call(name, args);
    assert.equal(res.isError, true, `${name} should have failed but returned ${res.text}`);
    if (pattern) assert.match(res.text, pattern);
    return res.text;
  }

  return { fake, ctx, call, ok, fails, registry, close: () => fake.close() };
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
