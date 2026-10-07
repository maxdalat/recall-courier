// Finding Anki on disk, launching it, and diagnosing a missing AnkiConnect add-on.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { AnkiUnreachableError, ToolError } from './errors.js';

export const ADDON_CODE = '2055492159';
export const FLATPAK_ID = 'net.ankiweb.Anki';
export const DOWNLOAD_URL = 'https://apps.ankiweb.net';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultDeps() {
  return { platform: process.platform, home: homedir(), env: process.env, exists: existsSync, spawn, sleep, now: Date.now };
}

function onPath(command, d) {
  const dirs = (d.env.PATH || '').split(d.platform === 'win32' ? ';' : ':').filter(Boolean);
  const names = d.platform === 'win32' ? [`${command}.exe`, command] : [command];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (d.exists(full)) return full;
    }
  }
  return null;
}

// Returns { kind, label, command, args } or null when Anki is not installed in a standard place.
export function detectAnki(overrides = {}) {
  const d = { ...defaultDeps(), ...overrides };
  if (d.platform === 'darwin') {
    for (const app of ['/Applications/Anki.app', path.join(d.home, 'Applications', 'Anki.app')]) {
      if (d.exists(app)) return { kind: 'macos-app', label: app, command: 'open', args: ['-a', app] };
    }
    return null;
  }
  if (d.platform === 'win32') {
    const roots = [
      d.env.LOCALAPPDATA && path.join(d.env.LOCALAPPDATA, 'Programs'),
      d.env.ProgramFiles,
      d.env['ProgramFiles(x86)'],
    ].filter(Boolean);
    for (const root of roots) {
      const exe = path.join(root, 'Anki', 'anki.exe');
      if (d.exists(exe)) return { kind: 'windows-exe', label: exe, command: exe, args: [] };
    }
    return null;
  }
  const bin = onPath('anki', d);
  if (bin) return { kind: 'path', label: bin, command: bin, args: [] };
  const dataHome = d.env.XDG_DATA_HOME || path.join(d.home, '.local', 'share');
  const flatpakDirs = [
    path.join('/var/lib/flatpak/app', FLATPAK_ID),
    path.join(dataHome, 'flatpak', 'app', FLATPAK_ID),
    path.join(d.home, '.var', 'app', FLATPAK_ID),
  ];
  const flatpak = onPath('flatpak', d);
  if (flatpak && flatpakDirs.some((p) => d.exists(p))) {
    return { kind: 'flatpak', label: `flatpak ${FLATPAK_ID}`, command: flatpak, args: ['run', FLATPAK_ID] };
  }
  return null;
}

// Where the AnkiConnect add-on folder would be, for each way Anki can be installed.
export function addonFolders(overrides = {}) {
  const d = { ...defaultDeps(), ...overrides };
  if (d.platform === 'darwin') {
    return [path.join(d.home, 'Library', 'Application Support', 'Anki2', 'addons21', ADDON_CODE)];
  }
  if (d.platform === 'win32') {
    const appData = d.env.APPDATA || path.join(d.home, 'AppData', 'Roaming');
    return [path.join(appData, 'Anki2', 'addons21', ADDON_CODE)];
  }
  const dataHome = d.env.XDG_DATA_HOME || path.join(d.home, '.local', 'share');
  return [
    path.join(dataHome, 'Anki2', 'addons21', ADDON_CODE),
    path.join(d.home, '.var', 'app', FLATPAK_ID, 'data', 'Anki2', 'addons21', ADDON_CODE),
  ];
}

export function findAddon(overrides = {}) {
  const d = { ...defaultDeps(), ...overrides };
  return addonFolders(d).find((p) => d.exists(p)) ?? null;
}

export const INSTALL_STEPS =
  'To install it, in Anki choose Tools > Add-ons > Get Add-ons..., enter the code 2055492159, press OK, then restart Anki.';

export function notInstalledError() {
  return new ToolError(
    `Anki does not appear to be installed on this computer (no Anki app was found in the standard locations). ` +
      `Ask the user to download and install Anki from ${DOWNLOAD_URL}, open it once, and then install the AnkiConnect add-on. ${INSTALL_STEPS} ` +
      'If Anki is installed somewhere unusual, ask the user to start it manually and retry.',
  );
}

export function addonMissingError(url) {
  return new ToolError(
    `Anki is running, but nothing answers at ${url}, and the AnkiConnect add-on folder was not found. ` +
      `Recall Courier needs the free AnkiConnect add-on (code ${ADDON_CODE}). ${INSTALL_STEPS} ` +
      'Recall Courier never installs add-ons itself. After the restart, retry.',
  );
}

export function addonSilentError(url, folder) {
  return new ToolError(
    `AnkiConnect is installed (${folder}) but did not answer at ${url} within the wait time. ` +
      'Possible causes: Anki is still starting or is showing a profile picker or dialog; the add-on is disabled; ' +
      'its webBindPort in Tools > Add-ons > AnkiConnect > Config is not the port in this plugin\'s "AnkiConnect URL" setting; ' +
      'or a firewall is blocking Anki. Ask the user to check the Anki window and those settings, then retry.',
  );
}

export function launchAnki(install, overrides = {}) {
  const d = { ...defaultDeps(), ...overrides };
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = d.spawn(install.command, install.args, { detached: true, stdio: 'ignore', windowsHide: false });
    } catch (err) {
      reject(new ToolError(`Could not start Anki (${install.label}): ${err.message}. Ask the user to start Anki manually, then retry.`));
      return;
    }
    child.once('error', (err) =>
      reject(new ToolError(`Could not start Anki (${install.label}): ${err.message}. Ask the user to start Anki manually, then retry.`)),
    );
    // Give a spawn error a moment to surface, then let go of the child so Anki outlives this server.
    d.sleep(150).then(() => {
      child.unref?.();
      resolve();
    });
  });
}

// Makes sure AnkiConnect answers, launching Anki if allowed. Returns { launched, waitedMs, alreadyRunning }.
export async function ensureAnkiConnect({ client, config, timeoutMs = 30000, pollMs = 500, deps = {} }) {
  const d = { ...defaultDeps(), ...deps };
  if (config.urlError) throw new ToolError(config.urlError);
  if (await isUp(client)) return { launched: false, alreadyRunning: true, waitedMs: 0 };

  if (!config.autoLaunch) {
    throw new ToolError(
      `AnkiConnect is not answering at ${client.url} and automatic launching is turned off in the plugin settings. ` +
        'Ask the user to start Anki (with the AnkiConnect add-on installed), then retry.',
    );
  }
  const install = detectAnki(d);
  if (!install) throw notInstalledError();

  await launchAnki(install, d);
  const started = d.now();
  while (d.now() - started < timeoutMs) {
    await d.sleep(pollMs);
    if (await isUp(client)) return { launched: true, alreadyRunning: false, waitedMs: d.now() - started, installedAt: install.label };
  }
  const folder = findAddon(d);
  throw folder ? addonSilentError(client.url, folder) : addonMissingError(client.url);
}

async function isUp(client) {
  try {
    const reply = await client.probe();
    if (reply && reply.permission === 'denied') {
      throw new ToolError(
        `AnkiConnect at ${client.url} refused this connection. Ask the user to add "http://localhost" to webCorsOriginList ` +
          'in Tools > Add-ons > AnkiConnect > Config, restart Anki, and retry.',
      );
    }
    return Boolean(reply && reply.permission === 'granted');
  } catch (err) {
    if (err instanceof AnkiUnreachableError) return false;
    throw err;
  }
}
