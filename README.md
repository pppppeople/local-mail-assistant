# PP Mail Assistant

A local-first multi-mailbox AI assistant: QQ/Gmail/iCloud over IMAP + SMTP, and Outlook over Microsoft Graph. Produce Chinese summaries, extract actionable tasks and prepare replies. **Only the owner's explicit confirmation of the displayed draft version can send a reply.**

Examples are fictional. No real mailbox configuration, mail sample, token, database or login state is included.

## Run locally

Use Node.js 24+:

```sh
npm ci
npm run check
npm run demo
npm run init
npm run status
```

The demo uses synthetic mail and fake AI, mailbox and notification adapters; it does not contact a real mailbox, model or messaging service. The test suite separately exercises a loopback SMTP server. All accounts in `config/accounts.example.json` are disabled and use reserved example addresses. Replace addresses only in your own private configuration, enable one intended account and supply its app password through the named environment variable in your private `config/secrets.env`. Outlook requires your own Microsoft application client ID and device-code authorization:

```sh
npm run mail -- auth-outlook outlook-personal
npm run mail -- poll
```

The first poll establishes a baseline and skips old mail. See [provider setup](docs/providers.md) for provider prerequisites. AI can use an authenticated local Codex CLI or `ai.provider: deepseek` with `DEEPSEEK_API_KEY`; this repository does not supply authentication. `npm run setup` is an optional interactive account helper, not required for the synthetic demo. `npm start` runs the foreground poller after you have configured accounts, AI and the notification adapter.

## Privacy model and optional notification adapter

The complete mail database, cursors, drafts and sending outcomes stay locally under `~/.local/share/pp-mail-assistant/runtime`. `MAIL_ASSISTANT_HOME` overrides the runtime; `MAIL_ASSISTANT_CONFIG` overrides the configuration file. Within runtime, `config/` holds private configuration, secrets and OAuth, `state/` holds SQLite, and `logs/`, `tmp/`, `backups/` have separate roles. `.env.example` lists names only; it is not automatically read. Source examples are not live configuration.

Local-first means storage and state control are local. Relevant message text is sent to the configured AI service/CLI for analysis, and replies go through your mail provider. Attachments are listed by metadata; their content is not analyzed. Review provider retention rules and limit which mail you authorize.

The existing notification interface expects a separately configured compatible WeChat adapter implementing `scripts/mail-notify.js`, owner checks and structured receipts. Supply `notification.bridgeDir` or `MAIL_WECHAT_BRIDGE_DIR` explicitly; no sibling project is autodiscovered or bundled. Missing adapter leaves notification delivery pending, rather than indicating success. A self-contained WeChat bridge is **not** part of this export. The loopback web portal is optional and requires its own access code; no service installation or remote access is necessary for the demo.

## Human confirmation and limits

Drafts are durable and versioned. Review the account, recipient, original message and exact text before confirming the current version. Old, cancelled, duplicate or unresolved drafts cannot send. Uncertain SMTP/Graph outcomes require reconciliation, not automatic retry. Server acceptance does not prove recipient delivery. The notification adapter and provider acceptance must be verified separately from unit tests.

Protocol adapters, confirmation rules and isolated fake/loopback tests are included. No real account or external-send acceptance was performed in this preparation. Do not run `install-service`, live AI smoke or notification commands as part of offline review. See [SCAN.md](SCAN.md), [architecture](docs/architecture.md), [mail rules](docs/mail-rules.md) and [dependency provenance](docs/upstream.md). MIT covers project code; upstream packages retain their own licenses.

中文：本地优先的多邮箱 AI 助理，支持中文摘要、待办提取和回复草稿。真实邮箱授权、模型调用与通知接入须本人配置，回复须确认当前草稿版本才能发送。
