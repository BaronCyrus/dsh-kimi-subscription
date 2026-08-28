# Changelog

## 0.3.0 — 2026-04-02

First public release.

- Register Kimi Code subscription models under the exact `Kimi subscription` group.
- Support subscription API keys and Kimi OAuth device-code login.
- Keep credentials in the DSH Host credential service with OAuth refresh rotation.
- Display weekly, rolling-window, reset-time, and booster-wallet usage in Settings.
- Display `5h 82%　7d 64%`-style quota beside the conversation input for selected Kimi models.
- Keep the subscription route separate from existing `kimi-coding` and Kimi Open Platform configuration.
- Restrict browser RPC to loopback and keep raw credentials and provider usage payloads Host-only.
