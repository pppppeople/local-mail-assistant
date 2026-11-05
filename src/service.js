import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ImapMailbox } from './mail/imap.js';
import { OutlookMailbox } from './mail/outlook.js';
import { MAIL_CATEGORIES, replyRecommended } from './mail-policy.js';
import { immediateNotice, nextDigestAt, portalLink, digestMessage } from './digest.js';

export function mailboxFactory(runtime) {
  return account => account.provider === 'outlook' ? new OutlookMailbox(account, runtime) : new ImapMailbox(account);
}

export function summaryMessage(mail, summary, account) {
  const todos = summary.actions.length ? `\n待办：\n${summary.actions.map(item => `• ${item}`).join('\n')}` : '';
  const reply = replyRecommended(summary) ? `\n\n建议回复：${summary.replyEvidence}\n要帮你拟回复吗？\n回复：邮件回复 ${mail.id} 你的想法` : '';
  return `📩 邮件 #${mail.id} · ${account.provider}\n收件邮箱：${mail.data.accountEmail || account.email}\n分类：${MAIL_CATEGORIES[summary.category] || '其他邮件'}\n发件人：${mail.data.fromName ? `${mail.data.fromName} · ${mail.data.from}` : mail.data.from}\n主题：${mail.data.subject.slice(0, 160)}\n${summary.urgency === 'urgent' ? '需要尽快处理\n' : ''}\n${summary.summary}${todos}${reply}\n查看：邮件详情 ${mail.id}`;
}

