<div align="center">

<img src="docs/assets/dsh-kimi-mascot.png" width="220" height="220" alt="DSH Kimi Subscription mascot: Moonlight Coder">

# DSH Kimi Subscription

[简体中文](README.md) · **English**

**Code, search, and check your quota in DSH with a Kimi Code subscription.**

Connect with a subscription API key or device sign-in.
Use Kimi models, web search, and usage information inside DeepSeek Harness without a separate pay-as-you-go Open Platform key.

[![CI](https://github.com/BaronCyrus/dsh-kimi-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/BaronCyrus/dsh-kimi-subscription/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-kimi-subscription?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-kimi-subscription)
[![Total npm downloads](https://img.shields.io/npm/dt/dsh-kimi-subscription?logo=npm&label=total%20downloads)](https://www.npmjs.com/package/dsh-kimi-subscription)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Star](https://img.shields.io/github/stars/BaronCyrus/dsh-kimi-subscription?style=flat&logo=github&label=Star)](https://github.com/BaronCyrus/dsh-kimi-subscription/stargazers)

[Features](#features) · [Install](#install) · [Daily use](#daily-use) · [Screenshots](#screenshots) · [User guide](#user-guide) · [Update and uninstall](#update-and-uninstall)

</div>

## Features

| Capability | What it does |
| --- | --- |
| **Dedicated subscription models** | Adds a `Kimi subscription` group without replacing your existing `kimi-coding` or Open Platform configuration |
| **Two connection methods** | Accepts a Kimi Code subscription API key or device sign-in; OAuth supports automatic refresh |
| **Subscription web search** | Leaves existing search routing alone by default; optionally routes by model or uses Kimi search |
| **Visible quota** | Shows usage, reset times, and reported booster balances in Settings, with a compact remaining-quota display beside the composer |
| **Update checks in Settings** | Shows current and latest versions; supported npm installs can update directly, while local development installs receive separate guidance |
| **Clear credential boundaries** | DSH Host manages credentials without returning them through browser RPC; subscription failures do not silently switch to another paid model route |

## Install

You need **DeepSeek Harness** and an active **Kimi Code subscription**. For DSH setup, see the [official instructions](https://github.com/deepseek-ai/deepseek-harness#run). See the guide for [compatibility declarations and validation records](docs/guide.en.md#installation-and-compatibility).

### 1. Install the plugin

Run in a terminal:

```sh
dsh plugin --profile web add dsh-kimi-subscription@latest
```

Then **manually restart the target DSH instance**. Refreshing the browser alone does not reload the plugin inside the Host process.

### 2. Connect your subscription

Open **Settings → Kimi subscription**. Enter a **subscription API key** created in the Kimi Code console, or follow the **device sign-in** flow.

> A subscription API key is not a pay-as-you-go Kimi Open Platform key. Do not mix them, or post keys, device codes, or login callbacks in public issues.

### 3. Select a model

Choose a model your subscription can use from the **Kimi subscription** group, then start a conversation or coding task. A model appearing in the list does not guarantee that your account has access to it.

<details>
<summary>Verify the install / use npx / pin a version</summary>

Check the installation in the selected profile:

```sh
dsh plugin --profile web list dsh-kimi-subscription --depth 0
```

When you run DSH through `npx` without a global `dsh` command, retain the complete launcher prefix. This example uses a DSH version with a compatibility record in the repository:

```sh
npx -y @deepseek-ai/dsh@0.2.0-rc.1 plugin --profile web add dsh-kimi-subscription@latest
```

For pinned releases, local release archives, and desktop installation, see [Installation and compatibility](docs/guide.en.md#installation-and-compatibility). Do not modify the desktop application's managed `desktop` profile through the CLI.

</details>

## Daily use

**Pick a model.** Switch models within `Kimi subscription`. When a plan-access message appears, choose a model your account can use. See [Models and subscription access](docs/guide.en.md#models-and-subscription-access).

**Check quota.** The composer can show a compact readout such as `5h 82%　7d 64%`; those numbers are examples, not an allowance promise. Open Settings for detailed usage, remaining percentages, resets, and booster information returned for your account.

**Enable search deliberately.** Open **Settings → Kimi subscription → Web search**. The default is **Do not take over**; optionally select **Auto (route by model)** or **Always use Kimi search**. With the Codex subscription plugin installed, read [Search coexistence](docs/guide.en.md#web-search-and-codex-coexistence) first.

## Screenshots

<p align="center">
  <img src="https://github.com/user-attachments/assets/b6d485b9-bbf4-49fe-972b-6b6bff4a0812" width="720" alt="Kimi subscription settings in DSH">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/90e68f0b-974b-4f19-a17d-5735773c3f98" width="800" alt="Compact Kimi subscription quota beside the DSH composer">
</p>

Screenshots illustrate where features appear. Models, quota, and controls depend on your installed version and account.

## User guide

The [full user guide](docs/guide.en.md) covers installation, compatibility, model access, quota, search routing, troubleshooting, and removal.

Quick links: [Sign-in and credentials](docs/guide.en.md#sign-in-and-credentials) · [Search and Codex coexistence](docs/guide.en.md#web-search-and-codex-coexistence) · [Troubleshooting](docs/guide.en.md#troubleshooting) · [Changelog](CHANGELOG.md).

## Update and uninstall

**Update an npm installation:** check for updates in Settings, or run:

```sh
dsh plugin --profile web add dsh-kimi-subscription@latest
```

For a local `link:` development install, pull, test, and rebuild its checkout instead. Do not replace the development link with the npm command above.

The desktop app owns its `desktop` profile exclusively and refuses `dsh plugin --profile desktop …`, so the desktop **Update plugin** button installs the exact version into that profile with DSH's bundled pnpm. Manual recovery steps are in [Updates and cleanup](docs/guide.en.md#updates-and-cleanup).

**Uninstall:** if Kimi search was enabled, first switch it to **Do not take over**, then run:

```sh
dsh plugin --profile web remove dsh-kimi-subscription
```

Manually restart the target DSH instance after installation, updates, or removal. If the plugin is already removed but its search patch remains, remove only its marked block as described in [Updates and cleanup](docs/guide.en.md#updates-and-cleanup); do not delete the entire profile.

## FAQ

**Signed in, but one model does not work?** The catalog is not filtered by your subscription tier. Model-access rejections and invalid credentials need different checks; see [Troubleshooting](docs/guide.en.md#troubleshooting).

**No quota readout?** Check that a Kimi subscription model is selected, then refresh usage in Settings. Missing usage data should not be interpreted as a zero balance.

**Still seeing the old UI?** Restart DSH fully, then refresh the page. A browser refresh alone does not reload the Host adapter.

## Security and scope

This is a community plugin, not affiliated with or endorsed by DeepSeek or Moonshot AI. The project is intended for personal interactive use; consult the [Kimi Code Community Guidelines](https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html) for subscription usage rules.

Credentials stay Host-side; the browser receives only necessary status and usage information. Model requests still go to the relevant Kimi service: keeping credentials out of browser responses does not mean inference is offline. See [SECURITY.md](SECURITY.md).

Use [Issues](https://github.com/BaronCyrus/dsh-kimi-subscription/issues) for ordinary bugs and [private vulnerability reporting](https://github.com/BaronCyrus/dsh-kimi-subscription/security/advisories/new) for security issues. Never publish credentials or raw account responses.

## Local development

```sh
git clone https://github.com/BaronCyrus/dsh-kimi-subscription.git
cd dsh-kimi-subscription
pnpm install --frozen-lockfile
pnpm run check
```

See [Local development](docs/guide.en.md#local-development) for linking and rebuild steps. Read [AGENTS.md](AGENTS.md) before agent-assisted changes or releases; do not hand-edit generated `lib/` files.

## References and acknowledgements

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [Kimi Code](https://github.com/MoonshotAI/kimi-code) · [Model documentation](https://www.kimi.com/code/docs/en/kimi-code/models.html) · [Membership](https://www.kimi.com/code/docs/en/kimi-code/membership.html) · [Third-party tools](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html) · [DSH Codex Subscription](https://github.com/WSL043/dsh-codex-subscription)

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for implementation references and third-party licenses.

## License

[MIT](LICENSE)
