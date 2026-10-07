// Tools about the Anki application itself: status, launch, sync, profiles.
import { AnkiUnreachableError, ToolError } from '../errors.js';
import { detectAnki, findAddon, INSTALL_STEPS } from '../setup.js';
import { matchName } from '../util.js';
import { defineTool, prop } from './helpers.js';

export const appTools = [
  defineTool({
    name: 'anki_status',
    title: 'Check Anki status',
    description:
      'Reports whether the Anki desktop app is installed and running, whether the AnkiConnect add-on answers, ' +
      'the AnkiConnect version, the active profile, and what to do next if something is missing. ' +
      'Does not start Anki.',
    kind: 'read',
    handler: async (_args, ctx) => {
      const install = detectAnki();
      const addon = findAddon();
      const status = {
        ankiconnect_url: ctx.config.url,
        anki_installed: Boolean(install),
        anki_location: install ? install.label : null,
        addon_folder_found: Boolean(addon),
        auto_launch: ctx.config.autoLaunch,
        ankiconnect_reachable: false,
      };
      if (ctx.config.urlError) return { ...status, problem: ctx.config.urlError };
      try {
        const permission = await ctx.client.probe();
        status.ankiconnect_reachable = true;
        status.anki_running = true;
        status.api_key_required = Boolean(permission.requireApiKey);
        status.ankiconnect_version = permission.version ?? null;
        try {
          status.active_profile = await ctx.client.invoke('getActiveProfile');
        } catch (err) {
          status.problem = err.message;
        }
      } catch (err) {
        if (!(err instanceof AnkiUnreachableError)) throw err;
        status.anki_running = false;
        if (!install) {
          status.next_step = `Anki is not installed. Ask the user to install it from https://apps.ankiweb.net, then add AnkiConnect. ${INSTALL_STEPS}`;
        } else if (!addon) {
          status.next_step = `Call anki_launch to start Anki. If it still does not answer, the AnkiConnect add-on is missing. ${INSTALL_STEPS}`;
        } else {
          status.next_step = 'Call anki_launch to start Anki.';
        }
      }
      return status;
    },
  }),

  defineTool({
    name: 'anki_launch',
    title: 'Launch Anki',
    description:
      'Starts the Anki desktop app if it is not already running and waits up to about 30 seconds for AnkiConnect to answer. ' +
      'Does nothing if Anki is already running. Fails with install steps if Anki or the AnkiConnect add-on is missing.',
    kind: 'write',
    idempotent: true,
    handler: async (_args, ctx) => {
      ctx.reset();
      const info = await ctx.ready();
      const permission = await ctx.client.probe();
      let profile = null;
      try {
        profile = await ctx.client.invoke('getActiveProfile');
      } catch {
        // the profile may not be loaded yet; not fatal
      }
      return {
        ready: true,
        launched_by_this_call: info.launched,
        waited_ms: info.waitedMs,
        ankiconnect_version: permission.version ?? null,
        active_profile: profile,
      };
    },
  }),

  defineTool({
    name: 'anki_sync',
    title: 'Sync with AnkiWeb',
    description:
      'Synchronizes the open Anki profile with AnkiWeb, the same as pressing Sync in Anki. ' +
      'Requires the user to be signed in to AnkiWeb inside Anki. Can take a while for large collections.',
    kind: 'destructive',
    handler: async (_args, ctx) => {
      await ctx.call('sync', {}, { timeoutMs: 300000 });
      return { synced: true, note: 'Sync finished. If Anki shows a dialog (for example a full-sync choice), the user needs to answer it in Anki.' };
    },
  }),

  defineTool({
    name: 'anki_list_profiles',
    title: 'List Anki profiles',
    description: 'Lists the profiles in this Anki installation and says which one is currently open.',
    kind: 'read',
    handler: async (_args, ctx) => {
      const [profiles, active] = await ctx.multiStrict([['getProfiles'], ['getActiveProfile']]);
      return { profiles, active_profile: active };
    },
  }),

  defineTool({
    name: 'anki_switch_profile',
    title: 'Switch Anki profile',
    description:
      'Opens a different Anki profile, closing the current one. Other tools then act on the newly opened profile. ' +
      'Syncs and closes the previous profile the way Anki normally does.',
    properties: { name: prop.nonEmpty('Profile name, exactly as returned by anki_list_profiles.') },
    required: ['name'],
    kind: 'write',
    idempotent: true,
    handler: async ({ name }, ctx) => {
      const profiles = await ctx.call('getProfiles');
      const canonical = matchName(name, profiles);
      if (!canonical) {
        throw new ToolError(`Profile "${name}" does not exist. Available profiles: ${profiles.join(', ')}. Pick one of those names.`);
      }
      const ok = await ctx.call('loadProfile', { name: canonical });
      if (ok !== true) throw new ToolError(`Anki could not open profile "${canonical}". Ask the user to check the Anki window for a dialog, then retry.`);
      return { active_profile: canonical };
    },
  }),
];
