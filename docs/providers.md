# 四种邮箱的接入

| 邮箱 | 收信 | 发信 | 本项目认证方式 |
| --- | --- | --- | --- |
| QQ | imap.qq.com:993 TLS | smtp.qq.com:465 TLS | IMAP/SMTP 服务授权码 |
| Gmail | imap.gmail.com:993 TLS | smtp.gmail.com:465 TLS | 应用专用密码（须账户支持） |
| iCloud | imap.mail.me.com:993 TLS | smtp.mail.me.com:587 STARTTLS | 应用专用密码 |
| Outlook | Microsoft Graph 增量接口 | Graph 原线程 reply | OAuth 设备代码授权与 refresh token |

授权码在本机 `npm run setup` 输入，不要发到聊天。Gmail 需开启两步验证且账户
允许应用专用密码；部分 Workspace/高级保护策略会限制该方式。当前 Gmail
适配器没有实现 Google OAuth，受限账户需要之后添加 OAuth 接入。
同一种邮箱可以在 config.accounts 追加多个唯一 id，指定不同 passwordEnv。
已使用的账户 id 绑定原邮箱；更换邮箱地址时使用新的 id。旧草稿不能借新地址发送。

QQ：在邮箱网页设置开启 IMAP/SMTP，生成客户端授权码；不要填写 QQ 登录密码。
官方帮助入口：[QQ 邮箱帮助中心](https://service.mail.qq.com/)。具体账户选项需登录核实。

iCloud：Apple 官方说明了 IMAP/SMTP 主机、端口、应用专用密码和用户名格式。
默认使用完整邮件地址；如果 IMAP 只接受用户名部分，设置账户的 `imapUser`。
[Apple 配置说明](https://support.apple.com/en-gb/102525)

Outlook：微软当前要求现代认证；本项目不采用旧项目里的普通密码登录。
[微软认证说明](https://support.microsoft.com/en-au/outlook/pop-imap-and-smtp-settings-for-outlook-com)

1. 在 Microsoft Entra 应用注册自己的公共客户端；个人 Outlook 用户选择支持
   Microsoft 个人账户的账户类型，启用公共客户端流。
2. `oauth.clientId` 填自己的 Application (client) ID；个人账户 tenant 用
   `consumers`，组织账户用其 tenant ID（权限可能需要管理员同意）。
3. 运行 `npm run mail -- auth-outlook <账户id>`，按终端提示在 Microsoft 登录页
   输入设备代码。不要使用网上项目写死的其他应用 clientId。
4. 申请 delegated `User.Read`、`Mail.Read`、`Mail.Send`、`offline_access`；会核对登录
   邮箱是否与配置一致，成功后令牌保存在私人运行目录。

参考：[设备代码授权](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)、
[邮件增量同步](https://learn.microsoft.com/en-us/graph/delta-query-messages)、
[原线程回复](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0)。

## 验收

配置完成后先建立基线，然后从另一个地址分别向四种邮箱发一封新的合成测试邮件。
检查发件人、主题、中文摘要和待办；再在微信要求拟稿，核对发件邮箱、Reply-To
收件人和版本，明确确认后检查实际邮件送达。公司账户的接入限制由当前组织
设置决定；不能用家庭账户成功推断公司邮箱可用。
