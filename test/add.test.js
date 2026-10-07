import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.js';

async function withDeck(name = 'Spanish') {
  const env = await makeEnv();
  await env.ok('create_deck', { names: [name] });
  return env;
}

test('add_notes: batch with defaults, per-note overrides and tags', async () => {
  const env = await withDeck();
  try {
    await env.ok('create_deck', { names: ['French'] });
    const res = await env.ok('add_notes', {
      deck: 'Spanish', note_type: 'Basic', tags: ['batch1'],
      notes: [
        { fields: { Front: 'perro', Back: 'dog' }, tags: ['animals'] },
        { fields: { Front: 'chat', Back: 'cat' }, deck: 'French' },
        { fields: { Text: 'The {{c1::sun}} is a star' }, note_type: 'Cloze' },
      ],
    });
    assert.equal(res.requested, 3);
    assert.equal(res.added_count, 3);
    assert.equal(res.failed_count, 0);
    assert.deepEqual(res.added.map((a) => a.deck), ['Spanish', 'French', 'Spanish']);
    assert.ok(res.added.every((a) => Number.isInteger(a.note_id)));
    assert.deepEqual(env.fake.noteByFirstField('perro').tags, ['batch1', 'animals']);
    assert.equal(env.fake.cardsOfDeck('French').length, 1);
  } finally {
    await env.close();
  }
});

test('add_notes: duplicates are skipped and reported; allow_duplicates overrides', async () => {
  const env = await withDeck();
  try {
    const first = await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'gato', back: 'cat' }] });
    assert.equal(first.added_count, 1);
    const again = await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'gato', back: 'cat' }, { front: 'pez', back: 'fish' }] });
    assert.equal(again.added_count, 1);
    assert.equal(again.duplicate_count, 1);
    assert.deepEqual(again.skipped_duplicates, [{ index: 0, first_field: 'gato' }]);
    assert.equal(again.failed_count, 0);
    assert.equal(env.fake.notes.size, 2);

    const forced = await env.ok('add_basic_cards', { deck: 'Spanish', allow_duplicates: true, cards: [{ front: 'gato', back: 'cat' }] });
    assert.equal(forced.added_count, 1);
    assert.equal(env.fake.notes.size, 3);
  } finally {
    await env.close();
  }
});

test('add_notes: duplicate_scope deck vs collection', async () => {
  const env = await withDeck('A');
  try {
    await env.ok('create_deck', { names: ['B'] });
    await env.ok('add_basic_cards', { deck: 'A', cards: [{ front: 'same', back: '1' }] });
    const collection = await env.ok('add_basic_cards', { deck: 'B', cards: [{ front: 'same', back: '2' }] });
    assert.equal(collection.duplicate_count, 1);
    const deckScope = await env.ok('add_basic_cards', { deck: 'B', duplicate_scope: 'deck', cards: [{ front: 'same', back: '2' }] });
    assert.equal(deckScope.added_count, 1);
  } finally {
    await env.close();
  }
});

test('add_notes: partial failures are reported per note with fixes', async () => {
  const env = await withDeck();
  try {
    const res = await env.ok('add_notes', {
      deck: 'Spanish', note_type: 'Basic',
      notes: [
        { fields: { Front: 'ok1', Back: 'fine' } },
        { fields: { Question: 'x', Back: 'y' } },
        { fields: { Front: '  ', Back: 'empty front' } },
        { fields: { Front: 'q' }, note_type: 'Nonexistent' },
        { fields: { Front: 'q2' }, deck: 'Spanis' },
        { fields: { Front: 'ok2', Back: 'fine' } },
      ],
    });
    assert.equal(res.added_count, 2);
    assert.equal(res.failed_count, 4);
    const errors = Object.fromEntries(res.failed.map((f) => [f.index, f.error]));
    assert.match(errors[1], /no field "Question".*Front, Back/);
    assert.match(errors[2], /first field "Front" is empty/);
    assert.match(errors[3], /Note type "Nonexistent" does not exist.*Available: Basic/s);
    assert.match(errors[4], /Deck "Spanis" does not exist.*Similar decks: Spanish.*create_deck_if_missing/s);
    assert.deepEqual(res.added.map((a) => a.index), [0, 5]);
    assert.equal(env.fake.notes.size, 2);
  } finally {
    await env.close();
  }
});

