// A full day-to-day lifecycle, driven through the real MCP server over stdio.
// Used by e2e.mjs (real Anki) and e2e-fake.test.js (fake AnkiConnect, so this script is itself tested).
// Safety: it only creates, edits and deletes things inside decks named "zz-plugin-test*", and it
// verifies afterwards that no other deck changed.
import assert from 'node:assert/strict';

export const TEST_DECK = 'zz-plugin-test';

export async function runScenario(client, log = () => {}) {
  const call = async (name, args = {}) => {
    const res = await client.call(name, args);
    let data = res.text;
    try {
      data = JSON.parse(res.text);
    } catch {
      // plain text error
    }
    return { isError: res.isError, data };
  };
  const ok = async (name, args = {}) => {
    const res = await call(name, args);
    assert.equal(res.isError, false, `${name} failed: ${typeof res.data === 'string' ? res.data : JSON.stringify(res.data)}`);
    log(`ok   ${name}`);
    return res.data;
  };
  const refuses = async (name, args, pattern) => {
    const res = await call(name, args);
    assert.equal(res.isError, true, `${name} should have been refused`);
    assert.match(String(res.data), pattern);
    log(`ok   ${name} refused as expected`);
  };

  await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });

  const status = await ok('anki_status');
  assert.equal(status.ankiconnect_reachable, true);

  const before = await ok('list_decks');
  assert.ok(!before.decks.some((d) => d.name === TEST_DECK || d.name.startsWith(`${TEST_DECK}::`)), `a deck named ${TEST_DECK} already exists; refusing to touch it. Rename or delete it and retry.`);
  const snapshot = (decks) => JSON.stringify(decks.filter((d) => !d.name.toLowerCase().startsWith('zz-plugin-test')).map((d) => [d.name, d.id, d.total_cards]));
  const baseline = snapshot(before.decks);
  const noteTypes = await ok('list_note_types');
  const typeNames = noteTypes.note_types.map((t) => t.name);
  assert.ok(typeNames.length > 0);

  let cleanup = async () => {};
  try {
    cleanup = async () => {
      const leftovers = (await call('list_decks', { name_contains: TEST_DECK })).data;
      const names = (leftovers.decks ?? []).map((d) => d.name).filter((n) => n.toLowerCase().startsWith('zz-plugin-test'));
      const top = names.filter((n) => !names.some((o) => o !== n && n.startsWith(`${o}::`)));
      if (top.length) await call('delete_deck', { names: top, confirm: true });
    };

    // decks
    const created = await ok('create_deck', { names: [`${TEST_DECK}::Sub`] });
    assert.deepEqual(created.created, [`${TEST_DECK}::Sub`]);

    // add basic, cloze and MathJax cards (including a raw < and >)
    const basic = await ok('add_basic_cards', { deck: TEST_DECK, tags: ['zz-e2e'], cards: [{ front: 'zz e2e capital of France', back: 'Paris' }, { front: 'zz e2e capital of Spain', back: 'Madrid' }] });
    assert.equal(basic.added_count, 2);
    const cloze = await ok('add_cloze_cards', { deck: TEST_DECK, tags: ['zz-e2e'], cards: [{ text: 'zz e2e water is {{c1::H2O}}', extra: 'chemistry' }] });
    assert.equal(cloze.added_count, 1);
    const math = await ok('add_notes', {
      deck: `${TEST_DECK}::Sub`, note_type: 'Basic', tags: ['zz-e2e'],
      notes: [{ fields: { Front: 'zz e2e when is \\(a<b\\)?', Back: 'when \\(b-a>0\\)' } }],
    });
    assert.equal(math.added_count, 1);
    assert.ok(math.warnings?.length >= 1, 'math rewrite should be reported');
    const dup = await ok('add_basic_cards', { deck: TEST_DECK, cards: [{ front: 'zz e2e capital of France', back: 'Paris' }] });
    assert.equal(dup.duplicate_count, 1, 'duplicate is skipped');

    // find, read
    const found = await ok('find_notes', { query: `deck:"${TEST_DECK}"` });
    assert.equal(found.total, 4);
    const got = await ok('get_notes', { note_ids: found.note_ids });
    const mathNote = got.notes.find((n) => (n.fields.Front ?? '').includes('when is'));
    assert.ok(mathNote.fields.Front.includes('\\lt') && !mathNote.fields.Front.includes('<b'), `math stored as ${mathNote.fields.Front}`);
    const spain = got.notes.find((n) => (n.fields.Front ?? '').includes('Spain'));

    // edit, tag, move, suspend
    const upd = await ok('update_note_fields', { updates: [{ note_id: spain.note_id, fields: { Back: 'Madrid (Spain)' } }] });
    assert.equal(upd.updated_count, 1);
    await ok('add_tags', { note_ids: [spain.note_id], tags: ['zz-extra'] });
    await ok('replace_tags', { note_ids: [spain.note_id], tag_to_replace: 'zz-extra', replace_with: 'zz-renamed' });
    await ok('remove_tags', { note_ids: [spain.note_id], tags: ['zz-e2e'] });
    const reread = (await ok('get_notes', { note_ids: [spain.note_id] })).notes[0];
    assert.equal(reread.fields.Back, 'Madrid (Spain)');
    assert.ok(reread.tags.includes('zz-renamed') && !reread.tags.includes('zz-e2e'));
    await ok('change_deck', { note_ids: [spain.note_id], deck: `${TEST_DECK}::Sub` });
    assert.equal((await ok('find_cards', { query: `deck:"${TEST_DECK}::Sub"` })).total, 2);
    await ok('suspend', { note_ids: [spain.note_id] });
    assert.equal((await ok('find_cards', { query: `deck:"${TEST_DECK}" is:suspended` })).total, 1);
    await ok('unsuspend', { note_ids: [spain.note_id] });
    assert.equal((await ok('find_cards', { query: `deck:"${TEST_DECK}" is:suspended` })).total, 0);
    const stats = await ok('deck_stats', { decks: [TEST_DECK] });
    assert.equal(stats.decks[0].total_cards, 4); // 2 basic + 1 cloze + 1 math (sub-deck included)
    await ok('get_deck_config', { deck: TEST_DECK });

    // rename (cards must follow), then confirm-gated deletes
    const renamed = await ok('rename_deck', { name: TEST_DECK, new_name: `${TEST_DECK}-renamed` });
    assert.equal(renamed.decks_renamed, 2);
    assert.equal((await ok('find_notes', { query: `deck:"${TEST_DECK}-renamed"` })).total, 4);
    await refuses('delete_notes', { note_ids: [spain.note_id], confirm: false }, /confirm was not true/);
    await ok('delete_notes', { note_ids: [spain.note_id], confirm: true });
    assert.equal((await ok('find_notes', { query: `deck:"${TEST_DECK}-renamed"` })).total, 3);
    await refuses('delete_deck', { names: [`${TEST_DECK}-renamed`], confirm: false }, /confirm was not true/);
    const gone = await ok('delete_deck', { names: [`${TEST_DECK}-renamed`], confirm: true });
    assert.equal(gone.cards_also_deleted, true);
  } finally {
    await cleanup();
  }

  const after = await ok('list_decks');
  assert.equal(snapshot(after.decks), baseline, 'other decks must be untouched');
  assert.ok(!after.decks.some((d) => d.name.toLowerCase().startsWith('zz-plugin-test')), 'test decks removed');
  log('all steps passed; other decks unchanged');
}
