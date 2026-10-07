// Note type (model) tools.
import { ToolError } from '../errors.js';
import { matchName } from '../util.js';
import { defineTool, prop, requireConfirm } from './helpers.js';

const templateProps = {
  name: prop.nonEmpty('Card template name, e.g. "Card 1".'),
  front: prop.str('HTML of the front (question) side, using {{FieldName}} placeholders.'),
  back: prop.str('HTML of the back (answer) side. Use {{FrontSide}} to repeat the front.'),
};

// Reads every note type with its fields and templates (one round trip).
export async function readNoteTypes(ctx, { withCss = false } = {}) {
  const ids = await ctx.call('modelNamesAndIds');
  const names = Object.keys(ids);
  const calls = names.flatMap((n) => [['modelFieldNames', { modelName: n }], ['modelTemplates', { modelName: n }]]);
  if (withCss) names.forEach((n) => calls.push(['modelStyling', { modelName: n }]));
  const out = await ctx.multi(calls);
  return names.map((name, i) => {
    const fields = out[i * 2].result ?? [];
    const templates = Object.entries(out[i * 2 + 1].result ?? {}).map(([tname, sides]) => ({ name: tname, front: sides.Front, back: sides.Back }));
    const entry = {
      name,
      id: ids[name],
      fields,
      is_cloze: templates.some((t) => /\{\{cloze:/i.test(t.front ?? '')),
      templates,
    };
    if (withCss) entry.css = out[names.length * 2 + i].result?.css ?? null;
    return entry;
  });
}

async function noteTypeNames(ctx) {
  return Object.keys(await ctx.call('modelNamesAndIds'));
}

export const noteTypeTools = [
  defineTool({
    name: 'list_note_types',
    title: 'List note types',
    description:
      'Lists every note type (Basic, Cloze, custom ones) with its field names, whether it is a cloze type, and its card templates (front and back HTML). ' +
      'Set include_css to also get each note type\'s CSS.',
    properties: { include_css: prop.bool('Also return the CSS of each note type. Default false.') },
    kind: 'read',
    handler: async ({ include_css }, ctx) => {
      const noteTypes = await readNoteTypes(ctx, { withCss: Boolean(include_css) });
      return { note_type_count: noteTypes.length, note_types: noteTypes };
    },
  }),

  defineTool({
    name: 'create_note_type',
    title: 'Create a note type',
    description:
      'Creates a new note type with the given fields and card templates. Templates reference fields as {{FieldName}}. ' +
      'For a cloze type set is_cloze and use {{cloze:FieldName}} in the template. Fails if a note type with that name exists.',
    properties: {
      name: prop.nonEmpty('Name of the new note type.'),
      fields: prop.strings('Ordered field names. The first field is the sort field.', { minItems: 1, maxItems: 50 }),
      templates: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'object', properties: templateProps, required: ['name', 'front', 'back'], additionalProperties: false },
        description: 'Card templates; each produces one card per note.',
      },
      css: prop.str('Optional CSS for the cards. Defaults to Anki\'s standard styling.'),
      is_cloze: prop.bool('Create a cloze-type note type. Default false.'),
    },
    required: ['name', 'fields', 'templates'],
    kind: 'write',
    handler: async (args, ctx) => {
      const existing = await noteTypeNames(ctx);
      if (matchName(args.name, existing)) {
        throw new ToolError(`A note type named "${args.name}" already exists. Pick another name, or change it with update_note_type.`);
      }
      const unknown = args.templates.flatMap((t) =>
        [...(t.front + t.back).matchAll(/\{\{(?:[a-z]+:)*([^}#/^]+?)\}\}/gi)]
          .map((m) => m[1].trim())
          .filter((f) => f !== 'FrontSide' && !args.fields.includes(f) && !/^(Tags|Type|Deck|Subdeck|Card|CardFlag)$/.test(f)),
      );
      if (unknown.length) {
        throw new ToolError(`Templates refer to fields that are not in "fields": ${[...new Set(unknown)].join(', ')}. Add them to fields or fix the templates.`);
      }
      const params = {
        modelName: args.name,
        inOrderFields: args.fields,
        cardTemplates: args.templates.map((t) => ({ Name: t.name, Front: t.front, Back: t.back })),
        isCloze: Boolean(args.is_cloze),
      };
      if (args.css !== undefined) params.css = args.css;
      const model = await ctx.call('createModel', params);
      return { created: args.name, id: model?.id ?? null, fields: args.fields, templates: args.templates.map((t) => t.name) };
    },
  }),

  defineTool({
    name: 'update_note_type',
    title: 'Update a note type',
    description:
      'Changes an existing note type: add, rename or remove fields; add, rewrite or remove card templates; replace the CSS. ' +
      'Several changes can be combined; they run in this order: add fields, rename fields, update templates, add templates, css, remove templates, remove fields. ' +
      'Removing fields or templates deletes that data from every note of this type and needs confirm: true.',
    properties: {
      name: prop.nonEmpty('Name of the note type to change.'),
      add_fields: prop.strings('Field names to add at the end.'),
      rename_fields: { type: 'object', description: 'Map of old field name to new field name, e.g. {"Back": "Answer"}.' },
      remove_fields: prop.strings('Field names to remove. Deletes their contents in every note of this type.'),
      update_templates: {
        type: 'array',
        items: { type: 'object', properties: { name: templateProps.name, front: templateProps.front, back: templateProps.back }, required: ['name'], additionalProperties: false },
        description: 'Rewrite existing templates by name. Only the sides provided (front, back) change.',
      },
      add_templates: {
        type: 'array',
        items: { type: 'object', properties: templateProps, required: ['name', 'front', 'back'], additionalProperties: false },
        description: 'New card templates to add.',
      },
      remove_templates: prop.strings('Template names to remove. Deletes the cards made from them.'),
      css: prop.str('Replacement CSS for the whole note type.'),
      confirm: prop.confirm('removing the listed fields or templates and the data in them'),
    },
    required: ['name'],
    kind: 'destructive',
    handler: async (args, ctx) => {
      const types = await readNoteTypes(ctx);
      const current = types.find((t) => t.name.toLowerCase() === args.name.toLowerCase());
      if (!current) {
        throw new ToolError(`Note type "${args.name}" does not exist. Available: ${types.map((t) => t.name).join(', ')}. Use one of those names.`);
      }
      const model = current.name;
      const removals = [...(args.remove_fields ?? []), ...(args.remove_templates ?? [])];
      if (removals.length) {
        requireConfirm(args, `This would remove ${removals.map((r) => `"${r}"`).join(', ')} from "${model}" and delete that data in all its notes.`);
      }
      const calls = [];
      const labels = [];
      const plan = (label, call) => {
        labels.push(label);
        calls.push(call);
      };
      for (const f of args.add_fields ?? []) plan(`add field ${f}`, ['modelFieldAdd', { modelName: model, fieldName: f }]);
      for (const [from, to] of Object.entries(args.rename_fields ?? {})) {
        plan(`rename field ${from} to ${to}`, ['modelFieldRename', { modelName: model, oldFieldName: from, newFieldName: to }]);
      }
      for (const t of args.update_templates ?? []) {
        const sides = {};
        if (t.front !== undefined) sides.Front = t.front;
        if (t.back !== undefined) sides.Back = t.back;
        plan(`update template ${t.name}`, ['updateModelTemplates', { model: { name: model, templates: { [t.name]: sides } } }]);
      }
      for (const t of args.add_templates ?? []) {
        plan(`add template ${t.name}`, ['modelTemplateAdd', { modelName: model, template: { Name: t.name, Front: t.front, Back: t.back } }]);
      }
      if (args.css !== undefined) plan('replace css', ['updateModelStyling', { model: { name: model, css: args.css } }]);
      for (const t of args.remove_templates ?? []) plan(`remove template ${t}`, ['modelTemplateRemove', { modelName: model, templateName: t }]);
      for (const f of args.remove_fields ?? []) plan(`remove field ${f}`, ['modelFieldRemove', { modelName: model, fieldName: f }]);
      if (calls.length === 0) throw new ToolError('No change was requested. Provide at least one of add_fields, rename_fields, update_templates, add_templates, css, remove_templates, remove_fields.');

      const results = await ctx.multi(calls);
      const applied = [];
      const failed = [];
      results.forEach((r, i) => (r.error === null ? applied : failed).push(r.error === null ? labels[i] : { change: labels[i], error: r.error }));
      const after = (await readNoteTypes(ctx)).find((t) => t.name === model);
      return { note_type: model, applied, failed, fields_now: after?.fields, templates_now: after?.templates.map((t) => t.name) };
    },
  }),
];
