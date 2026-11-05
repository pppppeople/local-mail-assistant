import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { MailService } from '../src/service.js';
import { parseMailCommand, executeMailCommand } from '../src/commands.js';

const account = { id: 'qq', provider: 'qq', enabled: true, email: 'owner@example.com' };
const mail = { sourceId: '7:42', subject: '会议时间', from: 'client@example.com', replyTo: 'reply@example.com', text: '请确认会议时间', attachments: [], references: [], messageId: '<a@example.com>' };
const summary = { summary: '对方请你确认会议时间。', actions: ['确认时间'], needsReply: true, urgency: 'normal', category: 'meeting', replyReason: 'explicit_request', replyEvidence: '对方要求邮件确认时间' };
function setup(options = {}) {
  const store = options.store || new Store(':memory:');
  const notices = []; const sends = [];
  const service = new MailService({ store, config: { accounts: [account], maxMessagesPerPoll: 50 },
    ai: { summarize: async () => summary, draft: async (_, instruction) => `您好，${instruction}` },
    notifier: { send: async text => notices.push(text) },
    createMailbox: () => ({ scan: async () => ({ messages: [mail], cursor: { validity: '7', lastUid: 42 } }),
      sendReply: async (_, body) => { sends.push(body); return { status: 'accepted', id: 'sent-1' }; } }), ...options });
  return { store, service, notices, sends };
}

test('new mail -> summary -> WeChat request -> review -> explicit send; polls do not duplicate', async t => {
  const { store, service, notices, sends } = setup(); t.after(() => store.close());
  await service.poll(); await service.poll();
  assert.equal(store.list().length, 1); assert.equal(notices.length, 1); assert.equal(sends.length, 0);
  assert.match(notices[0], /邮件回复 1/);
  assert.match(notices[0], /收件邮箱：owner@example.com/);
  const draft = await executeMailCommand(service, parseMailCommand('邮件回复 1 周三有空'));
  assert.match(draft, /收件人：reply@example.com/); assert.match(draft, /邮件确认 1 1/);
  assert.equal(sends.length, 0);
  await executeMailCommand(service, parseMailCommand('邮件确认 1 1'));
  assert.equal(sends.length, 1); assert.equal(store.draft(1).state, 'sent');
  await assert.rejects(service.confirm(1, 1)); assert.equal(sends.length, 1);
});

test('an observed transient read connection reset retries once without skipping or duplicating mail', async t => {
  let scans = 0;
  const { store, service } = setup({ createMailbox: () => ({ scan: async () => {
    scans++;
    if (scans === 1) { const error = new Error('synthetic reset'); error.code = 'ECONNRESET'; throw error; }
    return { messages: [mail], cursor: { validity: '7', lastUid: 42 } };
  } }) });
  t.after(() => store.close()); await service.poll();
  assert.equal(scans, 2); assert.equal(store.list().length, 1); assert.equal(store.cursor('qq').lastUid, 42);
});

test('edited draft rejects stale version and cancellation prevents sending', async t => {
  const { store, service, sends } = setup(); t.after(() => store.close()); await service.poll();
  await service.draft(1, '周三有空'); await service.draft(1, '周四有空');
  await assert.rejects(service.confirm(1, 1), /最新/);
  assert.equal(store.cancel(1), 1); await assert.rejects(service.confirm(1, 2)); assert.equal(sends.length, 0);
});

test('concurrent confirmations invoke the mail transport once', async t => {
  const { store, service, sends } = setup(); t.after(() => store.close()); await service.poll(); await service.draft(1, '同意');
  const results = await Promise.allSettled([service.confirm(1, 1), service.confirm(1, 1)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(sends.length, 1);
});

test('uncertain external send remains blocked and is never retried', async t => {
  let calls = 0;
  const { store, service } = setup({ createMailbox: () => ({ scan: async () => ({ messages: [mail], cursor: {} }),
    sendReply: async () => { calls++; throw new Error('connection lost after DATA'); } }) });
  t.after(() => store.close()); await service.poll(); await service.draft(1, '同意');
  assert.match(await service.confirm(1, 1), /不会自动重发/); assert.equal(store.draft(1).state, 'unknown');
  await assert.rejects(service.confirm(1, 1)); await assert.rejects(service.draft(1, '再次回复')); assert.equal(calls, 1);
});

test('durable drafts, account-separated IDs and notification chunks survive reopen', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mail-test-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'mail.sqlite');
  let store = new Store(file);
  store.ingest('qq', [mail], { lastUid: 42 }); store.ingest('gmail', [mail], { lastUid: 42 });
  store.saveDraft(1, '草稿'); store.notify(1, 'long', 'a'.repeat(3300));
  const notifications = store.pendingNotifications(); assert.equal(notifications.length, 3);
  store.notificationDone(notifications[0].id); store.close();
  store = new Store(file); t.after(() => store.close());
  assert.equal(store.list().length, 2); assert.equal(store.draft(1).body, '草稿');
  assert.equal(store.pendingNotifications().length, 2);
  assert.equal(store.pendingNotifications()[0].client_id, notifications[1].client_id);
  assert.equal(store.cursor('qq').lastUid, 42);
});

test('failed account does not block another account; notification failure stays queued', async t => {
  const { store, service } = setup({ config: { accounts: [account, { ...account, id: 'gmail', provider: 'gmail' }], maxMessagesPerPoll: 50 },
    notifier: { send: async () => { throw new Error('context expired'); } },
    createMailbox: a => ({ scan: async () => { if (a.id === 'qq') throw new Error('auth missing'); return { messages: [mail], cursor: { delta: 1 } }; } }) });
  t.after(() => store.close()); await service.poll();
  assert.equal(store.cursor('qq'), null); assert.equal(store.list()[0].account, 'gmail');
  assert.equal(service.status().pendingNotifications, 1); assert.equal(store.health().find(x => x.account === 'qq').status, 'error');
});

test('missing reply address, disabled account and placeholders cannot send', async t => {
  const { store, service, sends } = setup(); t.after(() => store.close()); await service.poll();
  store.saveDraft(1, '您好，[补充会议时间]'); await assert.rejects(service.confirm(1, 1), /占位/);
  assert.equal(sends.length, 0);
  assert.equal(parseMailCommand('确认'), null); assert.equal(parseMailCommand('帮我回复'), null);
  assert.equal(parseMailCommand('邮件确认 1').action, 'help');
});

test('a second scan worker cannot enter an active lease', async t => {
  const { store, service } = setup(); t.after(() => store.close());
  assert.equal(store.acquireLease('poll', 'other-worker'), true);
  await assert.rejects(service.poll(), /已有/);
});

test('changing an existing account address cannot send a stored draft from the new identity', async t => {
  const configured = { ...account };
  const { store, service, sends } = setup({ config: { accounts: [configured], maxMessagesPerPoll: 50 } });
  t.after(() => store.close()); await service.poll(); await service.draft(1, '同意');
  configured.email = 'other-owner@example.com';
  await assert.rejects(service.confirm(1, 1), /原邮箱/); assert.equal(sends.length, 0);
  await service.poll(); assert.equal(store.cursor('qq').accountEmail, 'owner@example.com');
});
