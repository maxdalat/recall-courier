import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeAnki } from './fake-ankiconnect.js';
import { StdioClient } from './stdio-client.js';
import { runScenario } from './e2e-scenario.js';

// Runs the same lifecycle script that e2e.mjs runs against real Anki, but against the fake,
// so the script itself is verified in CI.
test('end-to-end scenario passes against the fake AnkiConnect', async () => {
  const fake = new FakeAnki();
  fake.addDeckDirect('Existing deck');
  const url = await fake.listen();
  const client = new StdioClient({ RECALL_COURIER_URL: url, RECALL_COURIER_AUTO_LAUNCH: 'false' });
  try {
    const lines = [];
    await runScenario(client, (l) => lines.push(l));
    assert.ok(lines.at(-1).includes('other decks unchanged'));
    assert.ok(fake.decks.has('Existing deck'));
    assert.equal([...fake.decks.keys()].filter((d) => d.startsWith('zz-plugin-test')).length, 0);
    assert.equal(fake.notes.size, 0);
  } finally {
    assert.equal(await client.close(), 0);
    await fake.close();
  }
});

test('the real-Anki e2e script skips cleanly when AnkiConnect is not reachable', async () => {
  const { spawn } = await import('node:child_process');
  const dead = new FakeAnki();
  const url = await dead.listen();
  await dead.close();
  const out = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['test/e2e.mjs'], { env: { PATH: process.env.PATH, E2E_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    child.stdout.on('data', (c) => { text += c; });
    child.on('exit', (code) => resolve({ code, text }));
  });
  assert.equal(out.code, 0);
  assert.match(out.text, /SKIPPED: AnkiConnect is not reachable/);
});
