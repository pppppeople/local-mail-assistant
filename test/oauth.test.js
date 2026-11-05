import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MicrosoftAuth } from '../src/mail/oauth.js';
import { savePrivateJson } from '../src/config.js';

function environment(t) {
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mail-oauth-'));
  t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  return { runtime, account: { id: 'outlook', email: 'owner@example.com', oauth: { clientId: 'test-client', tenant: 'consumers' } } };
}

test('expired Microsoft token rotates refresh credentials and preserves account binding', async t => {
  const { runtime, account } = environment(t); let parameters;
  const auth = new MicrosoftAuth(account, runtime, async (_, options) => {
    parameters = options.body;
    return { ok: true, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }) };
  });
  savePrivateJson(auth.file, { access_token: 'old-access', refresh_token: 'old-refresh', expiresAt: 0, accountEmail: account.email });
  assert.equal(await auth.token(), 'new-access'); assert.equal(parameters.get('grant_type'), 'refresh_token');
  assert.match(parameters.get('scope'), /User.Read/);
  assert.equal(JSON.parse(fs.readFileSync(auth.file)).refresh_token, 'new-refresh');
  assert.equal(fs.statSync(auth.file).mode & 0o777, 0o600);
});

test('an OAuth token bound to another mailbox is not used', async t => {
  const { runtime, account } = environment(t); let called = false;
  const auth = new MicrosoftAuth(account, runtime, async () => { called = true; });
  savePrivateJson(auth.file, { access_token: 'wrong-access', expiresAt: Date.now() + 3600000, accountEmail: 'other@example.com' });
  await assert.rejects(auth.token(), /绑定/); assert.equal(called, false);
});

test('device authorization verifies identity before persisting tokens', async t => {
  const { runtime, account } = environment(t);
  const auth = new MicrosoftAuth(account, runtime, async url => {
    const data = url.endsWith('/devicecode') ? { verification_uri: 'https://microsoft.com/devicelogin', user_code: 'SYNTHETIC', device_code: 'synthetic', expires_in: 30, interval: 0.001 }
      : url.endsWith('/token') ? { access_token: 'synthetic', refresh_token: 'synthetic', expires_in: 3600 }
        : { mail: 'other@example.com', userPrincipalName: 'other@example.com' };
    return { ok: true, json: async () => data };
  });
  await assert.rejects(auth.authorize(() => {}), /账户与配置/); assert.equal(fs.existsSync(auth.file), false);
});
