# Changelog

## 1.2.14

- Explain a plan-gated model instead of letting it read as a credential failure. Kimi Code gates models by membership tier and answers a request for a model the plan does not include with HTTP 401; the host classifies any 401 as `AUTH` and its chat surface replaces the text with「API 密钥无效」, so a tier limit looked like a broken key. The stream guard now rewrites that terminal failure into an explicit sentence naming the model and suggesting `kimi-for-coding`. The replacement deliberately carries no status code and none of the words the host matches for quota, rate limits, timeouts, or transport faults, which also keeps the failure out of the `AUTH` retry policy that cannot help it.
- Add the tier table and this failure mode to the README.
- No behavior change for any other failure; no live model calls or credential reads.

## 1.2.13

- The host now performs the Kimi device sign-in and token refresh itself instead of delegating to pi-ai's OAuth, which authenticates with the ambient `fetch`. Both requests ask for an identity-encoded body, and the response is additionally decoded by its magic number (gzip / zstd) when the `Content-Encoding` header did not survive the transport. A token response is about 1.5 KB, so it arrives compressed; a transport that hands back the still-compressed bytes used to turn a successful exchange into `device token request failed (status 200)`, which the settings page showed as「操作失败，请重试。」. This removes the plugin's last dependency on the host's response decoding.
- A failed sign-in now carries the name of the step that failed — `denied`, `expired`, `exchange`, `response`, `network`, or `unreachable` — and the settings page renders it as a specific sentence in Chinese or English instead of one generic line. Provider output still never leaves the Host, because it can quote a token.
- A refresh response that does not rotate the refresh token now keeps the previous one, as RFC 6749 allows, instead of failing the credential.
- No live model calls or credential reads.

## 1.2.12

- Replace the enumerated `@deepseek-ai/dsh-*` peer versions with the range `>=0.1.1-rc.2 <0.2.0-0`. The desktop app auto-updated from `0.1.7-rc.1` to `0.1.7-rc.2` and every enumerated peer stopped matching, so profile startup skipped the bundle and the Kimi models disappeared again with `no adapter registered`. A range keeps the plugin loading across the 0.1 line while still refusing `0.2.0` prereleases.
- The peer gate is now asserted by release semantics rather than by literals: `tests/package-contract.test.mjs` runs the installer's rule (`semver.satisfies(runtime, range, { includePrerelease: true })`) against older releases, the current desktop release, and a rejected `0.2.0` prerelease.
- No source behavior change; no live model calls or credential reads.

## 1.2.11

- Fix “无法检查最新版本” on the desktop app when another plugin replaces undici's global dispatcher with one that does not decompress responses. Registry, usage, and search requests now ask for an identity-encoded body, so `response.json()` no longer fails on gzip bytes.
- No live model calls or credential reads.

## 1.2.10

- Fix the desktop settings page on DeepSeek Harness `0.1.7-rc.1`. That host replaced `settings.register` with volatile plugin Config, so `1.2.9` threw `ctx.settings.register is not a function` while applying and never mounted the account RPC. The settings page then reported that it could not read the Kimi subscription status. The search preference now uses `settings.register` on older hosts and this plugin's volatile Config on `0.1.7`.
- No live model calls or credential reads.

## 1.2.9

- Accept DeepSeek Harness `0.1.7-rc.1`, the version shipped in the desktop app. Its plugin installer rejects a package unless every `@deepseek-ai/dsh-*` peer range satisfies that runtime (prereleases included), which is why `1.2.8` was reported as incompatible. Peer ranges now include the `0.1.5` / `0.1.6` / `0.1.7` releases through `0.1.7-rc.1`, and the development baseline is `0.1.7-rc.1`.
- Drop the `@deepseek-ai/dsh-client-runtime` peer. Its last published release is `0.1.1-rc.2`, and the desktop app no longer ships it. The client inject list now names `@deepseek-ai/dsh-client-ui-conversation`, which owns the composer slot this plugin renders into.
- Widen `@deepseek-ai/cordis` to `4.0.4` and `@deepseek-ai/schemastery` to `^3.18.2`, matching the desktop kernel. The `connection` compatibility patch is unchanged and still activates RPC on both the current and `0.1.2-alpha.5` Connection.
- No live model calls, credential reads, or desktop GUI verification.

## 1.2.8

