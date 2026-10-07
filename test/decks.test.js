import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.js';

async function seeded() {
  const env = await makeEnv();
  await env.ok('create_deck', { names: ['Spanish::Verbs', 'Spanish::Nouns', 'French'] });
  await env.ok('add_basic_cards', { deck: 'Spanish::Verbs', cards: [{ front: 'hablar', back: 'to speak' }, { front: 'comer', back: 'to eat' }] });
  await env.ok('add_basic_cards', { deck: 'Spanish::Nouns', cards: [{ front: 'casa', back: 'house' }] });
  await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'hola', back: 'hello' }] });
  return env;
}

test('list_decks: counts, nesting, filter', async () => {
  const env = await seeded();
  try {
    const all = await env.ok('list_decks');
    const byName = Object.fromEntries(all.decks.map((d) => [d.name, d]));
    assert.deepEqual(Object.keys(byName).sort(), ['Default', 'French', 'Spanish', 'Spanish::Nouns', 'Spanish::Verbs']);
    assert.equal(byName['Spanish::Verbs'].total_cards, 2);
    assert.equal(byName['Spanish::Verbs'].new_due, 2);
    assert.equal(byName.Spanish.total_cards, 4); // includes sub-decks
    assert.equal(byName.French.total_cards, 0);
    assert.equal(typeof byName.French.id, 'number');
    const filtered = await env.ok('list_decks', { name_contains: 'span' });
    assert.deepEqual(filtered.decks.map((d) => d.name), ['Spanish', 'Spanish::Nouns', 'Spanish::Verbs']);
  } finally {
    await env.close();
  }
});

test('create_deck: nested, existing, invalid', async () => {
  const env = await makeEnv();
  try {
    const res = await env.ok('create_deck', { names: ['A::B::C', 'default', 'Bad::', 'A::B::C'] });
    assert.deepEqual(res.created, ['A::B::C']);
    assert.deepEqual(res.already_existed, ['Default']);
    assert.equal(res.failed[0].name, 'Bad::');
    assert.match(res.failed[0].error, /cannot start or end with/);
    const names = (await env.ok('list_decks')).decks.map((d) => d.name);
    assert.ok(names.includes('A') && names.includes('A::B') && names.includes('A::B::C'));
    await env.fails('create_deck', { names: [] }, /at least 1 item/);
  } finally {
    await env.close();
  }
});

test('rename_deck: moves cards and sub-decks, keeps options, removes old decks', async () => {
  const env = await seeded();
  try {
    env.fake.decks.get('Spanish::Verbs').configId = 1;
    const res = await env.ok('rename_deck', { name: 'spanish', new_name: 'Languages::Spanish' });
    assert.deepEqual(res.renamed, { from: 'Spanish', to: 'Languages::Spanish' });
    assert.equal(res.decks_renamed, 3);
    assert.equal(res.cards_moved, 4);
    const names = (await env.ok('list_decks')).decks.map((d) => d.name);
    assert.ok(!names.includes('Spanish') && !names.includes('Spanish::Verbs'));
    for (const n of ['Languages', 'Languages::Spanish', 'Languages::Spanish::Verbs', 'Languages::Spanish::Nouns']) assert.ok(names.includes(n), n);
    assert.equal(env.fake.cardsOfDeck('Languages::Spanish').length, 4);
    assert.equal(env.fake.cardsOfDeck('Languages::Spanish::Verbs').length, 2);
    assert.equal(env.fake.notes.size, 4); // nothing lost
  } finally {
    await env.close();
  }
});

test('rename_deck: refuses unsafe renames', async () => {
  const env = await seeded();
  try {
    await env.fails('rename_deck', { name: 'Nope', new_name: 'X' }, /does not exist/);
    await env.fails('rename_deck', { name: 'Default', new_name: 'X' }, /Default deck cannot be renamed/);
    await env.fails('rename_deck', { name: 'French', new_name: 'spanish' }, /already exists.*nothing was renamed/s);
    await env.fails('rename_deck', { name: 'French', new_name: 'French::Sub' }, /inside itself/);
    env.fake.decks.get('French').dyn = true;
    await env.fails('rename_deck', { name: 'French', new_name: 'Francais' }, /filtered deck/);
    assert.ok(env.fake.decks.has('French'));
  } finally {
    await env.close();
  }
});

