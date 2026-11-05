import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/store.js';
import { ROOT, savePrivateJson } from '../src/config.js';
import { MailService } from '../src/service.js';
import { parseMailCommand, executeMailCommand } from '../src/commands.js';

const directory = path.join(ROOT, 'artifacts', 'demo');
const output = path.join(directory, 'outputs');
const store = new Store(path.join(directory, 'tmp', 'runtime', 'state', 'mail.sqlite'));
const sent = []; const notifications = [];
const account = { id: 'demo-qq', provider: 'qq', email: 'owner@example.com', enabled: true };
const mail = { sourceId: `demo-${Date.now()}`, subject: '确认下周会议', from: 'client@example.com', fromName: '演示客户',
  replyTo: 'client@example.com', text: '能否下周二下午开会？请提前提供测试结果。', messageId: '<demo@example.com>', references: [], attachments: [], to: [account.email] };
const service = new MailService({ store, config: { accounts: [account], maxMessagesPerPoll: 50 },
  createMailbox: () => ({ scan: async () => ({ messages: [mail], cursor: { validity: 'demo', lastUid: 1 } }),
    sendReply: async (original, body) => { sent.push({ to: original.replyTo, body }); return { status: 'accepted', id: 'synthetic-only' }; } }),
  ai: { summarize: async () => ({ summary: '客户希望下周二下午开会，并提前收到测试结果。', actions: ['确认会议时间', '准备测试结果'], needsReply: true, urgency: 'normal', category: 'meeting', replyReason: 'explicit_request', replyEvidence: '客户要求确认会议时间' }),
    draft: async () => '您好，下周三我方便开会。测试结果我会在明天提供，请问这个安排是否方便？' },
  notifier: { send: async text => notifications.push(text) } });
try {
  await service.poll();
  const id = store.list(1)[0].id;
  const draft = await executeMailCommand(service, parseMailCommand(`邮件回复 ${id} 周三有空，明天给测试结果`));
  const revision = store.draft(id).revision;
  const receipt = await executeMailCommand(service, parseMailCommand(`邮件确认 ${id} ${revision}`));
  const evidence = { demo: true, realMailOrWechatContacted: false, notifications, draft, receipt, syntheticSent: sent };
  savePrivateJson(path.join(output, 'flow-evidence.json'), evidence);
  fs.writeFileSync(path.join(output, 'flow-preview.md'), `# 多邮箱助理流程演示\n\n全部使用模拟邮箱、模拟 AI 和模拟微信，没有真实发送。\n\n${notifications.map(text => '```text\n' + text + '\n```').join('\n')}\n\n## 回复草稿\n\n${draft}\n\n## 模拟发送结果\n\n${receipt}\n`);
  console.log(`演示完成，模拟通知 ${notifications.length} 条、模拟邮件 ${sent.length} 封。\n${path.join(output, 'flow-preview.md')}`);
} finally { store.close(); }
