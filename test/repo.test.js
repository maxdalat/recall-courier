// Invariants from the plugin pre-submission checklist, enforced in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../server/version.js';
import { allTools } from '../server/tools/index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function walk(dir = ROOT, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = walk();
const rel = (f) => path.relative(ROOT, f);

test('manifest: name, version, license, author, userConfig', () => {
  const m = json('.claude-plugin/plugin.json');
  assert.match(m.name, /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
  assert.ok(m.name.length <= 64);
  for (const reserved of ['claude', 'anthropic', 'official', 'mcp', 'plugin', 'test']) assert.notEqual(m.name, reserved);
  assert.doesNotMatch(m.name, /claude|anthropic|official|anki/);
  assert.equal(m.version, '0.1.0');
  assert.equal(m.version, VERSION);
  assert.equal(m.version, json('package.json').version);
  assert.equal(m.license, 'MIT');
  assert.deepEqual(m.author, { name: 'Maxim Dalat', url: 'https://github.com/maxdalat' });
  assert.ok(!JSON.stringify(m).includes('@gmail') && !JSON.stringify(m).includes('@'), 'no email in the manifest');
  assert.match(m.description, /not affiliated with Anki or Ankitects/i);
  assert.match(m.description, /unofficial/i);
  assert.equal(m.homepage, 'https://github.com/maxdalat/recall-courier#readme');
  assert.equal(m.repository, 'https://github.com/maxdalat/recall-courier');
  assert.equal(m.privacyPolicyUrl, 'https://github.com/maxdalat/recall-courier/blob/main/PRIVACY.md');
  assert.ok(m.keywords.length >= 3);
  assert.equal(m.userConfig.anki_connect_url.default, 'http://127.0.0.1:8765');
  assert.equal(m.userConfig.anki_connect_api_key.sensitive, true);
  for (const [k, v] of Object.entries(m.userConfig)) {
    assert.match(k, /^[A-Za-z_][A-Za-z0-9_]*$/);
    assert.ok(v.type && v.title && v.description, k);
    assert.ok('default' in v, `${k} needs a default so Cowork can load the server`);
  }
  assert.equal(m.displayName, 'Recall Courier for Anki');
  assert.ok(!('mcpServers' in m), 'servers are declared in .mcp.json only');
});

test('.mcp.json launches the server exactly as required, with only userConfig substitutions', () => {
  const mcp = json('.mcp.json');
  const servers = Object.values(mcp.mcpServers);
  assert.equal(servers.length, 1);
  const s = servers[0];
  assert.equal(s.command, 'node');
  assert.deepEqual(s.args, ['${CLAUDE_PLUGIN_ROOT}/server/index.js']);
  const declared = Object.keys(json('.claude-plugin/plugin.json').userConfig);
  for (const value of Object.values(s.env)) {
    const m = value.match(/^\$\{user_config\.([A-Za-z0-9_]+)\}$/);
    assert.ok(m && declared.includes(m[1]), `${value} must reference a declared userConfig key`);
  }
  assert.deepEqual(Object.keys(s).sort(), ['args', 'command', 'env']);
  assert.ok(!/npx|npm|sh -c|bash/.test(JSON.stringify(mcp)));
});

test('marketplace.json lists exactly this plugin at the repository root', () => {
  const mk = json('.claude-plugin/marketplace.json');
  assert.equal(mk.plugins.length, 1);
  assert.equal(mk.plugins[0].name, json('.claude-plugin/plugin.json').name);
  assert.equal(mk.plugins[0].source, './');
  assert.ok(mk.owner.name);
  assert.ok(!('version' in mk.plugins[0]), 'version lives in plugin.json only');
});

test('file rules: sizes, no symlinks, no forbidden files, no binaries', () => {
  const banned = ['.gitattributes', 'package-lock.json', 'npm-shrinkwrap.json', '.npmrc', 'bun.lock', 'bun.lockb', '.DS_Store', 'Thumbs.db', 'desktop.ini'];
  assert.ok(files.length <= 512);
  for (const f of files) {
    const name = path.basename(f);
    assert.ok(!banned.includes(name), `${rel(f)} is not allowed`);
    assert.ok(!lstatSync(f).isSymbolicLink(), `${rel(f)} is a symlink`);
    assert.ok(lstatSync(f).size < 256 * 1024, `${rel(f)} is 256 KiB or larger`);
    const buf = readFileSync(f);
    assert.ok(!buf.includes(0), `${rel(f)} looks binary`);
    assert.doesNotMatch(rel(f), /[:<>"|?*]|\.$/, `${rel(f)} has an invalid name`);
    if (/\.(js|mjs|json|md|svg|yml)$/.test(f)) {
      const longest = Math.max(...buf.toString('utf8').split('\n').map((l) => l.length));
      assert.ok(longest < 700 || /(README|SKILL|CHANGELOG|PRIVACY|SECURITY|CONTRIBUTING|DECISIONS|CHECKLIST|SUBMISSION)\.md$/.test(f), `${rel(f)} has a ${longest}-character line (minified?)`);
    }
  }
  const pkg = json('package.json');
  assert.equal(pkg.type, 'module');
  assert.ok(!pkg.dependencies && !pkg.devDependencies && !pkg.optionalDependencies, 'package.json must have no dependencies');
  assert.equal(readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split('\n').filter(Boolean).sort().join(','), '.DS_Store,Thumbs.db,node_modules');
});

test('server source: network, process and environment use match the README disclosures', () => {
  const server = files.filter((f) => rel(f).startsWith('server/') && f.endsWith('.js'));
  assert.ok(server.length >= 10, 'code is split into several small files');
  for (const f of server) {
    const src = readFileSync(f, 'utf8');
    const r = rel(f);
    assert.ok(src.split('\n').length < 400, `${r} is too long; split it`);
    assert.doesNotMatch(src, /\brequire\(|node:(http|https|net|dgram|dns|tls)['"]|from ['"]http/, `${r} must not open other network connections`);
    if (r !== 'server/ankiconnect.js') assert.doesNotMatch(src, /\bfetch\(|fetchImpl\(/, `${r} makes network calls`);
    if (r !== 'server/setup.js') assert.doesNotMatch(src, /child_process/, `${r} runs processes`);
    assert.doesNotMatch(src, /shell:\s*true|\bexec(Sync)?\(|\beval\(|new Function/, `${r} uses a shell or eval`);
    if (!['server/config.js', 'server/setup.js', 'server/index.js'].includes(r)) assert.doesNotMatch(src, /process\.env/, `${r} reads the environment`);
    assert.doesNotMatch(src, /\.sqlite|collection\.anki2|better-sqlite|sqlite3/i, `${r} touches Anki's database`);
  }
  const config = readFileSync(path.join(ROOT, 'server/config.js'), 'utf8');
  const vars = [...config.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(vars)], ['RECALL_COURIER_API_KEY', 'RECALL_COURIER_AUTO_LAUNCH', 'RECALL_COURIER_URL']);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'server/setup.js'), 'utf8'), /TOKEN|SECRET|PASSWORD|API_KEY/i, 'setup.js must not read credentials');
});

test('skill: valid front matter with a single-string description', () => {
  const src = read('skills/anki-cards/SKILL.md');
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'front matter present');
  const lines = m[1].split('\n');
  assert.equal(lines[0], 'name: anki-cards');
  assert.match(lines[1], /^description: [^\n]{40,}$/);
  assert.equal(lines.length, 2, 'only name and a one-line description');
  assert.doesNotMatch(lines[1], /^description: ["'\[{|>]/);
  assert.ok(!lines[1].slice(13).includes(': '), 'colon-space inside a plain YAML scalar would break parsing');
  assert.equal(readdirSync(path.join(ROOT, 'skills')).join(), 'anki-cards');
  for (const needle of ['list_decks', 'list_note_types', 'minimum information', '\\(', '\\lt', '\\gt', '20 cards', 'confirm', 'skipped_duplicates', 'anki_sync']) {
    assert.ok(src.includes(needle) || src.toLowerCase().includes(needle.toLowerCase()), `SKILL.md should mention ${needle}`);
  }
  // every tool the skill names exists
  const names = new Set(allTools().map((t) => t.name));
  for (const [, n] of src.matchAll(/`([a-z_]+)`/g)) {
    if (/_/.test(n) && !['create_deck_if_missing', 'skipped_duplicates', 'new_cards_per_day'].includes(n)) assert.ok(names.has(n), `SKILL.md names unknown tool ${n}`);
  }
});

test('README and PRIVACY: required sections and content', () => {
  const readme = read('README.md');
  const prose = readme.replace(/```[\s\S]*?```/g, '');
  assert.ok(prose.split(/\s+/).filter(Boolean).length > 40);
  assert.ok(prose.split(/\s+/).filter(Boolean).length > 400, 'README should be substantial');
  for (const heading of ['## What you can ask', '## Requirements', '## Install', '## Tools', '## What this plugin runs and connects to', '## Privacy Policy', '## Troubleshooting']) {
    assert.ok(readme.includes(heading), heading);
  }
  assert.match(readme, /not affiliated with, endorsed by, or sponsored by Anki, Ankitects/);
  assert.match(readme, /Node\.js 18/);
  assert.match(readme, /2055492159/);
  assert.match(readme, /browser-only claude\.ai/);
  assert.match(readme, /\/plugin marketplace add maxdalat\/recall-courier/);
  const examples = readme.split('## What you can ask')[1].split('## Requirements')[0].split('\n').filter((l) => l.startsWith('- '));
  assert.ok(examples.length >= 5);
  for (const t of allTools()) assert.ok(readme.includes(`\`${t.name}\``), `README should list ${t.name}`);
  for (const needle of ['127.0.0.1', 'launch the Anki app', 'only when you ask', 'Data collection', 'Third-party sharing', 'Retention', 'Contact', 'github.com/maxdalat/recall-courier/issues']) {
    assert.ok(readme.includes(needle), `README mentions ${needle}`);
  }
  const privacy = read('PRIVACY.md');
  for (const needle of ['Data collection', 'Usage and storage', 'Third-party sharing', 'Data retention', 'Contact', 'Anthropic', 'issues']) assert.ok(privacy.includes(needle), needle);
  for (const f of ['SECURITY.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'LICENSE']) assert.ok(read(f).length > 100, f);
  assert.match(read('LICENSE'), /^MIT License/);
});

test('names, markdown references and secrets', () => {
  const lower = new Map();
  for (const f of files) {
    const key = rel(f).toLowerCase();
    assert.ok(!lower.has(key), `${rel(f)} collides with ${lower.get(key)} on case-insensitive file systems`);
    lower.set(key, rel(f));
  }
  for (const f of files.filter((x) => x.endsWith('.md'))) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/icon\.svg/.test(src), `${rel(f)} must not mention the bundled icon path`);
  }
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,}/, `${rel(f)} looks like it contains a secret`);
  }
});
