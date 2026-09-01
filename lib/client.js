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
			interactiveOnly: "Kimi Code 订阅仅用于交互式使用；批处理或转售场景请使用 Kimi Open Platform。",
			versionTitle: "插件版本",
			versionCurrent: "当前版本",
			versionLatest: "最新版本",
			versionCheck: "检查更新",
			versionChecking: "正在检查更新…",
			versionFailed: "无法检查最新版本。",
			versionUpToDate: "已是最新版本。",
			versionAvailable: "发现新版本 v{version}。",
			versionLinked: "当前为本地开发安装，请在插件仓库拉取最新代码并重新构建。",
			versionManual: "请在终端运行 dsh plugin --profile web add dsh-kimi-subscription@latest 完成更新。",
			versionUpdate: "更新插件",
			versionUpdating: "正在更新…",
			versionUpdateFailed: "更新失败，请重试或在终端手动更新。",
			versionUpdated: "已更新到 v{version}。",
			versionUpdatedHint: "新版本需要重启 DSH 服务才能完全生效；仅刷新界面不会更新宿主进程中已加载的插件。",
			versionRestart: "重启 DSH 服务",
			versionRestartHint: "插件无法安全地重启宿主进程：请在运行 DSH 的终端按 Ctrl+C 结束进程，再重新运行 dsh web。",
			versionRefresh: "刷新界面",
			versionLater: "稍后",
			searchTitle: "网页搜索",
			searchScope: "DSH 全局设置",
			searchLoading: "正在读取搜索设置…",
			searchFailed: "搜索设置读取或保存失败。",
			searchDefault: "不接管（默认）",
			searchDefaultHint: "不改动 DSH 的搜索路由，由 DSH 默认搜索或其他订阅插件的设置决定。切回此项时会恢复此前被接管的搜索来源。",
			searchAuto: "自动（按模型路由）",
			searchAutoHint: "Kimi 模型使用 Kimi 订阅搜索；Codex 模型交给 Codex 订阅搜索（若已安装该插件）；其他模型使用 DSH 默认搜索。",
			searchKimi: "始终使用 Kimi 搜索",
			searchKimiHint: "所有模型的网页搜索都走 Kimi 订阅搜索；订阅未连接时搜索会失败。",
			searchCodexDetected: "检测到 Codex 订阅插件：DSH 搜索槽位由其管理。选择「自动 / 始终」会自动把路由写入本 profile 的 cordis.patch.yml（热加载生效，无需重启）：Kimi 模型走 Kimi 搜索，Codex 模型走 Codex 搜索，其余走 DSH 默认搜索；切回「不接管」会自动移除该补丁。"
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
			interactiveOnly: "Kimi Code subscriptions are for interactive use. Use Kimi Open Platform for batch processing or resale.",
			versionTitle: "Plugin version",
			versionCurrent: "Current version",
			versionLatest: "Latest version",
			versionCheck: "Check for updates",
			versionChecking: "Checking for updates…",
			versionFailed: "Could not check the latest version.",
			versionUpToDate: "You are on the latest version.",
			versionAvailable: "A new version v{version} is available.",
			versionLinked: "Installed from a local checkout; pull and rebuild the plugin repository to update.",
			versionManual: "Run dsh plugin --profile web add dsh-kimi-subscription@latest in a terminal to update.",
			versionUpdate: "Update plugin",
			versionUpdating: "Updating…",
			versionUpdateFailed: "The update failed. Try again or update manually in a terminal.",
			versionUpdated: "Updated to v{version}.",
			versionUpdatedHint: "The new version takes full effect after a DSH restart; refreshing the page alone does not reload the plugin inside the host process.",
			versionRestart: "Restart DSH",
			versionRestartHint: "The plugin cannot safely restart its host process: press Ctrl+C in the terminal running DSH, then run dsh web again.",
			versionRefresh: "Refresh page",
			versionLater: "Later",
			searchTitle: "Web search",
			searchScope: "DSH-wide setting",
			searchLoading: "Reading search preference…",
			searchFailed: "Could not read or save the search preference.",
			searchDefault: "Do not take over (default)",
			searchDefaultHint: "Leave DSH search routing untouched; the DSH default search or another subscription plugin decides. Switching back here restores the provider this plugin took over from.",
			searchAuto: "Auto (route by model)",
			searchAutoHint: "Kimi models use Kimi subscription search; Codex models delegate to Codex subscription search when that plugin is installed; other models use the DSH default search.",
			searchKimi: "Always use Kimi search",
			searchKimiHint: "Every model searches through the Kimi subscription; search fails while the subscription is disconnected.",
			searchCodexDetected: "Codex subscription plugin detected: it manages the DSH search slot. Choosing Auto/Always automatically writes the route into this profile's cordis.patch.yml (hot-applied, no restart needed): Kimi models use Kimi search, Codex models use Codex search, others use the DSH default. Switching back to default removes the patch automatically."
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
.kimiVersionRows{display:flex;flex-direction:column;gap:6px;font-size:13px;line-height:20px}.kimiVersionRow{display:flex;align-items:center;justify-content:space-between;gap:12px}.kimiVersionValue{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}.kimiVersionUpdated{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
 .kimiSubscriptionSearchChoices{display:flex;flex-direction:column;gap:10px}.kimiSubscriptionSearchChoice{display:flex;align-items:flex-start;gap:10px;cursor:pointer}.kimiSubscriptionSearchChoice input{margin-top:3px;accent-color:var(--dsw-alias-brand-primary)}.kimiSubscriptionSearchCopy{display:flex;flex-direction:column;gap:2px}.kimiSubscriptionSearchCopy strong{font-size:13px;line-height:20px;font-weight:500}.kimiSubscriptionSearchCopy span{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
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
		function VersionCard({ call, t }) {
			const [info, setInfo] = (0, react.useState)();
			const [loading, setLoading] = (0, react.useState)(true);
			const [error, setError] = (0, react.useState)(false);
			const [updating, setUpdating] = (0, react.useState)(false);
			const [updateFailed, setUpdateFailed] = (0, react.useState)(false);
			const [updated, setUpdated] = (0, react.useState)();
			const [restartHint, setRestartHint] = (0, react.useState)(false);
			const generation = (0, react.useRef)(0);
			const load = (force) => {
				const current = ++generation.current;
				setLoading(true);
				setError(false);
				call("plugin/version", { force }).then((value) => {
					if (generation.current === current) setInfo(value);
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
			const update = () => {
				setUpdating(true);
				setUpdateFailed(false);
				call("plugin/update").then((value) => {
					setUpdated(value);
					setRestartHint(false);
				}).catch(() => setUpdateFailed(true)).finally(() => setUpdating(false));
			};
			const installKind = info?.install?.kind;
			const showStatus = info !== void 0 && updated === void 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "kimiSubscriptionCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiUsageHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("versionTitle") }), updated === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "outline",
							disabled: loading || updating,
							onClick: () => load(true),
							children: loading ? t("versionChecking") : t("versionCheck")
						}) : null]
					}),
					loading && info === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						role: "status",
						children: t("versionChecking")
					}) : null,
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionError",
						role: "alert",
						children: t("versionFailed")
					}) : null,
					info !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiVersionRows",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "kimiVersionRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("versionCurrent") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "kimiVersionValue",
								children: ["v", info.current]
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "kimiVersionRow",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("versionLatest") }), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "kimiVersionValue",
								children: ["v", info.latest]
							})]
						})]
					}) : null,
					showStatus ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						role: "status",
						children: info.updateAvailable ? t("versionAvailable").replace("{version}", info.latest) : t("versionUpToDate")
					}) : null,
					showStatus && info.updateAvailable && installKind === "npm" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "kimiSubscriptionActions",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							type: "button",
							variant: "primary",
							disabled: updating,
							onClick: update,
							children: updating ? t("versionUpdating") : t("versionUpdate")
						})
					}) : null,
					showStatus && installKind === "link" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						children: t("versionLinked")
					}) : null,
					showStatus && info.updateAvailable && installKind === "unknown" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						children: t("versionManual")
					}) : null,
					updateFailed ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionError",
						role: "alert",
						children: t("versionUpdateFailed")
					}) : null,
					updated !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiVersionUpdated",
						role: "status",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "kimiSubscriptionStatus",
								children: t("versionUpdated").replace("{version}", updated.version)
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "kimiSubscriptionHint",
								children: t("versionUpdatedHint")
							}),
							restartHint ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: "kimiSubscriptionHint",
								children: t("versionRestartHint")
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "kimiSubscriptionActions",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "outline",
										onClick: () => setRestartHint(true),
										children: t("versionRestart")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "primary",
										onClick: () => window.location.reload(),
										children: t("versionRefresh")
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "outline",
										onClick: () => setUpdated(void 0),
										children: t("versionLater")
									})
								]
							})
						]
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
		function SearchProviderCard({ call, t }) {
			const [pref, setPref] = (0, react.useState)();
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(false);
			const generation = (0, react.useRef)(0);
			(0, react.useEffect)(() => {
				const current = ++generation.current;
				call("preferences/status").then((value) => {
					if (generation.current === current) setPref(value);
				}).catch(() => {
					if (generation.current === current) setError(true);
				});
				return () => {
					generation.current += 1;
				};
			}, []);
			const select = (value) => {
				if (busy || pref?.writable !== true || pref?.searchProvider === value) return;
				setBusy(true);
				setError(false);
				call("preferences/update", { searchProvider: value }).then((next) => {
					setPref(next);
				}).catch(() => setError(true)).finally(() => setBusy(false));
			};
			const choice = (value, label, hint) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
				className: "kimiSubscriptionSearchChoice",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					type: "radio",
					name: "kimi-subscription-search-provider",
					checked: pref?.searchProvider === value,
					disabled: busy || pref?.writable !== true,
					onChange: () => select(value)
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "kimiSubscriptionSearchCopy",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: hint })]
				})]
			}, value);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "kimiSubscriptionCard",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiUsageHeader",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", { children: t("searchTitle") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "kimiSubscriptionMethod",
							children: t("searchScope")
						})]
					}),
					pref === void 0 && !error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						role: "status",
						children: t("searchLoading")
					}) : null,
					error ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionError",
						role: "alert",
						children: t("searchFailed")
					}) : null,
					pref !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "kimiSubscriptionSearchChoices",
						role: "radiogroup",
						"aria-label": t("searchTitle"),
						children: [
							choice("default", t("searchDefault"), t("searchDefaultHint")),
							choice("auto", t("searchAuto"), t("searchAutoHint")),
							choice("kimi", t("searchKimi"), t("searchKimiHint"))
						]
					}) : null,
					pref?.codexDetected === true ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "kimiSubscriptionHint",
						role: "note",
						children: t("searchCodexDetected")
					}) : null
				]
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SearchProviderCard, {
						call,
						t
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(VersionCard, {
						call,
						t
					}),
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