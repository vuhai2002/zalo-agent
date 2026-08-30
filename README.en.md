<p align="center">
  <img src="web/public/zalo-agent-logo.webp" alt="Zalo Agent" width="240" />
</p>

<p align="center">
A self-hosted AI agent that lives inside <strong>Zalo</strong>. Runs on <strong>two channel types</strong>:<br/>
a <strong>personal</strong> Zalo account (via zca-js) and an <strong>official Zalo Bot</strong> account (via the Zalo Bot API).<br/>
Multi-account in one process, a separate "brain" per account, 15 tools, full web dashboard.<br/>
Provider-agnostic: any OpenAI-compatible endpoint, Anthropic, or Google.
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#two-channel-types">Channels</a> •
  <a href="#what-the-agent-can-do">Features</a> •
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
  <img src="https://img.shields.io/badge/tests-2267%20passing-brightgreen?style=flat-square" alt="tests" />
</p>

---

> Documentation is primarily written in Vietnamese, matching the target audience.
> This page is a complete English summary; [`README.md`](README.md) is the canonical version.

One turn: **incoming Zalo message -> filter (allowlist, @mention) -> batch per thread -> agent loop
(LLM calls tools) -> sanitize + translate formatting -> split by byte budget -> send**.

No step ever executes model-generated code. Content fetched from the web is always wrapped in a
marker that tells the model it is *data*, never an instruction.

## Two channel types

One process runs both account types at once, mixed freely. The type is chosen **when the account is
created** in the dashboard and cannot be changed afterwards.

