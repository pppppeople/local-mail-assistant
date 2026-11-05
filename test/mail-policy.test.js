import test from 'node:test';
import assert from 'node:assert/strict';
import { MailAI } from '../src/ai.js';
import { summaryMessage } from '../src/service.js';
import { MAIL_CATEGORIES } from '../src/mail-policy.js';

const mail = { id: 12, data: { subject: '合成邮件', from: 'synthetic@example.com' } };
const summary = { summary: '请查看相关信息。', actions: ['查看详情'], urgency: 'normal', needsReply: false, replyReason: 'none', replyEvidence: '' };

test('routine categories preserve summary and tasks without reply prompts', () => {
  for (const category of Object.keys(MAIL_CATEGORIES)) {
    const text = summaryMessage(mail, { ...summary, category }, { provider: 'gmail' });
    assert.match(text, /分类：/); assert.match(text, /查看详情/);
    assert.doesNotMatch(text, /拟回复|邮件回复|建议回复/);
  }
});

test('explicit meeting request and evidenced appeal show reply recommendation', () => {
  for (const [category, replyReason, replyEvidence] of [
    ['meeting', 'explicit_request', '请通过邮件确认周二是否方便'],
    ['transaction', 'appeal_dispute', '订单被重复扣款，客服支持回复提出异议'],
  ]) {
    const text = summaryMessage(mail, { ...summary, category, needsReply: true, replyReason, replyEvidence }, { provider: 'gmail' });
    assert.ok(text.includes(replyEvidence)); assert.match(text, /邮件回复 12/);
  }
});

test('AI reply flag without supporting evidence is suppressed; classification schema and rules apply', async () => {
  const ai = new MailAI({}, '.');
  ai.generate = async (prompt, schema) => {
    assert.match(prompt, /常规通知/); assert.ok(schema.required.includes('category'));
    return { ...summary, category: 'notification', needsReply: true, replyReason: 'appeal_dispute', replyEvidence: '  ' };
  };
  const result = await ai.summarize({ text: '状态更新' });
  assert.equal(result.needsReply, false); assert.equal(result.replyReason, 'none');
  assert.doesNotMatch(summaryMessage(mail, result, { provider: 'gmail' }), /邮件回复/);
});
