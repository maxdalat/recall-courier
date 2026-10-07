import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv } from './helpers.js';

test('list_note_types: fields, templates, cloze flag, css', async () => {
  const env = await makeEnv();
  try {
    const res = await env.ok('list_note_types');
    const byName = Object.fromEntries(res.note_types.map((t) => [t.name, t]));
    assert.deepEqual(Object.keys(byName).sort(), ['Basic', 'Basic (and reversed card)', 'Cloze']);
    assert.deepEqual(byName.Basic.fields, ['Front', 'Back']);
    assert.equal(byName.Basic.is_cloze, false);
    assert.equal(byName.Cloze.is_cloze, true);
    assert.equal(byName['Basic (and reversed card)'].templates.length, 2);
    assert.deepEqual(byName.Basic.templates[0], { name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr id=answer>{{Back}}' });
    assert.equal(byName.Basic.css, undefined);
    const withCss = await env.ok('list_note_types', { include_css: true });
    assert.match(withCss.note_types[0].css, /\.card/);
  } finally {
    await env.close();
  }
});

test('create_note_type: success and guards', async () => {
  const env = await makeEnv();
  try {
    const res = await env.ok('create_note_type', {
      name: 'Vocab', fields: ['Word', 'Meaning', 'Example'],
      templates: [{ name: 'Recognition', front: '{{Word}}', back: '{{FrontSide}}<hr>{{Meaning}}<br>{{Example}}' }, { name: 'Recall', front: '{{Meaning}}', back: '{{FrontSide}}<hr>{{Word}}' }],
      css: '.card { color: red; }',
    });
    assert.deepEqual(res.templates, ['Recognition', 'Recall']);
    assert.equal(env.fake.models.get('Vocab').css, '.card { color: red; }');
    await env.fails('create_note_type', { name: 'vocab', fields: ['A'], templates: [{ name: 'c', front: '{{A}}', back: '{{A}}' }] }, /already exists/);
    await env.fails('create_note_type', { name: 'Bad', fields: ['A'], templates: [{ name: 'c', front: '{{Missing}}', back: '{{A}}' }] }, /fields that are not in "fields": Missing/);
    const cloze = await env.ok('create_note_type', { name: 'MyCloze', fields: ['Text'], is_cloze: true, templates: [{ name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}' }] });
    assert.equal(cloze.created, 'MyCloze');
    assert.equal(env.fake.models.get('MyCloze').cloze, true);
  } finally {
    await env.close();
  }
});

test('update_note_type: fields, templates, css, and confirmed removals', async () => {
  const env = await makeEnv();
  try {
    await env.ok('add_basic_cards', { deck: 'Default', cards: [{ front: 'a', back: 'b' }] });
    const res = await env.ok('update_note_type', {
      name: 'basic', add_fields: ['Hint'], rename_fields: { Back: 'Answer' },
      update_templates: [{ name: 'Card 1', back: '{{FrontSide}}<hr>{{Answer}}' }],
      add_templates: [{ name: 'Card 2', front: '{{Answer}}', back: '{{Front}}' }], css: '.card{color:blue}',
    });
    assert.equal(res.failed.length, 0);
    assert.deepEqual(res.fields_now, ['Front', 'Answer', 'Hint']);
    assert.deepEqual(res.templates_now, ['Card 1', 'Card 2']);
    assert.equal(env.fake.models.get('Basic').css, '.card{color:blue}');
    assert.equal(env.fake.noteByFirstField('a').fields.Answer, 'b');

    const refused = await env.fails('update_note_type', { name: 'Basic', remove_fields: ['Hint'] }, /confirm was not true/);
    assert.match(refused, /remove "Hint"/);
    assert.ok(env.fake.models.get('Basic').fields.includes('Hint'));

    const removed = await env.ok('update_note_type', { name: 'Basic', remove_fields: ['Hint'], remove_templates: ['Card 2'], confirm: true });
    assert.deepEqual(removed.fields_now, ['Front', 'Answer']);
    assert.deepEqual(removed.templates_now, ['Card 1']);

    const partial = await env.ok('update_note_type', { name: 'Basic', add_fields: ['Notes'], rename_fields: { Nope: 'X' } });
    assert.equal(partial.applied.length, 1);
    assert.match(partial.failed[0].error, /field was not found: Nope/);

    await env.fails('update_note_type', { name: 'Ghost', add_fields: ['x'] }, /does not exist.*Available/s);
    await env.fails('update_note_type', { name: 'Basic' }, /No change was requested/);
  } finally {
    await env.close();
  }
});
