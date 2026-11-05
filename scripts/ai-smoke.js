import assert from 'node:assert/strict';
import path from 'node:path';
import { MailAI } from '../src/ai.js';
import fs from 'node:fs';
import { ROOT, RUNTIME, savePrivateJson } from '../src/config.js';

const directory = path.join(ROOT, 'artifacts', 'ai-smoke');
const provider = process.argv.includes('--deepseek') ? 'deepseek' : 'codex';
if (provider === 'deepseek') {
  const secrets = path.join(RUNTIME, 'config', 'secrets.env');
  if (fs.existsSync(secrets)) process.loadEnvFile(secrets);
}
const ai = provider === 'deepseek'
  ? new MailAI({ provider: 'deepseek', timeoutMs: 90000 }, path.join(directory, 'tmp', 'runtime'))
  : new MailAI({ bin: process.env.CODEX_BIN, timeoutMs: 90000 }, path.join(directory, 'tmp', 'runtime'));
const mail = { subject: '演示：确认会议时间', from: 'synthetic@example.com', replyTo: 'synthetic@example.com',
  text: '请确认下周二下午是否可以开会。不需要附件。', attachments: [] };
const summary = await ai.summarize(mail);
assert.equal(summary.needsReply, true); assert.match(summary.summary, /会议|开会/);
assert.ok(summary.replyEvidence.trim());
const classifications = [];
for (const [subject, text, category, needsReply] of [
  ['演示：会议邀请', '日历邀请：周二下午两点例会，请在日历中接受或拒绝。无需邮件回复。', 'meeting', false],
  ['演示：付款成功', '订单付款成功，金额100元，电子收据已生成。这是自动通知，无需回复。', 'transaction', false],
  ['演示：重复扣款处理', '同一订单原应扣款100元，但我们已确认实际扣款两次。若要求退回重复扣款，请回复本客服邮件提出异议并注明订单号。', 'transaction', true],
]) {
  const result = await ai.summarize({ ...mail, subject, text });
  assert.equal(result.category, category); assert.equal(result.needsReply, needsReply);
  if (needsReply) assert.ok(result.replyEvidence.trim());
  classifications.push({ subject, result });
}
const draft = await ai.draft(mail, '请改为下周三下午，礼貌询问对方是否方便。');
assert.match(draft, /周三/);
savePrivateJson(path.join(directory, 'outputs', 'evidence.json'), { synthetic: true, provider, realMailOrWechatContacted: false, summary, classifications, draft });
console.log(`真实 ${provider === 'deepseek' ? 'DeepSeek' : 'Codex'} 模型通过合成邮件摘要和拟稿检查；没有访问真实邮箱或发送消息。`);
