// Every error that reaches Claude should say what went wrong and what to do next.

export class ToolError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'ToolError';
    Object.assign(this, extra);
  }
}

// AnkiConnect answered, but with an error string.
export class AnkiConnectError extends ToolError {
  constructor(action, ankiMessage) {
    super(`Anki rejected the "${action}" request: ${ankiMessage}. ${hintFor(ankiMessage)}`);
    this.name = 'AnkiConnectError';
    this.action = action;
    this.ankiMessage = String(ankiMessage);
  }
}

// Nothing is listening at the AnkiConnect URL.
export class AnkiUnreachableError extends ToolError {
  constructor(url, cause) {
    super(
      `Could not reach AnkiConnect at ${url}. Anki is probably not running. ` +
        'Call anki_launch to start it, or ask the user to open Anki.',
    );
    this.name = 'AnkiUnreachableError';
    this.url = url;
    this.cause = cause;
  }
}

export function hintFor(message) {
  const m = String(message).toLowerCase();
  if (m.includes('valid api key')) {
    return (
      'AnkiConnect has an API key enabled. Ask the user to enter the same key in this plugin\'s ' +
      '"AnkiConnect API key" setting (Claude Code: /plugin, then configure Recall Courier), or clear apiKey in ' +
      'Anki under Tools > Add-ons > AnkiConnect > Config.'
    );
  }
  if (m.includes('collection is not available') || m.includes('collection not available')) {
    return (
      'Anki is open but no profile is loaded (a profile picker or sync dialog may be showing). ' +
      'Ask the user to open a profile in Anki, then retry.'
    );
  }
  if (m.includes('unsupported action')) {
    return (
      'The installed AnkiConnect is too old for this action. Ask the user to update it in Anki: ' +
      'Tools > Add-ons > AnkiConnect > check for updates, then restart Anki.'
    );
  }
  if (m.includes('was not found') || m.includes('not found')) {
    return 'Check the name or ID (list_decks, list_note_types, find_notes) and retry.';
  }
  if (m.includes('duplicate')) {
    return 'Pass allow_duplicates: true to add it anyway, or skip it.';
  }
  return 'Check the arguments and retry; if it keeps failing, ask the user to look at Anki for an open dialog.';
}

export function errorMessage(err) {
  if (err instanceof ToolError) return err.message;
  return `Unexpected error in the Recall Courier server: ${err && err.message ? err.message : err}. Retry once; if it persists, report it at https://github.com/maxdalat/recall-courier/issues.`;
}
