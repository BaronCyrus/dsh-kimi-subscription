# Security policy

## Supported version

Security fixes are applied to the latest tagged release. DeepSeek Harness is a developer preview, so a compatibility fix may require upgrading both DSH and this plugin.

## Reporting a vulnerability

Use a private GitHub security advisory:

https://github.com/BaronCyrus/dsh-kimi-subscription/security/advisories/new

Do not open a public issue containing API keys, access tokens, refresh tokens, account identifiers, raw DSH credential data, authorization URLs with codes, or private prompts. Include the affected plugin version, DSH version, operating system, minimal reproduction, and impact. Replace every credential with an unmistakably fake placeholder.

## Trust boundary

- The plugin runs with the privileges of the DSH Host process.
- Subscription credentials remain in DSH's Host credential service.
- Browser code calls only a loopback-authorized RPC surface and receives redacted account or quota projections.
- OAuth login links are restricted to official Kimi HTTPS origins: `auth.kimi.com`, `www.kimi.com`, and `kimi.com` for the China site, and `auth.kimi.ai`, `www.kimi.ai`, and `kimi.ai` for the international site.
- Each credential records the Kimi Code site it was connected to. Model, usage, and search requests and OAuth refreshes made with it go only to that site's fixed hosts, `api.kimi.com` and `auth.kimi.com` or `api.kimi.ai` and `auth.kimi.ai`. The plugin never retries a request on the other site, and refuses a request whose site it does not recognize before the credential is sent. Model requests use the path the installed pi-ai names on `api.kimi.com`, `/coding` (Anthropic Messages) or `/coding/v1` (OpenAI Chat Completions), on the credential's site; any other catalog URL is refused.
- Usage requests are Host-side, bounded by a timeout, refuse redirects, and never return bearer credentials or raw provider payloads to the browser.
- Version checks fetch only public npm registry metadata (timeout-bounded, redirects refused); one-click updates execute the `dsh plugin` CLI Host-side and never expose process output to the browser.
- The plugin defines no Kimi Open Platform or cross-provider fallback.
- Prompts, model responses, and session content are not read or recorded by this plugin.

Installing any DSH plugin grants its Host code access to the services named in its composition. Review the tag or commit you install and prefer a tagged release over a moving branch.

## Out of scope

- Kimi Code, Moonshot AI, or DeepSeek Harness availability and policy changes
- compromised Host machines or DSH installations
- credentials deliberately pasted into prompts, logs, issues, or screenshots
- provider membership, billing, or quota disputes

## Connection web server binding

Connection's public `rpc.handle` registers a dedicated RPC channel through `webServer` read on Connection's own fiber, and the official `connection` loader entry does not inject it. Versions 1.2.4 to 1.3.8 patched that entry's inject list; because a patch replaces the whole list, it also had to restate the host's startup service, and DSH 0.2.1 renaming `webRuntime` to `webStartup` left Connection unable to start. Versions 1.3.6 to 1.5.0 attached the running `webServer` to the connection fiber through private Cordis fields, which Cordis 4.1.0 (DSH 0.2.2) no longer reads, so the account channel stopped opening there.

The plugin now calls Connection's own channel registration, the `register` method `rpc.handle` uses, with the plugin's web context as the owner; that context injects `webServer`. The route is still Connection's: its Host/Origin fence and authentication run on every request, and the route is removed with the plugin's context. The plugin modifies no Connection or Cordis state, patches no official loader entry, replaces no route handler, and reads no account credentials during activation tests. Automated tests, run on both the DSH 0.2.1 and 0.2.2 host packages, verify that an unauthenticated loopback request is rejected with 401 and that a signed-in browser request reaches the account handler.
