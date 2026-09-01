import { homedir } from "node:os";
import { join } from "node:path";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { LlmError } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
import { randomUUID } from "node:crypto";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { createModels } from "@earendil-works/pi-ai";
import { spawn } from "node:child_process";
import { readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
//#region src/constants.js
const PROVIDER = "kimi-subscription";
const DISPLAY_NAME = "Kimi subscription";
const CHANNEL = "/kimi-subscription";
const CREDENTIAL_NAME = "KIMI_CODE_SUBSCRIPTION_CREDENTIAL";
//#endregion
//#region src/credential-store.js
const abortIfNeeded = (options) => options?.signal?.throwIfAborted();
const clone$2 = (value) => value === void 0 ? void 0 : structuredClone(value);
const LEGAL_API_KEY = /^[\x21-\x7E]+$/u;
/**
* Kimi Code OAuth access tokens live only ~15 minutes and the upstream may
* reject a token shortly before its nominal expiry (processing delay, clock
* skew, or rotation). Report expiry this much earlier so pi-ai refreshes
* before the request enters the danger window instead of after a 401.
*/
const OAUTH_EXPIRY_LEEWAY_MS = 180 * 1e3;
function assertProvider(providerId) {
	if (providerId !== "kimi-subscription") throw new Error(`Kimi credential store does not own provider ${JSON.stringify(providerId)}`);
}
function assertCredential(value) {
	if (value === void 0) return void 0;
	if (value === null || typeof value !== "object") throw new Error("Kimi credential store received a malformed credential");
	if (value.type === "api_key") {
		if (typeof value.key !== "string" || value.key.length === 0 || !LEGAL_API_KEY.test(value.key)) throw new Error("Kimi credential store received a malformed API key");
		return {
			type: "api_key",
			key: value.key
		};
	}
	if (value.type === "oauth") {
		if (typeof value.access !== "string" || value.access.length === 0 || typeof value.refresh !== "string" || value.refresh.length === 0 || typeof value.expires !== "number" || !Number.isFinite(value.expires)) throw new Error("Kimi credential store received a malformed OAuth credential");
		return clone$2(value);
	}
	throw new Error("Kimi credential store received an unsupported credential type");
}
function parseCredential(value) {
	try {
		return assertCredential(JSON.parse(value));
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("Kimi credential store received")) throw error;
		throw new Error("Kimi credential store contains malformed credential JSON", { cause: error });
	}
}
/** Adapt DSH's managed string credential service to pi-ai's typed store. */
var DshKimiCredentialStore = class {
	#chains = /* @__PURE__ */ new Map();
	#rejectedAccess;
	#rejectedDirty = false;
	constructor(credentials, ref) {
		if (credentials === void 0 || credentials === null) throw new Error("Kimi subscription authentication requires the DSH credentials service");
		this.credentials = credentials;
		this.ref = ref;
	}
	/**
	* Mark the current OAuth access token as rejected by the upstream (HTTP
	* 401). Synchronous on purpose: the next read reports the token as expired,
	* so pi-ai's double-checked refresh produces a fresh token for the retry.
	*/
	markAccessRejected() {
		this.#rejectedDirty = true;
	}
	#enqueue(providerId, operation, options) {
		assertProvider(providerId);
		const current = (this.#chains.get(providerId) ?? Promise.resolve()).catch(() => void 0).then(async () => {
			abortIfNeeded(options);
			return operation();
		});
		const tail = current.catch(() => void 0);
		this.#chains.set(providerId, tail);
		tail.finally(() => {
			if (this.#chains.get(providerId) === tail) this.#chains.delete(providerId);
		});
		return current;
	}
	async #read(providerId, options) {
		assertProvider(providerId);
		abortIfNeeded(options);
		const hit = await this.credentials.resolve(this.ref);
		abortIfNeeded(options);
		if (hit?.value === void 0 || hit.value === "") return void 0;
		const credential = parseCredential(hit.value);
		if (credential?.type !== "oauth") return credential;
		if (this.#rejectedDirty) {
			this.#rejectedDirty = false;
			this.#rejectedAccess = credential.access;
		}
		const expires = credential.access === this.#rejectedAccess ? 0 : credential.expires - OAUTH_EXPIRY_LEEWAY_MS;
		return {
			...credential,
			expires
		};
	}
	read(providerId, options) {
		return this.#enqueue(providerId, () => this.#read(providerId, options), options);
	}
	async list(options) {
		abortIfNeeded(options);
		const current = await this.read(PROVIDER, options);
		return current === void 0 ? [] : [{
			providerId: PROVIDER,
			type: current.type
		}];
	}
	modify(providerId, update, options) {
		return this.#enqueue(providerId, async () => {
			const current = await this.#read(providerId, options);
			const next = await update(clone$2(current));
			abortIfNeeded(options);
			if (next === void 0) return current;
			const validated = assertCredential(next);
			await this.credentials.set(this.ref, JSON.stringify(validated));
			abortIfNeeded(options);
			return clone$2(validated);
		}, options);
	}
	delete(providerId, options) {
		return this.#enqueue(providerId, async () => {
			await this.credentials.unset(this.ref);
			abortIfNeeded(options);
		}, options);
	}
};
/** Return only safe account state and bounded credential operations. */
function createKimiAuthService(models, store) {
	return Object.freeze({
		async status(options) {
			const current = await store.read(PROVIDER, options);
			if (current === void 0) return {
				authenticated: false,
				provider: PROVIDER
			};
			return {
				authenticated: true,
				provider: PROVIDER,
				method: current.type === "oauth" ? "oauth" : "api-key",
				...current.type === "oauth" ? { expiresAt: current.expires } : {}
			};
		},
		login(interaction) {
			return models.login(PROVIDER, "oauth", interaction);
		},
		async setApiKey(apiKey, options) {
			abortIfNeeded(options);
			const value = typeof apiKey === "string" ? apiKey.trim() : "";
			if (value.length === 0 || !LEGAL_API_KEY.test(value)) throw new Error("Kimi Code subscription API key is invalid");
			await store.modify(PROVIDER, async () => ({
				type: "api_key",
				key: value
			}), options);
			return this.status(options);
		},
		logout(options) {
			return models.logout(PROVIDER, options);
		}
	});
}
//#endregion
//#region src/shared-request.js
/**
* Resolve the ambient fetch at call time, never at plugin load. A sibling
* plugin in the same host may temporarily replace `globalThis.fetch` with a
* scoped proxy wrapper and dismantle that wrapper afterwards; a binding
* captured during `apply()` would otherwise freeze the stale wrapper (whose
* internal fallback is nulled on teardown) for the process lifetime, failing
* every request. Live lookup follows the restore and stays fetch-compatible
* even while such a wrapper is installed.
*/
function ambientFetch(...args) {
	return globalThis.fetch(...args);
}
/**
* Wait for a shared operation while keeping one caller's cancellation local to
* that caller. The shared promise continues for other subscribers and may still
* populate its cache.
*/
function waitForSharedRequest(promise, signal) {
	if (signal === void 0) return promise;
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		promise.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}
//#endregion
//#region src/usage.js
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const DEFAULT_USAGE_TTL_MS = 6e4;
const DEFAULT_USAGE_TIMEOUT_MS = 15e3;
const record$1 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone$1 = (value) => structuredClone(value);
function integer(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
}
function nameFrom(value) {
	return record$1(value) && typeof value.name === "string" && value.name.length > 0 ? value.name : void 0;
}
function resetAtFrom(value) {
	return record$1(value) && typeof value.resetTime === "string" && value.resetTime.length > 0 ? value.resetTime : void 0;
}
function normalizeUnit(value) {
	switch (value) {
		case "TIME_UNIT_MINUTE": return "minute";
		case "TIME_UNIT_HOUR": return "hour";
		case "TIME_UNIT_DAY": return "day";
		case "TIME_UNIT_WEEK": return "week";
		default: return;
	}
}
function windowFrom(value) {
	if (!record$1(value)) return void 0;
	const duration = integer(value.duration);
	const unit = normalizeUnit(value.timeUnit);
	if (duration === void 0 || duration <= 0 || unit === void 0) return void 0;
	if (unit === "minute" && duration >= 60 && duration % 60 === 0) return {
		duration: duration / 60,
		unit: "hour"
	};
	return {
		duration,
		unit
	};
}
function usageRow(value, extra = {}) {
	if (!record$1(value)) return null;
	const used = integer(value.used);
	const limit = integer(value.limit);
	if (used === void 0 && limit === void 0) return null;
	const normalizedUsed = Math.max(0, used ?? 0);
	const normalizedLimit = Math.max(0, limit ?? 0);
	const remaining = Math.max(0, normalizedLimit - normalizedUsed);
	const remainingPercent = normalizedLimit > 0 ? Math.max(0, Math.min(100, remaining / normalizedLimit * 100)) : 0;
	return {
		...extra.name ?? nameFrom(value) ? { name: extra.name ?? nameFrom(value) } : {},
		...extra.window ? { window: extra.window } : {},
		used: normalizedUsed,
		limit: normalizedLimit,
		remaining,
		remainingPercent,
		...resetAtFrom(value) ? { resetAt: resetAtFrom(value) } : {}
	};
}
const FIXED_POINT_CENTS = 1e6;
function fixedPointToCents(value) {
	const cents = value / FIXED_POINT_CENTS;
	if (cents > 0 && cents < 1) return 1;
	return Math.round(cents);
}
function money(value) {
	if (!record$1(value)) return null;
	const cents = integer(value.priceInCents);
	if (cents === void 0) return null;
	return {
		cents,
		currency: typeof value.currency === "string" && value.currency.length > 0 ? value.currency : ""
	};
}
function boosterWallet(value) {
	if (!record$1(value) || !record$1(value.balance) || value.balance.type !== "BOOSTER") return null;
	const amount = integer(value.balance.amount);
	if (amount === void 0 || amount <= 0) return null;
	const amountLeft = integer(value.balance.amountLeft);
	const monthlyLimit = money(value.monthlyChargeLimit);
	const monthlyUsed = money(value.monthlyUsed);
	return {
		balanceCents: amountLeft === void 0 ? 0 : fixedPointToCents(amountLeft),
		totalCents: fixedPointToCents(amount),
		monthlyChargeLimitEnabled: value.monthlyChargeLimitEnabled === true,
		monthlyChargeLimitCents: monthlyLimit?.cents ?? 0,
		monthlyUsedCents: monthlyUsed?.cents ?? 0,
		currency: monthlyLimit?.currency || monthlyUsed?.currency || "USD"
	};
}
/** Normalize the official /usages payload into small client-owned JSON. */
function parseKimiUsage(payload) {
	if (!record$1(payload)) return {
		summary: null,
		limits: [],
		extraUsage: null
	};
	let summary = usageRow(payload.usage);
	if (summary !== null && summary.window === void 0) summary = {
		...summary,
		window: {
			duration: 1,
			unit: "week"
		}
	};
	const limits = [];
	if (Array.isArray(payload.limits)) for (const item of payload.limits) {
		if (!record$1(item)) continue;
		const row = usageRow(item.detail, {
			name: nameFrom(item),
			window: windowFrom(item.window)
		});
		if (row !== null) limits.push(row);
	}
	return {
		summary,
		limits,
		extraUsage: boosterWallet(payload.boosterWallet)
	};
}
/** Derive a host-side Bearer header from an auth-models resolution. Never logged. */
function authorizationHeader(resolution) {
	const auth = resolution?.auth;
	if (!record$1(auth)) return void 0;
	if (typeof auth.apiKey === "string" && auth.apiKey.length > 0) return `Bearer ${auth.apiKey}`;
	if (!record$1(auth.headers)) return void 0;
	for (const [name, value] of Object.entries(auth.headers)) if (name.toLowerCase() === "authorization" && typeof value === "string" && value.length > 0) return value;
}
function statusError(status) {
	if (status === 401) return /* @__PURE__ */ new Error("Kimi Code subscription sign-in needs to be renewed");
	if (status === 402 || status === 403) return /* @__PURE__ */ new Error("Kimi Code subscription quota is currently unavailable");
	return /* @__PURE__ */ new Error("Could not read Kimi Code subscription usage");
}
/** Cached, single-flight usage reader. Credentials and response bodies stay host-only. */
function createKimiUsageReader({ getAuth, fetchImpl = ambientFetch, now = Date.now, url = KIMI_USAGE_URL, ttlMs = DEFAULT_USAGE_TTL_MS, timeoutMs = DEFAULT_USAGE_TIMEOUT_MS } = {}) {
	if (typeof getAuth !== "function") throw new Error("Kimi usage reader requires getAuth");
	if (typeof fetchImpl !== "function") throw new Error("Kimi usage reader requires fetch");
	let cached;
	let inFlight;
	let generation = 0;
	const load = async (signal) => {
		signal?.throwIfAborted();
		const authorization = authorizationHeader(await getAuth());
		if (authorization === void 0) throw new Error("Kimi Code subscription is not connected");
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal === void 0 ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
		const response = await fetchImpl(url, {
			headers: {
				Authorization: authorization,
				Accept: "application/json"
			},
			redirect: "error",
			signal: requestSignal
		});
		if (!response.ok) throw statusError(response.status);
		return {
			...parseKimiUsage(await response.json()),
			fetchedAt: now()
		};
	};
	return Object.freeze({
		async read({ force = false, signal } = {}) {
			signal?.throwIfAborted();
			if (!force && cached !== void 0 && now() - cached.fetchedAt < ttlMs) return clone$1(cached);
			const createPending = (requestSignal) => {
				const observedGeneration = generation;
				return load(requestSignal).then((value) => {
					if (generation === observedGeneration) cached = value;
					return value;
				});
			};
			if (force) return clone$1(await createPending(signal));
			const pending = inFlight ?? createPending();
			if (inFlight === void 0) {
				inFlight = pending;
				const clear = () => {
					if (inFlight === pending) inFlight = void 0;
				};
				pending.then(clear, clear);
			}
			return clone$1(await waitForSharedRequest(pending, signal));
		},
		invalidate() {
			generation += 1;
			cached = void 0;
		}
	});
}
//#endregion
//#region src/kimi-search.js
const KIMI_SEARCH_URL = "https://api.kimi.com/coding/v1/search";
const KIMI_SEARCH_PROVIDER_ID = "kimi-subscription";
const KIMI_AUTO_SEARCH_PROVIDER_ID = "kimi-subscription-auto";
const CODEX_AUTO_SEARCH_PROVIDER_ID = "codex-subscription-auto";
const DEFAULT_SEARCH_TIMEOUT_MS = 15e3;
const MAX_SOURCE_DATE = 64;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value) => typeof value === "string" && value.length > 0 ? value : void 0;
const displayText = (value) => {
	const text = nonEmpty(value)?.replace(/\s+/gu, " ").trim();
	return text === void 0 || text.length === 0 ? void 0 : text;
};
const boundedDisplayText = (value, maximum) => {
	const text = displayText(value);
	if (text === void 0 || text.length <= maximum) return text;
	return `${text.slice(0, maximum - 1)}…`;
};
function sourceOf(value) {
	if (!record(value)) return void 0;
	const url = nonEmpty(value.url);
	if (url === void 0) return void 0;
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return void 0;
	const title = displayText(value.title) ?? displayText(value.site_name) ?? parsed.hostname;
	const snippet = displayText(value.snippet) ?? displayText(value.content);
	const publishedAt = boundedDisplayText(value.date, MAX_SOURCE_DATE);
	return {
		url,
		title,
		...snippet === void 0 ? {} : { snippet },
		...publishedAt === void 0 ? {} : { publishedAt }
	};
}
/** Normalize the official /search payload into the DSH citation shape. */
function parseKimiSearchResponse(value) {
	if (!record(value) || !Array.isArray(value.search_results)) throw new Error("Kimi returned a malformed search response");
	const seen = /* @__PURE__ */ new Set();
	const sources = [];
	for (const result of value.search_results) {
		const source = sourceOf(result);
		if (source === void 0 || seen.has(source.url)) continue;
		seen.add(source.url);
		sources.push(source);
	}
	return {
		sources,
		truncated: false
	};
}
/**
* Create the DSH web search provider backed only by the Kimi Code
* subscription /search endpoint. Credentials stay host-side.
*/
function createKimiSearchProvider({ getAuth, fetchImpl = ambientFetch, url = KIMI_SEARCH_URL, timeoutMs = DEFAULT_SEARCH_TIMEOUT_MS } = {}) {
	if (typeof getAuth !== "function") throw new Error("Kimi search provider requires getAuth");
	if (typeof fetchImpl !== "function") throw new Error("Kimi search provider requires fetch");
	return Object.freeze({
		id: KIMI_SEARCH_PROVIDER_ID,
		available: () => true,
		async search(request, signal) {
			signal?.throwIfAborted();
			const authorization = authorizationHeader(await getAuth());
			if (authorization === void 0) throw new WebError("Kimi Code subscription is not connected", "WEB_PROVIDER_CREDENTIAL_MISSING");
			const timeoutSignal = AbortSignal.timeout(timeoutMs);
			const requestSignal = signal === void 0 ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
			let response;
			try {
				response = await fetchImpl(url, {
					method: "POST",
					redirect: "error",
					headers: {
						Authorization: authorization,
						Accept: "application/json",
						"Content-Type": "application/json"
					},
					body: JSON.stringify({ text_query: request.query }),
					signal: requestSignal
				});
			} catch (error) {
				if (signal?.aborted || error?.name === "AbortError") throw new WebError("Kimi search aborted", "WEB_ABORTED", { cause: error });
				throw new WebError("Kimi search request failed", "WEB_PROVIDER_ERROR", { cause: error });
			}
			if (!response.ok) throw response.status === 401 || response.status === 403 ? new WebError("Kimi Code subscription sign-in needs to be renewed", "WEB_PROVIDER_CREDENTIAL_MISSING") : new WebError(`Kimi search request failed (HTTP ${response.status})`, "WEB_PROVIDER_ERROR");
			let value;
			try {
				value = await response.json();
			} catch (error) {
				throw new WebError("Kimi returned an unreadable search response", "WEB_PROVIDER_ERROR", { cause: error });
			}
			try {
				return parseKimiSearchResponse(value);
			} catch (error) {
				throw new WebError("Kimi returned a malformed search response", "WEB_PROVIDER_ERROR", { cause: error });
			}
		}
	});
}
/**
* Route each request by its initiating model without changing the user's
* explicit overrides: Kimi models use the Kimi subscription search, Codex
* models delegate to the Codex subscription auto provider when it is
* registered, and every other model falls back to the DSH default provider.
*/
function createKimiAutoSearchProvider(options) {
	return Object.freeze({
		id: KIMI_AUTO_SEARCH_PROVIDER_ID,
		available: () => true,
		async search(request, signal) {
			if (options.resolveModelProvider?.() === "kimi-subscription") return options.kimi.search(request, signal);
			const modelProvider = options.resolveModelProvider?.();
			const codex = options.resolveCodexProvider?.();
			if (modelProvider === "openai-codex" && codex !== void 0 && codex.available() === true) return codex.search(request, signal);
			const provider = options.resolveDshProvider?.();
			if (provider === void 0 || provider.id === "kimi-subscription-auto" || provider.id === "kimi-subscription" || provider.available() !== true) throw new WebError("DSH default search is unavailable", "WEB_PROVIDER_UNAVAILABLE");
			return provider.search(request, signal);
		}
	});
}
const WEB_ENTRY_ID$1 = "web";
const DSH_SEARCH_PROVIDER_FALLBACK$1 = "deepseek-official";
/**
* Resolve the fallback provider id for non-Kimi/non-Codex models. When a
* profile patch points the DSH base configuration at one of this plugin's own
* providers, fall through to the built-in DeepSeek search instead of
* delegating to ourselves.
*/
function resolveDshSearchProviderId(baseId) {
	return baseId === "kimi-subscription" || baseId === "kimi-subscription-auto" ? DSH_SEARCH_PROVIDER_FALLBACK$1 : baseId;
}
/**
* Mirror the Codex subscription's search-provider switcher: write the chosen
* provider id into the DSH web runtime's single search slot. Two safeguards
* keep this plugin from fighting another subscription plugin for the slot:
*
* - `isForeignManaged` (e.g. the Codex subscription plugin's providers are
*   registered) makes every selection a no-op. That plugin re-writes its own
*   choice whenever the web runtime restarts, so contesting the slot would
*   restart-cycle the web runtime indefinitely.
* - The `default` selection is deliberately passive and only restores a
*   provider this switcher previously took over from.
*/
function createKimiSearchProviderSwitcher(loader, { isForeignManaged, logger } = {}) {
	const webEntry = () => [...loader.entries()].find((entry) => entry.options?.id === WEB_ENTRY_ID$1);
	let captured;
	let warned = false;
	const update = async (provider) => {
		const entry = webEntry();
		const fiber = entry?.fiber;
		if (entry === void 0 || fiber === void 0 || typeof fiber.update !== "function") throw new Error("DSH web runtime is unavailable");
		const currentConfig = fiber.config ?? entry.options?.config ?? {};
		if (currentConfig.searchProvider === provider) return;
		await fiber.update({
			...currentConfig,
			searchProvider: provider
		}, true);
	};
	return Object.freeze({ async select(selection) {
		if (isForeignManaged?.() === true) {
			if (!warned && selection !== "default") {
				warned = true;
				logger?.warn?.("another subscription plugin manages the DSH web search provider; the Kimi search provider selection is inactive");
			}
			return;
		}
		const entry = webEntry();
		if (entry === void 0) throw new Error("DSH web runtime is unavailable");
		const currentConfig = entry.fiber?.config ?? entry.options?.config ?? {};
		const ours = currentConfig.searchProvider === "kimi-subscription" || currentConfig.searchProvider === "kimi-subscription-auto";
		if (selection === "kimi" || selection === "auto") {
			if (!ours && currentConfig.searchProvider !== void 0) captured = currentConfig.searchProvider;
			await update(selection === "kimi" ? KIMI_SEARCH_PROVIDER_ID : KIMI_AUTO_SEARCH_PROVIDER_ID);
			return;
		}
		if (ours && captured !== void 0) {
			const restore = captured;
			captured = void 0;
			await update(restore);
		}
	} });
}
//#endregion
//#region src/login-coordinator.js
const TERMINAL_PHASES = /* @__PURE__ */ new Set([
	"authenticated",
	"failed",
	"cancelled"
]);
const ALLOWED_AUTH_ORIGINS = /* @__PURE__ */ new Set([
	"https://auth.kimi.com",
	"https://www.kimi.com",
	"https://kimi.com"
]);
const publicClone = (value) => structuredClone(value);
const asObject = (value) => value !== null && typeof value === "object" ? value : {};
const ok = (value) => ({
	ok: true,
	value
});
const badRequest = (message) => ({
	ok: false,
	error: {
		code: "bad-request",
		message,
		details: { issues: [] }
	}
});
const deferred = () => {
	let resolve;
	let reject;
	return {
		promise: new Promise((onResolve, onReject) => {
			resolve = onResolve;
			reject = onReject;
		}),
		resolve,
		reject
	};
};
/** Restrict browser-visible login links to official Kimi HTTPS origins. */
function assertKimiAuthUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Kimi auth URL is invalid");
	}
	if (url.protocol !== "https:" || !ALLOWED_AUTH_ORIGINS.has(url.origin) || url.username !== "" || url.password !== "") throw new Error("Kimi auth URL must use an official Kimi HTTPS origin");
	return url.href;
}
/** Own one host-side device-code login without exposing tokens to the client. */
var KimiLoginCoordinator = class {
	#sessions = /* @__PURE__ */ new Map();
	#activeId;
	constructor(auth, options = {}) {
		this.auth = auth;
		this.createId = options.createId ?? randomUUID;
	}
	async accountStatus(options) {
		return publicClone(await this.auth.status(options));
	}
	async start() {
		const active = this.#activeId === void 0 ? void 0 : this.#sessions.get(this.#activeId);
		if (active !== void 0 && !TERMINAL_PHASES.has(active.view.phase)) return this.read(active.view.id);
		if (active !== void 0) this.#sessions.delete(active.view.id);
		const id = this.createId();
		const ready = deferred();
		const controller = new AbortController();
		const session = {
			controller,
			ready,
			view: {
				id,
				provider: PROVIDER,
				phase: "starting",
				authenticated: false
			}
		};
		this.#sessions.set(id, session);
		this.#activeId = id;
		const publishReady = () => ready.resolve(publicClone(session.view));
		const interaction = {
			signal: controller.signal,
			prompt: async () => {
				throw new Error("Kimi device login unexpectedly requested interactive input");
			},
			notify: (event) => {
				if (controller.signal.aborted) return;
				if (event.type === "device_code") {
					const userCode = typeof event.userCode === "string" ? event.userCode : "";
					if (userCode.length === 0) throw new Error("Kimi device login returned no user code");
					session.view = {
						...session.view,
						phase: "waiting_device",
						deviceCode: {
							userCode,
							verificationUri: assertKimiAuthUrl(event.verificationUri),
							...typeof event.intervalSeconds === "number" ? { intervalSeconds: event.intervalSeconds } : {},
							...typeof event.expiresInSeconds === "number" ? { expiresInSeconds: event.expiresInSeconds } : {}
						}
					};
				} else session.view = {
					...session.view,
					message: String(event.message ?? "")
				};
				publishReady();
			}
		};
		session.run = Promise.resolve().then(() => this.auth.login(interaction)).then(async () => {
			if (controller.signal.aborted) return;
			const status = await this.auth.status();
			session.view = {
				id,
				provider: PROVIDER,
				phase: "authenticated",
				authenticated: status.authenticated === true
			};
		}).catch((error) => {
			if (controller.signal.aborted) {
				session.view = {
					id,
					provider: PROVIDER,
					phase: "cancelled",
					authenticated: false
				};
				return;
			}
			session.view = {
				id,
				provider: PROVIDER,
				phase: "failed",
				authenticated: false,
				error: "Kimi login failed"
			};
			session.hostError = error;
		}).finally(publishReady);
		return ready.promise;
	}
	read(id) {
		const session = this.#sessions.get(id);
		if (session === void 0) throw new Error("unknown Kimi login");
		return publicClone(session.view);
	}
	async cancel(id) {
		const session = this.#sessions.get(id);
		if (session === void 0) throw new Error("unknown Kimi login");
		if (!TERMINAL_PHASES.has(session.view.phase)) {
			session.view = {
				id,
				provider: PROVIDER,
				phase: "cancelled",
				authenticated: false
			};
			session.controller.abort(/* @__PURE__ */ new Error("Kimi login cancelled"));
		}
		return this.read(id);
	}
	async setApiKey(value, options) {
		if (this.#activeId !== void 0) {
			const active = this.#sessions.get(this.#activeId);
			if (active !== void 0 && !TERMINAL_PHASES.has(active.view.phase)) await this.cancel(active.view.id);
		}
		return this.auth.setApiKey(value, options);
	}
	async logout(options) {
		if (this.#activeId !== void 0) {
			const active = this.#sessions.get(this.#activeId);
			if (active !== void 0 && !TERMINAL_PHASES.has(active.view.phase)) await this.cancel(active.view.id);
		}
		await this.auth.logout(options);
		return this.accountStatus(options);
	}
};
/** Map the loopback-only DSH Connection channel onto account, usage, and plugin services. */
function createKimiRpcHandler(coordinator, { usageReader, pluginManager, searchPreference } = {}) {
	const preferenceStatus = () => ({
		searchProvider: searchPreference?.get() ?? "default",
		writable: searchPreference?.writable() === true,
		codexDetected: searchPreference?.codexDetected?.() === true
	});
	return async (endpoint, payload, signal) => {
		try {
			signal.throwIfAborted();
			const input = asObject(payload);
			if (endpoint === "status") return ok(await coordinator.accountStatus({ signal }));
			if (endpoint === "login/start") return ok(await coordinator.start());
			if (endpoint === "login/status") return ok(coordinator.read(input.id));
			if (endpoint === "login/cancel") return ok(await coordinator.cancel(input.id));
			if (endpoint === "usage") {
				if (usageReader === void 0) throw new Error("Kimi usage is unavailable");
				return ok(await usageReader.read({
					force: input.force === true,
					signal
				}));
			}
			if (endpoint === "plugin/version") {
				if (pluginManager === void 0) throw new Error("Kimi plugin version is unavailable");
				return ok(await pluginManager.read({
					force: input.force === true,
					signal
				}));
			}
			if (endpoint === "plugin/update") {
				if (pluginManager === void 0) throw new Error("Kimi plugin update is unavailable");
				return ok(await pluginManager.update({ signal }));
			}
			if (endpoint === "preferences/status") return ok(preferenceStatus());
			if (endpoint === "preferences/update") {
				if (searchPreference === void 0 || searchPreference.writable() !== true) throw new Error("Kimi search preference is unavailable");
				await searchPreference.set(input.searchProvider);
				return ok(preferenceStatus());
			}
			if (endpoint === "api-key/set") {
				const status = await coordinator.setApiKey(input.apiKey, { signal });
				usageReader?.invalidate();
				return ok(status);
			}
			if (endpoint === "logout") {
				const status = await coordinator.logout({ signal });
				usageReader?.invalidate();
				return ok(status);
			}
			return badRequest(`unknown Kimi auth endpoint: ${endpoint}`);
		} catch (error) {
			if (signal.aborted) throw error;
			const message = error instanceof Error && /^(unknown Kimi|Kimi login|Kimi usage|Kimi plugin|Kimi search preference|Kimi Code subscription|Invalid search provider|Could not read Kimi Code subscription usage)/u.test(error.message) ? error.message : "Kimi request failed";
			return badRequest(message);
		}
	};
}
//#endregion
//#region src/pi-ai-runtime.js
const AUTH_REJECTION = /\b401\b|invalid_authentication/iu;
const isAuthRejection = (error) => AUTH_REJECTION.test(String(error?.message ?? error));
/**
* Observe a pi-ai event stream and report an upstream authentication
* rejection (HTTP 401) that occurs before any chunk was produced. Mid-stream
* failures do not mark the token: the request had already been accepted.
* All other stream behavior, including `.result()`, passes through untouched.
*/
function guardKimiStreamAuthRejection(stream, onAuthRejected) {
	if (stream === null || typeof stream !== "object") return stream;
	let observed = false;
	return new Proxy(stream, { get(target, prop, receiver) {
		if (prop === Symbol.asyncIterator) return () => {
			const iterator = Reflect.get(target, Symbol.asyncIterator).call(target);
			return {
				next: async (...args) => {
					try {
						const item = await iterator.next(...args);
						observed = true;
						return item;
					} catch (error) {
						if (!observed && isAuthRejection(error)) onAuthRejected?.();
						throw error;
					}
				},
				...typeof iterator.return === "function" ? { return: (...args) => iterator.return(...args) } : {},
				...typeof iterator.throw === "function" ? { throw: (...args) => iterator.throw(...args) } : {}
			};
		};
		const value = Reflect.get(target, prop, receiver);
		return typeof value === "function" ? value.bind(target) : value;
	} });
}
/**
* Reuse pi-ai's Kimi Code protocol, catalog, OAuth flow, and auth refresh while
* giving the DSH subscription route an identity distinct from kimi-coding API
* configuration. API-key and OAuth auth are both subscription credentials;
* ambient Kimi platform credentials are disabled by the plugin's auth context.
*/
function createKimiSubscriptionProvider({ onAuthRejected } = {}) {
	const base = kimiCodingProvider();
	if (base.auth?.oauth === void 0 || base.auth?.apiKey === void 0) throw new Error("The installed pi-ai Kimi provider does not expose the required subscription authentication methods");
	const models = Object.freeze(base.getModels().map((model) => Object.freeze({
		...model,
		provider: PROVIDER
	})));
	return Object.freeze({
		id: PROVIDER,
		name: DISPLAY_NAME,
		baseUrl: base.baseUrl,
		headers: base.headers,
		auth: Object.freeze({
			apiKey: base.auth.apiKey,
			oauth: base.auth.oauth
		}),
		getModels: () => models,
		stream: (model, context, options) => guardKimiStreamAuthRejection(base.stream(model, context, options), onAuthRejected),
		streamSimple: (model, context, options) => guardKimiStreamAuthRejection(base.streamSimple(model, context, options), onAuthRejected)
	});
}
//#endregion
//#region src/plugin-version.js
const PACKAGE_NAME = "dsh-kimi-subscription";
const NPM_REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const DEFAULT_VERSION_TTL_MS = 5 * 6e4;
const DEFAULT_VERSION_TIMEOUT_MS = 1e4;
const DEFAULT_UPDATE_TIMEOUT_MS = 18e4;
const clone = (value) => structuredClone(value);
/** Parse a strict `x.y.z[-pre][+build]` version; anything else is undefined. */
function parseSemver(value) {
	if (typeof value !== "string") return void 0;
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim());
	if (match === null) return void 0;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		pre: match[4]
	};
}
/** Compare two versions: -1/0/1, or undefined when either side is not semver. */
function compareSemver(a, b) {
	const left = parseSemver(a);
	const right = parseSemver(b);
	if (left === void 0 || right === void 0) return void 0;
	for (const key of [
		"major",
		"minor",
		"patch"
	]) if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	if (left.pre === right.pre) return 0;
	if (left.pre === void 0) return 1;
	if (right.pre === void 0) return -1;
	return left.pre < right.pre ? -1 : 1;
}
/**
* Classify how the running package reached the profile. Only registry specs
* may be updated in place through `dsh plugin add <name>@<version>`; local
* checkouts (`link:`/`file:`) belong to the owner's iteration workflow.
*/
function classifySpec(spec) {
	if (typeof spec !== "string" || spec === "") return "unknown";
	if (/^(?:link|file):/u.test(spec)) return "link";
	if (/^(?:\d|[~^*])/u.test(spec)) return "npm";
	return "unknown";
}
const readManifest = async (path) => {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return parsed !== null && typeof parsed === "object" ? parsed : void 0;
	} catch {
		return;
	}
};
/**
* Find the profile that owns this running installation by matching the
* realpath of each profile's installed package against our own package.json
* (pnpm symlinks resolve identically on both sides). When no realpath matches,
* fall back to the only profile that declares the dependency at all.
*/
async function findInstall({ dshHome, ownPackageJsonUrl }) {
	let ownReal;
	try {
		ownReal = await realpath(fileURLToPath(ownPackageJsonUrl));
	} catch {
		ownReal = void 0;
	}
	let entries = [];
	try {
		entries = await readdir(join(dshHome, "profiles"), { withFileTypes: true });
	} catch {
		entries = [];
	}
	const declared = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const profileDir = join(dshHome, "profiles", entry.name);
		const spec = (await readManifest(join(profileDir, "package.json")))?.dependencies?.[PACKAGE_NAME];
		if (typeof spec !== "string") continue;
		declared.push({
			profile: entry.name,
			spec
		});
		if (ownReal === void 0) continue;
		try {
			if (await realpath(join(profileDir, "node_modules", "dsh-kimi-subscription", "package.json")) === ownReal) return {
				kind: classifySpec(spec),
				profile: entry.name
			};
		} catch {}
	}
	if (declared.length === 1) return {
		kind: classifySpec(declared[0].spec),
		profile: declared[0].profile
	};
	return { kind: "unknown" };
}
/** Run the dsh CLI host-side; output stays host-side and is never returned. */
function spawnRunCommand(argv, { signal, timeoutMs }) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("Kimi plugin update aborted"));
			return;
		}
		const controller = new AbortController();
		const onAbort = () => controller.abort(signal.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("Kimi plugin update timed out")), timeoutMs);
		let settled = false;
		const settle = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			callback(value);
		};
		let child;
		try {
			child = spawn(argv[0], argv.slice(1), {
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				],
				signal: controller.signal
			});
		} catch (error) {
			settle(reject, error);
			return;
		}
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout = (stdout + chunk).slice(-8192);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-8192);
		});
		child.on("error", (error) => settle(reject, error));
		child.on("close", (code) => {
			if (controller.signal.aborted) {
				const reason = controller.signal.reason;
				settle(reject, reason instanceof Error ? reason : /* @__PURE__ */ new Error("Kimi plugin update aborted"));
				return;
			}
			settle(resolve, {
				code: code ?? 1,
				stdout,
				stderr
			});
		});
	});
}
/**
* Owns the plugin's version self-knowledge: the running version from its own
* package.json, the latest npm registry version, which DSH profile installed
* it, and registry-spec updates executed through the `dsh plugin` CLI.
* Registry responses and CLI output stay host-only; only the small owned
* projection crosses RPC.
*/
function createKimiPluginManager({ fetchImpl = ambientFetch, runCommand = spawnRunCommand, execPath = process.execPath, binPath = process.argv[1], env = process.env, ownPackageJsonUrl = new URL("../package.json", import.meta.url), registryUrl = NPM_REGISTRY_LATEST_URL, now = Date.now, ttlMs = DEFAULT_VERSION_TTL_MS, timeoutMs = DEFAULT_VERSION_TIMEOUT_MS, updateTimeoutMs = DEFAULT_UPDATE_TIMEOUT_MS } = {}) {
	if (typeof fetchImpl !== "function") throw new Error("Kimi plugin manager requires fetch");
	if (typeof runCommand !== "function") throw new Error("Kimi plugin manager requires runCommand");
	const dshHome = typeof env.DSH_HOME === "string" && env.DSH_HOME !== "" ? env.DSH_HOME : join(homedir(), ".dsh");
	let cached;
	let inFlight;
	let generation = 0;
	let updating = false;
	const fetchLatest = async (signal) => {
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const requestSignal = signal === void 0 ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
		let response;
		try {
			response = await fetchImpl(registryUrl, {
				headers: { Accept: "application/json" },
				redirect: "error",
				signal: requestSignal
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			throw new Error("Kimi plugin version check failed");
		}
		if (!response.ok) throw new Error("Kimi plugin version check failed");
		let version;
		try {
			version = (await response.json())?.version;
		} catch {
			version = void 0;
		}
		if (parseSemver(version) === void 0) throw new Error("Kimi plugin version check failed");
		return version;
	};
	const readOwnVersion = async () => {
		const version = (await readManifest(fileURLToPath(ownPackageJsonUrl)))?.version;
		if (parseSemver(version) === void 0) throw new Error("Kimi plugin version is unavailable");
		return version;
	};
	const load = async (signal) => {
		signal?.throwIfAborted();
		const [current, install, latest] = await Promise.all([
			readOwnVersion(),
			findInstall({
				dshHome,
				ownPackageJsonUrl
			}),
			fetchLatest(signal)
		]);
		return {
			current,
			latest,
			updateAvailable: compareSemver(latest, current) === 1,
			install,
			fetchedAt: now()
		};
	};
	return Object.freeze({
		async read({ force = false, signal } = {}) {
			signal?.throwIfAborted();
			if (!force && cached !== void 0 && now() - cached.fetchedAt < ttlMs) return clone(cached);
			const createPending = (requestSignal) => {
				const observedGeneration = generation;
				return load(requestSignal).then((value) => {
					if (generation === observedGeneration) cached = value;
					return value;
				});
			};
			if (force) return clone(await createPending(signal));
			const pending = inFlight ?? createPending();
			if (inFlight === void 0) {
				inFlight = pending;
				const clear = () => {
					if (inFlight === pending) inFlight = void 0;
				};
				pending.then(clear, clear);
			}
			return clone(await waitForSharedRequest(pending, signal));
		},
		async update({ signal } = {}) {
			signal?.throwIfAborted();
			if (updating) throw new Error("Kimi plugin update is already running");
			updating = true;
			try {
				const install = await findInstall({
					dshHome,
					ownPackageJsonUrl
				});
				if (install.kind === "link") throw new Error("Kimi plugin is installed from a local checkout");
				if (install.kind !== "npm" || install.profile === void 0) throw new Error("Kimi plugin update could not find the owning profile");
				const latest = await fetchLatest(signal);
				const argv = binPath === void 0 ? [
					"dsh",
					"plugin",
					"--profile",
					install.profile,
					"add",
					`${PACKAGE_NAME}@${latest}`
				] : [
					execPath,
					binPath,
					"plugin",
					"--profile",
					install.profile,
					"add",
					`${PACKAGE_NAME}@${latest}`
				];
				let result;
				try {
					result = await runCommand(argv, {
						signal,
						timeoutMs: updateTimeoutMs
					});
				} catch (error) {
					if (signal?.aborted) throw error;
					throw new Error("Kimi plugin update failed");
				}
				if (result.code !== 0) throw new Error("Kimi plugin update failed");
				generation += 1;
				cached = void 0;
				return {
					version: latest,
					profile: install.profile
				};
			} finally {
				updating = false;
			}
		},
		invalidate() {
			generation += 1;
			cached = void 0;
		}
	});
}
//#endregion
//#region src/search-composition.js
const SEARCH_PATCH_FILE = "cordis.patch.yml";
const BLOCK_BEGIN = "# >>> dsh-kimi-subscription: web search provider";
const BLOCK_END = "# <<< dsh-kimi-subscription: web search provider";
const EMPTY_LIST = /^\[\]\s*$/u;
const LIST_ITEM = /^- /u;
const hasEntries = (content) => content.split("\n").some((line) => LIST_ITEM.test(line));
/** Remove this plugin's marked patch block; idempotent. */
function stripSearchPatchBlock(content) {
	const lines = content.split("\n");
	const out = [];
	let inside = false;
	for (const line of lines) {
		if (line.includes(BLOCK_BEGIN)) {
			inside = true;
			continue;
		}
		if (line.includes(BLOCK_END)) {
			inside = false;
			continue;
		}
		if (!inside) out.push(line);
	}
	return out.join("\n");
}
function yamlScalar(value) {
	if (typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value !== "string") throw new Error("Kimi search composition only supports scalar web config values");
	return /^[A-Za-z0-9._-]+$/u.test(value) ? value : JSON.stringify(value);
}
function patchBlock(searchProvider, baseConfig) {
	const config = {};
	for (const [key, value] of Object.entries(baseConfig)) {
		if (key === "searchProvider") continue;
		if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") config[key] = value;
	}
	config.searchProvider = searchProvider;
	const lines = Object.entries(config).map(([key, value]) => `    ${key}: ${yamlScalar(value)}`);
	return `${BLOCK_BEGIN}\n- id: web\n  config:\n${lines.join("\n")}\n${BLOCK_END}\n`;
}
/**
* Maintain this plugin's marked `- id: web` block inside the owning profile's
* `cordis.patch.yml`. The DSH boot layer watches that file and hot-applies
* edits transactionally, so writing the block changes the web row's base
* `searchProvider` without a restart and without contesting the runtime slot
* another subscription plugin's switcher keeps re-writing. Only the marked
* block is ever touched; every other patch entry is preserved verbatim.
*/
function createKimiSearchComposition({ findProfile, readBaseConfig, dshHome, fs = {
	readFile,
	writeFile,
	rename
} } = {}) {
	if (typeof findProfile !== "function") throw new Error("Kimi search composition requires findProfile");
	if (typeof readBaseConfig !== "function") throw new Error("Kimi search composition requires readBaseConfig");
	if (typeof dshHome !== "string" || dshHome === "") throw new Error("Kimi search composition requires dshHome");
	const patchPath = async () => {
		const profile = await findProfile();
		if (typeof profile !== "string" || profile === "") throw new Error("Kimi search composition could not find the owning profile");
		return join(dshHome, "profiles", profile, SEARCH_PATCH_FILE);
	};
	const readPatch = async (file) => {
		try {
			return await fs.readFile(file, "utf8");
		} catch (error) {
			if (error?.code === "ENOENT") return "";
			throw error;
		}
	};
	const writePatch = async (file, content, previous) => {
		if (content === previous) return false;
		const temporary = `${file}.tmp`;
		await fs.writeFile(temporary, content);
		await fs.rename(temporary, file);
		return true;
	};
	return Object.freeze({
		/** Write (or refresh) the marked block so the web base config selects the provider. */
		async apply(searchProvider) {
			const file = await patchPath();
			const existing = await readPatch(file);
			const stripped = stripSearchPatchBlock(existing);
			const head = (hasEntries(stripped) ? stripped : stripped.split("\n").filter((line) => !EMPTY_LIST.test(line)).join("\n")).trimEnd();
			const block = patchBlock(searchProvider, readBaseConfig());
			const body = head === "" ? block : `${head}\n${block}`;
			return writePatch(file, body, existing);
		},
		/** Remove the marked block, restoring an empty patch list when nothing else remains. */
		async remove() {
			const file = await patchPath();
			const existing = await readPatch(file);
			if (existing === "") return false;
			const stripped = stripSearchPatchBlock(existing);
			if (stripped === existing) return false;
			const head = stripped.trimEnd();
			const body = hasEntries(stripped) ? `${head}\n` : head === "" ? "[]\n" : `${head}\n[]\n`;
			return writePatch(file, body, existing);
		}
	});
}
//#endregion
//#region src/index.js
const name = "kimi-subscription";
const inject = [
	"llm",
	"credentials",
	"connection",
	"attachments",
	"web",
	"settings",
	"loader"
];
const CREDENTIAL_REF = credentialRef(CREDENTIAL_NAME);
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;
const SETTINGS_NAMESPACE = "kimi-subscription";
const SEARCH_PROVIDER_FIELD = "searchProvider";
const SEARCH_PROVIDER_DEFAULT = "default";
const SEARCH_PROVIDER_AUTO = "auto";
const SEARCH_PROVIDER_KIMI = "kimi";
const SEARCH_PROVIDER_CHOICES = [
	SEARCH_PROVIDER_DEFAULT,
	SEARCH_PROVIDER_AUTO,
	SEARCH_PROVIDER_KIMI
];
const DSH_SEARCH_PROVIDER_FALLBACK = "deepseek-official";
const WEB_ENTRY_ID = "web";
function apply(ctx) {
	const store = new DshKimiCredentialStore(ctx.credentials, CREDENTIAL_REF);
	const provider = createKimiSubscriptionProvider({ onAuthRejected: () => store.markAccessRejected() });
	const authContext = Object.freeze({
		env: async () => void 0,
		fileExists: async () => false
	});
	const authModels = createModels({
		credentials: store,
		authContext
	});
	authModels.setProvider(provider);
	const profile = Object.freeze({
		provider: PROVIDER,
		displayName: DISPLAY_NAME,
		piProvider: provider,
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		streamIdleTimeoutMs: 600 * 1e3,
		maxRequestImageBytes: MAX_REQUEST_IMAGE_BYTES,
		requestImagePixelBudget: REQUEST_IMAGE_PIXEL_BUDGET,
		requestImageMaxBytes: REQUEST_IMAGE_MAX_BYTES,
		cacheRetention: "short",
		retryPolicy: {
			mode: "normal",
			maxRetries: 2,
			retryableCodes: [
				"EMPTY_RESPONSE",
				"RATE_LIMIT",
				"SERVER",
				"TIMEOUT",
				"TRANSPORT",
				"AUTH"
			]
		}
	});
	const profiles = /* @__PURE__ */ new Map([[PROVIDER, profile]]);
	const adapter = new PiAiAdapter({
		profiles: () => profiles,
		resolveApiKey: async () => {
			let credential;
			try {
				credential = await store.read(PROVIDER);
			} catch (error) {
				throw new LlmError("Kimi Code subscription authorization failed", "AUTH_FAILED", { cause: error });
			}
			if (credential === void 0) throw new LlmError("Kimi Code subscription is not connected", "MISSING_CREDENTIAL");
			return credential.type === "api_key" ? credential.key : void 0;
		},
		auth: Object.freeze({
			credentials: store,
			authContext
		}),
		resolveAttachments: () => ctx.get?.("attachments") ?? ctx.attachments
	});
	ctx.llm.registerAdapter([PROVIDER], adapter);
	const auth = createKimiAuthService(authModels, store);
	const usageReader = createKimiUsageReader({ getAuth: () => authModels.getAuth(PROVIDER) });
	const pluginManager = createKimiPluginManager();
	const coordinator = new KimiLoginCoordinator(auth);
	const settings = ctx.settings.register(SETTINGS_NAMESPACE, z.object({ [SEARCH_PROVIDER_FIELD]: z.union(SEARCH_PROVIDER_CHOICES).default(SEARCH_PROVIDER_DEFAULT) }));
	const currentAgent = () => ctx.get?.("agents")?.currentInitiator?.();
	const kimiSearch = createKimiSearchProvider({ getAuth: () => authModels.getAuth(PROVIDER) });
	ctx.web.registerSearchProvider(kimiSearch);
	const webEntry = () => [...ctx.loader.entries()].find((entry) => entry.options?.id === WEB_ENTRY_ID);
	const dshSearchProviderId = () => {
		const baseConfig = webEntry()?.options?.config ?? {};
		return typeof baseConfig.searchProvider === "string" && baseConfig.searchProvider.length > 0 ? baseConfig.searchProvider : DSH_SEARCH_PROVIDER_FALLBACK;
	};
	ctx.web.registerSearchProvider(createKimiAutoSearchProvider({
		kimi: kimiSearch,
		resolveModelProvider: () => currentAgent()?.session.requestContext?.()?.provider,
		resolveCodexProvider: () => ctx.web.searchProviders?.get(CODEX_AUTO_SEARCH_PROVIDER_ID),
		resolveDshProvider: () => ctx.web.searchProviders?.get(resolveDshSearchProviderId(dshSearchProviderId()))
	}));
	const codexManagesSearch = () => ctx.web.searchProviders?.has(CODEX_AUTO_SEARCH_PROVIDER_ID) === true;
	const searchSwitcher = createKimiSearchProviderSwitcher(ctx.loader, {
		isForeignManaged: codexManagesSearch,
		logger: ctx.logger
	});
	const dshHome = typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh");
	const ownPackageJsonUrl = new URL("../package.json", import.meta.url);
	const searchComposition = createKimiSearchComposition({
		dshHome,
		findProfile: async () => (await findInstall({
			dshHome,
			ownPackageJsonUrl
		})).profile,
		readBaseConfig: () => webEntry()?.options?.config ?? {}
	});
	const searchPreference = Object.freeze({
		get: () => settings.get()[SEARCH_PROVIDER_FIELD],
		writable: () => ctx.settings.writable !== false,
		codexDetected: codexManagesSearch,
		set: async (value) => {
			if (!SEARCH_PROVIDER_CHOICES.includes(value)) throw new Error("Invalid search provider preference");
			await settings.update({ [SEARCH_PROVIDER_FIELD]: value });
		}
	});
	ctx.effect(() => {
		const select = (value) => {
			const selection = value[SEARCH_PROVIDER_FIELD];
			let task;
			if (codexManagesSearch()) task = selection === "default" ? searchComposition.remove() : searchComposition.apply(selection === "kimi" ? KIMI_SEARCH_PROVIDER_ID : KIMI_AUTO_SEARCH_PROVIDER_ID);
			else task = searchComposition.remove().finally(() => searchSwitcher.select(selection));
			Promise.resolve(task).catch((error) => {
				ctx.logger?.warn?.("could not apply the configured web search provider: %s", error.message);
			});
		};
		select(settings.get());
		return settings.watch(select);
	}, "kimi-subscription: search provider selection");
	const handler = createKimiRpcHandler(coordinator, {
		usageReader,
		pluginManager,
		searchPreference
	});
	ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, handler, { authority: "loopback" }), "kimi-subscription: loopback account RPC");
}
//#endregion
export { CHANNEL, DISPLAY_NAME, DshKimiCredentialStore, KIMI_AUTO_SEARCH_PROVIDER_ID, KIMI_SEARCH_PROVIDER_ID, KIMI_SEARCH_URL, KIMI_USAGE_URL, KimiLoginCoordinator, PROVIDER, SEARCH_PROVIDER_AUTO, SEARCH_PROVIDER_DEFAULT, SEARCH_PROVIDER_FIELD, SEARCH_PROVIDER_KIMI, SETTINGS_NAMESPACE, apply, createKimiAuthService, createKimiAutoSearchProvider, createKimiPluginManager, createKimiRpcHandler, createKimiSearchProvider, createKimiSearchProviderSwitcher, createKimiSubscriptionProvider, createKimiUsageReader, inject, name, parseKimiSearchResponse, parseKimiUsage };
