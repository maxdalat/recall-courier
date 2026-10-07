export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function uniq(items) {
  return [...new Set(items)];
}

export function clip(text, max = 120) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Plain-text preview of an HTML field, for result summaries.
export function preview(html, max = 80) {
  return clip(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  );
}

// Anki fields are HTML, so a raw "<" or ">" inside MathJax can be read as a tag.
// Rewrite them as \lt and \gt inside \( ... \) and \[ ... \] spans only.
export function escapeMathAngles(text) {
  if (typeof text !== 'string' || !text.includes('\\')) return { text, changed: false };
  let changed = false;
  const fixed = text.replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (match, inline, display) => {
    const body = inline !== undefined ? inline : display;
    if (!/[<>]/.test(body)) return match;
    changed = true;
    const escaped = body.replace(/</g, '\\lt ').replace(/>/g, '\\gt ');
    return inline !== undefined ? `\\(${escaped}\\)` : `\\[${escaped}\\]`;
  });
  return { text: fixed, changed };
}

// Quote a name for use inside an Anki search: deck:"name".
export function quoteSearch(name) {
  return `"${String(name).replace(/[\\"*_]/g, (c) => `\\${c}`)}"`;
}

// Search for the sub-decks of a deck: deck:"name::*" (the trailing * must stay a wildcard).
export function quoteSubdecks(name) {
  return `${quoteSearch(name).slice(0, -1)}::*"`;
}

export function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

// Case-insensitive lookup that returns the canonical spelling, or null.
export function matchName(wanted, names) {
  const w = String(wanted).trim().toLowerCase();
  return names.find((n) => n.toLowerCase() === w) ?? null;
}

// Cheap "did you mean" for deck and note type names.
export function suggest(wanted, names, limit = 5) {
  const w = String(wanted).trim().toLowerCase();
  if (!w) return [];
  const last = w.split('::').pop();
  return names
    .filter((n) => {
      const l = n.toLowerCase();
      return l.includes(w) || w.includes(l) || l.split('::').pop() === last;
    })
    .slice(0, limit);
}
