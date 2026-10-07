import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeEnv } from './helpers.js';

async function deckWithCards() {
  const env = await makeEnv();
  await env.ok('create_deck', { names: ['Study'] });
  const res = await env.ok('add_basic_cards', { deck: 'Study', cards: [{ front: 'a', back: '1' }, { front: 'b', back: '2' }, { front: 'c', back: '3' }] });
  const noteIds = res.added.map((x) => x.note_id);
  const cardIds = (await env.ok('find_cards', { query: 'deck:Study' })).card_ids;
  return { env, noteIds, cardIds };
}

test('suspend / unsuspend by card ids and note ids', async () => {
  const { env, noteIds, cardIds } = await deckWithCards();
  try {
    assert.deepEqual(await env.ok('suspend', { card_ids: cardIds.slice(0, 2) }), { cards_targeted: 2, state: 'suspended' });
    assert.equal((await env.ok('find_cards', { query: 'is:suspended' })).total, 2);
    await env.ok('unsuspend', { card_ids: [cardIds[0]] });
    assert.equal((await env.ok('find_cards', { query: 'is:suspended' })).total, 1);
    await env.ok('suspend', { note_ids: [noteIds[2]] });
    assert.equal((await env.ok('find_cards', { query: 'is:suspended' })).total, 2);
    await env.ok('unsuspend', { note_ids: noteIds });
    assert.equal((await env.ok('find_cards', { query: 'is:suspended' })).total, 0);
    await env.fails('suspend', {}, /Provide card_ids or note_ids/);
  } finally {
    await env.close();
  }
});

test('forget_cards needs confirmation and resets state', async () => {
  const { env, cardIds } = await deckWithCards();
  try {
    await env.ok('set_due_date', { card_ids: cardIds, days: '3' });
    assert.equal(env.fake.cards.get(cardIds[0]).type, 2);
    const refused = await env.fails('forget_cards', { card_ids: cardIds, confirm: false }, /confirm was not true/);
    assert.match(refused, /reset 3 card\(s\) to new/);
    assert.equal(env.fake.cards.get(cardIds[0]).type, 2);
    assert.deepEqual(await env.ok('forget_cards', { card_ids: cardIds, confirm: true }), { cards_reset: 3, state: 'new' });
    assert.equal(env.fake.cards.get(cardIds[0]).type, 0);
    await env.fails('forget_cards', { card_ids: cardIds }, /confirm is required/);
  } finally {
    await env.close();
  }
});

test('set_due_date: accepts Anki syntax, rejects nonsense', async () => {
  const { env, cardIds } = await deckWithCards();
  try {
    for (const days of ['0', '3', '3-7', '1!']) {
      assert.deepEqual(await env.ok('set_due_date', { card_ids: [cardIds[0]], days }), { cards_updated: 1, due: days });
    }
    assert.equal(env.fake.cards.get(cardIds[0]).dueDays, '1!');
    await env.fails('set_due_date', { card_ids: cardIds, days: 'tomorrow' }, /invalid format: use e\.g\./);
    await env.fails('set_due_date', { card_ids: cardIds, days: '7-3' }, /runs backwards/);
    await env.fails('set_due_date', { days: '1' }, /Provide card_ids or note_ids/);
  } finally {
    await env.close();
  }
});

test('store_media: data, path, url, collisions, and rejections', async () => {
  const env = await makeEnv();
  try {
    const dir = mkdtempSync(path.join(tmpdir(), 'rc-media-'));
    const file = path.join(dir, 'photo.jpg');
    writeFileSync(file, 'fake jpeg');
    const res = await env.ok('store_media', {
      files: [
        { filename: 'note.png', data_base64: 'aGVsbG8=' },
        { path: file },
        { filename: 'clip.mp3', url: 'https://example.com/clip.mp3' },
        { filename: 'note.png', data_base64: 'aGVsbG8=' },
        { filename: 'x.png', url: 'http://example.com/x.png' },
        { filename: 'bad.png', url: 'https://example.com/fail.png' },
        { filename: 'x.exe', data_base64: 'aGk=' },
      ],
    });
    assert.equal(res.requested, 7);
    assert.equal(res.stored_count, 4);
    assert.equal(res.failed_count, 3);
    assert.equal(res.results[0].html, '<img src="note.png">');
    assert.equal(res.results[1].stored_as, 'photo.jpg');
    assert.equal(res.results[2].html, '[sound:clip.mp3]');
    assert.equal(res.results[3].stored_as, 'note_1.png', 'existing file is not overwritten');
    assert.match(res.results[4].error, /https/);
    assert.match(res.results[5].error, /Unable to download/);
    assert.match(res.results[6].error, /image, audio or video/);
    assert.ok(env.fake.log.filter((l) => l.action === 'storeMediaFile').every((l) => l.params.deleteExisting === false));
    await env.fails('store_media', { files: [] }, /at least 1 item/);
  } finally {
    await env.close();
  }
});