- Fix [#2](https://github.com/BaronCyrus/dsh-kimi-subscription/issues/2): resolve the Kimi subscription retry policy through the host's public `resolveRetryPolicy` helper before passing it to `PiAiAdapter`. Plugin-supplied profiles already need a resolved policy; missing backoff fields previously produced `NaN` delays and `session event "llm/retry" carries non-JSON-serializable data`, masking the original provider error.
- Preserve normal mode, the two-retry limit, and the existing six retryable codes (including `AUTH` for expired-in-flight OAuth tokens). Use host defaults for initial delay, maximum delay, and jitter. This restores bounded retries; it does not restore exhausted quota or fix genuinely revoked credentials.
- Add offline regression coverage at the actual adapter, host retry executor, and Session event-validation boundary, including finite delays, retry exhaustion, provider-directed delays, and cancellation. Test dependencies are pinned to the existing DSH `0.1.5-alpha.2` baseline; supported host versions are unchanged. No live credentials or model requests are used.

## 1.2.7

- Support Kimi Code's K2.8 Preview upgrade: `kimi-for-coding` was upgraded in place (same model ID) to K2.8 Preview with a 1M context window and `low` / `high` / `max` thinking levels (default `max`). pi-ai's bundled catalog still describes K2.7 Code, so the plugin now patches that model's name, context window, and thinking-level map locally until the upstream catalog catches up. No model ID changes; `k3`, `k3-256k`, and `kimi-for-coding-highspeed` are unchanged.

## 1.2.6

- Fix `Cannot read properties of undefined (reading 'get')` when DeepSeek Harness `0.1.5-alpha.2` resolves the Kimi subscription model catalog: initialize the provider profile's `modelErrors` map required by the host PiAiAdapter.
- Extend peer compatibility to DSH `0.1.5-alpha.2` and update development dependencies and the lockfile to test against that host release, retaining previous peer ranges.
- Add a regression test that first reproduced the exact failure and now resolves every advertised Kimi model and prepares its call through the real host adapter. Catalog verification asserts that credentials are not read and never opens a model stream.
- Validation: 59 automated tests, Host/Client builds, and package creation; no live model calls or full GUI/account-flow verification.

## 1.2.5

- Correct the 1.2.4 Connection compatibility patch to retain the official profile's `webRuntime` injection alongside `webServer`. Entry patches replace the row's inject array; dropping `webRuntime` prevents `trustedHosts: !!js ctx.webRuntime.trustedHosts` from being evaluated during startup.
- Exercise the real profile's entry injection and dynamic trusted-host expression in regression tests, including an explicit reproduction of the 1.2.4 failure.

- Validation: 58 automated tests and real profile configuration checks; the user confirmed successful DSH startup after applying the corrected dependency list.

## 1.2.4

- Fix startup on DeepSeek Harness `0.1.5-alpha.1`: the plugin bundle adds `webServer` to the official `connection` loader entry's injected services. This compensates for Connection RPC registration accessing an undeclared owner dependency, without editing installed DSH code or replacing its transport/authentication logic. The patch is guarded by the official package name and is idempotent on previously supported hosts.
- Extend peer compatibility to DSH `0.1.5-alpha.1` and pi-ai `0.85.1`; update the development baseline while retaining prior peer ranges.
- Add real Cordis Loader/Connection regression coverage: reproduce the unpatched failure, activate the full plugin against current and legacy Connection, verify unauthorized requests are rejected, and verify route cleanup on unload. Validation uses isolated fake host resources and no live credentials or provider calls.

## 1.2.3

- Widen the `@deepseek-ai/cordis` peer range to `4.0.1 || 4.0.2`. DeepSeek Harness 0.1.2 hosts bundle cordis 4.0.2 and their packages require `^4.0.2`, so the previous exact `4.0.1` pin made pnpm print an unmet-peer warning on every `dsh plugin add` (harmless under DSH's `autoInstallPeers: false` profile setup, but noisy). No runtime behavior change.

## 1.2.2

- Refresh compatibility metadata for DeepSeek Harness `0.1.2-alpha.5`: peer ranges now accept `0.1.1-rc.2 || 0.1.2-alpha.2 || 0.1.2-alpha.3 || 0.1.2-alpha.5` (`@deepseek-ai/dsh-client-runtime` remains `0.1.1-rc.2`, the newest published), development dependencies build and test against `0.1.2-alpha.5`, and `compatibility.json`/README list `0.1.2-alpha.5` as supported. No runtime behavior change.

## 1.2.1

- Refresh compatibility metadata for DeepSeek Harness 0.1.2: peer ranges now accept `0.1.1-rc.2 || 0.1.2-alpha.2 || 0.1.2-alpha.3` (`@deepseek-ai/dsh-client-runtime` remains `0.1.1-rc.2`, the newest published), development dependencies build and test against `0.1.2-alpha.3`, and `compatibility.json`/README list the 0.1.2 alpha line as supported. No runtime behavior change.

## 1.2.0

- Automatic Codex coexistence for web search: no more manual profile patch. When the Codex subscription plugin manages DSH's search slot, choosing `auto`/`kimi` now writes (and `default` removes) a marked `- id: web` block in the owning profile's `cordis.patch.yml`, which DSH hot-applies without a restart — Codex models use the Codex subscription search, Kimi models use the Kimi subscription search, and other models use the DSH default. The block preserves every other `web` config key (e.g. `fetchProvider`) and every unrelated patch entry verbatim, and the settings card explains the behavior when the Codex plugin is detected. Without the Codex plugin, the previous runtime-slot behavior is unchanged and any stale patch block is cleaned up.

## 1.1.1

- Fix a search-routing race with dsh-codex-subscription. With both plugins set to route web search, the two switchers could contest DSH's single search-provider slot across web-runtime restarts; in practice the Codex plugin's selection won, silently routing Kimi models to the DSH default search instead of the Kimi subscription search. This plugin's switcher now yields whenever the Codex plugin's search providers are registered (the settings page explains this when detected), and the README documents the supported coexistence setup: keep the Codex plugin on its auto route and point the profile `cordis.patch.yml` web `searchProvider` at `kimi-subscription-auto`.
- The auto router now falls through to the built-in `deepseek-official` provider when the DSH base configuration already points at one of this plugin's own providers, avoiding self-delegation for non-subscription models in that patched setup.
- `preferences/status` additionally reports `codexDetected` so the settings card can explain when the selection is inactive.

## 1.1.0

- Add subscription-backed web search. The plugin registers two DSH search providers — `kimi-subscription` (Kimi Code's official `/coding/v1/search` endpoint, authenticated with the host-side subscription credential) and `kimi-subscription-auto` (routes by initiating model: Kimi models use Kimi search, Codex models delegate to the Codex subscription auto provider when installed, everything else uses the DSH default). A new Web search card in Settings selects `default` (passive, never touches DSH's single search-provider slot), `auto`, or `kimi`; switching back to `default` restores the provider this plugin took over from. Credentials and search traffic remain Host-side; the browser only sees the loopback-authorized preference projection.

## 1.0.3

- Fix subscription-usage and plugin-version reads permanently failing (`无法读取订阅余量` / `无法检查最新版本`) on some host startups. Both readers captured the ambient `globalThis.fetch` when the plugin loaded; a sibling plugin that temporarily swaps `globalThis.fetch` with a scoped proxy wrapper during its own startup network work could leave these readers holding a dismantled wrapper whose fallback is nulled on teardown, failing every request for the process lifetime. The ambient fetch is now resolved per call, which stays correct whether or not such a wrapper is installed.

## 1.0.2

- Fix a cancellation race that could make both the subscription-usage and plugin-version cards show permanent errors after page startup or reload. Shared Host requests now survive one browser caller disconnecting, while that caller still cancels promptly and the bounded request can complete for other subscribers and populate the cache.
- Keep the cancellation timeout regression tests alive reliably on the Node.js 22 CI runner.

## 1.0.1

Unpublished. The immutable tag is retained after its Node.js 22 CI run exposed a timeout-test harness issue; the corrected release is 1.0.2.

## 1.0.0

First stable release.

- Show the current and latest plugin versions in the Settings Kimi subscription section. The latest version comes from public npm registry metadata (Host-side, timeout-bounded, redirects refused) and is cached for 5 minutes.
- Add a one-click **Update plugin** button when a newer npm version exists. The update runs `dsh plugin --profile <owning profile> add dsh-kimi-subscription@<version>` on the Host; afterwards the settings page prompts to restart DSH or refresh the page, since the running host process keeps the old code until restarted. Local `link:`/`file:` development checkouts are reported but never updated in place.

## 0.3.3

- Fix sporadic `API key is invalid` (HTTP 401) turn failures with OAuth device sign-in. Kimi Code access tokens live only ~15 minutes and pi-ai refreshed them only at their nominal expiry with zero leeway, so requests dispatched in the final moments of a token's life were rejected and the whole turn failed (AUTH was not retryable). OAuth credentials now refresh 3 minutes early; a pre-chunk 401 marks the access token as upstream-rejected so the next attempt force-refreshes under the serialized lock; and the provider retry policy retries AUTH failures up to 2 times, recovering expired-in-flight tokens transparently. Genuinely revoked credentials still fail after the retries.

## 0.3.2

- Fix the Settings usage reset-time text color: it used the near-invisible `--dsw-alias-label-dimmed` token and now uses `--dsw-alias-label-tertiary`, which stays readable in both light and dark themes.

## 0.3.1

- Publish the plugin as the public npm package `dsh-kimi-subscription`.
- Make npm the primary installation and update path while retaining GitHub Release tarballs.
- Clarify that Kimi Code subscription credentials and Kimi Open Platform API keys are not interchangeable.

## 0.3.0 — 2026-04-02

First public release.

- Register Kimi Code subscription models under the exact `Kimi subscription` group.
- Support subscription API keys and Kimi OAuth device-code login.
- Keep credentials in the DSH Host credential service with OAuth refresh rotation.
- Display weekly, rolling-window, reset-time, and booster-wallet usage in Settings.
- Display `5h 82%　7d 64%`-style quota beside the conversation input for selected Kimi models.
- Keep the subscription route separate from existing `kimi-coding` and Kimi Open Platform configuration.
- Restrict browser RPC to loopback and keep raw credentials and provider usage payloads Host-only.
