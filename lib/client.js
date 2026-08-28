window.__ModuleLoader__.load({
	id: "dsh-kimi-subscription",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/composer-quota.js
		const WINDOW_SECONDS = Object.freeze({
			minute: 60,
			hour: 3600,
			day: 86400,
			week: 604800
		});
		function displayable(row) {
			return Number.isFinite(row?.remainingPercent) && row.remainingPercent >= 0 && row.remainingPercent <= 100;
		}
		function windowSeconds(row) {
			const factor = WINDOW_SECONDS[row?.window?.unit];
			const duration = row?.window?.duration;
			return Number.isFinite(factor) && Number.isFinite(duration) && duration > 0 ? factor * duration : void 0;
		}
		function findWindow(rows, seconds) {
			return rows.find((row) => displayable(row) && windowSeconds(row) === seconds);
		}
		/** Select the two Kimi plan windows rendered beside the conversation input. */
		function selectKimiComposerQuota(usage) {
			const rows = [usage?.summary, ...Array.isArray(usage?.limits) ? usage.limits : []].filter(Boolean);
			const fiveHour = findWindow(rows, 5 * 3600);
			const sevenDay = findWindow(rows, 7 * 86400);
			if (fiveHour === void 0 && sevenDay === void 0) return void 0;
			return {
				...fiveHour === void 0 ? {} : { fiveHour },
				...sevenDay === void 0 ? {} : { sevenDay }
			};
		}
		function formatKimiComposerQuota(quota) {
			if (quota === void 0) return void 0;
			const parts = [];
			if (quota.fiveHour !== void 0) parts.push(`5h ${Math.round(quota.fiveHour.remainingPercent)}%`);
			if (quota.sevenDay !== void 0) parts.push(`7d ${Math.round(quota.sevenDay.remainingPercent)}%`);
			return parts.length === 0 ? void 0 : parts.join("　");
		}
		//#endregion
		//#region src/constants.js
		const PROVIDER = "kimi-subscription";
		const CHANNEL = "/kimi-subscription";
		//#endregion
		//#region src/login-progress.js
		/** Reconcile a login flow with the credential store without exposing credentials. */
		async function readLoginProgress({ flow, readFlow, readAccount }) {
			try {
				const nextFlow = await readFlow();
				if (nextFlow.phase !== "authenticated") return { flow: nextFlow };
				return {
					flow: nextFlow,
					account: await readAccount()
				};
			} catch (flowError) {
				try {
					const account = await readAccount();
					if (account?.authenticated === true) return {
						flow: {
							id: flow.id,
							phase: "authenticated",
							authenticated: true
						},
						account,
						recovered: true
					};
				} catch {}
				throw flowError;
			}
		}
		//#endregion
		//#region src/client.jsx
		const inject = [
			"slots",
			"locale",
			"connection",
			"modelDirectories"
		];
		const NS = "settings.kimiSubscription";
		const TERMINAL_PHASES = /* @__PURE__ */ new Set([
			"authenticated",
			"failed",
			"cancelled"
		]);
		const QUICK_USAGE_REFRESH_EVENT = "dsh-kimi-subscription:refresh-quick-usage";
		const QUICK_USAGE_REFRESH_MS = 6e4;
		const zh = {
			nav: "Kimi 订阅",
			title: "Kimi Code 订阅",
			intro: "使用 Kimi Code 会员订阅，不会与按量计费的 Kimi Open Platform 混用。模型会显示在 Kimi subscription 分组。",
			loading: "正在读取登录状态…",
			connected: "已连接",
			disconnected: "未连接",
			methodApiKey: "Kimi Code 订阅 API Key",
			methodOauth: "Kimi 账号设备登录",
			apiKeyTitle: "订阅 API Key（推荐）",
			apiKeyHint: "请使用 Kimi Code 控制台生成的订阅 API Key，不要填写 Kimi Open Platform 的按量计费密钥。",
			apiKeyPlaceholder: "粘贴 Kimi Code 订阅 API Key",
			saveApiKey: "保存并连接",
			saving: "保存中…",
			or: "或者",
			deviceLogin: "使用 Kimi 账号登录",
			deviceHint: "在 Kimi 登录页确认此设备代码：",
			openLogin: "打开 Kimi 登录页",
			waiting: "正在等待登录完成…",
			cancel: "取消",
			logout: "断开连接",
			retry: "重试",
			failed: "操作失败，请重试。",
			loadFailed: "无法读取 Kimi 订阅状态。",
			readyHint: "现在可在模型选择器的 Kimi subscription 分组中选择订阅模型。",
			usageTitle: "订阅余量",
			usageLoading: "正在读取余量…",
			usageFailed: "无法读取订阅余量。",
			usageEmpty: "当前账号没有返回可显示的余量信息。",
			refreshUsage: "刷新余量",
			refreshingUsage: "刷新中…",
			remaining: "剩余",
			used: "已使用",
			resetAt: "重置时间",
			weeklyQuota: "每周额度",
			windowQuota: "{duration} {unit}额度",
			minute: "分钟",
			hour: "小时",
			day: "天",
			week: "周",
			boosterBalance: "加量包余额",
			monthlySpend: "本月已用",
			quickUsageStatus: "Kimi 订阅余量：{value}",
			interactiveOnly: "Kimi Code 订阅仅用于交互式使用；批处理或转售场景请使用 Kimi Open Platform。"
		};
		const en = {
			nav: "Kimi subscription",
			title: "Kimi Code subscription",
			intro: "Use a Kimi Code membership without mixing it with pay-as-you-go Kimi Open Platform credentials. Models appear under Kimi subscription.",
			loading: "Reading connection status…",
			connected: "Connected",
			disconnected: "Not connected",
			methodApiKey: "Kimi Code subscription API key",
			methodOauth: "Kimi account device sign-in",
			apiKeyTitle: "Subscription API key (recommended)",
			apiKeyHint: "Use a subscription API key created in the Kimi Code console, not a pay-as-you-go Kimi Open Platform key.",
			apiKeyPlaceholder: "Paste a Kimi Code subscription API key",
			saveApiKey: "Save and connect",
			saving: "Saving…",
			or: "or",
			deviceLogin: "Sign in with Kimi account",
			deviceHint: "Confirm this device code on the Kimi sign-in page:",
			openLogin: "Open Kimi sign-in",
			waiting: "Waiting for sign-in to finish…",
			cancel: "Cancel",
			logout: "Disconnect",
			retry: "Retry",
			failed: "The operation failed. Try again.",
			loadFailed: "Could not read Kimi subscription status.",
			readyHint: "You can now select a subscription model from the Kimi subscription group.",
			usageTitle: "Subscription usage",
			usageLoading: "Reading usage…",
			usageFailed: "Could not read subscription usage.",
			usageEmpty: "This account did not return any displayable usage information.",
			refreshUsage: "Refresh usage",
			refreshingUsage: "Refreshing…",
			remaining: "Remaining",
			used: "Used",
			resetAt: "Resets",
			weeklyQuota: "Weekly quota",
			windowQuota: "{duration} {unit} quota",
			minute: "minute",
			hour: "hour",
			day: "day",
			week: "week",
			boosterBalance: "Booster balance",
			monthlySpend: "Used this month",
			quickUsageStatus: "Kimi subscription usage: {value}",
			interactiveOnly: "Kimi Code subscriptions are for interactive use. Use Kimi Open Platform for batch processing or resale."
		};
		const STYLE = `
.kimiSubscription{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}
.kimiSubscription h2,.kimiSubscription h3,.kimiSubscription p{margin:0}.kimiSubscription h2{font-size:16px;line-height:24px;font-weight:500}.kimiSubscription h3{font-size:14px;line-height:22px;font-weight:500}
.kimiSubscriptionIntro,.kimiSubscriptionHint{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.kimiSubscriptionCard{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1)}
.kimiSubscriptionRow{display:flex;align-items:center;justify-content:space-between;gap:12px}.kimiSubscriptionStatus{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;font-weight:500}
.kimiSubscriptionDot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}.kimiSubscriptionDot[data-state=connected]{background:var(--dsw-alias-state-success-primary)}.kimiSubscriptionDot[data-state=disconnected]{background:var(--dsw-alias-state-error-primary)}
.kimiSubscriptionMethod{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.kimiSubscriptionActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kimiSubscriptionForm,.kimiSubscriptionFlow{display:flex;flex-direction:column;gap:10px}.kimiSubscriptionInput{width:100%;box-sizing:border-box}.kimiSubscriptionDivider{display:flex;align-items:center;gap:10px;color:var(--dsw-alias-label-dimmed);font-size:12px}.kimiSubscriptionDivider::before,.kimiSubscriptionDivider::after{content:'';height:1px;flex:1;background:var(--dsw-alias-border-l2)}
.kimiSubscriptionDevice{padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}.kimiSubscriptionCode{width:max-content;max-width:100%;font:600 17px/24px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.08em;overflow-wrap:anywhere}
.kimiSubscriptionError{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:20px}.kimiSubscriptionPolicy{padding-top:2px;color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:18px}
.kimiUsageHeader{display:flex;align-items:center;justify-content:space-between;gap:12px}.kimiUsageList{display:flex;flex-direction:column;gap:14px}.kimiUsageItem{display:flex;flex-direction:column;gap:6px}.kimiUsageMeta{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:13px;line-height:20px}.kimiUsageLabel{font-weight:500}.kimiUsageNumbers{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}.kimiUsageTrack{height:7px;overflow:hidden;border-radius:999px;background:var(--dsw-alias-bg-module-platform)}.kimiUsageFill{height:100%;border-radius:inherit;background:var(--dsw-alias-brand-primary);transition:width .2s ease}.kimiUsageReset{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px}.kimiUsageWallet{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2);font-size:13px;line-height:20px}
.kimiComposerUsage{display:inline-flex;align-items:center;flex:0 0 auto;height:28px;box-sizing:border-box;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;font-weight:500;font-variant-numeric:tabular-nums;white-space:nowrap;user-select:none}
@media(max-width:640px){.kimiSubscriptionRow{align-items:flex-start;flex-direction:column}.kimiSubscriptionActions{width:100%}.kimiUsageHeader{align-items:flex-start;flex-direction:column}}
`;
		const unwrap = (response) => {
			if (!response?.ok) throw new Error(response?.error?.message ?? "Kimi RPC failed");
			return response.value;
		};
		function formatNumber(value) {
			return new Intl.NumberFormat().format(value);
		}
		function formatReset(value) {
			const date = new Date(value);
			return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(void 0, {
				dateStyle: "medium",
				timeStyle: "short"
			}).format(date);
		}
		function formatMoney(cents, currency) {
			try {
				return new Intl.NumberFormat(void 0, {
					style: "currency",
					currency
				}).format(cents / 100);
			} catch {
				return `${formatNumber(cents / 100)} ${currency}`;
			}
		}
		function quotaLabel(row, index, t) {
			if (row.name) return row.name;
			if (row.window === void 0) return index === 0 ? t("weeklyQuota") : t("usageTitle");
			return t("windowQuota").replace("{duration}", String(row.window.duration)).replace("{unit}", t(row.window.unit));
		}
		function UsageCard({ call, t }) {
			const [usage, setUsage] = (0, react.useState)();
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(false);
			const generation = (0, react.useRef)(0);
			const load = (force) => {
				const current = ++generation.current;
				setLoading(true);
				setError(false);
				call("usage", { force }).then((value) => {
					if (generation.current === current) {
						setUsage(value);
						if (force) window.dispatchEvent(new Event(QUICK_USAGE_REFRESH_EVENT));
					}
				}).catch(() => {
					if (generation.current === current) setError(true);
				}).finally(() => {
					if (generation.current === current) setLoading(false);
				});
			};
			(0, react.useEffect)(() => {
				load(false);
				return () => {
					generation.current += 1;
				};
			}, []);
			const rows = usage === void 0 ? [] : [usage.summary, ...usage.limits].filter(Boolean);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "kimiSubscriptionCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiUsageHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("usageTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							disabled: loading,
							onClick: () => load(true),
							children: loading ? t("refreshingUsage") : t("refreshUsage")
						})]
					}),
					loading && usage === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						role: "status",
						children: t("usageLoading")
					}) : null,
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionError",
						role: "alert",
						children: t("usageFailed")
					}) : null,
					!loading && !error && rows.length === 0 && usage?.extraUsage == null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						children: t("usageEmpty")
					}) : null,
					rows.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "kimiUsageList",
						children: rows.map((row, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "kimiUsageItem",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "kimiUsageMeta",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "kimiUsageLabel",
										children: quotaLabel(row, index, t)
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: "kimiUsageNumbers",
										children: [
											t("remaining"),
											" ",
											Math.round(row.remainingPercent),
											"% · ",
											t("used"),
											" ",
											formatNumber(row.used),
											" / ",
											formatNumber(row.limit)
										]
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "kimiUsageTrack",
									role: "progressbar",
									"aria-label": quotaLabel(row, index, t),
									"aria-valuemin": "0",
									"aria-valuemax": "100",
									"aria-valuenow": Math.round(row.remainingPercent),
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "kimiUsageFill",
										style: { width: `${row.remainingPercent}%` }
									})
								}),
								row.resetAt ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "kimiUsageReset",
									children: [
										t("resetAt"),
										"：",
										formatReset(row.resetAt)
									]
								}) : null
							]
						}, `${row.name ?? ""}:${row.window?.duration ?? ""}:${row.window?.unit ?? ""}:${index}`))
					}) : null,
					usage?.extraUsage ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiUsageWallet",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "kimiUsageLabel",
							children: t("boosterBalance")
						}), usage.extraUsage.monthlyChargeLimitEnabled ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "kimiUsageReset",
							children: [
								t("monthlySpend"),
								"：",
								formatMoney(usage.extraUsage.monthlyUsedCents, usage.extraUsage.currency)
							]
						}) : null] }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "kimiUsageNumbers",
							children: [
								formatMoney(usage.extraUsage.balanceCents, usage.extraUsage.currency),
								" / ",
								formatMoney(usage.extraUsage.totalCents, usage.extraUsage.currency)
							]
						})]
					}) : null
				]
			});
		}
		function useQuickUsage(rpc, enabled) {
			const [quota, setQuota] = (0, react.useState)();
			(0, react.useEffect)(() => {
				if (!enabled) {
					setQuota(void 0);
					return;
				}
				let live = true;
				let loading = false;
				const load = async () => {
					if (loading) return;
					loading = true;
					try {
						const account = unwrap(await rpc.call(CHANNEL, "status", {}));
						if (!live) return;
						if (account?.authenticated !== true) {
							setQuota(void 0);
							return;
						}
						const usage = unwrap(await rpc.call(CHANNEL, "usage", { force: false }));
						if (live) setQuota(selectKimiComposerQuota(usage));
					} catch {
						if (live) setQuota(void 0);
					} finally {
						loading = false;
					}
				};
				const refresh = () => {
					load();
				};
				load();
				const timer = window.setInterval(refresh, QUICK_USAGE_REFRESH_MS);
				window.addEventListener(QUICK_USAGE_REFRESH_EVENT, refresh);
				return () => {
					live = false;
					window.clearInterval(timer);
					window.removeEventListener(QUICK_USAGE_REFRESH_EVENT, refresh);
				};
			}, [rpc, enabled]);
			return quota;
		}
		function KimiComposerUsage({ rpc, t, directory }) {
			const enabled = (0, react.useSyncExternalStore)((listener) => directory.subscribe(listener), () => directory.getSnapshot()).current?.provider === PROVIDER;
			const quota = useQuickUsage(rpc, enabled);
			const display = formatKimiComposerQuota(quota);
			if (!enabled || display === void 0) return null;
			const label = t("quickUsageStatus").replace("{value}", display);
			const resetDetails = [quota.fiveHour?.resetAt ? `5h ${t("resetAt")} ${formatReset(quota.fiveHour.resetAt)}` : void 0, quota.sevenDay?.resetAt ? `7d ${t("resetAt")} ${formatReset(quota.sevenDay.resetAt)}` : void 0].filter(Boolean);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "kimiComposerUsage",
				role: "status",
				"aria-label": label,
				title: resetDetails.length === 0 ? label : `${label}\n${resetDetails.join("\n")}`,
				children: display
			});
		}
		function KimiSection({ rpc, t }) {
			const [account, setAccount] = (0, react.useState)();
			const [accountError, setAccountError] = (0, react.useState)(false);
			const [flow, setFlow] = (0, react.useState)();
			const [apiKey, setApiKey] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const generation = (0, react.useRef)(0);
			const call = (endpoint, payload = {}) => rpc.call(CHANNEL, endpoint, payload).then(unwrap);
			const loadAccount = () => {
				const current = ++generation.current;
				setAccount(void 0);
				setAccountError(false);
				setError(void 0);
				call("status").then((value) => {
					if (generation.current === current) setAccount(value);
				}).catch(() => {
					if (generation.current === current) setAccountError(true);
				});
			};
			(0, react.useEffect)(() => {
				loadAccount();
				return () => {
					generation.current += 1;
				};
			}, []);
			(0, react.useEffect)(() => {
				if (flow?.id === void 0 || TERMINAL_PHASES.has(flow.phase)) return void 0;
				let polling = false;
				const poll = () => {
					if (polling) return;
					polling = true;
					readLoginProgress({
						flow,
						readFlow: () => call("login/status", { id: flow.id }),
						readAccount: () => call("status")
					}).then((next) => {
						setFlow(next.flow);
						setError(void 0);
						if (next.account !== void 0) setAccount(next.account);
					}).catch(() => setError(t("failed"))).finally(() => {
						polling = false;
					});
				};
				const timer = window.setInterval(poll, 800);
				return () => window.clearInterval(timer);
			}, [flow?.id, flow?.phase]);
			const startLogin = () => {
				setBusy(true);
				setError(void 0);
				call("login/start").then(setFlow).catch(() => setError(t("failed"))).finally(() => setBusy(false));
			};
			const cancelLogin = () => {
				if (flow?.id === void 0) return;
				setBusy(true);
				call("login/cancel", { id: flow.id }).then(setFlow).catch(() => setError(t("failed"))).finally(() => setBusy(false));
			};
			const saveApiKey = (event) => {
				event.preventDefault();
				const value = apiKey.trim();
				if (value.length === 0) return;
				setBusy(true);
				setError(void 0);
				call("api-key/set", { apiKey: value }).then((next) => {
					setApiKey("");
					setFlow(void 0);
					setAccount(next);
				}).catch(() => setError(t("failed"))).finally(() => setBusy(false));
			};
			const logout = () => {
				setBusy(true);
				setError(void 0);
				call("logout").then((next) => {
					setFlow(void 0);
					setAccount(next);
				}).catch(() => setError(t("failed"))).finally(() => setBusy(false));
			};
			if (accountError) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "kimiSubscription",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "kimiSubscriptionCard",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionError",
						role: "alert",
						children: t("loadFailed")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "kimiSubscriptionActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							onClick: loadAccount,
							children: t("retry")
						})
					})]
				})]
			});
			const signedIn = account?.authenticated === true;
			const ready = account !== void 0;
			const activeFlow = flow !== void 0 && !TERMINAL_PHASES.has(flow.phase);
			const method = account?.method === "oauth" ? t("methodOauth") : t("methodApiKey");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "kimiSubscription",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", { children: t("title") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionIntro",
						children: t("intro")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiSubscriptionCard",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "kimiSubscriptionRow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: "kimiSubscriptionStatus",
									role: "status",
									"aria-live": "polite",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "kimiSubscriptionDot",
										"data-state": ready ? signedIn ? "connected" : "disconnected" : "loading",
										"aria-hidden": "true"
									}), ready ? signedIn ? t("connected") : t("disconnected") : t("loading")]
								}), signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "kimiSubscriptionMethod",
									children: method
								}) : null] }), signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "kimiSubscriptionActions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "outline",
										disabled: busy,
										onClick: logout,
										children: t("logout")
									})
								}) : null]
							}),
							signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "kimiSubscriptionHint",
								children: t("readyHint")
							}) : ready && !activeFlow ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
									className: "kimiSubscriptionForm",
									onSubmit: saveApiKey,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("apiKeyTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: "kimiSubscriptionHint",
											children: t("apiKeyHint")
										})] }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
											className: "kimiSubscriptionInput",
											type: "password",
											value: apiKey,
											"aria-label": t("apiKeyTitle"),
											placeholder: t("apiKeyPlaceholder"),
											autoComplete: "off",
											spellCheck: false,
											onChange: (event) => setApiKey(event.currentTarget.value)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "kimiSubscriptionActions",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
												type: "submit",
												variant: "primary",
												disabled: busy || apiKey.trim() === "",
												children: busy ? t("saving") : t("saveApiKey")
											})
										})
									]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "kimiSubscriptionDivider",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("or") })
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "kimiSubscriptionActions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "outline",
										disabled: busy,
										onClick: startLogin,
										children: t("deviceLogin")
									})
								})
							] }) : null,
							!signedIn && flow?.phase === "waiting_device" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "kimiSubscriptionFlow kimiSubscriptionDevice",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "kimiSubscriptionHint",
										children: t("deviceHint")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: "kimiSubscriptionCode",
										children: flow.deviceCode?.userCode
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("a", {
										href: flow.deviceCode?.verificationUri,
										target: "_blank",
										rel: "noreferrer",
										children: t("openLogin")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: "kimiSubscriptionHint",
										children: t("waiting")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "kimiSubscriptionActions",
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											type: "button",
											variant: "outline",
											disabled: busy,
											onClick: cancelLogin,
											children: t("cancel")
										})
									})
								]
							}) : null,
							!signedIn && flow?.phase === "starting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "kimiSubscriptionFlow",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
									className: "kimiSubscriptionHint",
									children: t("waiting")
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "kimiSubscriptionActions",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "outline",
										disabled: busy,
										onClick: cancelLogin,
										children: t("cancel")
									})
								})]
							}) : null,
							flow?.phase === "failed" || error !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "kimiSubscriptionError",
								role: "alert",
								children: error ?? t("failed")
							}) : null
						]
					}),
					signedIn ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(UsageCard, {
						call,
						t
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionPolicy",
						children: t("interactiveOnly")
					})
				]
			});
		}
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "kimi-subscription: copy");
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-kimi-subscription";
				tag.textContent = STYLE;
				document.head.append(tag);
				return () => tag.remove();
			}, "kimi-subscription: style");
			const connection = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "kimi-subscription",
				order: 16,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({
					rpc: connection.rpc,
					t
				})
			}, KimiSection));
			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "kimi-subscription-usage",
				order: 16,
				locale: NS,
				inject: (sessionId) => ({
					rpc: connection.rpc,
					t,
					directory: ctx.modelDirectories.directoryFor(sessionId).store
				})
			}, KimiComposerUsage));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map