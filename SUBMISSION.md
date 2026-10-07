# Directory submission guide

Everything needed to submit Recall Courier for Anki to Anthropic's plugin directory from the developer portal. Sources: [Submit your plugin](https://claude.com/docs/plugins/submit) and the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).

## 1. Steps

1. On claude.ai, make sure your GitHub account is connected (the portal offers **Connect GitHub** when it needs it; the connection is per Claude organization, and your GitHub account needs push access to the repository).
2. Open <https://claude.ai/directory/manage> and select **Submit new**.
3. When asked **What would you like to submit?**, choose **Plugin bundle** (not "MCP connector": this plugin has no remote server).
4. Fill in the **Source** step (section 2), select **Validate**, and fix anything marked **Blocking**.
5. Check **Listing details** (read from `plugin.json` and the README; to change anything, edit the repository and re-validate).
6. Answer **Data handling** (section 3).
7. Complete **Compliance** (section 4).
8. On **Review and submit**, leave **GitHub push webhook** selected for new versions, then select **Submit for review**. Afterwards use **Set up push updates** (needs admin access to the repository).

## 2. Source step

| Field | Value |
| - | - |
| Repository | `maxdalat/recall-courier` |
| Plugin path | leave blank (the plugin is at the repository root) |
| Branch or tag | `main` |

The repository is public, which the directory requires before a listing goes live. `marketplace.json` lists only this plugin, so it does not trigger the "one plugin per submission" rule ("Pick one plugin first" appears only when a repository's marketplace lists several plugins to submit).

## 3. Data handling answers

| Question | Answer |
| - | - |
| Does the plugin read personal data? | Only the user's own flashcard content (cards, decks, tags, media), read locally from the Anki app on their computer when they ask Claude to. Nothing else. |
| Does it store personal data? | No. It has no database, cache or log files; data lives only in Anki on the user's device. |
| Does it send data to services other than its declared connectors? | Only to AnkiConnect on `127.0.0.1` (the user's own computer). The only other network activity is Anki downloading an https URL when the user explicitly asks to add media from that URL. No analytics, telemetry or third-party services. Card content that Claude reads or writes is part of the user's conversation with Claude. |
| Data retention | None. The plugin keeps nothing; Anki keeps the collection on the user's device. |
| Intended for people under 18? | Not specifically. It is a general-audience study tool and collects no personal data from anyone. |

Privacy policy URL (also set in `plugin.json`): <https://github.com/maxdalat/recall-courier/blob/main/PRIVACY.md>

## 4. Compliance step

- Check that the **contact email** is an address where Anthropic can reach you about the submission (it comes from your claude.ai account; the plugin itself contains no email).
- Select **all four acknowledgements**. They concern the [Anthropic Software Directory Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) and [Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy); read both before ticking. The portal's exact wording is not published in the docs, so confirm it on screen.

## 5. Expected findings and why they are acceptable

A **Policy hold** is not a rejection; a reviewer reads the held version before it can go live. The first version always goes through a reviewer by default.

| Likely finding | Why it appears | Why it is acceptable |
| - | - | - |
| **Name matches a known brand** (or "may be confused with an existing listing") | The display name "Recall Courier for Anki" and the keywords contain the brand "Anki". The plugin `name` itself does not. | It is a compatibility statement ("for Anki"), not an impersonation. The manifest description, README and privacy policy each say it is unofficial and not affiliated with Anki or Ankitects, and no Anki logo or branding is used. If the reviewer objects to the display name, change it to `Recall Courier` and keep "for Anki" in the description, then push a new version. |
| **Uses a credential from the user's machine** (possible) | The server reads one environment variable named like an API key. | The variable is set by the plugin's own sensitive `userConfig` setting through `${user_config.anki_connect_api_key}`; no ambient variable is read, the value only goes to AnkiConnect on localhost, and it is never logged. Described in README and DECISIONS.md. |
| **Scripts the validator couldn't follow** / **MCP server command wasn't read** (unlikely) | The server is a Node file rather than a shell script. | The launch is exactly `node ${CLAUDE_PLUGIN_ROOT}/server/index.js`, the plugin is at the repository root (the docs' stated way to avoid this hold), and the source is plain, readable, unminified ES modules. |
| Reviewer questions about launching an app | The server may start the Anki desktop app. | Disclosed in the README section "What this plugin runs and connects to"; fixed arguments only, no shell; it can be turned off in the plugin settings ("Start Anki automatically"). |
| Reviewer questions about file access | `store_media`, `import_package` and `export_deck` read or write files the user names. | Disclosed in the README; paths must be absolute and are validated; `.colpkg` imports and overwriting exports are refused. |

Warnings you may see when running `claude plugin validate` with an older Claude Code (before 2.1.281): "Unknown field" for `icon`, `documentationUrl`, `supportUrl` and `privacyPolicyUrl`. These are directory listing fields; the portal reads them.

Not verifiable from here: whether the name `recall-courier` is free in the directory ("Name is taken" blocks; "Name may be confused with an existing listing" holds).

## 6. If validation fails

1. Open the finding in the report; each has a title and often a fix.
2. Run `claude plugin validate .` locally from the repository and `npm test` (the repository tests mirror the checklist's file rules).
3. Fix the issue, commit and push to `main`. A validation result applies to one commit, so select **Re-validate** on the **Source** step.
4. Name problems: **Name is taken** needs a new `name` in `plugin.json` and `marketplace.json` (the name is permanent after release, so settle it now). A look-alike is only a hold.
5. If a submission is rejected, read **Requested changes** on the **Review** tab, push a fix, then select **Resubmit for review**.
6. Stuck submissions: see "Contact Anthropic about a submission" in the portal docs (`directory@anthropic.com` for repository ownership questions).

## 7. Updating after approval

- Push to `main` and **bump `version`** in `.claude-plugin/plugin.json` (also `package.json` and `server/version.js`, which a test requires to match). The directory notices the commit through the push webhook or its scheduled check, re-scans it, and publishes it according to the plugin's publish setting. The previous version stays live until then.
- Add a `CHANGELOG.md` entry and a GitHub release with a tag (`v0.1.1`, …).
- The plugin `name` must never change. Edit `displayName` for a new label.
- Use **Check for new commits** on the plugin's page to trigger a scan right away.