test('add_notes: create_deck_if_missing and case-insensitive names', async () => {
  const env = await withDeck();
  try {
    const res = await env.ok('add_notes', {
      create_deck_if_missing: true,
      notes: [
        { deck: 'spanish', note_type: 'basic', fields: { front: 'a', BACK: 'b' } },
        { deck: 'Brand::New', note_type: 'Basic', fields: { Front: 'c', Back: 'd' } },
        { deck: 'brand::new', note_type: 'Basic', fields: { Front: 'e', Back: 'f' } },
      ],
    });
    assert.equal(res.added_count, 3);
    assert.deepEqual(res.decks_created, ['Brand::New']);
    assert.deepEqual(res.added.map((a) => a.deck), ['Spanish', 'Brand::New', 'Brand::New']);
    assert.ok(env.fake.decks.has('Brand'));
    const noDeck = await env.ok('add_notes', { notes: [{ fields: { Front: 'x' }, note_type: 'Basic' }] });
    assert.match(noDeck.failed[0].error, /No deck given/);
  } finally {
    await env.close();
  }
});

test('add_notes: MathJax angle brackets are escaped and reported', async () => {
  const env = await withDeck();
  try {
    const res = await env.ok('add_basic_cards', {
      deck: 'Spanish',
      cards: [{ front: 'When is \\(a<b\\) true? Also \\[x>y\\]', back: 'If \\(b-a>0\\). <b>Bold</b> stays.' }],
    });
    assert.equal(res.added_count, 1);
    assert.match(res.warnings[0], /\\lt and \\gt/);
    const note = env.fake.noteByFirstField('When is \\(a\\lt b\\) true? Also \\[x\\gt y\\]');
    assert.ok(note, 'front stored with \\lt/\\gt');
    assert.equal(note.fields.Back, 'If \\(b-a\\gt 0\\). <b>Bold</b> stays.');
    const cloze = await env.ok('add_cloze_cards', { deck: 'Spanish', cards: [{ text: '{{c1::\\(x<1\\)}} is small' }] });
    assert.equal(cloze.added_count, 1);
    assert.ok(env.fake.noteByFirstField('{{c1::\\(x\\lt 1\\)}} is small'));
  } finally {
    await env.close();
  }
});

test('add_notes: media from data and url; a bad source fails only that note', async () => {
  const env = await withDeck();
  try {
    const res = await env.ok('add_notes', {
      deck: 'Spanish', note_type: 'Basic',
      notes: [
        { fields: { Front: 'cat pic', Back: 'gato' }, media: [{ filename: 'cat.png', data_base64: 'aGVsbG8=', fields: ['Back'] }] },
        { fields: { Front: 'dog sound', Back: 'perro' }, media: [{ filename: 'dog.mp3', url: 'https://example.com/dog.mp3' }] },
        { fields: { Front: 'insecure', Back: 'x' }, media: [{ filename: 'a.png', url: 'http://example.com/a.png' }] },
        { fields: { Front: 'missing field', Back: 'x' }, media: [{ filename: 'b.png', data_base64: 'aGk=', fields: ['Nope'] }] },
      ],
    });
    assert.equal(res.added_count, 2);
    assert.equal(res.failed_count, 2);
    assert.match(res.failed[0].error, /https/);
    assert.match(res.failed[1].error, /Media field "Nope"/);
    assert.equal(env.fake.noteByFirstField('cat pic').fields.Back, 'gato<img src="cat.png">');
    assert.equal(env.fake.noteByFirstField('dog sound[sound:dog.mp3]').fields.Front, 'dog sound[sound:dog.mp3]');
    assert.ok(env.fake.media.has('cat.png') && env.fake.media.has('dog.mp3'));
  } finally {
    await env.close();
  }
});

test('add_notes: tags with spaces are fixed with a warning; in-batch duplicates are not both added', async () => {
  const env = await withDeck();
  try {
    const res = await env.ok('add_notes', {
      deck: 'Spanish', note_type: 'Basic',
      notes: [{ fields: { Front: 'twin', Back: '1' }, tags: ['two words'] }, { fields: { Front: 'twin', Back: '2' } }],
    });
    assert.equal(res.added_count, 1);
    assert.equal(res.failed_count, 0);
    assert.equal(res.duplicate_count, 1);
    assert.equal(res.skipped_duplicates[0].note, 'same as an earlier note in this batch');
    assert.match(res.warnings[0], /"two words".*"two_words"/);
    assert.deepEqual(env.fake.noteByFirstField('twin').tags, ['two_words']);
  } finally {
    await env.close();
  }
});

test('add_notes: falls back to canAddNotes when the add-on is older', async () => {
  const env = await withDeck();
  try {
    env.fake.unsupported.add('canAddNotesWithErrorDetail');
    await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'uno', back: '1' }] });
    const res = await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'uno', back: '1' }, { front: 'dos', back: '2' }] });
    assert.equal(res.added_count, 1);
    assert.equal(res.duplicate_count, 1);
    assert.ok(env.fake.log.some((l) => l.action === 'canAddNotes'));
  } finally {
    await env.close();
  }
});

