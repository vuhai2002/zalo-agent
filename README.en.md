<p align="center"><strong>zalo-agent</strong></p>

<p align="center">
A self-hosted AI agent that lives inside <strong>Zalo</strong> on a personal account.<br/>
Multi-account in one process, a separate "brain" per account, 13 tools, full web dashboard.<br/>
Provider-agnostic: any OpenAI-compatible endpoint or Anthropic.
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#what-the-bot-can-do">Features</a> •
  <a href="#dashboard">Dashboard</a> •
  <a href="#safety---read-this-first">Safety</a> •
  <a href="README.md">Tiếng Việt</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="MIT" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node-22.13+-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node" />
  <img src="https://img.shields.io/badge/SQLite-node:sqlite-003B57?style=flat-square&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/AI_SDK-Vercel-000000?style=flat-square&logo=vercel&logoColor=white" alt="Vercel AI SDK" />
  <img src="https://img.shields.io/badge/tests-1556%20passing-brightgreen?style=flat-square" alt="tests" />
</p>

---

> Documentation is primarily written in Vietnamese, matching the target audience of a Zalo bot.
> This page is a complete English summary; [`README.md`](README.md) is the canonical version.

One turn: **incoming Zalo message -> filter (allowlist, @mention) -> batch per thread -> agent loop
(LLM calls tools) -> sanitize + translate formatting -> split by byte budget -> send**.

No step ever executes model-generated code. Content fetched from the web is always wrapped in a
marker that tells the model it is *data*, never an instruction.

## What the bot can do

13 tools, each toggleable per account from the dashboard.

| Tool | Purpose |
|---|---|
| `web_search` | Web search over a provider chain (Brave -> DuckDuckGo). DuckDuckGo needs no API key |
| `web_fetch` | Read one public URL. Blocks private IPs and cloud metadata endpoints (SSRF defense) |
| `read_image` | Re-examine an image with a specific question: count items, read fine print |
| `create_image` | Generate an image, or **edit an image the user just sent** - the rest stays pixel-identical |
| `create_word_document` | Compose a .docx (headings, paragraphs, tables, two-column layout) and send it in chat |
| `create_excel_file` | Compose a multi-sheet .xlsx with **formulas plus cached results**, so mobile preview shows numbers |
| `send_file` | Send from a local shared folder or download from a public URL |
| `schedule_task` | Create/list/edit/cancel schedules so the bot messages this thread later |
| `save_memory` | Durable facts about the user that survive across sessions |
| `get_datetime` | Accurate date and time in the configured timezone |
| `tag_member` | @mention the right person in a group |
| `get_group_info` | Group name, member count, member list |
| `add_reaction` | React to a message |

### Real rich text, not plain walls

Model markdown is **translated** into Zalo's native `textProperties`, not stripped:

- **Bold**, *italic*, ~~strikethrough~~, underline, large headings
- **Four text colors** (red, orange, yellow, green) for invitations and formal announcements
- Leading emoji chosen to match each line's meaning

All of it was **measured on real devices, on both Zalo Web and Zalo mobile** - the two clients
render some styles differently, and those styles were removed from the design. Zalo also rejects a
whole message when text plus formatting exceeds a byte threshold, so the sender shrinks the
per-message character cap to fit the budget before splitting.

### Scheduling (the bot messages you)

Three kinds: `once`, `every`, `cron`. Created from chat in plain language, or from the dashboard.

- `message` jobs send verbatim - **zero tokens**
- `agent` jobs run an isolated AI turn (research, then report)
- Two anti-spam layers: reject overly frequent schedules at creation, and a daily cap on proactive messages
- A late job still **sends**, labelled "(late reminder, originally HH:MM)", instead of silently swallowing it

### Memory

- Conversation history in SQLite, per account and thread
- **Rolling summary** so context that falls out of the replay window is not lost
- **Durable facts** via `save_memory`, with asymmetric privacy rules between direct chats and groups
- Received images are stored, described by a secondary vision model, and cached so later turns cost nothing

## Dashboard

Hono + React + Tailwind, served by the bot process itself at `http://127.0.0.1:3900`.

| Page | Purpose |
|---|---|
| Overview | Daily input/output tokens across all accounts |
| Accounts | Add Zalo accounts, **scan the QR login right in the browser**, enable/disable each |
| Agents | One brain per account: its own persona, model, and tool set |
| Sessions | Replay any conversation, read the bot's own rolling summary, mute per thread, **wipe a conversation's context** |
| Contacts | People the bot has met |
| Memory | Inspect, edit, delete anything the bot remembers |
| Schedule | All jobs, dry-run now, per-run history |
| Tools | Toggle the 13 tools per account; configure image generation and the vision sidecar |
| Tuning | **54 runtime parameters**, applied live with no restart |
| Trace | Step-by-step replay of an agent turn: reasoning, tool calls, arguments |
| Logs | System log viewer |

Configuration precedence everywhere: **dashboard (DB) > `.env` > schema default**. Missing LLM
config never blocks boot - you must be able to reach the dashboard in order to enter it.

## Engineering you cannot see in a screenshot

**Survives real-world failure modes**

- Every LLM call is **streamed**. The router sits behind Cloudflare, which kills a request with 524
  when the origin has not sent a first byte within 100 seconds. Measured on the real router with a
  4000-word generation: non-streaming died at 125s, streaming finished at 135s with the first byte
  at 7.5s
