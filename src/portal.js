import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, savePrivateJson } from './config.js';

export function portalAccessCode(runtime) {
  const file = path.join(runtime, 'config', 'web-access.json');
  if (!fs.existsSync(file)) savePrivateJson(file, { code: crypto.randomBytes(24).toString('base64url') });
  return JSON.parse(fs.readFileSync(file, 'utf8')).code;
}

const assets = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
function equalSecret(a, b) {
  return typeof a === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('请求格式无效');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20000) throw new Error('请求过长');
  }
  return JSON.parse(body);
}
export function mailView(service, id, detail = false) {
  const mail = service.store.message(id);
  if (!mail) throw new Error('找不到这封邮件');
  const account = service.accountForMail(mail);
  const draft = service.store.draft(id);
  return { id: mail.id, provider: account.provider, accountEmail: account.email,
    subject: mail.data.subject, from: mail.data.from, fromName: mail.data.fromName || '',
    replyTo: mail.data.replyTo, date: mail.data.date || mail.data.receivedAt || '',
    summary: mail.summary, state: mail.state,
    ...(detail ? { text: mail.data.text, attachments: mail.data.attachments,
      draft: draft ? { revision: draft.revision, body: draft.body, state: draft.state } : null } : {}) };
}

export function createMailPortal({ service, accessCode, port = 8768, publicUrl = '', now = () => Date.now() }) {
  const sessions = service.store.db;
  const publicOrigin = publicUrl ? new URL(publicUrl).origin : '';
  const origins = () => [`http://127.0.0.1:${server.address()?.port || port}`, `http://localhost:${server.address()?.port || port}`, publicOrigin].filter(Boolean);
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (!origins().some(origin => new URL(origin).host === request.headers.host)) return send(403, { error: '访问地址未授权' });
      const url = new URL(request.url, 'http://localhost');
      if (request.method !== 'GET' && !origins().includes(request.headers.origin)) return send(403, { error: '请从邮件页面执行操作' });
      if (request.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname];
        response.writeHead(200, { 'Content-Type': type });
        return response.end(fs.readFileSync(path.join(ROOT, 'public', 'mail', file)));
      }
      if (request.method === 'POST' && url.pathname === '/api/session') {
        const body = await readJson(request);
        if (!equalSecret(body.code, accessCode)) return send(401, { error: '访问码不正确' });
        sessions.prepare('DELETE FROM web_sessions WHERE expires_at<=?').run(now());
        const token = crypto.randomBytes(32).toString('base64url');
        const maxAge = body.remember === true ? 30 * 24 * 3600 : 8 * 3600;
        sessions.prepare('INSERT INTO web_sessions VALUES (?,?)').run(token, now() + maxAge * 1000);
        response.setHeader('Set-Cookie', `pp_mail_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${request.headers.origin === publicOrigin ? '; Secure' : ''}`);
        return send(200, { ok: true });
      }
      const token = request.headers.cookie?.match(/(?:^|;\s*)pp_mail_session=([a-zA-Z0-9_-]+)/)?.[1];
      if (!token || (sessions.prepare('SELECT expires_at FROM web_sessions WHERE token=?').get(token)?.expires_at || 0) <= now()) return send(401, { error: '请先输入私人访问码' });
      if (request.method === 'POST' && url.pathname === '/api/logout') {
        sessions.prepare('DELETE FROM web_sessions WHERE token=?').run(token); response.setHeader('Set-Cookie', 'pp_mail_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return send(200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/status') return send(200, service.status());
      if (request.method === 'GET' && url.pathname === '/api/mail') return send(200, service.store.list(100).map(mail => mailView(service, mail.id)));
      const match = url.pathname.match(/^\/api\/mail\/(\d+)(?:\/(draft|edit|confirm|cancel))?$/);
      if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return send(404, { error: '页面不存在' });
      const id = Number(match[1]); const action = match[2];
      if (request.method === 'GET' && !action) return send(200, mailView(service, id, true));
      if (request.method !== 'POST' || !action) return send(405, { error: '操作方式无效' });
      const body = await readJson(request);
      if (action === 'draft') {
        if (typeof body.instruction !== 'string' || body.instruction.length > 5000) throw new Error('请填写回复意思（最多 5000 字符）');
        await service.draft(id, body.instruction);
      } else {
        if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw new Error('请确认展示的草稿版本');
        if (action === 'edit') service.editDraft(id, body.revision, body.body);
        if (action === 'confirm') {
          if (body.confirm !== true) throw new Error('需要你明确确认发送');
          const message = await service.confirm(id, body.revision);
          return send(200, { mail: mailView(service, id, true), message });
        }
        if (action === 'cancel') {
          // Same transaction prevents cancelling a newer draft from a stale tab.
          service.store.transaction(() => {
            if (service.store.draft(id)?.revision !== body.revision) throw new Error('草稿版本已改变，请刷新');
            if (!service.store.cancel(id)) throw new Error('没有可取消的待审核草稿');
          });
        }
      }
      return send(200, { mail: mailView(service, id, true) });
    } catch (error) {
      // Known operation validation is user-visible; parser/transport errors are not.
      const message = error instanceof SyntaxError ? '请求内容无效' : error.message;
      send(400, { error: message });
    }
  });
  server.requestTimeout = 150000;
  return server;
}