test('list_media: pattern and limit', async () => {
  const env = await makeEnv();
  try {
    await env.ok('store_media', { files: ['a.png', 'b.png', 'c.mp3'].map((filename) => ({ filename, data_base64: 'aGk=' })) });
    assert.deepEqual((await env.ok('list_media')).files.sort(), ['a.png', 'b.png', 'c.mp3']);
    const png = await env.ok('list_media', { pattern: '*.png', limit: 1 });
    assert.equal(png.total, 2);
    assert.equal(png.files.length, 1);
    assert.equal((await env.ok('list_media', { pattern: 'zzz*' })).total, 0);
  } finally {
    await env.close();
  }
});

test('deck_stats: totals, states, due counts, leeches', async () => {
  const { env, noteIds, cardIds } = await deckWithCards();
  try {
    await env.ok('suspend', { card_ids: [cardIds[0]] });
    await env.ok('add_tags', { note_ids: [noteIds[1]], tags: ['leech'] });
    env.fake.cards.get(cardIds[2]).type = 2;
    env.fake.cards.get(cardIds[2]).queue = 2;
    env.fake.cards.get(cardIds[2]).interval = 30;
    env.fake.cards.get(cardIds[2]).due = 0;
    const res = await env.ok('deck_stats', { decks: ['study'] });
    const s = res.decks[0];
    assert.equal(s.deck, 'Study');
    assert.equal(s.total_cards, 3);
    assert.equal(s.new_cards, 2);
    assert.equal(s.review_cards, 1);
    assert.equal(s.suspended_cards, 1);
    assert.equal(s.mature_cards, 1);
    assert.equal(s.leeches_cards, 1);
    assert.deepEqual(s.due_today, { new: 1, learning: 0, review: 1 });
    await env.fails('deck_stats', { decks: ['Ghost'] }, /does not exist/);
  } finally {
    await env.close();
  }
});

test('cards_reviewed_today and get_card_reviews', async () => {
  const { env, cardIds } = await deckWithCards();
  try {
    const now = Date.now();
    env.fake.reviews.push(
      { id: now - 1000, cardId: cardIds[0], ease: 3, ivl: 4, lastIvl: 1, factor: 2500, time: 6200, type: 1 },
      { id: now - 2000, cardId: cardIds[1], ease: 1, ivl: -60, lastIvl: -60, factor: 0, time: 4800, type: 0 },
      { id: now - 3 * 86400000, cardId: cardIds[0], ease: 4, ivl: 1, lastIvl: 0, factor: 2500, time: 3000, type: 0 },
    );
    assert.deepEqual(await env.ok('cards_reviewed_today'), { reviewed_today: 2 });
    const days = await env.ok('cards_reviewed_today', { days: 2 });
    assert.equal(days.per_day.length, 2);
    assert.equal(days.per_day[0].reviewed, 2);

    const byCard = await env.ok('get_card_reviews', { card_ids: [cardIds[0]] });
    assert.equal(byCard.review_count, 2);
    assert.equal(byCard.reviews[0].rating, 3);
    assert.equal(byCard.reviews[0].type, 'review');
    assert.equal(byCard.reviews[0].ease_percent, 250);
    assert.equal(byCard.reviews[0].seconds_taken, 6.2);

    const byDeck = await env.ok('get_card_reviews', { deck: 'study', since_days: 1 });
    assert.equal(byDeck.deck, 'Study');
    assert.equal(byDeck.review_count, 2);
    assert.equal(byDeck.reviews[1].type, 'learn');
    await env.fails('get_card_reviews', {}, /Provide card_ids, or a deck/);
    await env.fails('get_card_reviews', { deck: 'Ghost' }, /does not exist/);
  } finally {
    await env.close();
  }
});
