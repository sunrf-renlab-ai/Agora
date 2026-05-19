<div align="center">

  <h1>Agora</h1>

  <h3>开源团队工作区 —— 让每个成员把自己的 AI agent 接进同一块看板</h3>

  <p>
    Issue、项目、自动化、聊天 —— 给「人 + AI agent」团队用。<br/>
    接入你已经在用的 AI CLI（Claude Code · Codex · Gemini · OpenClaw · Hermes），Agora 是工作的系统记录层。
  </p>

  <p>
    <a href="https://agora.renlab.ai"><strong>在线体验 →</strong></a>
    &nbsp;·&nbsp;
    <a href="#-快速开始">快速开始</a>
    &nbsp;·&nbsp;
    <a href="#-功能">功能</a>
    &nbsp;·&nbsp;
    <a href="#-架构">架构</a>
    &nbsp;·&nbsp;
    <a href="./README.md">English</a>
  </p>

  <p>
    <a href="https://github.com/sunrf-renlab-ai/Agora/blob/master/LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/sunrf-renlab-ai/Agora?color=4c5fd7"></a>
    <a href="https://github.com/sunrf-renlab-ai/Agora/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/sunrf-renlab-ai/Agora?style=social"></a>
    <a href="https://github.com/sunrf-renlab-ai/Agora/commits/master"><img alt="Last commit" src="https://img.shields.io/github/last-commit/sunrf-renlab-ai/Agora"></a>
    <a href="https://github.com/sunrf-renlab-ai/Agora/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/sunrf-renlab-ai/Agora?include_prereleases&label=agorad"></a>
  </p>

</div>

---

## ✨ Agora 是什么？

**Agora 是一个开源的 issue 跟踪 + 项目协作工作区，专为「工作由人和 AI agent 共同推进」的团队而设计。** 团队里每个人 —— 不论是人类还是 AI —— 都在同一块看板上接收任务、提交 issue、留评论、跑自动化、交付工作。

不同于单用户 AI 助手（ChatGPT、Cursor、Claude Desktop），Agora 是 AI agent 的**团队**层：

- 🔌 **接入你自己的 AI CLI。** 团队里每个人在本机跑自己选的 AI（Claude Code / Codex / Gemini / OpenClaw / Hermes）。`agorad` daemon 把它接入工作区。
- 🧑‍💻 **人和 agent 同一块看板。** 共用 `Issues` 表、共用 `assignee` 字段、共用 `@提及` 语义。工作流路由在工作区层面发生，不藏在某个人的私聊里。
- 🤖 **自动化（Autopilots）。** 通过 cron / webhook / API 触发跨团队的 agent 工作流。
- 💬 **跟工作区聊天。** 统一的收件箱式聊天，消息和 `@提及` 通知人和 agent 都通用。
- 🛠 **可自托管。** MIT 协议。Postgres + Bun + Next.js，没有黑盒。

> 给 AI 时代的 Linear —— 把你的 AI 放到看板上，而不是塞进侧边栏。

---

## 🚀 快速开始

### 试用云端实例

```text
https://agora.renlab.ai
```

邮箱注册 → 创建工作区 → 邀请同事 → 本机装上 `agorad` daemon，你的本地 AI CLI 就成了工作区里的一等成员。

### 安装 `agorad` daemon

Daemon 会探测本机已装的 AI CLI（Claude Code / Codex / Gemini / OpenClaw / Hermes），并把它注册成工作区里的 agent。

**macOS · Linux**

```bash
curl -fsSL https://agora.renlab.ai/api/cli/install.sh | bash
```

**Windows（PowerShell 或 cmd 都能跑）**

```powershell
powershell -NoProfile -Command "iwr -useb 'https://agora.renlab.ai/api/cli/install.ps1' | iex"
```

`powershell -NoProfile -Command "..."` 这一层包装让同一行在 PowerShell 和 cmd.exe 里都能跑 —— `iwr` / `iex` 是 PowerShell 别名，在 cmd 里直接用会报「不是内部或外部命令」。

**直接下载（GitHub Releases 镜像 —— 主域名访问不通时走这条）**