test('rename_deck: if the move fails nothing is deleted', async () => {
  const env = await seeded();
  try {
    env.fake.failures.changeDeck = 'disk is full';
    const msg = await env.fails('rename_deck', { name: 'Spanish::Verbs', new_name: 'Spanish::Verbos' }, /disk is full/);
    assert.match(msg, /Anki rejected the "changeDeck"/);
    assert.equal(env.fake.cardsOfDeck('Spanish::Verbs').length, 2);
    assert.ok(env.fake.decks.has('Spanish::Verbs'));
  } finally {
    await env.close();
  }
});

test('delete_deck: needs confirm, says cards go too, deletes sub-decks', async () => {
  const env = await seeded();
  try {
    const refused = await env.fails('delete_deck', { names: ['Spanish'], confirm: false }, /confirm was not true/);
    assert.match(refused, /permanently remove 1 deck\(s\) and 4 card\(s\)/);
    assert.match(refused, /sub-decks: Spanish::Verbs, Spanish::Nouns/);
    assert.equal(env.fake.notes.size, 4);
    assert.ok(env.fake.decks.has('Spanish'));

    const done = await env.ok('delete_deck', { names: ['spanish', 'French'], confirm: true });
    assert.equal(done.cards_also_deleted, true);
    assert.equal(done.cards_deleted, 4);
    assert.deepEqual([...env.fake.decks.keys()], ['Default']);
    assert.equal(env.fake.notes.size, 0);
  } finally {
    await env.close();
  }
});

test('delete_deck: guards', async () => {
  const env = await seeded();
  try {
    await env.fails('delete_deck', { names: ['Default'], confirm: true }, /Default deck cannot be deleted/);
    await env.fails('delete_deck', { names: ['Ghost'], confirm: true }, /does not exist, so nothing was deleted/);
    await env.fails('delete_deck', { names: ['French'] }, /confirm is required/);
    assert.ok(env.fake.decks.has('French'));
  } finally {
    await env.close();
  }
});

test('get_deck_config / set_deck_config', async () => {
  const env = await seeded();
  try {
    const cfg = await env.ok('get_deck_config', { deck: 'French' });
    assert.equal(cfg.new_cards_per_day, 20);
    assert.equal(cfg.max_reviews_per_day, 200);
    assert.deepEqual(cfg.learning_steps_minutes, [1, 10]);
    assert.equal(cfg.starting_ease_percent, 250);
    assert.equal(cfg.raw.id, 1);

    const res = await env.ok('set_deck_config', {
      deck: 'French', new_cards_per_day: 5, max_reviews_per_day: 50, starting_ease_percent: 230, graduating_interval_days: 2,
      learning_steps_minutes: [2, 15], advanced: { rev: { ease4: 1.5 } },
    });
    assert.equal(res.before.new_cards_per_day, 20);
    assert.equal(res.after.new_cards_per_day, 5);
    assert.equal(res.after.starting_ease_percent, 230);
    assert.equal(res.applies_to_all_decks_using_group, true);
    const saved = env.fake.configs.get(1);
    assert.equal(saved.rev.ease4, 1.5);
    assert.equal(saved.rev.fuzz, 0.05); // deep merge kept siblings
    assert.deepEqual(saved.new.ints, [2, 4, 7]);
    assert.deepEqual(saved.new.delays, [2, 15]);

    await env.fails('set_deck_config', { deck: 'French' }, /No option was provided/);
    await env.fails('set_deck_config', { deck: 'French', advanced: { id: 9 } }, /cannot change the options group id/);
    await env.fails('set_deck_config', { deck: 'French', new_cards_per_day: -1 }, /at least 0/);
    await env.fails('get_deck_config', { deck: 'Ghost' }, /does not exist/);
    env.fake.decks.get('French').dyn = true;
    await env.fails('get_deck_config', { deck: 'French' }, /filtered deck/);
  } finally {
    await env.close();
  }
});
