<div align="center">

# DSH Kimi Subscription

**在 DeepSeek Harness 中直接使用 Kimi Code 会员订阅**

无需 Kimi Open Platform 按量计费密钥；订阅模型、登录与额度都留在 DSH 内。

[![CI](https://github.com/BaronCyrus/dsh-kimi-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/BaronCyrus/dsh-kimi-subscription/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-kimi-subscription?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-kimi-subscription)
[![Release](https://img.shields.io/github/v/release/BaronCyrus/dsh-kimi-subscription?logo=github)](https://github.com/BaronCyrus/dsh-kimi-subscription/releases/latest)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Star](https://img.shields.io/github/stars/BaronCyrus/dsh-kimi-subscription?style=flat&logo=github&label=Star)](https://github.com/BaronCyrus/dsh-kimi-subscription/stargazers)

[快速开始](#快速开始) · [功能](#功能) · [本地开发](#本地开发) · [安全边界](#安全边界)

<img width="803" height="553" alt="截屏2026-08-28 12 23 06" src="https://github.com/user-attachments/assets/39f2125a-998c-412c-a02f-f256ea1c651b" />

</div>

## 快速开始

当前版本兼容 DeepSeek Harness `0.1.1-rc.2`。通过 npm 安装到目标 profile：

```sh
dsh plugin --profile web add dsh-kimi-subscription
dsh plugin --profile web list dsh-kimi-subscription --depth 0
```

也可以从 [GitHub Releases](https://github.com/BaronCyrus/dsh-kimi-subscription/releases/latest) 下载对应版本的 `.tgz` 后安装：

```sh
dsh plugin --profile web add ./dsh-kimi-subscription-1.0.1.tgz
```

手动重启 DSH 后：

1. 打开 **设置 → Kimi 订阅**；
2. 推荐粘贴 Kimi Code 控制台生成的订阅 API Key，或使用 Kimi 账号设备登录；
3. 在模型选择器中选择 **Kimi subscription** 分组的模型；
4. 设置页会显示完整额度，输入框右侧会显示 `5h 82%　7d 64%`。

<img width="796" height="139" alt="截屏2026-08-28 12 24 56" src="https://github.com/user-attachments/assets/90e68f0b-974b-4f19-a17d-5735773c3f98" />

> 登录时请使用 Kimi Code 会员订阅 API Key 或设备登录；Kimi Open Platform 的按量计费 API Key 不适用于本插件。

## 功能

| 能力 | 说明 |
| --- | --- |
| **订阅模型** | 独立注册 `kimi-subscription` 路由，不覆盖现有 `kimi-coding` 或 Open Platform 配置 |
| **两种登录方式** | Kimi Code 订阅 API Key（推荐）与 Kimi OAuth 设备代码登录 |
| **安全凭据** | OAuth 自动刷新，API Key、access token、refresh token 仅保存在 DSH Host 凭据服务中 |
| **完整额度** | 读取 Kimi Code 官方 `/coding/v1/usages`，显示已用量、剩余比例、重置时间与加量包余额 |
| **输入框额度** | 选择 Kimi 模型时紧凑显示 `5h 82%　7d 64%`，每 60 秒刷新 |
| **版本检查** | 设置页显示当前与最新插件版本；npm 安装出现新版本时可一键更新，并提示重启 DSH 或刷新界面 |
| **无付费回退** | 不会静默切换到 Kimi Open Platform 或其他付费提供方 |

当前模型目录来自 `@earendil-works/pi-ai` `0.82.1`：

- `k3`
- `k3-256k`
- `kimi-for-coding`
- `kimi-for-coding-highspeed`

## Kimi Code 与 Open Platform

本插件连接 `https://api.kimi.com/coding`，使用 **Kimi Code 会员额度**。它不同于 `api.moonshot.ai` / `api.moonshot.cn` 的按量计费开放平台，账号额度、密钥与模型 ID 不能混用。

根据 [Kimi Code Community Guidelines](https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html)，会员订阅仅适用于交互式使用。批处理、转售或重新包装服务应使用 Kimi Open Platform。

## 本地开发

```sh
git clone https://github.com/BaronCyrus/dsh-kimi-subscription.git
cd dsh-kimi-subscription
pnpm install
pnpm run check
```

迭代时可让 DSH profile 直接链接本地仓库：

```sh
dsh plugin --profile web add /absolute/path/to/dsh-kimi-subscription
```

修改后运行 `pnpm run test` 和 `pnpm run build`，再手动重启 DSH。发布包由 `pnpm run check` 生成到 `.artifacts/`。使用 Agent 迭代或发布时请遵循 [AGENTS.md](AGENTS.md)。

## 更新与卸载

设置 → Kimi 订阅页面会显示当前版本与 npm 最新版本；出现新版本时可直接点击「更新插件」，更新完成后按提示重启 DSH 服务（或先刷新界面）。

也可以在终端更新到 npm 最新版：

```sh
dsh plugin --profile web add dsh-kimi-subscription@latest
```

也可以安装指定的 GitHub Release：

```sh
dsh plugin --profile web add ./dsh-kimi-subscription-<version>.tgz
```

卸载：

```sh
dsh plugin --profile web remove dsh-kimi-subscription
```

安装、更新或卸载后均需手动重启目标 DSH；插件不会自行重启正在运行的会话。

## 安全边界

- RPC 仅允许 loopback 浏览器调用；浏览器只接收裁剪后的登录状态和额度 JSON。
- OAuth 登录 URL 仅允许 Kimi 官方 HTTPS origin。
- 额度请求在 Host 发出，带超时、拒绝重定向且不会向浏览器返回凭据或原始响应。
- 版本检查仅请求 npm registry 的公开元数据（带超时、拒绝重定向）；一键更新在 Host 调用 `dsh plugin` CLI，进程输出不会返回浏览器。
- 本项目不会读取、记录或上传会话提示词与模型回复。
- 安全问题请通过 [GitHub Private Vulnerability Reporting](https://github.com/BaronCyrus/dsh-kimi-subscription/security/advisories/new) 私下报告，不要在公开 Issue 中粘贴凭据。

更多信息见 [SECURITY.md](SECURITY.md)。

## 技术依据与致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [Kimi Code 模型文档](https://www.kimi.com/code/docs/en/kimi-code/models.html)
- [Kimi Code 会员说明](https://www.kimi.com/code/docs/en/kimi-code/membership.html)
- [Kimi Code 第三方工具接入](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html)
- [MoonshotAI/kimi-code](https://github.com/MoonshotAI/kimi-code)
- [dsh-codex-subscription](https://github.com/WSL043/dsh-codex-subscription)

第三方许可与实现参考见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

[MIT](LICENSE)
