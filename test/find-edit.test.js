import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.js';

async function library() {
  const env = await makeEnv();
  await env.ok('create_deck', { names: ['Spanish::Verbs', 'Math', 'Archive'] });
  const verbs = await env.ok('add_basic_cards', {
    deck: 'Spanish::Verbs', tags: ['verb'],
    cards: [{ front: 'hablar', back: 'to speak' }, { front: 'comer', back: 'to eat', tags: ['food'] }, { front: 'beber', back: 'to drink', tags: ['food'] }],
  });
  const math = await env.ok('add_basic_cards', { deck: 'Math', cards: [{ front: 'Pythagoras', back: '\\(a^2+b^2=c^2\\)' }] });
  return { env, verbIds: verbs.added.map((a) => a.note_id), mathId: math.added[0].note_id };
}

test('find_notes: queries, limit, totals, details', async () => {
  const { env } = await library();
  try {
    assert.equal((await env.ok('find_notes', { query: 'deck:Spanish' })).total, 3);
    assert.equal((await env.ok('find_notes', { query: 'deck:"Spanish::Verbs" tag:food' })).total, 2);
    assert.equal((await env.ok('find_notes', { query: 'deck:Spanish -tag:food' })).total, 1);
    assert.equal((await env.ok('find_notes', { query: 'tag:food or deck:Math' })).total, 3);
    assert.equal((await env.ok('find_notes', { query: 'front:com*' })).total, 1);
    assert.equal((await env.ok('find_notes', { query: 'speak' })).total, 1);
    assert.equal((await env.ok('find_notes', { query: 'nonexistent-word' })).total, 0);
    const limited = await env.ok('find_notes', { query: 'deck:*', limit: 2 });
    assert.equal(limited.total, 4);
    assert.equal(limited.returned, 2);
    assert.equal(limited.note_ids.length, 2);
    const detailed = await env.ok('find_notes', { query: 'tag:verb', details: true });
    assert.equal(detailed.notes.length, 3);
    assert.deepEqual(Object.keys(detailed.notes[0].fields), ['Front', 'Back']);
    await env.fails('find_notes', { query: '' }, /must not be empty/);
    await env.fails('find_notes', { query: 'x', limit: 99999 }, /at most 5000/);
  } finally {
    await env.close();
  }
});

test('find_cards: ids, details, states', async () => {
  const { env, verbIds } = await library();
  try {
    const cards = await env.ok('find_cards', { query: 'deck:Spanish', details: true });
    assert.equal(cards.total, 3);
    assert.equal(cards.cards[0].state, 'new');
    assert.equal(cards.cards[0].deck, 'Spanish::Verbs');
    assert.equal(cards.cards[0].suspended, false);
    await env.ok('suspend', { note_ids: [verbIds[0]] });
    assert.equal((await env.ok('find_cards', { query: 'is:suspended' })).total, 1);
    assert.equal((await env.ok('find_cards', { query: 'deck:Spanish -is:suspended' })).total, 2);
  } finally {
    await env.close();
  }
});

test('get_notes: fields, tags, cards and decks; missing ids reported', async () => {
  const { env, verbIds } = await library();
  try {
    const res = await env.ok('get_notes', { note_ids: [verbIds[1], 999] });
    assert.equal(res.note_count, 1);
    assert.deepEqual(res.not_found, [999]);
    const n = res.notes[0];
    assert.equal(n.note_type, 'Basic');
    assert.deepEqual(n.fields, { Front: 'comer', Back: 'to eat' });
    assert.deepEqual(n.tags, ['verb', 'food']);
    assert.deepEqual(n.decks, ['Spanish::Verbs']);
    assert.equal(n.cards.length, 1);
    await env.fails('get_notes', { note_ids: Array.from({ length: 101 }, (_, i) => i + 1) }, /maximum per call is 100/);
  } finally {
    await env.close();
  }
});

