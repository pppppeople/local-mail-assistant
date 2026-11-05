import { portalLink } from './digest.js';

export function parseMailCommand(text) {
  const value = String(text || '').trim().replace(/^扣子[，,\s]*/, '');
  if (/^邮件(?:列表|清单)$/.test(value)) return { action: 'list' };
  if (/^邮件状态$/.test(value)) return { action: 'status' };
  if (/^邮件页面$/.test(value)) return { action: 'portal' };
  let match = value.match(/^邮件(详情|取消)\s+#?(\d+)$/);
  if (match) return { action: match[1] === '详情' ? 'detail' : 'cancel', id: Number(match[2]) };
  match = value.match(/^邮件回复\s+#?(\d+)\s+([\s\S]+)$/);
  if (match) return { action: 'draft', id: Number(match[1]), instruction: match[2].trim() };
  match = value.match(/^邮件确认\s+#?(\d+)\s+(\d+)$/);
  if (match) return { action: 'confirm', id: Number(match[1]), revision: Number(match[2]) };
  if (/^邮件(?:回复|确认|取消|详情)(?:\s|$)/.test(value)) return { action: 'help' };
  return null;
}

export async function executeMailCommand(service, command) {
  const store = service.store;
  switch (command.action) {
    case 'portal': return portalLink(service.config) || '邮件页面尚未启用。';
    case 'list': {
      const list = store.list();
      return list.length ? list.map(m => `#${m.id} · ${service.account(m.account).provider} · ${m.data.subject}\n${m.summary?.summary || '正在分析'}`).join('\n\n') : '还没有新邮件记录。第一次接入只建立基线，之后的新邮件才会通知。';
    }
    case 'status': return JSON.stringify(service.status(), null, 2);
    case 'detail': {
      const mail = store.message(command.id);
      if (!mail) throw new Error('找不到这封邮件');
      return `邮件 #${mail.id}\n发件人：${mail.data.from}\n主题：${mail.data.subject}\n\n${mail.summary?.summary || '尚未生成摘要'}\n\n正文节选：\n${mail.data.text.slice(0, 2500)}${mail.data.attachments.length ? '\n\n附件：' + mail.data.attachments.map(a => a.name).join('、') : ''}`;
    }
    case 'draft': return service.draft(command.id, command.instruction);
    case 'confirm': return service.confirm(command.id, command.revision);
    case 'cancel': return store.cancel(command.id) ? `邮件 #${command.id} 草稿已取消，未发送。` : '没有可取消的待审核草稿。';
    default: return '邮件列表\n邮件详情 1\n邮件回复 1 你的回复意思\n邮件确认 1 草稿版本\n邮件取消 1';
  }
}
