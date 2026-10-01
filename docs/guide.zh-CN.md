# Kimi 订阅使用指南

[返回项目首页](../README.md) · **简体中文** · [English](guide.en.md)

本指南补充安装、权限、搜索与排障细节。快速上手请先看 [README](../README.md#安装)。

## 安装与兼容性

本仓库的 DSH peer 声明为 `>=0.1.1-rc.2 <0.3.0-0`；已记录的验证版本、依赖版本与验证范围见 [compatibility.json](../compatibility.json) 和 [package.json](../package.json)。兼容范围不代表其中每个版本都经过完整 GUI、登录和真实模型调用验证。

**桌面应用（唯一支持的方式）：** 打开桌面应用的**插件**页，点击**添加插件**，在**包名或地址**中填入 `dsh-kimi-subscription`，在**安装源**中选择**官方源**，然后点击**安装**。同一个输入框也接受 GitHub 仓库地址和本机插件目录的绝对路径。

安装完成后**手动重启桌面应用**；应用自身会提示「更改将在下次启动生效」。

需要可重复安装时，在同一个输入框中把版本一起写上（版本号换成你要的）：

```text
dsh-kimi-subscription@1.3.6
```

从 [GitHub Releases](https://github.com/BaronCyrus/dsh-kimi-subscription/releases/latest) 下载 `dsh-kimi-subscription-1.3.6.tgz` 后，也可以改用该文件的绝对路径安装，适合离线或审计场景。

**其它 profile（例如自建 profile）：** `dsh plugin --profile <name> add dsh-kimi-subscription@latest` 仍可用于非桌面 profile。**不要**对 `desktop` 使用它：CLI 会直接拒绝（`profile "desktop" is managed exclusively by the Electron application`），请改用上面的插件页。

插件页只列出当前部署中存在的 profile；如果提示「本部署没有可管理的 profile」，说明 profile 尚未就绪，应先在桌面应用中完成初始化。分享诊断信息前请检查并隐藏个人路径和敏感配置，不要公开整份配置。

## 登录与凭据

在 **设置 → Kimi 订阅** 中，选择 Kimi Code 订阅 API Key 或设备登录。前者应来自 Kimi Code 控制台，后者按页面提示完成官方授权。

本插件连接 Kimi Code 订阅服务 `https://api.kimi.com/coding`。它与 `api.moonshot.ai` / `api.moonshot.cn` 的按量计费 Open Platform 不同，凭据与额度不能混用。项目不会静默读取环境中的 Open Platform 密钥作为备用。

API Key 和 OAuth 凭据由 DSH Host 的凭据服务管理。OAuth 支持自动刷新，但账号撤销授权、登录失效或网络异常仍可能要求重新登录；不要把自动刷新理解为永不掉线。安全边界见 [SECURITY.md](../SECURITY.md)。

## 模型与订阅权限

模型目录来自插件适配的 pi-ai Kimi Code provider。仓库记录的 `0.85.1` 目录包含 `k3`、`k3-256k`、`kimi-for-coding` 和 `kimi-for-coding-highspeed`；实际目录会随安装依赖变化。

本仓库对 `kimi-for-coding` 的元数据作了本地修正：名称为 **Kimi K2.8 Preview**，上下文声明为 `1048576`，思考档位映射为 `low` / `high` / `max`。这些是插件的模型元数据，不是服务端容量或账号权限的保证，实现见 [pi-ai-runtime.js](../src/pi-ai-runtime.js)。

**目录不是授权清单。** 插件不按会员档位过滤模型。不同模型与上下文能力的权益应以 [Kimi Code 模型文档](https://www.kimi.com/code/docs/kimi-code/models.html) 和当前账号为准，避免依赖容易过期的套餐对照表。

服务端明确返回「没有该模型访问权限」或档位限制时，插件会转换为可读的模型权限提示，避免误导为单纯密钥错误。其他 `401`、认证失败或网络错误需要单独排查；不能把所有 `401` 都解释为档位不足。

## 额度说明

设置页通过 Kimi Code `/coding/v1/usages` 读取用量，展示响应中实际存在的剩余比例、已用量、重置时间和加量包信息。输入框紧凑显示短窗口与周窗口，并按当前实现每 60 秒刷新。

`5h 82%　7d 64%` 仅是显示格式示例，不是你的余额，也不是所有账号都拥有这些窗口。没有可用读数时，到设置页刷新并查看错误；缺失数据不等于额度为零。实现见 [usage.js](../src/usage.js) 和 [client.jsx](../src/client.jsx)。

## 网页搜索与 Codex 共存

DSH 同一运行环境中只有一个生效的全局搜索提供方槽位；选择聊天模型本身不一定改变搜索来源。本插件注册 `kimi-subscription` 和 `kimi-subscription-auto` 两个搜索提供方，使用 Kimi Code `/coding/v1/search`。

| 设置 | 本插件的行为 |
| --- | --- |
| **不接管（默认）** | 保持 DSH 或其他插件已有的搜索安排；从接管状态切回时恢复由本插件管理的部分 |
| **按模型自动路由** | Kimi 模型使用 Kimi 搜索；可与 Codex 搜索组合；其他模型使用配置中的 DSH 默认搜索 |
| **始终使用 Kimi 搜索** | 没有其他插件管理搜索槽位时，让模型的搜索统一使用 Kimi；订阅未连接时请求会失败 |

搜索路由切换是明确的全局设置，不是模型请求失败后的自动付费回退。

**与 Codex 订阅插件同时使用：** 检测到 Codex 搜索管理器后，本插件不会争夺它的运行时槽位，而是在所属 profile 的 `cordis.patch.yml` 中维护一个有标记的 `web.searchProvider` 补丁块。推荐从「按模型自动路由」开始；Codex 插件仍参与最终路由，不能把「始终使用 Kimi」理解为必然覆盖另一插件的所有策略。共存行为也取决于安装的 Codex 插件版本。

在组合路由中，目标是 Kimi 模型走 Kimi 搜索、Codex 模型走相应的 Codex 搜索、其他模型走 DSH 默认搜索。DSH 会热加载这个 profile 补丁；切回「不接管」会移除本插件的标记块。它不会删除其他补丁条目。实现见 [index.js](../src/index.js)、[kimi-search.js](../src/kimi-search.js) 和 [search-composition.js](../src/search-composition.js)。

## 故障排查

**设置页不出现 / 仍是旧版本。** 先确认安装的是正在运行的 profile，然后完整重启 DSH、刷新浏览器。不要仅凭安装命令成功就判断当前进程已加载新代码。

**设备授权失败。** 按页面区分拒绝授权、设备码过期、网络失败等状态；过期时重新发起，网络失败时检查 DSH Host 的连接。不要把所有失败归为密钥无效。

**能登录、能读额度，但模型失败。** 额度读取与模型调用是不同请求。先看错误是否明确提示模型权限；尝试账号有权使用的模型。仍为认证失败时，再检查凭据来源与登录状态。

**没有额度徽章。** 确认选择的是 `Kimi subscription` 分组，然后到设置页手动刷新用量。记录脱敏后的错误，不要提交原始账号响应。

**搜索来源不符合预期。** 检查 Kimi 搜索选项、是否同时安装 Codex 插件，以及目标 profile 中本插件的标记块。不要删除整个 `cordis.patch.yml` 来恢复一个搜索设置。

## 更新与清理

**更新。** 首选桌面应用 **设置 → Kimi 订阅 → 更新插件**：它会在 `desktop` profile 目录中用 DSH 自带的 pnpm 安装精确版本，并读回 `package.json` 确认版本真的落地，因此不会把「命令退出码为 0」当成更新成功。本地 `link:` 开发安装不适用该按钮，应在对应 checkout 拉取代码、测试并重新构建。

`desktop` profile 由 Electron 应用独占，`dsh plugin --profile desktop …` 会被 CLI 直接拒绝（`profile "desktop" is managed exclusively by the Electron application`），所以桌面版不要走 CLI。若你所在版本较旧、按钮报错，可在终端手动执行（pnpm 需 ≥ 11）：

```sh
cd "$HOME/.dsh/profiles/desktop"    # Windows: cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm add --save-exact dsh-kimi-subscription@1.3.6
```

然后完全退出并重启桌面版。更新成功后该 profile 的 `package.json` 里依赖应变为目标版本，`dsh.profile.bundles` 条目保持不变。

**卸载。** 建议先将网页搜索切回「不接管」，再在桌面应用的**插件**页中对本插件执行**卸载**。

若插件已经卸载，只删除所属 profile 的 `cordis.patch.yml` 中以下两条标记及其之间的内容：

```text
# >>> dsh-kimi-subscription: web search provider
# <<< dsh-kimi-subscription: web search provider
```

默认位置是 `~/.dsh/profiles/<profile>/cordis.patch.yml`；设置了 `DSH_HOME` 时以该目录为准。编辑前保留备份，保留其他配置；如果没有其他 YAML 条目，应保留合法的空列表 `[]`。不要删除整个 profile，也不要顺手清理其他插件或凭据。

## 本地开发

```sh
git clone https://github.com/BaronCyrus/dsh-kimi-subscription.git
cd dsh-kimi-subscription
pnpm install --frozen-lockfile
pnpm run check
```

需要让桌面应用链接到 checkout 时，把本机插件的绝对路径交给插件页的**添加插件**（该输入框接受本地目录）；非桌面 profile 也可以用 CLI：

```sh
dsh plugin --profile <name> add /absolute/path/to/dsh-kimi-subscription
```

`pnpm run check` 执行测试、构建，并在 `.artifacts/` 中生成包。修改源码后至少重新测试、构建并手动重启 DSH；仅修改文档时运行 `pnpm run test` 与 `git diff --check`。构建通过不等于登录、GUI 或真实模型调用已经验证。

发布与 Agent 操作必须遵循 [AGENTS.md](../AGENTS.md)。提交文档不等于授权发布 npm 包或新版本。
