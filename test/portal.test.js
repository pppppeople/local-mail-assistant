import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { MailService } from '../src/service.js';
import { createMailPortal } from '../src/portal.js';

test('remembered login survives server recreation and logout revokes it for all instances', async t => {
  const store = new Store(':memory:'); const service = { store, config: {}, status: () => ({ ok: true }) };
  let now = 1000000; const servers = [];
  t.after(async () => { for (const server of servers) await new Promise(resolve => server.close(resolve)); store.close(); });
  const start = async () => {
    const server = createMailPortal({ service, accessCode: 'synthetic-code', port: 0, now: () => now });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  };
  const first = await start();
  const login = await fetch(first + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: first }, body: JSON.stringify({ code: 'synthetic-code', remember: true }) });
  assert.match(login.headers.get('set-cookie'), /Max-Age=2592000/);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const second = await start(); now += 3 * 24 * 3600000;
  assert.equal((await fetch(second + '/api/status', { headers: { Cookie: cookie } })).status, 200);
  await fetch(second + '/api/logout', { method: 'POST', headers: { Origin: second, Cookie: cookie } });
  assert.equal((await fetch(first + '/api/status', { headers: { Cookie: cookie } })).status, 401);
});

test('owner portal auth, origin checks, edits and explicit version confirmation preserve send authority', async t => {
  const store = new Store(':memory:');
  let sends = 0;
  store.ingest('test', [{ sourceId: 'one', subject: '<script>bad</script>', from: 'synthetic@example.com', replyTo: 'reply@example.com', text: '<img onerror=bad>', attachments: [], accountEmail: 'owner@example.com' }], {});
  const service = new MailService({ store, config: { accounts: [{ id: 'test', email: 'owner@example.com', provider: 'gmail', enabled: true }] },
    ai: { draft: async () => '合成草稿' }, createMailbox: () => ({ sendReply: async () => { sends++; return { status: 'accepted' }; } }) });
  const server = createMailPortal({ service, accessCode: 'synthetic-access', port: 0 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, cookie = '', origin = base) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + '/api/mail')).status, 401);
  assert.equal((await post('/api/session', { code: 'wrong' })).status, 401);
  assert.equal((await post('/api/session', { code: 'synthetic-access' }, '', 'https://bad.example')).status, 403);
  const login = await post('/api/session', { code: 'synthetic-access' }); const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/mail', { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await post('/api/mail/1/draft', { instruction: '合成要求' }, cookie)).status, 200); assert.equal(sends, 0);
  assert.equal((await post('/api/mail/1/edit', { revision: 1, body: '修改后的正文' }, cookie)).status, 200); assert.equal(store.draft(1).revision, 2);
  assert.equal((await post('/api/mail/1/cancel', { revision: 1 }, cookie)).status, 400);
  assert.equal((await post('/api/mail/1/confirm', { revision: 2 }, cookie)).status, 400);
  assert.equal((await post('/api/mail/1/confirm', { revision: 1, confirm: true }, cookie)).status, 400);
  assert.equal((await post('/api/mail/1/confirm', { revision: 2, confirm: true }, cookie, 'https://bad.example')).status, 403);
  assert.equal(sends, 0);
  assert.equal((await post('/api/mail/1/confirm', { revision: 2, confirm: true }, cookie)).status, 200); assert.equal(sends, 1);
  assert.equal((await post('/api/mail/1/confirm', { revision: 2, confirm: true }, cookie)).status, 400); assert.equal(sends, 1);
  assert.equal((await post('/api/logout', {}, cookie)).status, 200);
  assert.equal((await fetch(base + '/api/mail', { headers: { Cookie: cookie } })).status, 401);
});
