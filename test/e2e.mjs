#!/usr/bin/env node
// End-to-end test against a REAL, already running Anki with the AnkiConnect add-on.
// It never launches Anki and only touches decks named "zz-plugin-test*". Run: npm run test:e2e
import { StdioClient } from './stdio-client.js';
import { runScenario } from './e2e-scenario.js';

const url = process.env.E2E_URL || 'http://127.0.0.1:8765';

const probe = await fetch(url, { method: 'POST', body: JSON.stringify({ action: 'version', version: 6 }), signal: AbortSignal.timeout(3000) }).catch(() => null);
if (!probe || !probe.ok) {
  console.log(`SKIPPED: AnkiConnect is not reachable at ${url}. Start Anki (with the AnkiConnect add-on) and run again.`);
  process.exit(0);
}

const client = new StdioClient({ RECALL_COURIER_URL: url, RECALL_COURIER_AUTO_LAUNCH: 'false' });
let failed = false;
try {
  await runScenario(client, (line) => console.log(line));
  console.log('E2E PASSED');
} catch (err) {
  failed = true;
  console.error('E2E FAILED:', err.message);
} finally {
  await client.close();
}
process.exit(failed ? 1 : 0);
