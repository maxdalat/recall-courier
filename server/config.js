// Settings arrive as environment variables that .mcp.json fills in from the plugin's userConfig.
// The server reads only these three variables and never falls back to anything else.

export const DEFAULT_URL = 'http://127.0.0.1:8765';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// An unfilled "${user_config.x}" placeholder counts as "not set".
function clean(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  return /^\$\{.*\}$/.test(v) ? '' : v;
}

export function loadConfig(env = process.env) {
  const rawUrl = clean(env.RECALL_COURIER_URL) || DEFAULT_URL;
  const apiKey = clean(env.RECALL_COURIER_API_KEY);
  const autoLaunch = clean(env.RECALL_COURIER_AUTO_LAUNCH).toLowerCase() !== 'false';

  let url = DEFAULT_URL;
  let urlError = null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:') {
      urlError = `The AnkiConnect URL "${rawUrl}" must start with http://.`;
    } else if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      urlError = `The AnkiConnect URL "${rawUrl}" points to ${parsed.hostname}, which is not this computer.`;
    } else {
      url = `${parsed.protocol}//${parsed.host}`;
    }
  } catch {
    urlError = `The AnkiConnect URL "${rawUrl}" is not a valid URL.`;
  }
  if (urlError) {
    urlError += ' Recall Courier only talks to AnkiConnect on this computer (127.0.0.1 or localhost). ' +
      `Ask the user to fix "AnkiConnect URL" in the plugin settings (default ${DEFAULT_URL}).`;
  }
  return { url, apiKey, autoLaunch, urlError };
}