- **Per-thread batching**: three messages typed in bursts produce one answer, not three turns that
  each redo the work
- **Mid-turn injection**: a message sent while the bot is working is pulled in at the next step
  boundary rather than waiting for the next turn
- If Zalo rejects a formatted message, it is **resent as plain text** - formatting is lost, content is not
- Three-layer tool-loop guards, per-turn timeout, output token ceiling

**Serious prompt-injection defense** (the bot reads messages from strangers)

- Web content is wrapped in an explicit `<noi_dung_ngoai>` tag; the persona states it is data, not commands
- `web_fetch` and `send_file` block loopback, private ranges, and cloud metadata endpoints
- **No money-transfer or payment tool exists** - deliberately omitted even though the library offers one
- Document tools accept **data only** (titles, paragraphs, tables); model-generated code is never executed
- Replies that leak the system prompt are blocked before reaching Zalo
- Every regex touching untrusted content is linear (ReDoS-safe)

**Local security**

- Zalo cookies encrypted with **AES-256-GCM**, key held outside the database
- Dashboard password hashed with scrypt, login rate-limited
- All data stays on your machine in SQLite under `data/`; nothing leaves except calls to the LLM provider you configured

## Install

```bash
corepack enable
pnpm install
cp .env.example .env
```

Only **two variables are required**:

| Variable | How to get it |
|---|---|
| `CREDENTIALS_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `DASHBOARD_PASSWORD` | your choice, at least 8 characters |

Everything else is entered in the dashboard: LLM provider, model and API key first, then the Zalo
account plus QR login.

## Run

```bash
pnpm dev                    # bot (watch mode) + dashboard
pnpm build:web              # build the UI; the bot serves it at http://127.0.0.1:3900
pnpm zalo-login acc-main    # QR login from the CLI (the web flow is easier)
pnpm test                   # 1556 tests
pnpm typecheck
pnpm eval                   # 17 cases against a REAL model; no message ever reaches real Zalo
```

## LLM providers

Swappable via `LLM_PROVIDER`, changeable at runtime from the dashboard:

- `openai-compatible` - any OpenAI-shaped endpoint (proxy routers, OpenRouter, LM Studio, Ollama, ...)
- `anthropic` - direct to Anthropic's own API
- `google` - direct to Google's own API (Gemini). Required over their
  OpenAI-compatible shim, which drops `thought_signature` and breaks every turn
  that calls a tool

Image generation and the vision sidecar are configured separately, also OpenAI-compatible.

## Safety - read this first

> [!WARNING]
> `zca-js` is an **unofficial** API. Zalo can ban the account.
> **Use a secondary account only.** Never your primary or a valuable one.

- `data/` holds encrypted Zalo cookies and your whole history - **never commit or share it**
- One listener per account: opening Zalo Web in a browser kicks the bot's listener (it reconnects and kicks back)
- Mass messaging and CRM campaigns are **deliberately out of scope**
- Behind Caddy/Nginx, set `DASHBOARD_BEHIND_PROXY=true` (correct client IP for rate limiting, `Secure` cookies)

## Testing

| | |
|---|---|
| Unit + integration tests | **1556**, on `node:test`, no external framework |
| Eval cases against a real model | **17** - measuring what tests cannot: does it research instead of guessing, ask when information is missing, format readably |
| Source | ~31,700 lines excluding tests, across 273 files |

Evals can inspect **the actual formatting sent to Zalo**, not just plain text, so presentation bugs
are caught by machine rather than by the user noticing.

Working discipline: **break the code and confirm the test goes red** before calling a fix done. A
green test proves nothing if it is also green when the logic is wrong.

## Layout

```
src/
├── config/        env (Zod), account store, agent store, 54 live-tunable parameters
├── zalo/          QR login, encrypted credentials, listener + reconnect, message parsing,
│                  sanitizer, markdown -> Zalo styles, byte-budget message splitting
├── agent/         agent loop (AI SDK), providers, persona, tools/ (13 tools)
├── scheduler/     schedules: tick, job claiming, proactive-send caps, run history
├── conversation/  SQLite: history, threads, contacts, usage, memory, images, summarizer
├── middleware/    allowlist + @mention, per-thread batching, send rate limiting
├── documents/     .docx / .xlsx generation
├── images/        image generation, vision sidecar
└── server/        dashboard API (Hono)
web/               dashboard UI (React + Vite + Tailwind)
evals/             eval suite against a real model
docs/              architecture, roadmap, release guide
```

## Documentation

- [System architecture](docs/system-architecture.md)
- [Roadmap](docs/project-roadmap.md) - the full history: bugs hit, how they were measured,
  decisions locked in, and the limitations that remain. The thickest and most honest document here
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests welcome. Before opening a PR, `pnpm typecheck` and `pnpm test` must pass.

## License

[MIT](LICENSE)

Built on [zca-js](https://github.com/RFS-ADRENO/zca-js) (MIT) and
[Vercel AI SDK](https://github.com/vercel/ai) (Apache-2.0).

---

<sub>Keywords: Zalo bot, Zalo AI agent, Zalo chatbot, zca-js, LLM agent, tool calling, function
calling, Vercel AI SDK, OpenAI-compatible, Anthropic, self-hosted AI assistant, multi-account,
SQLite, TypeScript, Hono, React, prompt injection defense, cron scheduler, rich text messaging,
Vietnamese personal assistant.</sub>
