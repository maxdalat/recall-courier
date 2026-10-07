import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { AnkiClient } from '../server/ankiconnect.js';
import { loadConfig } from '../server/config.js';
import { addonFolders, detectAnki, ensureAnkiConnect, findAddon } from '../server/setup.js';
import { FakeAnki } from './fake-ankiconnect.js';
import { makeEnv, wait } from './helpers.js';

const withFiles = (files) => (p) => files.includes(p);

test('detectAnki: macOS, Windows, Linux PATH and flatpak', () => {
  const mac = detectAnki({ platform: 'darwin', home: '/Users/me', exists: withFiles(['/Users/me/Applications/Anki.app']) });
  assert.equal(mac.command, 'open');
  assert.deepEqual(mac.args, ['-a', '/Users/me/Applications/Anki.app']);
  assert.equal(detectAnki({ platform: 'darwin', home: '/Users/me', exists: withFiles(['/Applications/Anki.app']) }).label, '/Applications/Anki.app');
  assert.equal(detectAnki({ platform: 'darwin', home: '/Users/me', exists: () => false }), null);

  const exe = path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'Anki', 'anki.exe');
  const win = detectAnki({ platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, exists: withFiles([exe]) });
  assert.equal(win.command, exe);
  const pf = detectAnki({ platform: 'win32', home: 'x', env: { ProgramFiles: 'C:\\Program Files' }, exists: withFiles([path.join('C:\\Program Files', 'Anki', 'anki.exe')]) });
  assert.ok(pf);
  assert.equal(detectAnki({ platform: 'win32', home: 'x', env: {}, exists: () => false }), null);

  const onPath = detectAnki({ platform: 'linux', home: '/home/me', env: { PATH: '/usr/bin:/opt/bin' }, exists: withFiles(['/opt/bin/anki']) });
  assert.deepEqual([onPath.kind, onPath.command], ['path', '/opt/bin/anki']);
  const flat = detectAnki({ platform: 'linux', home: '/home/me', env: { PATH: '/usr/bin' }, exists: withFiles(['/usr/bin/flatpak', '/home/me/.var/app/net.ankiweb.Anki']) });
  assert.deepEqual([flat.kind, flat.command, flat.args], ['flatpak', '/usr/bin/flatpak', ['run', 'net.ankiweb.Anki']]);
  assert.equal(detectAnki({ platform: 'linux', home: '/home/me', env: { PATH: '/usr/bin' }, exists: withFiles(['/usr/bin/flatpak']) }), null);
});

test('addon folders per platform', () => {
  assert.deepEqual(addonFolders({ platform: 'darwin', home: '/Users/me' }), ['/Users/me/Library/Application Support/Anki2/addons21/2055492159']);
  assert.equal(addonFolders({ platform: 'win32', home: 'h', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } })[0], path.join('C:\\Users\\me\\AppData\\Roaming', 'Anki2', 'addons21', '2055492159'));
  const linux = addonFolders({ platform: 'linux', home: '/home/me', env: {} });
  assert.equal(linux[0], '/home/me/.local/share/Anki2/addons21/2055492159');
  assert.match(linux[1], /\.var\/app\/net\.ankiweb\.Anki\/data\/Anki2\/addons21\/2055492159$/);
  assert.equal(findAddon({ platform: 'linux', home: '/home/me', env: {}, exists: withFiles([linux[1]]) }), linux[1]);
});

function fakeSpawn(onStart) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    onStart?.(child);
    return child;
  };
  return { spawn, calls };
}

test('ensureAnkiConnect: already running does not launch', async () => {
  const env = await makeEnv();
  const { spawn, calls } = fakeSpawn();
  try {
    const info = await ensureAnkiConnect({ client: env.ctx.client, config: env.ctx.config, deps: { spawn } });
    assert.equal(info.alreadyRunning, true);
    assert.equal(calls.length, 0);
  } finally {
    await env.close();
  }
});

