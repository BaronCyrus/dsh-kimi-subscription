# Kimi subscription user guide

[Project home](../README.en.md) · [简体中文](guide.zh-CN.md) · **English**

This guide expands installation, access, search, and troubleshooting details. Start with the [README](../README.en.md#install) for the quick setup.

## Installation and compatibility

The repository declares a DSH peer range of `>=0.1.1-rc.2 <0.3.0-0`. Recorded versions, dependencies, and validation scope are in [compatibility.json](../compatibility.json) and [package.json](../package.json). A declared range does not mean every version has passed complete GUI, sign-in, and live-model checks.

**Desktop application (the only supported way):** open the app's **Plugins** page, click **Add plugin**, enter `dsh-kimi-subscription` as the **package name or address**, choose the **official** install source, then click **Install**. The same field also accepts a GitHub repository address or an absolute path to a local plugin directory.

**Manually restart the desktop application afterwards**; the app itself reports that changes take effect on the next launch.

For a reproducible install, add the version in that same field (substitute the version you want):

```text
dsh-kimi-subscription@1.3.5
```

A `dsh-kimi-subscription-1.3.5.tgz` downloaded from [GitHub Releases](https://github.com/BaronCyrus/dsh-kimi-subscription/releases/latest) can be installed from its absolute path instead, which suits offline or audited setups.

**Other profiles (for example a scratch profile):** `dsh plugin --profile <name> add dsh-kimi-subscription@latest` still works for non-desktop profiles. Do **not** use it for `desktop`: the CLI refuses it outright (`profile "desktop" is managed exclusively by the Electron application`). Use the Plugins page above instead.

The Plugins page lists only the profiles that exist in this deployment. If it reports that there is no manageable profile, the profile is not ready yet and should be initialized in the desktop application first. Before sharing diagnostics, check for and hide personal paths and sensitive configuration; never publish a whole config.

Restart the desktop application after installation. For further local checks on a non-desktop profile, `dsh --profile <name> --dump-config` should show one `kimi-subscription` entry.

## Sign-in and credentials

In **Settings → Kimi subscription**, choose a Kimi Code subscription API key or device sign-in. Create the former in the Kimi Code console; complete the latter through the official authorization flow shown in the UI.

The plugin connects to Kimi Code at `https://api.kimi.com/coding`. This is distinct from the pay-as-you-go Open Platform at `api.moonshot.ai` / `api.moonshot.cn`; keys and allowances are not interchangeable. It does not silently use an ambient Open Platform key as a fallback.

DSH Host's credential service manages API keys and OAuth credentials. OAuth supports automatic refresh, but revoked authorization, invalid sessions, or connectivity problems can still require sign-in again. Automatic refresh is not a promise of permanent connectivity. See [SECURITY.md](../SECURITY.md).

## Models and subscription access

The catalog comes from the pi-ai Kimi Code provider used by the plugin. The repository's recorded `0.85.1` catalog includes `k3`, `k3-256k`, `kimi-for-coding`, and `kimi-for-coding-highspeed`; the effective catalog depends on installed dependencies.

The repository applies a local metadata correction for `kimi-for-coding`: the name **Kimi K2.8 Preview**, a declared context window of `1048576`, and a `low` / `high` / `max` thinking-level map. These are plugin metadata, not a guarantee of backend capacity or account access. See [pi-ai-runtime.js](../src/pi-ai-runtime.js).

**The catalog is not an entitlement list.** Models are not filtered by membership tier. Consult the [Kimi Code model documentation](https://www.kimi.com/code/docs/kimi-code/models.html) and your account instead of relying on a static plan comparison that may become outdated.

When the backend explicitly reports that a model is outside the account's access or plan, the plugin translates that rejection into a readable model-access message. Other `401`, authentication, and network failures require their own diagnosis; not every `401` means an insufficient tier.

## Quota

Settings reads Kimi Code `/coding/v1/usages` and presents the remaining percentages, used amounts, reset times, and booster information actually returned. The compact composer display shows short and weekly windows and refreshes every 60 seconds in the current implementation.

`5h 82%　7d 64%` is only a formatting example. It is not your balance or a promise that every account has those windows. If no usable reading is available, refresh usage in Settings and inspect the error; missing data does not mean zero quota. See [usage.js](../src/usage.js) and [client.jsx](../src/client.jsx).

## Web search and Codex coexistence

A DSH runtime has one effective global search-provider slot. Selecting a chat model does not necessarily select a search provider. This plugin registers `kimi-subscription` and `kimi-subscription-auto`, using Kimi Code `/coding/v1/search`.

| Setting | Behavior managed by this plugin |
| --- | --- |
| **Do not take over (default)** | Leaves DSH or another plugin's search arrangement in place; switching back restores the part this plugin managed |
| **Auto (route by model)** | Kimi models use Kimi search, routing can compose with Codex search, and other models use the configured DSH default |
| **Always use Kimi search** | When no other plugin manages the search slot, routes searches through Kimi; requests fail while that subscription is disconnected |

Changing search routing is an explicit global setting, not an automatic paid fallback after a model request fails.

**With the Codex subscription plugin installed:** when its search manager is detected, Kimi does not compete for the runtime slot. Instead, it maintains a marked `web.searchProvider` block in the owning profile's `cordis.patch.yml`. Start with **Auto**. Codex still participates in the final routing, so **Always use Kimi** should not be read as overriding every other plugin policy. Coexistence also depends on the installed Codex plugin version.

The intended composed route sends Kimi models to Kimi search, Codex models to the corresponding Codex search, and other models to the DSH default. DSH hot-loads the profile patch. Switching back to **Do not take over** removes this plugin's marked block without deleting other patch entries. See [index.js](../src/index.js), [kimi-search.js](../src/kimi-search.js), and [search-composition.js](../src/search-composition.js).

## Troubleshooting

**Missing Settings page or an old version still running.** Confirm the plugin was installed into the profile you actually run, then restart DSH and refresh the browser. A successful install does not prove the running process loaded the new code.

**Device authorization failed.** Follow the distinct denied, expired-code, and network failure messages. Start a new flow for an expired code, or check Host connectivity for a network failure. Do not classify every failure as an invalid key.

**Sign-in and usage work, but a model fails.** Usage reads and model calls are separate requests. Check for an explicit model-access rejection and try a model the account can use. For authentication failures, inspect the credential type and session state instead.

**No quota badge.** Select a model from `Kimi subscription`, then refresh usage in Settings. Share only a sanitized error, never the raw account response.

**Unexpected search provider.** Check the Kimi search option, the Codex plugin if installed, and the marked block in the relevant profile. Do not remove the entire `cordis.patch.yml` to undo one search setting.

## Updates and cleanup

**Update.** Prefer **Settings → Kimi subscription → Update plugin** in the desktop app: it installs the exact version into the `desktop` profile with DSH's bundled pnpm and reads the version back from `package.json`, so a command that installed nothing never reads as success. Local `link:` development installs cannot use that button; pull, test, and rebuild the checkout instead.

The desktop app owns its `desktop` profile exclusively, and `dsh plugin --profile desktop …` is refused by the CLI with `profile "desktop" is managed exclusively by the Electron application`, so do not reach for the CLI. On an older version whose button fails, run this manually (pnpm ≥ 11):

```sh
cd "$HOME/.dsh/profiles/desktop"    # Windows: cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add --save-exact dsh-kimi-subscription@1.3.5
```

Then quit the desktop app completely and start it again. A successful update shows the target version in that profile's `package.json` while its `dsh.profile.bundles` entry stays unchanged.

**Uninstall.** Switch search to **Do not take over** first, then use **Uninstall** for this plugin on the app's **Plugins** page.

If already removed, delete only the following markers and the block between them from the owning profile's `cordis.patch.yml`:

```text
# >>> dsh-kimi-subscription: web search provider
# <<< dsh-kimi-subscription: web search provider
```

The default path is `~/.dsh/profiles/<profile>/cordis.patch.yml`; honor `DSH_HOME` when set. Back up the file and retain all unrelated entries. If no YAML entries remain, leave a valid empty list `[]`. Do not delete the whole profile or clear unrelated plugins and credentials.

## Local development

```sh
git clone https://github.com/BaronCyrus/dsh-kimi-subscription.git
cd dsh-kimi-subscription
pnpm install --frozen-lockfile
pnpm run check
```

To let the desktop app link to a checkout, hand the plugin's absolute path to **Add plugin** on the Plugins page (that field accepts a local directory). For a non-desktop profile the CLI also works:

```sh
dsh plugin --profile <name> add /absolute/path/to/dsh-kimi-subscription
```

`pnpm run check` tests, builds, and creates a package in `.artifacts/`. After source changes, test, rebuild, and manually restart DSH. For documentation-only changes, run `pnpm run test` and `git diff --check`. A successful build does not verify sign-in, GUI behavior, or live model calls.

Follow [AGENTS.md](../AGENTS.md) for agent operations and releases. A documentation commit is not authorization to publish an npm package or release.
