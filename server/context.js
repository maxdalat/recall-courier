// Shared state for tool handlers: the AnkiConnect client plus "make sure Anki is up" logic.
import { AnkiConnectError, AnkiUnreachableError } from './errors.js';
import { ensureAnkiConnect } from './setup.js';

export function createContext({ config, client, setupDeps = {}, launchTimeoutMs = 30000, pollMs = 500 }) {
  let readyPromise = null;
  let lastEnsure = null;

  function ready() {
    if (!readyPromise) {
      readyPromise = ensureAnkiConnect({ client, config, deps: setupDeps, timeoutMs: launchTimeoutMs, pollMs })
        .then((info) => {
          lastEnsure = info;
          return info;
        })
        .catch((err) => {
          readyPromise = null;
          throw err;
        });
    }
    return readyPromise;
  }

  // Runs fn once; if Anki went away since the last call, tries to bring it back and runs fn again.
  async function withRecovery(fn) {
    await ready();
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof AnkiUnreachableError)) throw err;
      readyPromise = null;
      await ready();
      return fn();
    }
  }

  return {
    config,
    client,
    ready,
    lastEnsure: () => lastEnsure,
    // Forget that AnkiConnect was reachable, so the next ready() checks (and launches) again.
    reset: () => {
      readyPromise = null;
    },
    call: (action, params, opts) => withRecovery(() => client.invoke(action, params, opts)),
    // Returns [{ result, error }] per call.
    multi: (calls, opts) => withRecovery(() => client.multi(calls, opts)),
    // Like multi, but throws on the first per-item error.
    async multiStrict(calls, opts) {
      const out = await this.multi(calls, opts);
      const bad = out.findIndex((r) => r.error !== null);
      if (bad !== -1) {
        throw new AnkiConnectError(calls[bad][0], out[bad].error);
      }
      return out.map((r) => r.result);
    },
  };
}