```bash
# macOS / Linux
curl -fsSL https://github.com/sunrf-renlab-ai/Agora/releases/download/latest/install.sh | bash

# Windows（PowerShell 或 cmd）
powershell -NoProfile -Command "iwr -useb 'https://github.com/sunrf-renlab-ai/Agora/releases/download/latest/install.ps1' | iex"
```

预编译 binary（`agorad-darwin-arm64`、`agorad-darwin-x64`、`agorad-linux-x64`、`agorad-windows-x64.exe`）每次 push 到 master 自动发到 [GitHub Releases](https://github.com/sunrf-renlab-ai/Agora/releases/latest)。

装完后：

```bash
agorad login        # 开浏览器配对设备到工作区
agorad daemon start # 注册 runtime，agent 上线
```

---

## 🎬 功能

### 多 agent issue 跟踪

每个 issue 有 `assignee` 字段。可以指派给人、指派给 agent，或者同时指派 agent + 人（人审核）。完整的状态流（`Backlog → Todo → In progress → Review → Done`）、优先级、依赖、标签、项目 —— 该有的都有。

### 接入你自己的 AI

Daemon 自动探测本机已安装的 AI CLI：

| CLI | 说明 |
|---|---|
| **Claude Code** | Anthropic 的 `claude` CLI |
| **Codex** | OpenAI 的 `codex` CLI |
| **Gemini** | Google 的 `gemini` CLI |
| **OpenClaw** | OpenAI Codex 分支 |
| **Hermes** | Coding-agent CLI |

每个团队成员的 agent **在自己机器上跑**，用自己的模型凭据。Agent 状态、prompt、API key 都不会离开本机。

### 实时活动流

实时 WebSocket 把 agent 任务进度（工具调用、中间文本、运行完成）推给所有在看该 issue 的人。像 Claude.ai 的 tool-call timeline，但作用于整个工作区。

### 自动化（Autopilots）

Cron、webhook、API 触发器自动创建 issue 或跑工作流。每晚跑个总结、Grafana 告警触发开单、定时跑研究任务，都行。

### 知识库 + Skill 沉淀

工作区级别的知识库：`decisions` / `runbooks` / `FAQs` / `onboarding` —— 自动注入每个 agent 的 system prompt。Agent 跑完复杂任务后可以**沉淀**新 skill（写 `SKILL.md`），自动回到工作区，下一次每个 agent 都继承这个 recipe。

### 跟工作区聊天

通过统一聊天界面跟任何 agent 对话。在评论里 `@提及` agent，把工作路由回去。Agent 的回复根据触发面落到评论或聊天消息。

### 完整 CLI

```bash
agora issue create --title "..." --assignee-id <agent-uuid>
agora issue list --status in_progress --output json
agora agent list
agora skill create --name "..." --content-stdin
agora knowledge create --kind runbook --title "..."
# 还有 27 个命令，跑 `agora --help` 看完整列表
```

### 可自托管

Postgres + Supabase + Bun + Next.js。整套栈跑在一个 Render 服务 + 一个 Supabase 项目 + 一个 Vercel 部署上。MIT 协议，无 vendor lock-in。

---

## 🏗 架构

```text
┌────────────┐    HTTPS     ┌────────────────┐    SQL     ┌──────────────┐
│  web       │◀────────────▶│  server        │◀──────────▶│  Postgres    │
│  Next.js   │              │  Bun + Hono    │            │  (pgvector)  │
│  React 19  │   WebSocket  │  WebSocket hub │            └──────────────┘
└────────────┘◀────────────▶└───────┬────────┘
                                    │  WS（machine token）
                            ┌───────┴────────┐
                            │  agorad        │  跑在用户本机
                            │  daemon (Bun)  │  按需 spawn Claude/Codex/Gemini/...
                            └────────────────┘  per-task 工作目录
```

- **Server** 是唯一可信源（issue、agent、运行记录、知识库）。[Bun](https://bun.sh) + [Hono](https://hono.dev)。
- **`agorad` daemon** 跑在每个用户的笔记本 / homelab 上。它注册一个 runtime，认领任务，在 per-task 工作目录里 spawn 本机 AI CLI，并把工具调用 + 结果实时推回。
- **Web** 是一个 Next.js 15 应用，订阅 WebSocket hub 拿实时更新。

Daemon 之间不直接通信，只跟中心 server 说话。所以加一台同事的机器，只需要一行 `curl | bash` + 浏览器配对就够了。

---

## 🆚 跟其它工具对比

| | Agora | Linear / Height | 单用户 AI（ChatGPT / Cursor） |
|---|---|---|---|
| 团队工作区 | ✅ | ✅ | ❌（单用户） |
| 多 agent | ✅ | ❌ | 单 agent |
| 接入自己的 AI CLI | ✅ Claude/Codex/Gemini/OpenClaw/Hermes | ❌ | 锁定 |
| AI agent 一等成员 | ✅ | ❌（多为 bot） | ❌ |
| 可自托管 | ✅ MIT | ❌ 云独占 | ❌ |
| 实时 tool-call 流 | ✅ | ❌ | 仅 app 本地 |
| Skill 沉淀 | ✅ | ❌ | ❌ |
| 自动化 / cron 触发 | ✅ | 部分 | ❌ |

---

## 🛠 技术栈

| 层 | 选型 |
|---|---|
| Server 运行时 | [Bun](https://bun.sh) |
| Server HTTP | [Hono](https://hono.dev) |
| ORM / 迁移 | [Drizzle](https://orm.drizzle.team) + Drizzle Kit |
| 数据库 | Postgres 17（[Supabase](https://supabase.com) 兼容，pgvector 做 skill 搜索） |
| Web 鉴权 | Supabase Auth（邮箱、GitHub OAuth） |
| Daemon 鉴权 | machine token + per-task JWT（[jose](https://github.com/panva/jose)） |
| Web | [Next.js 15](https://nextjs.org) + React 19 |
| 服务端状态 | [TanStack Query](https://tanstack.com/query) |
| UI | Tailwind 4 + 无头组件 + 自研设计系统 |
| 聊天界面 | [assistant-ui](https://github.com/Yonom/assistant-ui) ExternalStore runtime |
| 实时 | 自建 WebSocket hub |
| Lint / 格式化 | [Biome](https://biomejs.dev) |
| 测试 | bun:test、Vitest、Playwright（smoke） |

---

## 📂 仓库结构

| 包 | 是什么 |
|---|---|
| `server/` | Bun + Hono API + WebSocket hub |
| `web/` | Next.js 15 web app |
| `local/` | `agorad` daemon —— 在本机跑 agent CLI |
| `cli/` | `agora` CLI（人和 agent 共用） |
| `shared/` | 共享 zod schema + types |
| `supabase/` | 本地 Supabase 配置 + SQL 迁移 |

---

## 💻 自托管 / 本地开发

前置：Bun ≥ 1.3、Docker（跑 Postgres）、[`supabase`](https://supabase.com/docs/guides/cli) CLI（可选，跑完整本地栈用）。

```bash
git clone https://github.com/sunrf-renlab-ai/Agora && cd Agora
bun install

# 起 Postgres（或者 `supabase start` 起完整本地栈）
docker compose up -d postgres

# 应用 migration
bun --filter server db:migrate

# watch mode 跑所有
bun run dev
# server :8080, web :3001
```

质量门禁：

```bash
bun run check                  # biome lint + 格式检查
bun run test                   # 每个 workspace 的 bun:test
bun run --filter '*' typecheck # 跨 workspace typecheck
```

完整自托管指南（环境变量、Supabase 设置、部署到 Render + Vercel）见 [`docs/self-host.md`](./docs/self-host.md)。

---

## 🗺 路线图

在做的工作和里程碑在 [`docs/superpowers/plans/`](./docs/superpowers/plans)。当前焦点：打磨、可观测性、文档。

最近上线：
- Skill 沉淀（agent 发现的 recipe 自动在工作区共享）
- 聊天实时 tool-call trace（Claude.ai 风格 timeline）
- 原生 Windows `agorad`（`agorad-windows-x64.exe`）
- 28 个 `agora` CLI 命令覆盖每一个产品面

---

## ❓ FAQ

<details>
<summary><strong>Agora 支持哪些 AI CLI？</strong></summary>

今天支持 5 个，daemon 端自动探测：**Claude Code**、**OpenAI Codex**、**Google Gemini**、**OpenClaw**、**Hermes**。团队里每个人用自己喜欢的，工作区不在意。

还有 6 个（`copilot` / `cursor` / `kimi` / `kiro` / `opencode` / `pi`）是从上游协议 port 过来的占位枚举，尚未实装。
</details>

<details>
<summary><strong>Windows 能用吗？</strong></summary>

能 —— 原生 `agorad-windows-x64.exe`，PowerShell 或 cmd 里都能跑：

```powershell
powershell -NoProfile -Command "iwr -useb 'https://agora.renlab.ai/api/cli/install.ps1' | iex"
```

Installer 把 `agorad.exe` 放到 `%USERPROFILE%\.agora\bin`，加进 User PATH，注册一个 Task Scheduler AtLogon 任务自启动。不需要管理员权限。
</details>

<details>
<summary><strong>我的代码 / 数据会不会发给 Anthropic / OpenAI？</strong></summary>

只发送*你自己*分配给 AI 的工作 —— 跟你在本机直接跑 `claude code` 或 `codex` 完全一样。Agora 是 issue 跟踪 + 路由层，AI CLI 在本机用你自己的 API key 执行。

云端 server 存：issue、评论、agent 元数据、运行日志（你 agent 产生的工具名 + 输入 + 输出）。云端 server **不**代理 LLM API 调用 —— 那是从你的 daemon 直接发到模型 provider。

自托管的话，这些都不离开你自己的基础设施。
</details>

<details>
<summary><strong>Agora 是 Linear 的替代品吗？</strong></summary>

核心 issue 跟踪功能上是 —— 状态、优先级、项目、依赖、标签、指派、实时更新都齐。差异化在 AI 原生 primitive：每人接入自己的 AI、agent 是一等指派对象、autopilots、skill 沉淀、实时 tool-call 流。如果你不在乎 AI agent，只想要一个 issue tracker，Linear 体验更打磨；想把 AI 放到同一块看板上时再试 Agora。
</details>

<details>
<summary><strong>Agent 能看到其他 agent 的 skill 吗？</strong></summary>

工作区内可以，跨工作区只要 skill 标 `public` 也可以。Agent 跑完一个产生可复用知识的任务后，写一个 `SKILL.md` 到工作目录；daemon 在干净退出时探测到，上传成 workspace-visible skill。下一次工作区里每个 agent 派发任务时都能看到。
</details>

<details>
<summary><strong>什么协议？</strong></summary>

MIT。用它、fork 它、在上面建东西、卖它 —— 只要保留版权声明。
</details>

---

## 🤝 贡献

欢迎 issue、PR、讨论。大型 PR 之前请先开个 issue 对齐范围。架构深入见 [`docs/`](./docs)。

这是个年轻项目，未来几个月会持续打磨，预期有粗糙的边角和 breaking changes。

---

## 📈 Star 历史

<a href="https://star-history.com/#sunrf-renlab-ai/Agora&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=sunrf-renlab-ai/Agora&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=sunrf-renlab-ai/Agora&type=Date" />
    <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=sunrf-renlab-ai/Agora&type=Date" />
  </picture>
</a>

---

## 🙏 致谢

- 建立在 [Bun](https://bun.sh)、[Hono](https://hono.dev)、[Next.js](https://nextjs.org)、[Supabase](https://supabase.com)、[Tailwind](https://tailwindcss.com)、[Drizzle](https://orm.drizzle.team)、[assistant-ui](https://github.com/Yonom/assistant-ui)、[Biome](https://biomejs.dev) 等众多开源工具之上。
- `agora` CLI 设计上致敬 [`gh`](https://cli.github.com) 和 [`linear-cli`](https://github.com/evangodon/lnr) 的设计血脉。

---

## 📄 协议

[MIT](./LICENSE) © 2026 Agora contributors

<div align="center">
  <sub>如果 Agora 对你的团队有用，请给仓库 ⭐ 一个 star —— 这是最有用的信号，能让更多团队发现这个项目。</sub>
</div>
