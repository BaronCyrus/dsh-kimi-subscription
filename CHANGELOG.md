# Changelog

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
