// An in-memory stand-in for Anki + AnkiConnect (API v6), faithful enough to exercise every tool.
// Behaviours copied from the real add-on: addNotes returns null per failed note, changeDeck creates missing decks,
// deleteDecks demands cardsToo, notesInfo returns {} for unknown ids, errors are plain strings.
import { createServer } from 'node:http';
import { existsSync, writeFileSync } from 'node:fs';

const DAY = 86400000;

export class FakeAnki {
  constructor({ apiKey = '' } = {}) {
    this.apiKey = apiKey;
    this.log = [];
    this.failures = {}; // action -> error message
    this.unsupported = new Set();
    this.garbage = false; // answer with non-JSON
    this.collectionUnavailable = false;
    this.idCounter = 1700000000000;
    this.decks = new Map();
    this.configs = new Map();
    this.models = new Map();
    this.notes = new Map();
    this.cards = new Map();
    this.media = new Map();
    this.reviews = []; // {id, cardId, ease, ivl, lastIvl, factor, time, type}
    this.profiles = ['User 1', 'Second'];
    this.activeProfile = 'User 1';
    this.exports = [];
    this.imports = [];
    this.gui = [];
    this.syncCount = 0;
    this.#seed();
  }

  #nextId() {
    this.idCounter += 7;
    return this.idCounter;
  }

  #seed() {
    this.configs.set(1, {
      id: 1, name: 'Default', dyn: false, autoplay: true, maxTaken: 60, replayq: true, timer: 0, mod: 0, usn: -1,
      new: { bury: true, order: 1, initialFactor: 2500, perDay: 20, delays: [1, 10], separate: true, ints: [1, 4, 7] },
      rev: { bury: true, ivlFct: 1, ease4: 1.3, maxIvl: 36500, perDay: 200, minSpace: 1, fuzz: 0.05 },
      lapse: { leechFails: 8, delays: [10], minInt: 1, leechAction: 0, mult: 0 },
    });
    this.decks.set('Default', { id: 1, configId: 1, dyn: false });
    const css = '.card { font-family: arial; font-size: 20px; }';
    const basic = [{ name: 'Card 1', qfmt: '{{Front}}', afmt: '{{FrontSide}}<hr id=answer>{{Back}}' }];
    this.models.set('Basic', { id: this.#nextId(), fields: ['Front', 'Back'], templates: basic, css, cloze: false });
    this.models.set('Basic (and reversed card)', {
      id: this.#nextId(), fields: ['Front', 'Back'], css, cloze: false,
      templates: [...basic, { name: 'Card 2', qfmt: '{{Back}}', afmt: '{{FrontSide}}<hr id=answer>{{Front}}' }],
    });
    this.models.set('Cloze', {
      id: this.#nextId(), fields: ['Text', 'Extra'], css, cloze: true,
      templates: [{ name: 'Cloze', qfmt: '{{cloze:Text}}', afmt: '{{cloze:Text}}<br>{{Extra}}' }],
    });
  }

  // ---- direct helpers for tests -------------------------------------------------------------
  addDeckDirect(name) {
    this.#createDeck(name);
  }

  noteByFirstField(value) {
    return [...this.notes.values()].find((n) => Object.values(n.fields)[0] === value);
  }

  cardsOfDeck(name) {
    return [...this.cards.values()].filter((c) => c.deck === name || c.deck.startsWith(`${name}::`));
  }

  // ---- HTTP -------------------------------------------------------------------------------
  async listen() {
    this.server = createServer((req, res) => {
      if (req.method !== 'POST') {
        res.end('AnkiConnect v.6');
        return;
      }
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        if (this.garbage) {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html>not anki</html>');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(this.handle(JSON.parse(body))));
      });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.url = `http://127.0.0.1:${this.server.address().port}`;
    return this.url;
  }

  async close() {
    await new Promise((resolve) => this.server.close(resolve));
  }

  handle(req) {
    const { action, params = {}, key } = req;
    this.log.push({ action, params });
    try {
      if (action === 'requestPermission') return this.#ok({ permission: 'granted', requireApiKey: Boolean(this.apiKey), version: 6 });
      if (this.apiKey && key !== this.apiKey) throw new Error('valid api key must be provided');
      if (this.failures[action]) throw new Error(this.failures[action]);
      if (this.unsupported.has(action)) throw new Error('unsupported action');
      if (this.collectionUnavailable && !['version', 'getProfiles', 'loadProfile'].includes(action)) throw new Error('collection is not available');
      const fn = this.actions[action];
      if (!fn) throw new Error('unsupported action');
      return this.#ok(fn.call(this, params));
    } catch (err) {
      return { result: null, error: String(err.message) };
    }
  }

  #ok(result) {
    return { result: result === undefined ? null : result, error: null };
  }

  // ---- model / deck internals ------------------------------------------------------------
  #createDeck(name) {
    const parts = name.split('::');
    let id = null;
    for (let i = 1; i <= parts.length; i += 1) {
      const n = parts.slice(0, i).join('::');
      const existing = [...this.decks.keys()].find((d) => d.toLowerCase() === n.toLowerCase());
      if (!existing) this.decks.set(n, { id: this.#nextId(), configId: 1, dyn: false });
      id = this.decks.get(existing ?? n).id;
    }
    return id;
  }

  #deckName(name) {
    return [...this.decks.keys()].find((d) => d.toLowerCase() === String(name).toLowerCase());
  }

  #model(name) {
    const m = this.models.get(name);
    if (!m) throw new Error(`model was not found: ${name}`);
    return m;
  }

  #cardCount(model, fields) {
    if (!model.cloze) return model.templates.length;
    const nums = new Set([...Object.values(fields).join(' ').matchAll(/\{\{c(\d+)::/g)].map((m) => m[1]));
    return Math.max(1, nums.size);
  }

  #stripped(html) {
    return String(html ?? '').replace(/<[^>]+>/g, '').trim();
  }

  #validateNote(note) {
    const model = this.#model(note.modelName);
    const deck = this.#deckName(note.deckName);
    if (!deck) throw new Error(`deck was not found: ${note.deckName}`);
    const first = model.fields[0];
    if (!this.#stripped(note.fields?.[first])) throw new Error('cannot create note because it is empty');
    for (const f of Object.keys(note.fields ?? {})) {
      if (!model.fields.includes(f)) throw new Error(`field was not found: ${f}`);
    }
    const allow = note.options?.allowDuplicate === true;
    if (!allow) {
      const deckScope = note.options?.duplicateScope === 'deck';
      const dupe = [...this.notes.values()].some((n) => {
        if (n.model !== note.modelName) return false;
        if (this.#stripped(n.fields[first]) !== this.#stripped(note.fields[first])) return false;
        if (!deckScope) return true;
        return n.cardIds.some((id) => this.cards.get(id)?.deck === deck);
      });
      if (dupe) throw new Error('cannot create note because it is a duplicate');
    }
    return { model, deck };
  }

  #addNote(note) {
    const { model, deck } = this.#validateNote(note);
    const fields = {};
    for (const f of model.fields) fields[f] = note.fields?.[f] ?? '';
    for (const [kind, tag] of [['picture', (n) => `<img src="${n}">`], ['audio', (n) => `[sound:${n}]`], ['video', (n) => `[sound:${n}]`]]) {
      for (const item of note[kind] ?? []) {
        const stored = this.#storeMedia({ ...item, deleteExisting: true });
        for (const f of item.fields ?? [model.fields[0]]) fields[f] += tag(stored);
      }
    }
    const id = this.#nextId();
    const cardIds = [];
    for (let ord = 0; ord < this.#cardCount(model, fields); ord += 1) {
      const cardId = this.#nextId();
      this.cards.set(cardId, { id: cardId, noteId: id, deck, ord, type: 0, queue: 0, due: 1, interval: 0, reps: 0, lapses: 0, mod: 0 });
      cardIds.push(cardId);
    }
    this.notes.set(id, { id, model: note.modelName, fields, tags: [...(note.tags ?? [])], cardIds });
    return id;
  }

  #storeMedia({ filename, data, path, url, deleteExisting = true }) {
    if (!data && !path && !url) throw new Error('You must provide a "data", "path", or "url" field.');
    if (url && String(url).includes('fail')) throw new Error(`Unable to download ${url}`);
    let name = filename;
    if (this.media.has(name) && deleteExisting === false) {
      const dot = name.lastIndexOf('.');
      name = `${name.slice(0, dot)}_1${name.slice(dot)}`;
    }
    this.media.set(name, { data, path, url });
    return name;
  }

  // ---- search ----------------------------------------------------------------------------
  #tokens(query) {
    const tokens = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < query.length; i += 1) {
      const ch = query[i];
      if (ch === '\\' && i + 1 < query.length) {
        cur += ch + query[i + 1];
        i += 1;
      } else if (ch === '"') {
        quoted = !quoted;
        cur += ch;
      } else if (/\s/.test(ch) && !quoted) {
        if (cur) tokens.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur) tokens.push(cur);
    return tokens;
  }

  #pattern(text) {
    let src = '';
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '\\' && i + 1 < text.length) {
        src += text[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        i += 1;
      } else if (ch === '*') src += '.*';
      else if (ch === '_') src += '.';
      else src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return src;
  }

  #unquote(v) {
    return v.replace(/^"(.*)"$/s, '$1');
  }

  #matchTerm(card, rawToken) {
    let token = rawToken;
    let negate = false;
    if (token.startsWith('-')) {
      negate = true;
      token = token.slice(1);
    }
    const note = this.notes.get(card.noteId);
    const model = this.models.get(note.model);
    let hit;
    const colon = token.replace(/^"|"$/g, '').indexOf(':');
    const bare = token.replace(/^"(.*)"$/s, '$1');
    if (colon > 0) {
      const key = bare.slice(0, colon).toLowerCase();
      const value = this.#unquote(bare.slice(colon + 1));
      const rx = new RegExp(`^${this.#pattern(value)}$`, 'i');
      if (key === 'deck') hit = value === '*' || rx.test(card.deck) || new RegExp(`^${this.#pattern(value)}::`, 'i').test(card.deck);
      else if (key === 'tag') hit = note.tags.some((t) => rx.test(t) || new RegExp(`^${this.#pattern(value)}::`, 'i').test(t));
      else if (key === 'note') hit = rx.test(note.model);
      else if (key === 'nid') hit = value.split(',').includes(String(note.id));
      else if (key === 'cid') hit = value.split(',').includes(String(card.id));
      else if (key === 'is') {
        hit = { suspended: card.queue === -1, new: card.type === 0, review: card.type === 2, learn: card.type === 1 || card.type === 3, due: card.type !== 0 && card.due <= 0 }[value] ?? false;
      } else if (key === 'prop') {
        const m = value.match(/^ivl(>=|<=|>|<|=)(\d+)$/);
        const n = m ? Number(m[2]) : 0;
        hit = m ? { '>=': card.interval >= n, '<=': card.interval <= n, '>': card.interval > n, '<': card.interval < n, '=': card.interval === n }[m[1]] : false;
      } else if (key === 'added' || key === 'rated') hit = true;
      else {
        const field = model.fields.find((f) => f.toLowerCase() === key);
        hit = field ? rx.test(this.#stripped(note.fields[field])) : false;
      }
    } else {
      const rx = new RegExp(this.#pattern(bare), 'i');
      hit = Object.values(note.fields).some((v) => rx.test(v));
    }
    return negate ? !hit : hit;
  }

  #search(query) {
    const tokens = this.#tokens(query);
    const groups = [[]];
    for (const t of tokens) {
      if (t.toLowerCase() === 'or') groups.push([]);
      else if (t.toLowerCase() !== 'and') groups[groups.length - 1].push(t);
    }
    return [...this.cards.values()].filter((card) => groups.some((g) => g.every((t) => this.#matchTerm(card, t))));
  }

  #render(template, note, card) {
    return template
      .replace(/\{\{cloze:(\w+)\}\}/g, (_, f) => note.fields[f].replace(/\{\{c(\d+)::(.*?)(::.*?)?\}\}/g, (m, n, text) => (Number(n) === card.ord + 1 ? '[...]' : text)))
      .replace(/\{\{FrontSide\}\}/g, '')
      .replace(/\{\{(\w+)\}\}/g, (_, f) => note.fields[f] ?? '');
  }

  #cardInfo(card) {
    const note = this.notes.get(card.noteId);
    const model = this.models.get(note.model);
    const tmpl = model.templates[Math.min(card.ord, model.templates.length - 1)];
    return {
      answer: this.#render(tmpl.afmt, note, card), question: this.#render(tmpl.qfmt, note, card), deckName: card.deck, modelName: note.model,
      fieldOrder: 0, fields: Object.fromEntries(model.fields.map((f, i) => [f, { value: note.fields[f], order: i }])),
      css: model.css, cardId: card.id, interval: card.interval, note: card.noteId, ord: card.ord, type: card.type, queue: card.queue,
      due: card.due, reps: card.reps, lapses: card.lapses, left: 0, mod: card.mod,
    };
  }

  #noteInfo(id) {
    const note = this.notes.get(id);
    if (!note) return {};
    const model = this.models.get(note.model);
    return {
      noteId: note.id, profile: this.activeProfile, modelName: note.model, tags: note.tags, mod: 0, cards: note.cardIds,
      fields: Object.fromEntries(model.fields.map((f, i) => [f, { value: note.fields[f], order: i }])),
    };
  }

  #statsFor(name) {
    const cards = this.cardsOfDeck(name);
    return {
      deck_id: this.decks.get(name).id, name,
      new_count: Math.min(20, cards.filter((c) => c.type === 0 && c.queue !== -1).length),
      learn_count: cards.filter((c) => (c.type === 1 || c.type === 3) && c.queue !== -1).length,
      review_count: cards.filter((c) => c.type === 2 && c.queue !== -1 && c.due <= 0).length,
      total_in_deck: cards.length,
    };
  }

  // ---- the action table -------------------------------------------------------------------
  get actions() {
    return {
      version: () => 6,
      sync() { this.syncCount += 1; if (this.syncError) throw new Error(this.syncError); return null; },
      getProfiles() { return this.profiles; },
      getActiveProfile() { return this.activeProfile; },
      loadProfile({ name }) { if (!this.profiles.includes(name)) return false; this.activeProfile = name; return true; },
      multi({ actions }) { return actions.map((a) => { const r = this.handle({ ...a, key: this.apiKey }); return a.version ? r : r.result; }); },

      deckNames() { return [...this.decks.keys()]; },
      deckNamesAndIds() { return Object.fromEntries([...this.decks].map(([n, d]) => [n, d.id])); },
      createDeck({ deck }) { return this.#createDeck(deck); },
      deleteDecks({ decks, cardsToo }) {
        if (cardsToo !== true) throw new Error("Since Anki 2.1.28 it's not possible to delete decks without deleting cards as well. Please set the cardsToo parameter to true");
        for (const raw of decks) {
          const name = this.#deckName(raw);
          if (!name || name === 'Default') continue;
          for (const c of this.cardsOfDeck(name)) { this.#dropCard(c); }
          for (const d of [...this.decks.keys()]) if (d === name || d.startsWith(`${name}::`)) this.decks.delete(d);
        }
        return null;
      },
      changeDeck({ cards, deck }) {
        const name = this.#deckName(deck) ?? (this.#createDeck(deck), deck);
        for (const id of cards) { const c = this.cards.get(id); if (c) c.deck = this.#deckName(name); }
        return null;
      },
      getDeckStats({ decks }) {
        return Object.fromEntries(decks.map((d) => { const n = this.#deckName(d); if (!n) throw new Error(`deck was not found: ${d}`); const s = this.#statsFor(n); return [String(s.deck_id), s]; }));
      },
      getDeckConfig({ deck }) {
        const n = this.#deckName(deck);
        if (!n) return false;
        const d = this.decks.get(n);
        return d.dyn ? false : structuredClone(this.configs.get(d.configId));
      },
      saveDeckConfig({ config }) { if (!this.configs.has(config.id)) return false; this.configs.set(config.id, structuredClone(config)); return true; },
      setDeckConfigId({ decks, configId }) { for (const d of decks) this.decks.get(this.#deckName(d)).configId = configId; return true; },

      modelNames() { return [...this.models.keys()]; },
      modelNamesAndIds() { return Object.fromEntries([...this.models].map(([n, m]) => [n, m.id])); },
      modelFieldNames({ modelName }) { return [...this.#model(modelName).fields]; },
      modelTemplates({ modelName }) { return Object.fromEntries(this.#model(modelName).templates.map((t) => [t.name, { Front: t.qfmt, Back: t.afmt }])); },
      modelStyling({ modelName }) { return { css: this.#model(modelName).css }; },
      createModel({ modelName, inOrderFields, cardTemplates, css, isCloze }) {
        if (this.models.has(modelName)) throw new Error('Model name already exists');
        this.models.set(modelName, {
          id: this.#nextId(), fields: [...inOrderFields], css: css ?? '.card {}', cloze: Boolean(isCloze),
          templates: cardTemplates.map((t, i) => ({ name: t.Name ?? `Card ${i + 1}`, qfmt: t.Front, afmt: t.Back })),
        });
        return { id: this.models.get(modelName).id, name: modelName };
      },
      updateModelTemplates({ model }) {
        const m = this.#model(model.name);
        for (const [tn, sides] of Object.entries(model.templates)) {
          const t = m.templates.find((x) => x.name === tn);
          if (!t) throw new Error(`template was not found: ${tn}`);
          if (sides.Front !== undefined) t.qfmt = sides.Front;
          if (sides.Back !== undefined) t.afmt = sides.Back;
        }
        return null;
      },
      updateModelStyling({ model }) { this.#model(model.name).css = model.css; return null; },
      modelTemplateAdd({ modelName, template }) { this.#model(modelName).templates.push({ name: template.Name, qfmt: template.Front, afmt: template.Back }); return null; },
      modelTemplateRemove({ modelName, templateName }) {
        const m = this.#model(modelName);
        if (m.templates.length < 2) throw new Error('Removing this template would leave the note type with no templates');
        const i = m.templates.findIndex((t) => t.name === templateName);
        if (i < 0) throw new Error(`template was not found: ${templateName}`);
        m.templates.splice(i, 1);
        return null;
      },
      modelFieldAdd({ modelName, fieldName }) {
        const m = this.#model(modelName);
        if (m.fields.includes(fieldName)) throw new Error('field already exists');
        m.fields.push(fieldName);
        for (const n of this.notes.values()) if (n.model === modelName) n.fields[fieldName] = '';
        return null;
      },
      modelFieldRename({ modelName, oldFieldName, newFieldName }) {
        const m = this.#model(modelName);
        const i = m.fields.indexOf(oldFieldName);
        if (i < 0) throw new Error(`field was not found: ${oldFieldName}`);
        m.fields[i] = newFieldName;
        for (const n of this.notes.values()) if (n.model === modelName) { n.fields[newFieldName] = n.fields[oldFieldName]; delete n.fields[oldFieldName]; }
        return null;
      },
      modelFieldRemove({ modelName, fieldName }) {
        const m = this.#model(modelName);
        const i = m.fields.indexOf(fieldName);
        if (i < 0) throw new Error(`field was not found: ${fieldName}`);
        if (m.fields.length === 1) throw new Error('cannot remove the only field');
        m.fields.splice(i, 1);
        for (const n of this.notes.values()) if (n.model === modelName) delete n.fields[fieldName];
        return null;
      },

      addNote({ note }) { return this.#addNote(note); },
      addNotes({ notes }) { return notes.map((n) => { try { return this.#addNote(n); } catch { return null; } }); },
      canAddNotes({ notes }) { return notes.map((n) => { try { this.#validateNote(n); return true; } catch { return false; } }); },
      canAddNotesWithErrorDetail({ notes }) {
        return notes.map((n) => { try { this.#validateNote(n); return { canAdd: true }; } catch (e) { return { canAdd: false, error: e.message }; } });
      },
      updateNoteFields({ note }) {
        const n = this.notes.get(note.id);
        if (!n) throw new Error(`Note was not found: ${note.id}`);
        for (const [f, v] of Object.entries(note.fields)) { if (!(f in n.fields)) throw new Error(`field was not found: ${f}`); n.fields[f] = v; }
        return null;
      },
      notesInfo({ notes, query }) { return (notes ?? [...new Set(this.#search(query).map((c) => c.noteId))]).map((id) => this.#noteInfo(id)); },
      cardsInfo({ cards }) { return cards.map((id) => (this.cards.has(id) ? this.#cardInfo(this.cards.get(id)) : {})); },
      findNotes({ query }) { return [...new Set(this.#search(query).map((c) => c.noteId))]; },
      findCards({ query }) { return this.#search(query).map((c) => c.id); },
      cardsToNotes({ cards }) { return [...new Set(cards.map((id) => this.cards.get(id).noteId))]; },
      addTags({ notes, tags }) { for (const id of notes) { const n = this.notes.get(id); for (const t of tags.split(' ')) if (n && !n.tags.some((x) => x.toLowerCase() === t.toLowerCase())) n.tags.push(t); } return null; },
      removeTags({ notes, tags }) { const drop = tags.toLowerCase().split(' '); for (const id of notes) { const n = this.notes.get(id); if (n) n.tags = n.tags.filter((t) => !drop.includes(t.toLowerCase())); } return null; },
      replaceTags({ notes, tag_to_replace: from, replace_with: to }) { for (const id of notes) { const n = this.notes.get(id); if (n) n.tags = n.tags.map((t) => (t.toLowerCase() === from.toLowerCase() ? to : t)); } return null; },
      deleteNotes({ notes }) { for (const id of notes) { const n = this.notes.get(id); if (!n) continue; for (const cid of n.cardIds) this.cards.delete(cid); this.notes.delete(id); } return null; },

      suspend({ cards }) { let any = false; for (const id of cards) { const c = this.cards.get(id); if (c && c.queue !== -1) { c.queue = -1; any = true; } } return any; },
      unsuspend({ cards }) { let any = false; for (const id of cards) { const c = this.cards.get(id); if (c && c.queue === -1) { c.queue = c.type; any = true; } } return any; },
      forgetCards({ cards }) { for (const id of cards) { const c = this.cards.get(id); if (c) Object.assign(c, { type: 0, queue: 0, interval: 0, reps: 0 }); } return null; },
      setDueDate({ cards, days }) { for (const id of cards) { const c = this.cards.get(id); if (c) Object.assign(c, { type: 2, queue: 2, dueDays: days, due: Number.parseInt(days, 10) }); } return true; },

      storeMediaFile(p) { return this.#storeMedia(p); },
      getMediaFilesNames({ pattern } = {}) {
        const rx = pattern ? new RegExp(`^${this.#pattern(pattern)}$`, 'i') : /./;
        return [...this.media.keys()].filter((n) => rx.test(n));
      },
      deleteMediaFile({ filename }) { this.media.delete(filename); return null; },

      exportPackage({ deck, path, includeSched }) { this.exports.push({ deck, path, includeSched }); writeFileSync(path, 'fake apkg'); return true; },
      importPackage({ path }) { this.imports.push(path); return existsSync(path); },
      guiBrowse({ query }) { this.gui.push({ action: 'guiBrowse', query }); return this.#search(query).map((c) => c.id); },
      guiAddCards({ note }) { this.gui.push({ action: 'guiAddCards', note }); return 4242; },

      getNumCardsReviewedToday() { const start = Date.now() - (Date.now() % DAY); return this.reviews.filter((r) => r.id >= start).length; },
      getNumCardsReviewedByDay() {
        const byDay = new Map();
        for (const r of this.reviews) { const d = new Date(r.id).toISOString().slice(0, 10); byDay.set(d, (byDay.get(d) ?? 0) + 1); }
        return [...byDay].sort((a, b) => b[0].localeCompare(a[0]));
      },
      cardReviews({ deck, startID }) {
        const n = this.#deckName(deck);
        const ids = new Set(this.cardsOfDeck(n).map((c) => c.id));
        return this.reviews.filter((r) => ids.has(r.cardId) && r.id > startID).map((r) => [r.id, r.cardId, -1, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
      },
      getReviewsOfCards({ cards }) {
        return Object.fromEntries(cards.map((id) => [String(id), this.reviews.filter((r) => r.cardId === Number(id)).map((r) => ({ id: r.id, usn: -1, ease: r.ease, ivl: r.ivl, lastIvl: r.lastIvl, factor: r.factor, time: r.time, type: r.type }))]));
      },
    };
  }

  #dropCard(card) {
    this.cards.delete(card.id);
    const note = this.notes.get(card.noteId);
    if (!note) return;
    note.cardIds = note.cardIds.filter((id) => id !== card.id);
    if (!note.cardIds.length) this.notes.delete(note.id);
  }
}
