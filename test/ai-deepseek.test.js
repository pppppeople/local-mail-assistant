import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MailAI } from '../src/ai.js';

const SUMMARY = { summary: '一封会议确认邮件', actions: [], needsReply: true, urgency: 'normal', category: 'meeting', replyReason: 'explicit_request', replyEvidence: '请确认是否可以开会' };

function withKey(t) {
  const previous = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous; });
}

test('deepseek provider posts JSON-mode chat completion and validates summary', async t => {
  withKey(t);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-mail-ai-ds-')); t.after(() => fs.rmSync(runtime, { recursive: true, force: true }));
  let url; let options;
  const ai = new MailAI({ provider: 'deepseek', timeoutMs: 5000 }, runtime, {
    fetchImpl: async (u, o) => { url = u; options = o; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify(SUMMARY) } }] }) }; },
  });
  const result = await ai.summarize({ subject: '确认会议', text: '请确认下周二是否可以开会' });
  assert.equal(result.summary, SUMMARY.summary); assert.equal(result.needsReply, true);
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(options.headers.Authorization, 'Bearer test-key');
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'deepseek-flash'); assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /只输出指定 JSON/); assert.match(body.messages[0].content, /JSON Schema/); assert.match(body.messages[0].content, /urgency/);
});

test('deepseek provider surfaces HTTP failures and missing key', async t => {
  withKey(t);
  const failing = new MailAI({ provider: 'deepseek' }, '.', { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  await assert.rejects(failing.summarize({ text: 'x' }), /HTTP 500/);
  delete process.env.DEEPSEEK_API_KEY;
  const keyless = new MailAI({ provider: 'deepseek' }, '.', { fetchImpl: async () => { throw new Error('must not be called'); } });
  await assert.rejects(keyless.summarize({ text: 'x' }), /DEEPSEEK_API_KEY/);
});
