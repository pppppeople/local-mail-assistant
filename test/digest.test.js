import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { MailService } from '../src/service.js';
import { nextDigestAt, digestMessage } from '../src/digest.js';

test('Shanghai next digest is 9 or 18, with the next day after 18', () => {
  for (const [from, to] of [['2026-10-11T00:30:00Z', '2026-10-11T01:00:00Z'], ['2026-10-11T01:00:00Z', '2026-10-11T10:00:00Z'], ['2026-10-11T11:00:00Z', '2026-10-12T01:00:00Z']]) assert.equal(nextDigestAt(Date.parse(from)), Date.parse(to));
});

test('routine mail is durably deferred then queued once; reply and urgent are immediate', async t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  let now = Date.parse('2026-10-11T00:30:00Z'); const notices = [];
  const mails = ['receipt', 'reply', 'urgent'].map((sourceId, i) => ({ sourceId, subject: sourceId, from: 'synthetic@example.com', text: String(i), attachments: [] }));
  const service = new MailService({ store, now: () => now, config: { accounts: [{ id: 'test', provider: 'gmail', email: 'owner@example.com', enabled: true }], maxMessagesPerPoll: 50 },
    createMailbox: () => ({ scan: async () => ({ messages: mails, cursor: {} }) }), notifier: { send: async text => notices.push(text) },
    ai: { summarize: async mail => ({ category: 'transaction', summary: '合成摘要', actions: [], needsReply: mail.text === '1', replyReason: mail.text === '1' ? 'explicit_request' : 'none', replyEvidence: mail.text === '1' ? '请邮件答复' : '', urgency: mail.text === '2' ? 'urgent' : 'normal' }) } });
  await service.poll(); assert.equal(notices.length, 2); assert.equal(service.status().pendingDigest, 1);
  now = Date.parse('2026-10-11T01:00:00Z'); await service.poll(); assert.equal(notices.length, 3); assert.match(notices[2], /常规邮件汇总/); assert.doesNotMatch(notices[2], /拟回复|邮件回复/);
  assert.match(notices[2], /收件邮箱：owner@example.com/); assert.match(notices[2], /synthetic@example.com/);
  assert.equal(service.status().pendingDigest, 0); await service.poll(); assert.equal(notices.length, 3);
});

test('large verification batches become one compact notification with separate receiving accounts', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  for (let i = 0; i < 60; i++) {
    store.ingest('test', [{ sourceId: String(i), accountEmail: i < 40 ? 'one@example.com' : 'two@example.com', fromName: 'Cursor', from: 'synthetic@example.com', subject: `验证码 ${i}` }], {});
    store.analyzed(i + 1, { category: 'security', summary: '临时验证码', actions: ['输入验证码完成登录'] }, '', 1);
  }
  store.flushDigests(2, messages => digestMessage(messages, { accounts: [] }));
  const notices = store.pendingNotifications(); assert.equal(notices.length, 1);
  assert.match(notices[0].text, /60 封/); assert.match(notices[0].text, /账号与安全：40 封/); assert.match(notices[0].text, /账号与安全：20 封/);
  assert.match(notices[0].text, /one@example.com/); assert.match(notices[0].text, /two@example.com/);
  assert.doesNotMatch(notices[0].text, /主题：|输入验证码|#\d+/); assert.ok(notices[0].text.length <= 1600);
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM digest_items').get().n, 0);
});

test('digest enqueue rollback retains mail when formatting fails', t => {
  const store = new Store(':memory:'); t.after(() => store.close());
  store.ingest('test', [{ sourceId: 'a', subject: 'a' }], {}); store.analyzed(1, { summary: 'a' }, '', 1);
  assert.throws(() => store.flushDigests(2, () => { throw new Error('format'); }));
  assert.equal(store.db.prepare('SELECT COUNT(*) n FROM digest_items').get().n, 1);
  assert.equal(store.pendingNotifications().length, 0);
});
