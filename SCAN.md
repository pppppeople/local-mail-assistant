# Public export scan

日期：2026-11-05。结论：本地准备，待独立审计；不代表发布批准或零风险保证。

## Commands and scope

```sh
rg -n -i 'key|token|secret|password|cookie|@gmail|@qq|1[3-9][0-9]{9}|/Users/[p]eople|100\.[0-9]+\.' . --hidden -g '!SCAN.md'
python3 ../artifacts/phase1/scripts/scan_exports.py
```

第二条为本任务保留的本地扫描器，附加私密 denylist（任务书点名的两邮箱、两 QQ、人名/客户名、案例号、原绝对目录及账号标识），不把其真实值抄进公开仓。扫描器全文读取所有文件（包含本 SCAN.md），另查手机号、私网地址、非示例邮箱、7 位号码、UUID、常见真实凭据格式、二进制及符号链接。未读取真实运行资料；未联网验证任何凭据。

## Line counts

| 类别 | 命中行数 | 处置 |
| --- | ---: | --- |
| broad | 139 | 保留语法、环境键名、测试假值与规则文字；逐文件见下表 |
| explicit-denylist | 0 | 应为 0；任何实际命中须复核 |
| absolute-home | 0 | 应为 0；任何实际命中须复核 |
| phone | 0 | 应为 0；任何实际命中须复核 |
| private-ip | 0 | 应为 0；任何实际命中须复核 |
| email | 33 | 仅保留 example.com / example.org / example.net 虚构地址 |
| seven-digit | 5 | 逐处核实为毫秒/秒时长和虚构测试时钟，非工单或账号 |
| uuid | 0 | 应为 0；任何实际命中须复核 |
| strong-secret | 0 | 应为 0；任何实际命中须复核 |

## Per-file disposition

只保留禁用的 accounts.example.json，地址统一为保留域 example.com；授权值全部留空；更换私人目录默认值；通知桥必须显式指定；不复制邮件、OAuth、运行数据库、真实配置或 artifacts。测试 token/password 都是短虚构哨兵。

下表统计 broad 命中，全部为实现必需的标识符、空环境键、虚构测试值、协议字段、公开来源或本报告规则文字；不将所有 key/token 词语机械删除。未保留真实凭据值。任何非保留域邮箱与个人标识仍作为阻断项处理。

| 文件 | broad 命中行 | 处置 |
| --- | ---: | --- |
| `.env.example` | 4 | 仅空键名 |
| `.gitignore` | 1 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `README.md` | 4 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `SCAN.md` | 4 | 审计规则与命中解释 |
| `config/accounts.example.json` | 3 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `docs/architecture.md` | 1 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `docs/providers.md` | 2 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `docs/upstream.md` | 1 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `public/mail/index.html` | 1 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `scripts/ai-smoke.js` | 2 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `scripts/install-service.js` | 7 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `scripts/setup.js` | 11 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/ai.js` | 9 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/cli.js` | 2 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/config.js` | 5 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/mail/imap.js` | 3 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/mail/oauth.js` | 10 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/mail/outlook.js` | 1 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/portal.js` | 8 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `src/store.js` | 8 | 代码/配置字段、协议说明或公开许可证；无真实值 |
| `test/ai-deepseek.test.js` | 11 | 虚构样本与测试哨兵 |
| `test/ai-notification.test.js` | 3 | 虚构样本与测试哨兵 |
| `test/mail-policy.test.js` | 1 | 虚构样本与测试哨兵 |
| `test/oauth.test.js` | 10 | 虚构样本与测试哨兵 |
| `test/portal.test.js` | 19 | 虚构样本与测试哨兵 |
| `test/providers.test.js` | 7 | 虚构样本与测试哨兵 |
| `test/storage-layout.test.js` | 1 | 虚构样本与测试哨兵 |

7 位数字专项复核（均保留，非 SAP Case）：

- `src/digest.js`：1 行；时间换算/会话有效期，或完全虚构的测试时钟。
- `test/oauth.test.js`：1 行；时间换算/会话有效期，或完全虚构的测试时钟。
- `test/portal.test.js`：3 行；时间换算/会话有效期，或完全虚构的测试时钟。

## Source Git history

只读扫描四个导出源仓的全部现有 refs 可达 blob（不复制 .git）。本项 117 个 blob，强凭据/字面量规则候选 0 处；未命中强格式候选。未发现已确认真实密钥，因此未触发任务书停工条件。元数据和规则保留在任务 artifacts；不保存密钥原文。未扫描不可达或已丢弃对象，不声称证明历史从未包含秘密。

## Review status

无源仓历史、无远端配置；没有复制 .env、依赖安装目录、私有配置、登录态或真实业务数据。MIT LICENSE、.gitignore、空值 .env.example 已提供。已按点名规则和额外账号模式扫描；仍须人工语义审计以发现正则无法识别的人名、业务背景、授权和许可证问题。实际测试结果及尚未验证的接入见根目录 PREP-REPORT.md。