test('update_note_fields: success, partial failures, math escaping', async () => {
  const { env, verbIds } = await library();
  try {
    const res = await env.ok('update_note_fields', {
      updates: [
        { note_id: verbIds[0], fields: { back: 'to talk' } },
        { note_id: verbIds[1], fields: { Nope: 'x' } },
        { note_id: 12345, fields: { Back: 'y' } },
        { note_id: verbIds[2], fields: { Back: 'if \\(x<3\\)' } },
      ],
    });
    assert.equal(res.updated_count, 2);
    assert.equal(res.failed_count, 2);
    const byId = Object.fromEntries(res.results.map((r) => [r.note_id, r]));
    assert.deepEqual(byId[verbIds[0]].changed, ['Back']);
    assert.match(byId[verbIds[1]].error, /no field "Nope"/);
    assert.match(byId[12345].error, /does not exist/);
    assert.equal(env.fake.noteByFirstField('hablar').fields.Back, 'to talk');
    assert.equal(env.fake.noteByFirstField('beber').fields.Back, 'if \\(x\\lt 3\\)');
    assert.match(res.warnings[0], /\\lt and \\gt/);
    assert.equal(env.fake.noteByFirstField('comer').fields.Back, 'to eat'); // untouched
  } finally {
    await env.close();
  }
});

test('add_tags / remove_tags / replace_tags', async () => {
  const { env, verbIds, mathId } = await library();
  try {
    const added = await env.ok('add_tags', { note_ids: [...verbIds, 424242], tags: ['review', 'week 1'] });
    assert.equal(added.notes_updated, 3);
    assert.deepEqual(added.not_found, [424242]);
    assert.deepEqual(added.tags, ['review', 'week_1']);
    assert.match(added.warnings[0], /contained spaces/);
    assert.ok(env.fake.noteByFirstField('hablar').tags.includes('week_1'));

    const removed = await env.ok('remove_tags', { note_ids: verbIds, tags: ['review'] });
    assert.equal(removed.notes_updated, 3);
    assert.ok(!env.fake.noteByFirstField('hablar').tags.includes('review'));
    assert.equal(env.fake.notes.size, 4); // removing tags never deletes notes

    const replaced = await env.ok('replace_tags', { note_ids: [...verbIds, mathId], tag_to_replace: 'food', replace_with: 'cuisine' });
    assert.equal(replaced.notes_changed, 2);
    assert.equal(replaced.notes_without_tag, 2);
    assert.ok(env.fake.noteByFirstField('comer').tags.includes('cuisine'));
    await env.fails('replace_tags', { note_ids: verbIds, tag_to_replace: 'a b', replace_with: 'c' }, /cannot contain spaces/);
    await env.fails('add_tags', { note_ids: verbIds, tags: [] }, /at least 1 item/);
  } finally {
    await env.close();
  }
});

test('change_deck: by cards and by notes, missing deck suggestions, create flag', async () => {
  const { env, verbIds, mathId } = await library();
  try {
    const noteMove = await env.ok('change_deck', { note_ids: [verbIds[0]], deck: 'archive' });
    assert.deepEqual(noteMove, { moved_cards: 1, deck: 'Archive', deck_created: false });
    const cardIds = (await env.ok('find_cards', { query: 'deck:Math' })).card_ids;
    await env.ok('change_deck', { card_ids: cardIds, deck: 'Archive' });
    assert.equal(env.fake.cardsOfDeck('Archive').length, 2);
    const msg = await env.fails('change_deck', { note_ids: [mathId], deck: 'Archiv' }, /does not exist/);
    assert.match(msg, /Similar decks: Archive/);
    assert.ok(!env.fake.decks.has('Archiv'), 'typo did not create a deck');
    const created = await env.ok('change_deck', { note_ids: [mathId], deck: 'Brand New', create_deck_if_missing: true });
    assert.equal(created.deck_created, true);
    await env.fails('change_deck', { deck: 'Archive' }, /Provide card_ids or note_ids/);
    await env.fails('change_deck', { note_ids: [777], deck: 'Archive' }, /Note 777 does not exist/);
  } finally {
    await env.close();
  }
});

test('delete_notes: confirmation gate, preview, partial ids', async () => {
  const { env, verbIds } = await library();
  try {
    const refused = await env.fails('delete_notes', { note_ids: verbIds, confirm: false }, /confirm was not true/);
    assert.match(refused, /permanently delete 3 note\(s\) and 3 card\(s\)/);
    assert.match(refused, /"hablar"/);
    assert.equal(env.fake.notes.size, 4);
    await env.fails('delete_notes', { note_ids: verbIds }, /confirm is required/);
    await env.fails('delete_notes', { note_ids: [1, 2], confirm: true }, /None of the 2 note IDs exist/);
    const done = await env.ok('delete_notes', { note_ids: [verbIds[0], verbIds[1], 31337], confirm: true });
    assert.deepEqual(done, { deleted_notes: 2, deleted_cards: 2, not_found: [31337] });
    assert.equal(env.fake.notes.size, 2);
  } finally {
    await env.close();
  }
});