export class MailService {
  constructor({ store, config, ai, notifier, createMailbox, now = () => Date.now() }) {
    this.store = store; this.config = config; this.ai = ai; this.notifier = notifier;
    this.createMailbox = createMailbox; this.leaseOwner = crypto.randomUUID();
    this.now = now;
  }
  account(id) {
    const account = this.config.accounts.find(a => a.id === id);
    if (!account) throw new Error('该邮箱已从配置移除，不能回复');
    return account;
  }
  accountForMail(mail) {
    const account = this.account(mail.account);
    if (mail.data.accountEmail && mail.data.accountEmail.toLowerCase() !== account.email.toLowerCase()) throw new Error('该邮件的原邮箱与当前配置不同，未操作；请恢复原配置或为新邮箱使用新的 id');
    return account;
  }
  async poll() {
    if (!this.store.acquireLease('poll', this.leaseOwner)) throw new Error('已有邮件扫描运行中');
    const heartbeat = setInterval(() => this.store.acquireLease('poll', this.leaseOwner), 30000);
    try {
      for (const account of this.config.accounts.filter(a => a.enabled)) {
        try {
          const cursor = this.store.cursor(account.id);
          if (cursor?.accountEmail && cursor.accountEmail.toLowerCase() !== account.email.toLowerCase()) throw new Error('邮箱地址已更改，请使用新的账户 id');
          let result;
          for (let attempt = 0; attempt < 2; attempt++) {
            try { result = await this.createMailbox(account).scan(cursor, this.config.maxMessagesPerPoll); break; }
            catch (error) {
              if (attempt || !['ECONNRESET', 'ETIMEDOUT', 'ESOCKET'].includes(error.code)) throw error;
              // Scans are read-only and the cursor has not advanced. Never use
              // this retry for sending a reply.
              await delay(1000);
            }
          }
          const added = this.store.ingest(account.id, result.messages.map(mail => ({ ...mail, accountEmail: account.email })), { ...result.cursor, accountEmail: account.email });
          this.store.setHealth(account.id, { status: 'ok', at: new Date().toISOString(), added, baseline: !!result.baseline });
        } catch (error) {
          // Error contents can contain provider identity; retain status codes only.
          this.store.setHealth(account.id, { status: 'error', at: new Date().toISOString(), error: error.code || error.name || 'Error' });
        }
        this.store.acquireLease('poll', this.leaseOwner);
      }
      for (const mail of this.store.pendingAnalysis()) {
        try {
          const summary = await this.ai.summarize(mail.data);
          const url = portalLink(this.config, mail.id);
          const text = summaryMessage(mail, summary, this.accountForMail(mail)) + (url ? `\n页面：${url}` : '');
          this.store.analyzed(mail.id, summary, text, immediateNotice(summary) ? null : nextDigestAt(this.now(), this.config.notification?.digestHours));
          this.store.setHealth(`analysis:${mail.account}`, { status: 'ok', at: new Date().toISOString() });
        } catch {
          this.store.setHealth(`analysis:${mail.account}`, { status: 'error', at: new Date().toISOString() });
        }
        this.store.acquireLease('poll', this.leaseOwner);
      }
      this.store.flushDigests(this.now(), messages => digestMessage(messages, this.config));
      for (const notification of this.store.pendingNotifications()) {
        try { await this.notifier.send(notification.text, { clientId: notification.client_id }); this.store.notificationDone(notification.id); }
        catch { this.store.notificationRetry(notification.id); }
      }
      return this.status();
    } finally { clearInterval(heartbeat); this.store.releaseLease('poll', this.leaseOwner); }
  }
  status() {
    return { accounts: this.config.accounts.map(a => ({ id: a.id, provider: a.provider, enabled: !!a.enabled })),
      digestHours: this.config.notification?.digestHours || [9, 18],
      health: this.store.health(), pendingAnalysis: this.store.pendingAnalysis().length,
      pendingDigest: Number(this.store.db.prepare('SELECT COUNT(*) AS n FROM digest_items').get().n),
      pendingNotifications: Number(this.store.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE state='pending'").get().n) };
  }
  editDraft(id, revision, body) {
    const mail = this.store.message(id);
    if (!mail) throw new Error('找不到这封邮件');
    this.accountForMail(mail);
    if (typeof body !== 'string' || !body.trim() || body.length > 12000) throw new Error('草稿应为 1–12000 字符');
    return this.store.transaction(() => {
      const previous = this.store.draft(id);
      if (!previous || previous.revision !== revision) throw new Error('草稿已修改，请刷新最新版本');
      if (previous.state !== 'review') throw new Error('只有待审核草稿可以修改');
      this.store.db.prepare("UPDATE drafts SET body=?,revision=revision+1 WHERE message_id=?").run(body.trim(), id);
      return this.store.draft(id);
    });
  }
  async draft(id, instruction) {
    const mail = this.store.message(id);
    if (!mail) throw new Error('找不到这封邮件');
    const account = this.accountForMail(mail);
    const previous = this.store.draft(id);
    if (previous && ['sent', 'sending', 'unknown'].includes(previous.state)) throw new Error('已发送或发送结果待核实，不能重新拟稿');
    if (!instruction.trim()) throw new Error('请说明回复意思');
    const body = await this.ai.draft(mail.data, instruction);
    const draft = this.store.saveDraft(id, body);
    return `✍️ 邮件 #${id} 回复草稿 · 第 ${draft.revision} 版\n发件邮箱：${account.email}\n收件人：${mail.data.replyTo}\n\n${body}\n\n发送前请检查内容。\n确认发送：邮件确认 ${id} ${draft.revision}\n修改：邮件回复 ${id} 新的回复意思\n取消：邮件取消 ${id}`;
  }
  async confirm(id, revision) {
    const mail = this.store.message(id);
    const draft = this.store.draft(id);
    if (!mail || !draft) throw new Error('找不到回复草稿');
    const account = this.accountForMail(mail);
    if (draft.revision !== revision) throw new Error('草稿已修改，请确认最新显示的版本');
    if (!account.enabled) throw new Error('该邮箱未启用，不能发送');
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(mail.data.replyTo || '')) throw new Error('原邮件收件地址无效，未发送');
    if (/\[[^\]]+\]/.test(draft.body)) throw new Error('草稿仍有方括号占位，请补齐后重新拟稿');
    if (!this.store.claimSend(id, revision)) throw new Error('这版草稿已取消、已发送或正在发送；未重复发送');
    try {
      const receipt = await this.createMailbox(account).sendReply(mail.data, draft.body);
      if (receipt?.status !== 'accepted') throw new Error('缺少发送回执');
      this.store.finishSend(id, 'sent', JSON.stringify(receipt));
      return `邮件 #${id} 第 ${revision} 版已被邮箱服务器接受发送。`;
    } catch {
      this.store.finishSend(id, 'unknown');
      return `邮件 #${id} 的发送结果暂时无法确认。请先检查邮箱已发送文件夹；系统不会自动重发，避免重复邮件。`;
    }
  }
}
