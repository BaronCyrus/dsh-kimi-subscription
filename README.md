<div align="center">

<img src="docs/assets/dsh-kimi-mascot.png" width="220" height="220" alt="DSH Kimi Subscription 吉祥物：月牙工程师">

# DSH Kimi Subscription

**简体中文** · [English](README.en.md)

**用 Kimi Code 订阅，在 DSH 里写代码、查资料、看额度。**

通过订阅 API Key 或设备登录连接 Kimi Code。
模型选择、网页搜索和额度查询集成在 DeepSeek Harness，无需另配 Open Platform 按量计费密钥。

[![CI](https://github.com/BaronCyrus/dsh-kimi-subscription/actions/workflows/ci.yml/badge.svg)](https://github.com/BaronCyrus/dsh-kimi-subscription/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-kimi-subscription?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-kimi-subscription)
[![npm 总下载量](https://img.shields.io/npm/dt/dsh-kimi-subscription?logo=npm&label=%E6%80%BB%E4%B8%8B%E8%BD%BD%E9%87%8F)](https://www.npmjs.com/package/dsh-kimi-subscription)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)
[![Star](https://img.shields.io/github/stars/BaronCyrus/dsh-kimi-subscription?style=flat&logo=github&label=Star)](https://github.com/BaronCyrus/dsh-kimi-subscription/stargazers)

[功能](#功能) · [安装](#安装) · [日常使用](#日常使用) · [界面预览](#界面预览) · [使用指南](#使用指南) · [更新与卸载](#更新与卸载)

</div>

## 功能

| 能力 | 使用体验 |
| --- | --- |
| **独立订阅模型** | 在 `Kimi subscription` 分组中选模型，不覆盖已有的 `kimi-coding` 或 Open Platform 配置 |
| **两种连接方式** | 使用 Kimi Code 订阅 API Key，或在设置页发起设备登录；OAuth 支持自动刷新 |
| **订阅网页搜索** | 默认保持原有搜索设置，可选择按模型自动路由或使用 Kimi 搜索 |
| **额度一眼可见** | 设置页查看用量、重置时间与服务端返回的加量包余额；输入框显示紧凑余量 |
| **设置内检查更新** | 查看当前与最新版本；支持的 npm 安装可直接更新，本地开发安装另行提示 |
| **清晰的凭据边界** | 凭据由 DSH Host 管理，不通过浏览器 RPC 返回；订阅失败不会偷偷切换到其他付费模型路由 |

<a id="快速开始"></a>

## 安装

先准备好 **DeepSeek Harness** 和可用的 **Kimi Code 订阅**。尚未安装 DSH，可查看 [DSH 官方说明](https://github.com/deepseek-ai/deepseek-harness#run)。兼容范围与验证记录见 [使用指南](docs/guide.zh-CN.md#安装与兼容性)。

### 1. 安装插件

在终端运行：

```sh
dsh plugin --profile web add dsh-kimi-subscription@latest
```

完成后，**手动重启正在运行的目标 DSH**。仅刷新浏览器不会重新加载 Host 中的插件。

### 2. 连接订阅

打开 **设置 → Kimi 订阅**，使用 Kimi Code 控制台生成的**订阅 API Key**，或按页面提示完成**设备登录**。

> 订阅 API Key 与 Kimi Open Platform 的按量计费密钥不是同一种凭据。请勿混用，也不要把密钥、设备码或登录回调粘贴到公开 Issue 中。

### 3. 选择模型

在模型选择器中选择 **Kimi subscription** 分组下、你的订阅有权使用的模型，即可开始对话或编程。能在列表中看到模型，不代表账号一定具备调用权限。

<details>
<summary>检查安装 / 使用 npx / 安装指定版本</summary>

检查当前 profile 中的安装：

```sh
dsh plugin --profile web list dsh-kimi-subscription --depth 0
```

只有通过 `npx` 运行 DSH、没有全局 `dsh` 命令时，需要保留完整的启动前缀。以下使用仓库已有兼容记录的 DSH 版本作为示例：

```sh
npx -y @deepseek-ai/dsh@0.1.7-rc.2 plugin --profile web add dsh-kimi-subscription@latest
```

固定版本安装、Release 包安装和桌面应用的区别见 [安装与兼容性](docs/guide.zh-CN.md#安装与兼容性)。不要通过 CLI 修改由桌面应用管理的 `desktop` profile。

</details>

## 日常使用

**选模型。** 在 `Kimi subscription` 分组中切换模型；遇到档位提示时，选择当前账号有权限的模型。模型说明与常见认证问题见 [模型与订阅权限](docs/guide.zh-CN.md#模型与订阅权限)。

**看额度。** 输入框可紧凑显示 `5h 82%　7d 64%`，这里的数字仅为格式示例。完整用量、剩余比例、重置时间及加量包信息在设置页查看，以账号实际返回的数据为准。

**用搜索。** 打开 **设置 → Kimi 订阅 → 网页搜索**。默认「不接管」原有搜索；需要时再启用「按模型自动路由」或「始终使用 Kimi 搜索」。同时安装 Codex 订阅插件时，先看 [搜索共存说明](docs/guide.zh-CN.md#网页搜索与-codex-共存)。

## 界面预览

<p align="center">
  <img src="https://github.com/user-attachments/assets/b6d485b9-bbf4-49fe-972b-6b6bff4a0812" width="720" alt="DSH 中的 Kimi 订阅设置界面">
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/90e68f0b-974b-4f19-a17d-5735773c3f98" width="800" alt="DSH 输入框中的 Kimi 订阅余量显示">
</p>

截图用于展示界面位置；模型、额度和按钮以所安装的版本与当前账号为准。

## 使用指南

[完整使用指南](docs/guide.zh-CN.md) 包含安装与兼容性、模型权限、额度说明、搜索路由、故障排查和卸载清理。

常用入口：[登录与凭据](docs/guide.zh-CN.md#登录与凭据) · [网页搜索与 Codex 共存](docs/guide.zh-CN.md#网页搜索与-codex-共存) · [故障排查](docs/guide.zh-CN.md#故障排查) · [更新记录](CHANGELOG.md)。

## 更新与卸载

**更新 npm 安装：** 可在设置页检查更新，也可以运行：

```sh
dsh plugin --profile web add dsh-kimi-subscription@latest
```

本地 `link:` 开发安装应在对应仓库拉取代码、测试并重新构建，不要用上述命令替换开发链接。

**卸载：** 若启用过 Kimi 搜索，先在设置页切回「不接管」，再运行：

```sh
dsh plugin --profile web remove dsh-kimi-subscription
```

安装、更新或卸载后，均请手动重启目标 DSH。已经卸载、但还残留搜索补丁时，只清理本插件的标记块，具体见 [更新与清理](docs/guide.zh-CN.md#更新与清理)；不要删除整个 profile。

## 常见问题

**登录正常，但某个模型不可用？** 模型目录不按订阅档位过滤。明确的模型权限拒绝与失效凭据应分开排查，详见 [故障排查](docs/guide.zh-CN.md#故障排查)。

**额度没有显示？** 先确认选择的是 Kimi 订阅模型，再到设置页刷新余量；没有返回可用数据时，不应把缺失显示理解为额度为零。

**更新后还是旧界面？** 完整重启 DSH 后再刷新页面。仅刷新前端不会重载 Host 适配器。

## 安全边界

本项目是社区插件，与 DeepSeek、Moonshot AI 无隶属或背书关系。项目面向本人交互式使用；订阅适用范围请参阅 [Kimi Code Community Guidelines](https://www.kimi.com/code/docs/en/kimi-code/community-guidelines.html)。

凭据保存在 Host 侧，浏览器仅接收必要的状态与用量信息。模型请求会发送到相应的 Kimi 服务，不应将「凭据不返回浏览器」理解为离线推理。更多说明见 [SECURITY.md](SECURITY.md)。

普通问题请提交 [Issue](https://github.com/BaronCyrus/dsh-kimi-subscription/issues)；安全问题请通过 [私密漏洞报告](https://github.com/BaronCyrus/dsh-kimi-subscription/security/advisories/new) 提交，不要公开凭据或原始账号响应。

## 本地开发

```sh
git clone https://github.com/BaronCyrus/dsh-kimi-subscription.git
cd dsh-kimi-subscription
pnpm install --frozen-lockfile
pnpm run check
```

本地链接、构建与验证步骤见 [开发说明](docs/guide.zh-CN.md#本地开发)。使用 Agent 修改或发布项目时，请先阅读 [AGENTS.md](AGENTS.md)；不要手动编辑生成的 `lib/`。

## 技术依据与致谢

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [Kimi Code](https://github.com/MoonshotAI/kimi-code) · [Kimi Code 模型文档](https://www.kimi.com/code/docs/en/kimi-code/models.html) · [会员说明](https://www.kimi.com/code/docs/en/kimi-code/membership.html) · [第三方工具接入](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html) · [DSH Codex Subscription](https://github.com/WSL043/dsh-codex-subscription)

第三方实现参考与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

[MIT](LICENSE)
