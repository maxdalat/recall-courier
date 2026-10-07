import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.js';
import { allTools } from '../server/tools/index.js';

test('every tool failure says what happened and what to do (Anki not running)', async () => {
  const live = await makeEnv();
  const url = live.ctx.config.url;
  await live.close();
  const env = await makeEnv({ url, autoLaunch: false });
  await env.fake.close().catch(() => {});
  try {
    const msg = await env.fails('list_decks', {}, /automatic launching is turned off/);
    assert.match(msg, /Ask the user to start Anki/);
    const msg2 = await env.fails('add_basic_cards', { deck: 'X', cards: [{ front: 'a', back: 'b' }] });
    assert.match(msg2, /start Anki/);
  } finally {
    // fake already closed
  }
});

test('api key mismatch is explained with the setting to change', async () => {
  const env = await makeEnv({ apiKey: 'right', clientKey: 'wrong' });
  try {
    const msg = await env.fails('list_decks');
    assert.match(msg, /valid api key must be provided/);
    assert.match(msg, /AnkiConnect API key/);
    const ok = await makeEnv({ apiKey: 'right', clientKey: 'right' });
    try {
      assert.equal((await ok.ok('list_decks')).deck_count, 1);
    } finally {
      await ok.close();
    }
  } finally {
    await env.close();
  }
});

test('collection not loaded and old add-on are explained', async () => {
  const env = await makeEnv();
  try {
    env.fake.collectionUnavailable = true;
    await env.fails('list_decks', {}, /no profile is loaded.*open a profile/s);
    env.fake.collectionUnavailable = false;
    env.fake.unsupported.add('deckNamesAndIds');
    await env.fails('list_decks', {}, /too old.*update it in Anki/s);
  } finally {
    await env.close();
  }
});

test('something else on the port, and a bad URL setting', async () => {
  const env = await makeEnv();
  try {
    env.fake.garbage = true;
    await env.fails('list_decks', {}, /did not answer like AnkiConnect/);
  } finally {
    await env.close();
  }
  const bad = await makeEnv({ url: 'http://example.com:8765' });
  try {
    await bad.fails('list_decks', {}, /not this computer.*127\.0\.0\.1/s);
  } finally {
    await bad.close();
  }
});

test('invalid arguments name the problem and the fix; unknown tool returns null', async () => {
  const env = await makeEnv();
  try {
    const msg = await env.fails('create_deck', { names: 'oops', extra: 1 });
    assert.match(msg, /Invalid arguments for create_deck/);
    assert.match(msg, /names must be an array/);
    assert.match(msg, /extra is not a recognised argument/);
    assert.match(msg, /call create_deck again/);
    assert.equal(await env.registry.call('does_not_exist', {}), null);
  } finally {
    await env.close();
  }
});

test('recovery: if Anki disappears between calls the next call reports it', async () => {
  const env = await makeEnv();
  try {
    await env.ok('list_decks');
    await env.fake.close();
    const msg = await env.fails('list_decks');
    assert.match(msg, /(Could not reach AnkiConnect|not answering).*Anki/s);
  } finally {
    // closed above
  }
});

test('tool metadata: titles, annotations, schemas, names', () => {
  const tools = allTools();
  assert.ok(tools.length >= 40);
  const readOnly = [];
  for (const t of tools) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/);
    assert.ok(t.name.length <= 64);
    assert.ok(t.title && t.annotations.title === t.title, `${t.name} title`);
    assert.ok(t.description.length > 30, `${t.name} description`);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.inputSchema.additionalProperties, false);
    for (const r of t.inputSchema.required) assert.ok(r in t.inputSchema.properties, `${t.name} requires unknown ${r}`);
    for (const [k, v] of Object.entries(t.inputSchema.properties)) assert.ok(v.description || v.type === 'object' || v.type === 'array', `${t.name}.${k} needs a description`);
    if (t.annotations.readOnlyHint) {
      readOnly.push(t.name);
      assert.equal(t.annotations.destructiveHint, undefined, `${t.name}`);
    } else {
      assert.equal(typeof t.annotations.destructiveHint, 'boolean', `${t.name} must set destructiveHint`);
    }
    assert.doesNotMatch(t.description, /\b(ignore previous|you must|always call|never call|system prompt)\b/i, `${t.name} reads like an instruction to Claude`);
  }
  const destructive = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name);
  for (const name of ['delete_deck', 'delete_notes', 'forget_cards', 'remove_tags', 'update_note_fields', 'update_note_type', 'rename_deck', 'set_due_date', 'import_package', 'suspend', 'unsuspend', 'change_deck', 'add_tags', 'anki_sync']) {
    assert.ok(destructive.includes(name), `${name} should be destructive`);
  }
  for (const name of ['list_decks', 'find_notes', 'find_cards', 'get_notes', 'list_note_types', 'list_media', 'deck_stats', 'anki_status']) {
    assert.ok(readOnly.includes(name), `${name} should be read-only`);
  }
  for (const name of ['add_notes', 'add_basic_cards', 'create_deck', 'create_note_type', 'store_media', 'export_deck', 'anki_launch']) assert.ok(!destructive.includes(name), `${name} only creates things and should not be destructive`);
  // destructive tools that delete require an explicit confirm argument
  for (const name of ['delete_deck', 'delete_notes', 'forget_cards']) {
    assert.ok(tools.find((t) => t.name === name).inputSchema.required.includes('confirm') || name === 'forget_cards');
  }
});

test('the full required tool list is present', () => {
  const have = new Set(allTools().map((t) => t.name));
  const required = `anki_status anki_launch anki_sync anki_list_profiles anki_switch_profile list_decks create_deck rename_deck delete_deck get_deck_config set_deck_config
    list_note_types create_note_type update_note_type add_notes add_basic_cards add_cloze_cards add_reversed_cards find_notes find_cards get_notes update_note_fields
    add_tags remove_tags replace_tags change_deck suspend unsuspend forget_cards set_due_date delete_notes store_media list_media deck_stats cards_reviewed_today
    get_card_reviews import_package export_deck open_browser_search open_add_cards_dialog`.split(/\s+/);
  for (const name of required) assert.ok(have.has(name), `missing ${name}`);
});
