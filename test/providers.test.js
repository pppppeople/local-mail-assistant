import test from 'node:test';
import assert from 'node:assert/strict';
import { ImapMailbox } from '../src/mail/imap.js';
import { OutlookMailbox } from '../src/mail/outlook.js';
import { parseMime } from '../src/mail/normalize.js';
import { SMTPServer } from 'smtp-server';
import nodemailer from 'nodemailer';

const mime = Buffer.from('From: Client <client@example.com>\r\nTo: owner@example.com\r\nReply-To: reply@example.com\r\nSubject: =?UTF-8?B?5Lya6K6u?=\r\nMessage-ID: <original@example.com>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n请确认周二下午的会议。');

test('MIME parser decodes Chinese headers and preserves Reply-To/thread identity', async () => {
  const result = await parseMime(mime, { sourceId: '7:10' });
  assert.equal(result.subject, '会议'); assert.equal(result.replyTo, 'reply@example.com');
  assert.equal(result.messageId, '<original@example.com>'); assert.match(result.text, /周二/);
});

for (const provider of ['qq', 'gmail', 'icloud']) test(`${provider}: first baseline, bounded new UID fetch and read-only mailbox`, async () => {
  let options; const requests = [];
  const client = { mailbox: { uidValidity: 7n, uidNext: 13, path: 'INBOX' },
    connect: async () => {}, logout: async () => {},
    getMailboxLock: async (_, open) => { assert.equal(open.readOnly, true); return { release() {} }; },
    fetch: async function* (range, _, query) { requests.push(range); assert.equal(query.uid, true); yield { uid: 11, source: mime }; } };
  const mailbox = new ImapMailbox({ id: provider, provider, email: 'owner@example.com', passwordEnv: 'TEST_PASSWORD' },
    { env: { TEST_PASSWORD: 'synthetic-only' }, clientFactory: value => { options = value; return client; } });
  assert.equal((await mailbox.scan(null)).baseline, true); assert.equal(requests.length, 0);
  const result = await mailbox.scan({ validity: '7', lastUid: 10 }, 1);
  assert.equal(result.cursor.lastUid, 11); assert.equal(result.messages[0].sourceId, '7:11'); assert.equal(requests[0], '11:11');
  assert.equal(options.secure, true); assert.equal(options.port, 993); assert.equal(options.logger, false);
  client.mailbox.uidNext = 11;
  assert.equal((await mailbox.scan({ validity: '7', lastUid: 10 })).messages.length, 0);
  await assert.rejects(mailbox.scan({ validity: '6', lastUid: 10 }), /UIDVALIDITY/);
});

test('Outlook paginated baseline skips history, then captures incremental mail with immutable IDs', async () => {
  const requests = [];
  const values = [
    { value: [{ id: 'old-1' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next1' },
    { value: [{ id: 'old-2' }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta1' },
    { value: [{ id: 'new-1', subject: '新邮件', from: { emailAddress: { address: 'client@example.com' } }, body: { content: '请回复' } }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta2' },
  ];
  const mailbox = new OutlookMailbox({ id: 'outlook' }, '.', { auth: { token: async () => 'fake-token' },
    fetchImpl: async (url, options) => { requests.push({ url, options }); return { ok: true, status: 200, json: async () => values.shift() }; } });
  const first = await mailbox.scan(null); assert.equal(first.messages.length, 0); assert.equal(first.cursor.baselining, true);
  const second = await mailbox.scan(first.cursor); assert.equal(second.messages.length, 0); assert.equal(second.cursor.baselining, false);
  const third = await mailbox.scan(second.cursor); assert.equal(third.messages[0].sourceId, 'new-1');
  assert.match(requests[2].options.headers.Prefer, /ImmutableId/);
  await assert.rejects(mailbox.request('https://example.com/steal-token'), /分页地址/);
});

test('Outlook replies use original conversation, not an AI-selected recipient', async () => {
  let request;
  const mailbox = new OutlookMailbox({ id: 'outlook' }, '.', { auth: { token: async () => 'fake-token' },
    fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, status: 202 }; } });
  assert.equal((await mailbox.sendReply({ sourceId: 'original/id' }, '您好')).status, 'accepted');
  assert.match(request.url, /original%2Fid\/reply$/); assert.equal(JSON.parse(request.options.body).message.body.content, '您好');
});

test('SMTP integration actually delivers a MIME reply to a local test server', async t => {
  let received;
  const server = new SMTPServer({ authOptional: true, disabledCommands: ['AUTH', 'STARTTLS'],
    onData(stream, session, done) { const chunks = []; stream.on('data', value => chunks.push(value)); stream.on('end', () => { received = { source: Buffer.concat(chunks), envelope: session.envelope }; done(); }); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.server.address().port;
  const mailbox = new ImapMailbox({ id: 'qq', provider: 'qq', email: 'owner@example.com', passwordEnv: 'TEST_PASSWORD' },
    { env: { TEST_PASSWORD: 'synthetic-only' }, transportFactory: () => nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, ignoreTLS: true }) });
  const original = await parseMime(mime, { sourceId: '7:1' });
  const receipt = await mailbox.sendReply(original, '周三方便。'); assert.equal(receipt.status, 'accepted');
  const parsed = await parseMime(received.source, { sourceId: 'sent' });
  assert.equal(received.envelope.rcptTo[0].address, 'reply@example.com');
  assert.match(parsed.text, /周三方便/);
  assert.match(received.source.toString(), /In-Reply-To: <original@example.com>/);
});
