import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { PRESETS, secretFor } from '../config.js';
import { parseMime } from './normalize.js';

export class ImapMailbox {
  constructor(account, { env = process.env, clientFactory = options => new ImapFlow(options), transportFactory = nodemailer.createTransport } = {}) {
    this.account = account; this.env = env; this.clientFactory = clientFactory; this.transportFactory = transportFactory;
  }
  async scan(cursor, limit = 50) {
    const preset = PRESETS[this.account.provider];
    const client = this.clientFactory({ host: preset.imap, port: 993, secure: true,
      auth: { user: this.account.imapUser || this.account.email, pass: secretFor(this.account, this.env) },
      logger: false, connectionTimeout: 20000, socketTimeout: 60000, disableAutoIdle: true,
      clientInfo: { name: 'PP Mail Assistant', version: '0.1.0' } });
    client.on?.('error', () => {}); // Connection operations report their own failure.
    let lock;
    try {
      await client.connect();
      lock = await client.getMailboxLock(this.account.folder || 'INBOX', { readOnly: true });
      const validity = String(client.mailbox.uidValidity);
      const highUid = Number(client.mailbox.uidNext) - 1;
      if (!Number.isSafeInteger(highUid) || highUid < 0) throw new Error('IMAP 未返回有效 UIDNEXT，未推进游标');
      if (!cursor) return { messages: [], cursor: { validity, lastUid: highUid }, baseline: true };
      if (cursor.validity !== validity) throw new Error('IMAP UIDVALIDITY 已改变，请核实后重新建立基线；未自动跳过邮件');
      if (highUid <= cursor.lastUid) return { messages: [], cursor };
      // A concrete upper bound avoids IMAP n:* returning the last old message
      // when there are no UIDs >= n. Batch limits never skip intervening UIDs.
      const upper = Math.min(highUid, cursor.lastUid + limit);
      const messages = [];
      for await (const item of client.fetch(`${cursor.lastUid + 1}:${upper}`, { uid: true, source: true, internalDate: true }, { uid: true })) {
        if (item.uid <= cursor.lastUid || item.uid > upper) continue;
        messages.push(await parseMime(item.source, { sourceId: `${validity}:${item.uid}`, folder: client.mailbox.path,
          receivedAt: item.internalDate?.toISOString() }));
      }
      return { messages, cursor: { validity, lastUid: upper } };
    } finally {
      lock?.release();
      await client.logout().catch(() => client.close());
    }
  }
  async sendReply(mail, body) {
    const preset = PRESETS[this.account.provider];
    const transport = this.transportFactory({ host: preset.smtp, port: preset.smtpPort, secure: preset.smtpSecure,
      requireTLS: !preset.smtpSecure, auth: { user: this.account.email, pass: secretFor(this.account, this.env) },
      connectionTimeout: 20000, socketTimeout: 60000 });
    try {
      const result = await transport.sendMail({ from: this.account.email, to: mail.replyTo,
        subject: /^re:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
        text: body, inReplyTo: mail.messageId || undefined,
        references: [...(Array.isArray(mail.references) ? mail.references : [mail.references]), mail.messageId].filter(Boolean) });
      if (!result.accepted?.length) throw new Error('SMTP 未确认接受收件人');
      return { status: 'accepted', id: result.messageId };
    } finally { transport.close(); }
  }
}
