# GitHub 复用调研与来源

核查日期：2026-10-10。核对仓库说明、关键模块、最近推送和 LICENSE；
没有把 star 数或 README 声明当作真实账号验收。

| 项目 | 已核对的部分 | 本项目采用方式 | 许可证/取舍 |
| --- | --- | --- | --- |
| [Mailpilot](https://github.com/Wangnov/mailpilot) | IMAP 监听、首跑水位线、去重和重试队列 | 参考首跑基线及断线不丢邮件的流程，重新用 SQLite/Node 实现 | MIT；不复制 Go 源码；其 Outlook 密码示例不沿用 |
| [gmail-agent](https://github.com/olivierloverde/gmail-agent) | emailService、summaryService、telegramService 的修改/确认/发送 | 参考显示草稿→确认→发送的交互，重写为耐久版本状态机 | MIT；2024-11-16 后未见推送，单 Gmail、内存确认状态不直接搬 |
| [Courier](https://github.com/overseers-desk/courier) | CLI/MCP、IMAP、多账户配置说明 | 参考账户/身份分离；不采用整个 CLI/MCP 服务 | MIT；2026-09-26 推送，具体租户兼容仍需验收 |
| [Inbox Zero](https://github.com/elie222/inbox-zero) | 多账户数据结构、Google/Microsoft、消息渠道 | 产品结构参考，不复制源码 | AGPLv3 加商业/企业额外限制；避免引入应用代码许可范围 |
| [raa-org/email-assistant](https://github.com/raa-org/email-assistant) | IMAP XOAUTH2、单封/批量摘要、LLM 适配 | 摘要模块划分参考，不采用 Keycloak/企业邮箱架构 | MIT；XOAUTH2 与 IdP 绑定，不适合直接当四种个人邮箱入口 |
| [EmailEngine](https://github.com/postalsys/emailengine) | IMAP/SMTP/Gmail/Graph 统一 API | 参考协议分层，不复制/部署服务器 | 当前仓库为商业许可，不能误当免费开源依赖 |
| [ImapFlow](https://github.com/postalsys/imapflow) | 只读 mailbox lock、UID 查询、TLS | **直接 npm 依赖**，负责 QQ/Gmail/iCloud 收信 | 安装版本 2.4.0；包标记 MIT，实际许可证文本不含保留声明条件 |
| [Mailparser](https://github.com/nodemailer/mailparser) | MIME、中文主题、正文、Reply-To、附件元数据 | **直接 npm 依赖**，负责原始邮件归一化 | 安装版本 3.9.38；包标记 MIT，实际许可证文本不含保留声明条件 |
| [Nodemailer](https://github.com/nodemailer/nodemailer) | SMTP TLS/STARTTLS、回复头、发送回执 | **直接 npm 依赖**，负责经确认的回复发送 | 安装版本 10.1.0，MIT-0 |
| [Codex TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript) | structured output、隔离线程、AbortSignal | **直接 npm 依赖**，沿用本机已登录 Codex，禁用工具 | 安装版本 0.162.1，Apache-2.0 |

依赖保留为上游包，不复制进 src/，package-lock.json 固定安装内容。
应用项目只作经过核查的设计参考；目前没有转抄第三方应用代码。
因此不会把“调研了多个应用”误报成“复制了多个应用的模块”。

## 固定研究版本

| 仓库 | 核查 commit |
| --- | --- |
| Wangnov/mailpilot | 47f0fd4f46b4b2cc15833bdb664bd063a67fea98 |
| olivierloverde/gmail-agent | 2855218851408ff59c7195bbef69c3ee763f348d |
| overseers-desk/courier | 1e6c5111c649c4dea668beef977982464d00e151 |
| elie222/inbox-zero | 7524881a876272d2130c7011b65626af5afd1d97 |
| raa-org/email-assistant | 55acd3ad3346d2203022d81be2aee15588619d9c |
| postalsys/emailengine | fc32e2b3c1ae33fb5ab031d8f6c7be8d7e70a216 |
| postalsys/imapflow | 1ba1945e2b330584c4e3e6f03ed5deca64295077 |
| nodemailer/mailparser | a8a01773c7e7aec6bcfff6fe93c0794d851b4fc0 |
| nodemailer/nodemailer | 0780032250ad5c566b5d8e6fd56ca8c210e423ec |

## 下一步复用入口

之后如果需要 IMAP IDLE、Google OAuth、服务器端草稿或附件分析，优先扩展
现有 owning 模块，不再引入第二套邮件状态库。每项必须有真实账户验证。
微信发送沿用私有桥的 owner/context 合约，不复用 Telegram 代码来模拟微信接入。