| | Personal account | Official Zalo Bot account |
|---|---|---|
| Library / API | [`zca-js`](https://github.com/RFS-ADRENO/zca-js) (**unofficial**) | **Zalo Bot API** - `bot-api.zaloplatforms.com` (official) |
| Sign-in | scan the QR right in the dashboard | paste a **Bot Token** into the dashboard |
| Receiving | WebSocket listener + auto reconnect | long polling `getUpdates` |
| Ban risk | **yes** - use a throwaway account | **no** |
| Who can message it | friends only | anyone with the link |
| Tools available | all **15** | **7 of 15** (see table below) |
| Text formatting | native Zalo styles (`textProperties`) | plain text |
| Per-message cap | configurable (default 2000 chars) | 2000 chars, enforced server-side |
| Files / images / reactions / @mention | yes | **no such method on the API** |
| Scheduling | yes | yes |
| Allowlist default | open | **closed** (`mode: "list"`) |

> [!IMPORTANT]
> **The Zalo Bot API is NOT the Zalo OA API.** These two products are confused everywhere,
> including in third-party documentation. The "you may only message within 7 days of the last
> interaction" policy and the per-message pricing belong to the **OA API** (`openapi.zalo.me`) and
> do **not** apply to the Bot API this project uses.

### Creating a Zalo Bot account

1. Open Zalo and find the Official Account **"Zalo Bot Manager"**.
2. Choose **"Tạo bot"** (opens the Zalo Bot Creator mini app). The bot name **must start with "Bot"**.
3. The token is delivered to you as a Zalo message.
4. Dashboard > **Accounts** > add an account > channel type = **official bot** > paste the token.

The server **validates the token with Zalo before saving** (it calls `getMe`) - an invalid token
saves nothing, so you never end up with an account that looks configured but silently never runs.
After saving, the account restarts immediately.

### Why 8 tools cannot run on the Bot channel

Not a conservative choice - **measured against the live API**: of 17 probed methods, 13 return
`{"ok":false,"description":"Not Found","error_code":404}`. There is no
`sendDocument` / `sendFile` / `sendVideo` / `sendAudio` / `editMessageText` / `deleteMessage` /
`setMessageReaction` / `forwardMessage` / `getChat` / `getChatMember`.

Those tools are **removed from the schema** sent to the model (it never learns they exist, spends no
tokens on their descriptions, and cannot be tricked into calling them by prompt injection) **and**
the persona gains a rule stating this is a platform limit rather than a malfunction - so when asked,
the agent says plainly that a bot account cannot send that, and suggests the personal account.
Hiding a tool without explaining why just makes the user think the agent is broken.

> This list used to hold **8** tools, including `schedule_task`. It was the only entry with no
> 404 behind it: the Bot API sends proactive messages just fine (measured: 10 messages in
> 416ms), the scheduler was simply hard-wired to `zca-js`, so a bot account had no send path.
> Wired up in V3.19.

## What the agent can do

15 tools, each toggleable per account from the dashboard.

| Tool | Purpose | Bot channel |
|---|---|---|
| `web_search` | Web search over a provider chain (Brave -> DuckDuckGo). DuckDuckGo needs no API key | yes |
| `web_fetch` | Read one public URL. Blocks private IPs and cloud metadata endpoints (SSRF defense) | yes |
| `kb_search` | Search documents the agent owner uploaded (policies, price lists, guides) - FTS5 + bm25, merged with RRF | yes |
| `save_memory` | Durable facts about the user that survive across sessions | yes |
| `get_datetime` | Accurate date and time in the configured timezone | yes |
| `read_image` | Re-examine an image with a specific question: count items, read fine print | yes |
| `create_image` | Generate an image, or **edit an image the user just sent** - the rest stays pixel-identical | no |
| `create_word_document` | Compose a .docx (headings, paragraphs, tables, two-column layout) and send it in chat | no |
| `create_excel_file` | Compose a multi-sheet .xlsx with **formulas plus cached results**, so mobile preview shows numbers | no |
| `send_file` | Send from a local shared folder or download from a public URL | no |
| `schedule_task` | Create/list/edit/cancel schedules so the agent messages this thread later | yes |
| `tag_member` | @mention the right person in a group | no |
| `get_group_info` | Group name, member count, member list | no |
| `add_reaction` | React to a message | no |
| `tai_video` | Download a TikTok/Facebook video without the watermark and send it in chat | no |

The effective tool set of a turn is the **intersection** of two disable lists: the **agent** declares
capability ("what this persona knows how to do"), the **account** applies policy ("what this Zalo
identity is allowed to do"). Neither side can re-enable what the other disabled, so adding a new
agent can never widen an account's permissions.

Scheduled turns are narrower still: **10 tools are excluded**, because a scheduled turn runs isolated
from chat history and 6 of them send straight to Zalo, bypassing the daily proactive-message cap.

### Real rich text, not plain walls

On the personal channel, model markdown is **translated** into Zalo's native `textProperties`, not
stripped:

- **Bold**, *italic*, ~~strikethrough~~, underline, large headings
- **Four text colors** (red, orange, yellow, green) for invitations and formal announcements
- Leading emoji chosen to match each line's meaning

All of it was **measured on real devices, on both Zalo Web and Zalo mobile** - the two clients
render some styles differently, and those styles were removed from the design. Zalo also rejects a
whole message when text plus formatting exceeds a byte threshold, so the sender shrinks the
per-message character cap to fit the budget before splitting.

The Bot channel sends **plain text** - not out of caution, but because by the time text reaches the
sender the markdown is already gone (the translation layer lifted it into `Style[]` upstream), so
asking the server to re-parse it could only remove characters.

### Knowledge base (RAG)

Upload documents for the agent to consult through the `kb_search` tool - company policies, price
lists, internal guides, FAQs.

- Formats: **.docx, .xlsx, .pdf, .txt, .md**, or typed directly in the dashboard
- Retrieval via **SQLite FTS5 + bm25**, multiple queries merged with **RRF** (a vector layer can be
  added later without changing the interface)
- Content is loaded **by tool call**, never pasted into the prompt - that preserves the prompt-cache
  investment of every turn that does not touch the knowledge base
- Each agent can only read sources **explicitly assigned** to it. Default: **none**
- Uploads are checked by **real file signature** (magic bytes) for docx/xlsx/pdf, never by extension
- Reading and chunking run in a **dedicated worker thread** with two circuit breakers: a document
  that spins the CPU forever is cut by `terminate()`, and one that grows the heap is stopped by a RAM
  ceiling set in the dashboard
- docx/xlsx are parsed with **streaming SAX**, not paired regexes: the old regex pair was measured
  blocking the event loop for **38.09 seconds** on a 1.7 KB compressed XML bomb (quadratic ReDoS).
  That number is pinned in a regression test

### MCP client (plug in external servers)

The bot is an MCP **client**: it connects to external MCP servers (HTTP transport only, no stdio -
the VPS restricts running arbitrary commands) so the agent can discover and call their tools,
stacked on top of the 15 built-in tools.

- **Assigned per agent, default OFF** (default-deny): a server must be explicitly assigned to an
  agent from the dashboard; an unassigned agent sees no external tools at all - a stranger chatting
  with an unconfigured agent never reaches an external tool
- External tool output is wrapped as **untrusted content**, the same guard as `web_fetch`; a failed
  call never throws
- Auth headers (tokens, API keys for the MCP server) are encrypted with **AES-256-GCM**, like every
  other secret in the project
- **Fingerprint drift**: a fingerprint of the tool set is captured when the operator approves a
  server - if it silently changes its tools afterward, the server drops into a "needs re-approval"
  state and no tool loads until the operator re-approves
- Every external tool is treated as the `action` group (the server's own annotations are not
  trusted) and excluded from scheduled turns
- `MCP_ENABLED` is a runtime kill switch - disabling it in the dashboard blocks everything
  immediately, no need to remove each assignment

Managed from the **MCP** tab in the dashboard. Full architecture diagram:
[`docs/mcp-client-architecture.html`](docs/mcp-client-architecture.html).

### Scheduling (the agent messages you)

Three kinds: `once`, `every`, `cron`. Created from chat in plain language, or from the dashboard.

- `message` jobs send verbatim - **zero tokens**
- `agent` jobs run an isolated AI turn (research, then report)
- Two anti-spam layers: reject overly frequent schedules at creation, and a daily cap on proactive messages
- A late job still **sends**, labelled "(late reminder, originally HH:MM)", instead of silently swallowing it
- No free-form datetime strings are accepted - only `{date, time}` or `{inMinutes}`, because a naive
  string through `new Date()` is interpreted in the OS timezone. All conversion goes through one path

### Memory

- Conversation history in SQLite, per account and thread
- **Rolling summary** so context that falls out of the replay window is not lost
- A real **token budget** for context (settable per agent), not just a message count - when the
  budget is exceeded, old images are dropped before old messages
- **Durable facts** via `save_memory`, with asymmetric privacy rules between direct chats and groups
- Received images are stored, described by a secondary vision model, and cached so later turns cost nothing

## Dashboard

Hono + React + Tailwind, served by the agent process itself at `http://127.0.0.1:3900`.

| Page | Purpose |
|---|---|
| Overview | Daily input/output tokens across all accounts |
| Accounts | Add Zalo accounts, pick the **channel type** (personal / official bot), **scan the QR right in the browser** or paste a **Bot Token**, enable/disable each |
| Agents | One brain per account: its own persona, model, tool set, and knowledge sources |
| Sessions | Replay any conversation, read the agent's own rolling summary, mute per thread, **wipe a conversation's context** |
| Contacts | People the agent has met |
| Memory | Inspect, edit, delete anything the agent remembers |
| Knowledge base | Upload documents or type them in, inspect the chunks, assign sources per agent for `kb_search` |
| Schedule | All jobs, dry-run now, per-run history |
| Tools | Toggle the 15 tools per account; configure image generation and the vision sidecar. Picking a bot account shows exactly why a platform-blocked tool is unavailable |
| MCP | Add/edit/remove external MCP servers (HTTP only), assign servers per agent (default off), re-approve when the tool set drifts |
| Tuning | **70 runtime parameters** in 13 groups, applied live with no restart |
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
- **Mid-turn injection**: a message sent while the agent is working is pulled in at the next step
  boundary rather than waiting for the next turn
- If Zalo rejects a formatted message, it is **resent as plain text** - formatting is lost, content is not
- Three-layer tool-loop guards, per-turn timeout, output token ceiling
- Provider errors are classified instead of blindly retried: quota exhaustion honours the real
  `Retry-After`, context overflow trims harder and retries, a bad key is **not** retried at all

**Serious prompt-injection defense** (the agent reads messages from strangers)

- Web content is wrapped in a `<noi_dung_ngoai>` tag carrying a **random nonce generated per call**;
  the persona states it is data, not commands. An attacker composes their payload before the nonce
  exists, so they cannot forge the closing tag
- `web_fetch` and `send_file` block loopback, private ranges, and cloud metadata endpoints
- **No money-transfer or payment tool exists** - deliberately omitted even though the library offers one
- Document tools accept **data only** (titles, paragraphs, tables); model-generated code is never executed
- Replies that leak the system prompt are blocked before reaching Zalo
- Every regex touching untrusted content is linear (ReDoS-safe)

**Local security**

- Zalo cookies and Bot Tokens encrypted with **AES-256-GCM**, key held outside the database
- The Bot Token lives in the Zalo Bot API **URL path** (`/bot{token}/{method}`), so the client masks
  it in every string headed for an error message - three layers of masking, because the token was
  once traced from an intermediary proxy's error page into the dashboard and into log files
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
account - QR login for a personal account, or a Bot Token for an official bot account.

## Run

```bash
pnpm dev                    # agent (watch mode) + dashboard
pnpm build:web              # build the UI; the process serves it at http://127.0.0.1:3900
pnpm dev:web                # dashboard UI in dev mode (Vite, proxies the API)
pnpm zalo-login acc-main    # QR login from the CLI (the web flow is easier; PERSONAL accounts only)
pnpm zalo-bot-check         # probe the Zalo Bot API with a real token, print which methods live or 404
pnpm test                   # 2267 tests
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
> This risk does **not** apply to official Zalo Bot accounts - that is a public Zalo API.

- `data/` holds encrypted Zalo cookies and Bot Tokens plus your whole history - **never commit or share it**
- One listener per personal account: opening Zalo Web in a browser kicks the agent's listener (it reconnects and kicks back)
- Bot accounts default to a **closed allowlist**, unlike personal accounts - the blast radius is
  different: a personal account only receives from friends, while anyone with the link can message a
  bot, so leaving it open invites strangers to burn tokens and probe for prompt injection
- Mass messaging and CRM campaigns are **deliberately out of scope**
- Behind Caddy/Nginx, set `DASHBOARD_BEHIND_PROXY=true` (correct client IP for rate limiting, `Secure` cookies)

## Testing

| | |
|---|---|
| Unit + integration tests | **2267**, on `node:test`, no external framework, across 210 test files |
| Eval cases against a real model | **17** - measuring what tests cannot: does it research instead of guessing, ask when information is missing, format readably |
| Source | ~41,900 lines excluding tests, across 355 files |

Evals can inspect **the actual formatting sent to Zalo**, not just plain text, so presentation bugs
are caught by machine rather than by the user noticing.

Working discipline: **break the code and confirm the test goes red** before calling a fix done. A
green test proves nothing if it is also green when the logic is wrong. And when replacing an
existing security regex, run **both versions** over **the same payload set** and assert the new
one's catch set is a superset - sabotage only proves the new code is *needed* by the new test, never
that it *covers* the old one.

## Layout

```
src/
├── config/        env (Zod), account store, agent store, 70 live-tunable parameters
├── zalo/          [PERSONAL channel] QR login, encrypted credentials, listener + reconnect,
│                  message parsing, sanitizer, markdown -> Zalo styles, byte-budget splitting,
│                  channel capability abstraction (KenhLuot)
├── zalo-bot/      [BOT channel] Zalo Bot API client, long polling, update parser, capability
│                  table + tool blocking, its own inbound router, per-account runner
├── agent/         agent loop (AI SDK), providers, persona, tools/ (15 tools)
├── scheduler/     schedules: tick, job claiming, proactive-send caps, run history
├── conversation/  SQLite: history, threads, contacts, usage, memory, images, summarizer
├── middleware/    allowlist + @mention, per-thread batching, send rate limiting
├── documents/     .docx / .xlsx generation
├── knowledge/     Knowledge base - safe docx/xlsx/pdf/txt/md reading (streaming SAX +
│                  zip-bomb caps), chunking, FTS5+RRF search, worker-thread extraction
├── mcp/           MCP client: connect external MCP servers (HTTP only), per-agent default-deny,
│                  fingerprint drift detection
├── images/        image generation, vision sidecar
└── server/        dashboard API (Hono)
web/               dashboard UI (React + Vite + Tailwind)
evals/             eval suite against a real model
docs/              architecture, roadmap, release guide
```

## Documentation

- [System architecture](docs/system-architecture.md) - including the measured Zalo Bot API tables
  (error shape, limits, which methods actually exist)
- [MCP client architecture](docs/mcp-client-architecture.html) - dashboard-to-model flow, 2-gate
  default-deny, fingerprint drift. Open in a browser
- [Deployment guide](docs/deployment-guide.md) - Docker, reverse proxy, backup, troubleshooting
- [First-time VPS setup](docs/vps-setup-checklist.md) - user, firewall, cron, backup
- [Roadmap](docs/project-roadmap.md) - the full history: bugs hit, how they were measured,
  decisions locked in, and the limitations that remain. The thickest and most honest document here
- [Agent token accounting](docs/ke-toan-token-cua-agent.html) - a self-study explainer (Vietnamese):
  context window, per-turn tokens, multi-step turns, prompt caching. Open it in a browser
- [Changelog](CHANGELOG.md)

## Contributing

Issues and pull requests welcome. Before opening a PR, `pnpm typecheck` and `pnpm test` must pass.

## License

[MIT](LICENSE)

Built on [zca-js](https://github.com/RFS-ADRENO/zca-js) (MIT) and the
[Vercel AI SDK](https://github.com/vercel/ai) (Apache-2.0).
