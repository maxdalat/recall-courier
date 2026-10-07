// A small JSON Schema subset validator, so bad arguments get a clear message instead of an Anki stack trace.
// Supports: type, enum, required, properties, additionalProperties:false, items, minItems, maxItems,
// minLength, minimum, maximum, pattern. Values are lightly coerced because models sometimes send
// numbers as strings or arrays as JSON text.

function typeOf(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function coerce(schema, value) {
  if (typeof value !== 'string') return value;
  if ((schema.type === 'integer' || schema.type === 'number') && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return Number(value);
  }
  if (schema.type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  if (schema.type === 'array' || schema.type === 'object') {
    try {
      const parsed = JSON.parse(value);
      if (typeOf(parsed) === schema.type) return parsed;
    } catch {
      // fall through; the type check below reports it
    }
  }
  return value;
}

export function validate(schema, input, path = 'arguments') {
  const errors = [];
  const value = check(schema, input, path, errors);
  return { value, errors };
}

function check(schema, input, path, errors) {
  let value = coerce(schema, input);
  const actual = typeOf(value);
  const want = schema.type;

  if (want) {
    const ok = want === 'integer' ? Number.isInteger(value) : want === 'number' ? actual === 'number' : actual === want;
    if (!ok) {
      const article = /^[aeiou]/.test(want) ? 'an' : 'a';
      errors.push(`${path} must be ${article} ${want} (got ${actual}).`);
      return value;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.map((e) => JSON.stringify(e)).join(', ')} (got ${JSON.stringify(value)}).`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path} must not be empty.`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path} has an invalid format${schema.patternHint ? `: ${schema.patternHint}` : ''}.`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}.`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}.`);
  }
  if (actual === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} has ${value.length} items; the maximum per call is ${schema.maxItems}. Split it into several calls.`);
    }
    if (schema.items) value = value.map((item, i) => check(schema.items, item, `${path}[${i}]`, errors));
  }
  if (actual === 'object' && (schema.properties || schema.required)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (value[key] === undefined || value[key] === null) errors.push(`${path}.${key} is required.`);
    }
    const out = { ...value };
    for (const [key, sub] of Object.entries(props)) {
      if (value[key] !== undefined && value[key] !== null) out[key] = check(sub, value[key], `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(`${path}.${key} is not a recognised argument. Allowed: ${Object.keys(props).join(', ') || '(none)'}.`);
      }
    }
    value = out;
  }
  return value;
}
