import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeEnv } from './helpers.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'rc-transfer-'));

test('anki_status: reachable, with profile and version', async () => {
  const env = await makeEnv();
  try {
    const s = await env.ok('anki_status');
    assert.equal(s.ankiconnect_reachable, true);
    assert.equal(s.anki_running, true);
    assert.equal(s.ankiconnect_version, 6);
    assert.equal(s.active_profile, 'User 1');
    assert.equal(s.api_key_required, false);
    assert.equal(s.ankiconnect_url, env.ctx.config.url);
  } finally {
    await env.close();
  }
});

test('anki_status: not running is a status, not an error, with a next step', async () => {
  const env = await makeEnv();
  const url = env.ctx.config.url;
  await env.close();
  const dead = await makeEnv({ url });
  await dead.fake.close().catch(() => {});
  const s = await dead.ok('anki_status');
  assert.equal(s.ankiconnect_reachable, false);
  assert.equal(s.anki_running, false);
  assert.match(s.next_step, /anki_launch|not installed/);
});

test('anki_status: api key required but missing is explained', async () => {
  const env = await makeEnv({ apiKey: 'secret', clientKey: '' });
  try {
    const s = await env.ok('anki_status');
    assert.equal(s.api_key_required, true);
    assert.match(s.problem, /API key/);
    assert.match(s.problem, /AnkiConnect API key/);
  } finally {
    await env.close();
  }
});

test('anki_launch: no-op when Anki already runs', async () => {
  const env = await makeEnv({ autoLaunch: true });
  try {
    const res = await env.ok('anki_launch');
    assert.equal(res.ready, true);
    assert.equal(res.launched_by_this_call, false);
    assert.equal(res.active_profile, 'User 1');
  } finally {
    await env.close();
  }
});

test('anki_sync: success and failure message', async () => {
  const env = await makeEnv();
  try {
    assert.equal((await env.ok('anki_sync')).synced, true);
    assert.equal(env.fake.syncCount, 1);
    env.fake.syncError = 'AnkiWeb login required';
    await env.fails('anki_sync', {}, /AnkiWeb login required/);
  } finally {
    await env.close();
  }
});

test('anki_list_profiles / anki_switch_profile', async () => {
  const env = await makeEnv();
  try {
    assert.deepEqual(await env.ok('anki_list_profiles'), { profiles: ['User 1', 'Second'], active_profile: 'User 1' });
    assert.deepEqual(await env.ok('anki_switch_profile', { name: 'second' }), { active_profile: 'Second' });
    assert.equal(env.fake.activeProfile, 'Second');
    await env.fails('anki_switch_profile', { name: 'Ghost' }, /does not exist.*User 1, Second/s);
  } finally {
    await env.close();
  }
});

test('export_deck then import_package round trip, with guards', async () => {
  const env = await makeEnv();
  try {
    await env.ok('create_deck', { names: ['Share'] });
    const dir = tmp();
    const file = path.join(dir, 'share.apkg');
    const out = await env.ok('export_deck', { deck: 'share', path: file, include_scheduling: true });
    assert.deepEqual([out.exported, out.deck, out.includes_scheduling], [true, 'Share', true]);
    assert.deepEqual(env.fake.exports[0], { deck: 'Share', path: file, includeSched: true });
    assert.ok(existsSync(file));

    await env.fails('export_deck', { deck: 'Share', path: file }, /already exists at .* will not be overwritten/);
    await env.fails('export_deck', { deck: 'Share', path: 'relative.apkg' }, /absolute path/);
    await env.fails('export_deck', { deck: 'Share', path: path.join(dir, 'x.zip') }, /must end in \.apkg/);
    await env.fails('export_deck', { deck: 'Share', path: path.join(dir, 'nodir', 'x.apkg') }, /folder .* does not exist/);
    await env.fails('export_deck', { deck: 'Ghost', path: path.join(dir, 'g.apkg') }, /does not exist/);

    assert.deepEqual(await env.ok('import_package', { path: file }), { imported: true, file });
    assert.deepEqual(env.fake.imports, [file]);
    const backup = path.join(dir, 'backup.colpkg');
    writeFileSync(backup, 'x');
    await env.fails('import_package', { path: backup }, /replace the whole collection/);
    await env.fails('import_package', { path: path.join(dir, 'notes.txt') }, /not an \.apkg file/);
    await env.fails('import_package', { path: path.join(dir, 'missing.apkg') }, /No file exists/);
    assert.equal(env.fake.imports.length, 1);
  } finally {
    await env.close();
  }
});

test('open_browser_search and open_add_cards_dialog', async () => {
  const env = await makeEnv();
  try {
    await env.ok('create_deck', { names: ['Look'] });
    await env.ok('add_basic_cards', { deck: 'Look', cards: [{ front: 'a', back: 'b' }] });
    const res = await env.ok('open_browser_search', { query: 'deck:Look' });
    assert.deepEqual(res, { opened: true, query: 'deck:Look', matching_cards: 1 });
    assert.deepEqual(env.fake.gui[0], { action: 'guiBrowse', query: 'deck:Look' });

    const dlg = await env.ok('open_add_cards_dialog', { deck: 'look', note_type: 'basic', fields: { front: 'Prefilled \\(a<b\\)' }, tags: ['x'] });
    assert.equal(dlg.deck, 'Look');
    const sent = env.fake.gui[1].note;
    assert.deepEqual(sent.fields, { Front: 'Prefilled \\(a\\lt b\\)', Back: '' });
    assert.deepEqual(sent.tags, ['x']);
    await env.fails('open_add_cards_dialog', { deck: 'Ghost', note_type: 'Basic' }, /does not exist/);
    await env.fails('open_add_cards_dialog', { deck: 'Look', note_type: 'Nope' }, /Available:/);
    await env.fails('open_add_cards_dialog', { deck: 'Look', note_type: 'Basic', fields: { Nope: 'x' } }, /has no field "Nope"/);
  } finally {
    await env.close();
  }
});

test('anki_launch re-checks after Anki has quit instead of trusting an earlier success', async () => {
  const env = await makeEnv({ autoLaunch: true });
  try {
    await env.ok('list_decks'); // marks AnkiConnect as ready
    await env.fake.close(); // Anki quits
    // With no Anki installed in the test environment, a fresh check ends in install guidance, not a stale "unreachable" loop.
    const msg = await env.fails('anki_launch', {}, /not appear to be installed/);
    assert.match(msg, /apps\.ankiweb\.net/);
  } finally {
    // fake already closed
  }
});
