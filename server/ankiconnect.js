// Minimal AnkiConnect (API version 6) client. The only network destination is the configured loopback URL.
import { AnkiConnectError, AnkiUnreachableError, ToolError } from './errors.js';

const API_VERSION = 6;

export class AnkiClient {
  constructor({ url, apiKey = '', fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
    this.url = url;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async #post(body, timeoutMs) {
    let response;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new ToolError(
          `AnkiConnect at ${this.url} did not answer within ${Math.round((timeoutMs ?? this.timeoutMs) / 1000)} seconds. ` +
            'Anki may be busy or showing a dialog. Ask the user to check the Anki window, then retry.',
        );
      }
      throw new AnkiUnreachableError(this.url, err);
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ToolError(
        `Something is listening at ${this.url}, but it did not answer like AnkiConnect (HTTP ${response.status}). ` +
          'Another program may be using that port. Ask the user to close it, or change AnkiConnect\'s webBindPort and the plugin\'s "AnkiConnect URL" setting.',
      );
    }
    return payload;
  }

  // Calls one AnkiConnect action and returns its result, or throws a ToolError.
  async invoke(action, params = {}, { timeoutMs } = {}) {
    const body = { action, version: API_VERSION, params };
    if (this.apiKey) body.key = this.apiKey;
    const payload = await this.#post(body, timeoutMs);
    if (payload === null || typeof payload !== 'object' || !('error' in payload)) {
      throw new ToolError(
        `AnkiConnect returned an unexpected reply to "${action}". Ask the user to update the AnkiConnect add-on (Tools > Add-ons) and restart Anki.`,
      );
    }
    if (payload.error !== null) throw new AnkiConnectError(action, payload.error);
    return payload.result;
  }

  // Runs several actions in one round trip. Returns [{ result, error }] in order; never throws on per-item errors.
  async multi(calls, { timeoutMs } = {}) {
    if (calls.length === 0) return [];
    const actions = calls.map(([action, params]) => ({ action, version: API_VERSION, params: params ?? {} }));
    const results = await this.invoke('multi', { actions }, { timeoutMs });
    return results.map((item) => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item) && 'error' in item && 'result' in item) {
        return { result: item.result, error: item.error };
      }
      return { result: item, error: null };
    });
  }

  // requestPermission works without an API key, so it is the cheapest "is AnkiConnect there?" probe.
  async probe() {
    return this.invoke('requestPermission', {}, { timeoutMs: 3000 });
  }
}
