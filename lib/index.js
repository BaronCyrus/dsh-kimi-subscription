import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { LlmError } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { randomUUID } from "node:crypto";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { createModels } from "@earendil-works/pi-ai";
//#region src/constants.js
const PROVIDER = "kimi-subscription";
const DISPLAY_NAME = "Kimi subscription";
const CHANNEL = "/kimi-subscription";
const CREDENTIAL_NAME = "KIMI_CODE_SUBSCRIPTION_CREDENTIAL";
//#endregion
//#region src/credential-store.js
const abortIfNeeded = (options) => options?.signal?.throwIfAborted();
const clone$1 = (value) => value === void 0 ? void 0 : structuredClone(value);
const LEGAL_API_KEY = /^[\x21-\x7E]+$/u;
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
		return clone$1(value);
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
	constructor(credentials, ref) {
		if (credentials === void 0 || credentials === null) throw new Error("Kimi subscription authentication requires the DSH credentials service");
		this.credentials = credentials;
		this.ref = ref;
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
		return parseCredential(hit.value);
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
			const next = await update(clone$1(current));
			abortIfNeeded(options);
			if (next === void 0) return current;
			const validated = assertCredential(next);
			await this.credentials.set(this.ref, JSON.stringify(validated));
			abortIfNeeded(options);
			return clone$1(validated);
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
/** Map the loopback-only DSH Connection channel onto account and usage services. */
function createKimiRpcHandler(coordinator, { usageReader } = {}) {
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
			const message = error instanceof Error && /^(unknown Kimi|Kimi login|Kimi usage|Kimi Code subscription|Could not read Kimi Code subscription usage)/u.test(error.message) ? error.message : "Kimi request failed";
			return badRequest(message);
		}
	};
}
//#endregion
//#region src/pi-ai-runtime.js
/**
* Reuse pi-ai's Kimi Code protocol, catalog, OAuth flow, and auth refresh while
* giving the DSH subscription route an identity distinct from kimi-coding API
* configuration. API-key and OAuth auth are both subscription credentials;
* ambient Kimi platform credentials are disabled by the plugin's auth context.
*/
function createKimiSubscriptionProvider() {
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
		stream: (model, context, options) => base.stream(model, context, options),
		streamSimple: (model, context, options) => base.streamSimple(model, context, options)
	});
}
//#endregion
//#region src/usage.js
const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const DEFAULT_USAGE_TTL_MS = 6e4;
const DEFAULT_USAGE_TIMEOUT_MS = 15e3;
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const clone = (value) => structuredClone(value);
function integer(value) {
	if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return Math.trunc(parsed);
	}
}
function nameFrom(value) {
	return record(value) && typeof value.name === "string" && value.name.length > 0 ? value.name : void 0;
}
function resetAtFrom(value) {
	return record(value) && typeof value.resetTime === "string" && value.resetTime.length > 0 ? value.resetTime : void 0;
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
	if (!record(value)) return void 0;
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
	if (!record(value)) return null;
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
	if (!record(value)) return null;
	const cents = integer(value.priceInCents);
	if (cents === void 0) return null;
	return {
		cents,
		currency: typeof value.currency === "string" && value.currency.length > 0 ? value.currency : ""
	};
}
function boosterWallet(value) {
	if (!record(value) || !record(value.balance) || value.balance.type !== "BOOSTER") return null;
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
	if (!record(payload)) return {
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
		if (!record(item)) continue;
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
function authorizationHeader(resolution) {
	const auth = resolution?.auth;
	if (!record(auth)) return void 0;
	if (typeof auth.apiKey === "string" && auth.apiKey.length > 0) return `Bearer ${auth.apiKey}`;
	if (!record(auth.headers)) return void 0;
	for (const [name, value] of Object.entries(auth.headers)) if (name.toLowerCase() === "authorization" && typeof value === "string" && value.length > 0) return value;
}
function statusError(status) {
	if (status === 401) return /* @__PURE__ */ new Error("Kimi Code subscription sign-in needs to be renewed");
	if (status === 402 || status === 403) return /* @__PURE__ */ new Error("Kimi Code subscription quota is currently unavailable");
	return /* @__PURE__ */ new Error("Could not read Kimi Code subscription usage");
}
/** Cached, single-flight usage reader. Credentials and response bodies stay host-only. */
function createKimiUsageReader({ getAuth, fetchImpl = globalThis.fetch, now = Date.now, url = KIMI_USAGE_URL, ttlMs = DEFAULT_USAGE_TTL_MS, timeoutMs = DEFAULT_USAGE_TIMEOUT_MS } = {}) {
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
			if (!force && cached !== void 0 && now() - cached.fetchedAt < ttlMs) return clone(cached);
			const observedGeneration = generation;
			if (!force && inFlight !== void 0) return clone(await inFlight);
			const pending = load(signal).then((value) => {
				if (generation === observedGeneration) cached = value;
				return value;
			});
			if (!force) inFlight = pending;
			try {
				return clone(await pending);
			} finally {
				if (inFlight === pending) inFlight = void 0;
			}
		},
		invalidate() {
			generation += 1;
			cached = void 0;
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
	"attachments"
];
const CREDENTIAL_REF = credentialRef(CREDENTIAL_NAME);
const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024;
const REQUEST_IMAGE_PIXEL_BUDGET = 2048 * 2048;
const REQUEST_IMAGE_MAX_BYTES = 1024 * 1024;
function apply(ctx) {
	const store = new DshKimiCredentialStore(ctx.credentials, CREDENTIAL_REF);
	const provider = createKimiSubscriptionProvider();
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
		cacheRetention: "short"
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
	const handler = createKimiRpcHandler(new KimiLoginCoordinator(auth), { usageReader });
	ctx.effect(() => ctx.connection.rpc.handle(CHANNEL, handler, { authority: "loopback" }), "kimi-subscription: loopback account RPC");
}
//#endregion
export { CHANNEL, DISPLAY_NAME, DshKimiCredentialStore, KIMI_USAGE_URL, KimiLoginCoordinator, PROVIDER, apply, createKimiAuthService, createKimiRpcHandler, createKimiSubscriptionProvider, createKimiUsageReader, inject, name, parseKimiUsage };