test('add_notes: an AnkiConnect failure during addNotes is reported per note, not thrown', async () => {
  const env = await withDeck();
  try {
    env.fake.failures.addNotes = 'database is locked';
    const res = await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'a', back: 'b' }, { front: 'c', back: 'd' }] });
    assert.equal(res.added_count, 0);
    assert.equal(res.failed_count, 2);
    assert.match(res.failed[0].error, /database is locked/);
  } finally {
    await env.close();
  }
});

test('add_basic_cards / add_reversed_cards: card counts and shared tags', async () => {
  const env = await withDeck();
  try {
    const basic = await env.ok('add_basic_cards', { deck: 'Spanish', tags: ['t1'], cards: [{ front: 'a', back: 'b', tags: ['own'] }] });
    assert.equal(basic.note_type_used, 'Basic');
    assert.deepEqual(env.fake.noteByFirstField('a').tags, ['t1', 'own']);
    const rev = await env.ok('add_reversed_cards', { deck: 'Spanish', cards: [{ front: 'hola', back: 'hello' }, { front: 'adios', back: 'bye' }] });
    assert.equal(rev.note_type_used, 'Basic (and reversed card)');
    assert.equal(rev.added_count, 2);
    assert.equal(env.fake.cardsOfDeck('Spanish').length, 1 + 4);
    await env.fails('add_basic_cards', { deck: 'Spanish', cards: [] }, /at least 1 item/);
    await env.fails('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'only front' }] }, /back is required/);
    await env.fails('add_basic_cards', { deck: 'Spanish', note_type: 'Nope', cards: [{ front: 'a', back: 'b' }] }, /Note type "Nope" does not exist/);
  } finally {
    await env.close();
  }
});

test('add_cloze_cards: validates deletions and keeps original indexes', async () => {
  const env = await withDeck();
  try {
    const res = await env.ok('add_cloze_cards', {
      deck: 'Spanish',
      cards: [
        { text: 'Paris is the capital of {{c1::France}}', extra: 'Europe' },
        { text: 'No deletion here' },
        { text: '{{c1::H}}{{c2::2}}O is water' },
        { text: 'Paris is the capital of {{c1::France}}' },
      ],
    });
    assert.equal(res.note_type_used, 'Cloze');
    assert.deepEqual(res.added.map((a) => a.index), [0, 2]);
    assert.equal(res.failed.length, 1);
    assert.equal(res.failed[0].index, 1);
    assert.match(res.failed[0].error, /no cloze deletion.*\{\{c1::answer\}\}/s);
    assert.deepEqual(res.skipped_duplicates.map((d) => d.index), [3]);
    assert.equal(res.requested, 4);
    assert.equal(env.fake.noteByFirstField('Paris is the capital of {{c1::France}}').fields.Extra, 'Europe');
    assert.equal(env.fake.cardsOfDeck('Spanish').length, 1 + 2);
  } finally {
    await env.close();
  }
});

test('convenience tools find stock note types by structure when renamed (localized Anki)', async () => {
  const env = await withDeck();
  try {
    const m = env.fake.models;
    const rename = (from, to) => { m.set(to, m.get(from)); m.delete(from); };
    rename('Basic', 'Einfach');
    rename('Basic (and reversed card)', 'Einfach (und umgekehrt)');
    rename('Cloze', 'Lückentext');
    assert.equal((await env.ok('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'a', back: 'b' }] })).note_type_used, 'Einfach');
    assert.equal((await env.ok('add_reversed_cards', { deck: 'Spanish', cards: [{ front: 'c', back: 'd' }] })).note_type_used, 'Einfach (und umgekehrt)');
    assert.equal((await env.ok('add_cloze_cards', { deck: 'Spanish', cards: [{ text: '{{c1::x}}' }] })).note_type_used, 'Lückentext');
    m.clear();
    await env.fails('add_basic_cards', { deck: 'Spanish', cards: [{ front: 'a', back: 'b' }] }, /No "Basic" note type was found/);
  } finally {
    await env.close();
  }
});

test('add_notes: schema limits and unknown arguments', async () => {
  const env = await withDeck();
  try {
    await env.fails('add_notes', { notes: [] }, /at least 1 item/);
    await env.fails('add_notes', { notes: [{ fields: { Front: 'a' } }], bogus: true }, /not a recognised argument/);
    await env.fails('add_notes', { notes: Array.from({ length: 501 }, () => ({ fields: { Front: 'a' } })) }, /maximum per call is 500/);
    await env.fails('add_notes', { notes: [{ deck: 'Spanish' }] }, /fields is required/);
    await env.fails('add_notes', {}, /notes is required/);
  } finally {
    await env.close();
  }
});
