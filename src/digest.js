import { MAIL_CATEGORIES, replyRecommended } from './mail-policy.js';

export function immediateNotice(summary) {
  return summary.urgency === 'urgent' || replyRecommended(summary)
    || (summary.category === 'conversation' && summary.actions.length > 0);
}

export function nextDigestAt(now, hours = [9, 18]) {
  // Digest schedules are explicitly in Asia/Shanghai (UTC+8).
  const local = new Date(now + 8 * 3600000);
  for (const day of [0, 1]) {
    for (const hour of hours) {
      const candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, hour - 8);
      if (candidate > now) return candidate;
    }
  }
  throw new Error('邮件汇总时间配置无效');
}

export function portalLink(config, id) {
  const base = config.web?.publicUrl || (config.web?.enabled ? `http://127.0.0.1:${config.web.port || 8768}` : '');
  return base ? `${base.replace(/\/$/, '')}/${id ? `#mail-${id}` : ''}` : '';
}

export function digestMessage(messages, config) {
  const accounts = new Map();
  for (const mail of messages) {
    const email = mail.data.accountEmail || config.accounts.find(account => account.id === mail.account)?.email || '未记录';
    if (!accounts.has(email)) accounts.set(email, new Map());
    const categories = accounts.get(email);
    const category = mail.summary.category || 'other';
    if (!categories.has(category)) categories.set(category, []);
    categories.get(category).push(mail);
  }
  const sections = [];
  for (const [email, categories] of accounts) {
    const lines = [`收件邮箱：${email}`];
    for (const [category, items] of categories) {
      const senders = [...new Set(items.map(m => m.data.fromName || m.data.from || '未知发件人'))];
      const names = senders.slice(0, 3).map(name => name.slice(0, 35)).join('、') + (senders.length > 3 ? '等' : '');
      lines.push(`• ${MAIL_CATEGORIES[category] || '其他邮件'}：${items.length} 封${names ? `（${names}）` : ''}`);
      // Security digests should not repeat short-lived verification tasks.
      if (category !== 'security') {
        const actions = [...new Set(items.flatMap(m => m.summary.actions))];
        if (actions.length) lines.push(`  处理事项：${actions.slice(0, 2).map(action => action.slice(0, 80)).join('；')}${actions.length > 2 ? '；其余见页面' : ''}`);
      }
    }
    sections.push(lines.join('\n'));
  }
  const url = portalLink(config);
  const footer = `\n\n${url ? `详细邮件：${url}\n` : ''}微信查看：邮件列表`;
  let content = `📬 常规邮件汇总 · ${messages.length} 封\n\n`;
  let omitted = 0;
  for (const section of sections) {
    if (content.length + section.length + footer.length > 1400) { omitted++; continue; }
    content += `${section}\n\n`;
  }
  if (omitted) content += `另有 ${omitted} 个邮箱的明细，请在页面或邮件列表查看。`;
  return content.trimEnd() + footer;
}