test('ensureAnkiConnect: launches Anki, then waits until AnkiConnect answers', async () => {
  const fake = new FakeAnki();
  const url = await fake.listen();
  await fake.close(); // port is now closed: "Anki is not running"
  const client = new AnkiClient({ url, timeoutMs: 1000 });
  const config = loadConfig({ RECALL_COURIER_URL: url });
  const revived = new FakeAnki();
  const { spawn, calls } = fakeSpawn(() => {
    // "Anki starts" shortly after the launch command and listens on the same port.
    setTimeout(() => revived.server || revived.listenOn(Number(new URL(url).port)), 120);
  });
  revived.listenOn = async (port) => {
    const { createServer } = await import('node:http');
    revived.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(revived.handle(JSON.parse(body || '{}')))); });
    });
    await new Promise((r) => revived.server.listen(port, '127.0.0.1', r));
  };
  try {
    const info = await ensureAnkiConnect({
      client, config, timeoutMs: 3000, pollMs: 25,
      deps: { platform: 'linux', home: '/h', env: { PATH: '/bin' }, exists: withFiles(['/bin/anki']), spawn },
    });
    assert.equal(info.launched, true);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].command, calls[0].args, calls[0].options.detached], ['/bin/anki', [], true]);
  } finally {
    await wait(10);
    await new Promise((r) => (revived.server ? revived.server.close(r) : r()));
  }
});

const closedPort = async () => {
  const f = new FakeAnki();
  const url = await f.listen();
  await f.close();
  return url;
};

test('ensureAnkiConnect: Anki not installed points to the download page', async () => {
  const url = await closedPort();
  const client = new AnkiClient({ url, timeoutMs: 500 });
  await assert.rejects(
    ensureAnkiConnect({ client, config: loadConfig({ RECALL_COURIER_URL: url }), deps: { platform: 'linux', home: '/h', env: { PATH: '' }, exists: () => false } }),
    (e) => /not appear to be installed/.test(e.message) && e.message.includes('https://apps.ankiweb.net') && e.message.includes('2055492159'),
  );
});

test('ensureAnkiConnect: running Anki without the add-on gets exact install steps', async () => {
  const url = await closedPort();
  const client = new AnkiClient({ url, timeoutMs: 500 });
  const { spawn } = fakeSpawn();
  await assert.rejects(
    ensureAnkiConnect({
      client, config: loadConfig({ RECALL_COURIER_URL: url }), timeoutMs: 150, pollMs: 25,
      deps: { platform: 'linux', home: '/h', env: { PATH: '/bin' }, exists: withFiles(['/bin/anki']), spawn },
    }),
    (e) => /add-on folder was not found/.test(e.message) && /Tools > Add-ons > Get Add-ons/.test(e.message) && e.message.includes('2055492159') && /restart Anki/.test(e.message) && /never installs add-ons/.test(e.message),
  );
});

test('ensureAnkiConnect: add-on installed but silent explains likely causes', async () => {
  const url = await closedPort();
  const client = new AnkiClient({ url, timeoutMs: 500 });
  const { spawn } = fakeSpawn();
  const addon = '/h/.local/share/Anki2/addons21/2055492159';
  await assert.rejects(
    ensureAnkiConnect({
      client, config: loadConfig({ RECALL_COURIER_URL: url }), timeoutMs: 150, pollMs: 25,
      deps: { platform: 'linux', home: '/h', env: { PATH: '/bin' }, exists: withFiles(['/bin/anki', addon]), spawn },
    }),
    (e) => e.message.includes(addon) && /webBindPort/.test(e.message),
  );
});

test('ensureAnkiConnect: launch failure and auto-launch disabled', async () => {
  const url = await closedPort();
  const client = new AnkiClient({ url, timeoutMs: 500 });
  const spawn = () => {
    const child = new EventEmitter();
    child.unref = () => {};
    setImmediate(() => child.emit('error', new Error('spawn ENOENT')));
    return child;
  };
  await assert.rejects(
    ensureAnkiConnect({ client, config: loadConfig({ RECALL_COURIER_URL: url }), deps: { platform: 'linux', home: '/h', env: { PATH: '/bin' }, exists: withFiles(['/bin/anki']), spawn } }),
    /Could not start Anki.*spawn ENOENT.*manually/s,
  );
  await assert.rejects(
    ensureAnkiConnect({ client, config: loadConfig({ RECALL_COURIER_URL: url, RECALL_COURIER_AUTO_LAUNCH: 'false' }) }),
    /automatic launching is turned off/,
  );
  await assert.rejects(
    ensureAnkiConnect({ client, config: loadConfig({ RECALL_COURIER_URL: 'http://example.com' }) }),
    /not this computer/,
  );
});

test('ensureAnkiConnect: permission denied is reported, not retried as "not running"', async () => {
  const env = await makeEnv();
  const original = env.fake.handle.bind(env.fake);
  env.fake.handle = (req) => (req.action === 'requestPermission' ? { result: { permission: 'denied' }, error: null } : original(req));
  try {
    await assert.rejects(ensureAnkiConnect({ client: env.ctx.client, config: env.ctx.config }), /refused this connection.*webCorsOriginList/s);
  } finally {
    await env.close();
  }
});
