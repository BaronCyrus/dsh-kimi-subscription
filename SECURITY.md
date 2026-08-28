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
- OAuth login links are restricted to official Kimi HTTPS origins.
- Usage requests are Host-side, bounded by a timeout, refuse redirects, and never return bearer credentials or raw provider payloads to the browser.
- The plugin defines no Kimi Open Platform or cross-provider fallback.
- Prompts, model responses, and session content are not read or recorded by this plugin.

Installing any DSH plugin grants its Host code access to the services named in its composition. Review the tag or commit you install and prefer a tagged release over a moving branch.

## Out of scope

- Kimi Code, Moonshot AI, or DeepSeek Harness availability and policy changes
- compromised Host machines or DSH installations
- credentials deliberately pasted into prompts, logs, issues, or screenshots
- provider membership, billing, or quota disputes
