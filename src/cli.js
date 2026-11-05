#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RUNTIME, CONFIG_FILE, loadConfig, savePrivateJson } from './config.js';
import { Store } from './store.js';
import { MailAI } from './ai.js';
import { WechatNotifier } from './notifications/wechat.js';
import { MailService, mailboxFactory } from './service.js';
import { parseMailCommand, executeMailCommand } from './commands.js';
import { MicrosoftAuth } from './mail/oauth.js';
import { createMailPortal, portalAccessCode } from './portal.js';
import { execFileSync } from 'node:child_process';

async function stdinText() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 20000) throw new Error('输入过长');
  }
  return input;
}

async function main() {
  const [action = 'status', ...args] = process.argv.slice(2);
  if (action === 'init') {
    if (fs.existsSync(CONFIG_FILE)) { console.log('配置已存在，保留现役文件。'); return; }
    savePrivateJson(CONFIG_FILE, JSON.parse(fs.readFileSync(path.join(ROOT, 'config/accounts.example.json'), 'utf8')));
    console.log(`已创建配置：${CONFIG_FILE}\n默认所有邮箱关闭。授权码留在本机，不要贴进聊天。`);
    return;
  }
  if (!fs.existsSync(CONFIG_FILE)) throw new Error('尚未配置邮箱，请先运行 npm run init');
  const secrets = path.join(RUNTIME, 'config', 'secrets.env');
  if (fs.existsSync(secrets)) process.loadEnvFile(secrets);
  const config = loadConfig();
  if (action === 'web-copy-code') {
    execFileSync('pbcopy', { input: portalAccessCode(RUNTIME) });
    console.log('私人页面访问码已复制到剪贴板。'); return;
  }
  if (action === 'auth-outlook') {
    const account = config.accounts.find(a => a.id === args[0] && a.provider === 'outlook');
    if (!account) throw new Error('请指定 Outlook 邮箱 id');
    const auth = new MicrosoftAuth(account, RUNTIME);
    await auth.authorize(code => console.log(`请在浏览器打开 ${code.url}，输入代码 ${code.code}`));
    console.log('授权完成，账户身份已核实。'); return;
  }
  const store = new Store(path.join(RUNTIME, 'state', 'mail.sqlite'));
  const service = new MailService({ store, config, ai: new MailAI(config.ai || {}, RUNTIME),
    notifier: new WechatNotifier({ bridgeDir: config.notification?.bridgeDir }), createMailbox: mailboxFactory(RUNTIME) });
  try {
    if (action === 'status') { console.log(JSON.stringify(service.status(), null, 2)); return; }
    if (action === 'wechat') {
      const command = parseMailCommand(await stdinText());
      if (!command) throw new Error('不识别的邮件命令');
      try { console.log(await executeMailCommand(service, command)); }
      catch (error) { console.log(`这次邮件操作没有完成：${error.message}`); }
      return;
    }
    if (action === 'poll') { console.log(JSON.stringify(await service.poll(), null, 2)); return; }
    if (action === 'baseline-reset') {
      if (!args[0] || args[1] !== '--confirm-skip-existing') throw new Error('重建基线会跳过现有邮件，需要指定邮箱 id 和 --confirm-skip-existing');
      service.account(args[0]);
      store.db.prepare('DELETE FROM cursors WHERE account=?').run(args[0]);
      console.log('下次扫描重新建立基线，现有邮件不会通知。'); return;
    }
    if (!['run', 'web'].includes(action)) throw new Error('用法：init | status | poll | run | web | web-copy-code | wechat | auth-outlook <id>');
    if (!config.accounts.some(a => a.enabled)) throw new Error('尚未启用邮箱，未启动空服务');
    let server;
    if (config.web?.enabled || action === 'web') {
      server = createMailPortal({ service, accessCode: portalAccessCode(RUNTIME), port: config.web?.port, publicUrl: config.web?.publicUrl });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.web?.port || 8768, '127.0.0.1', resolve); });
      console.log(`私人邮件页面已在本机端口 ${config.web?.port || 8768} 启动。`);
    }
    let stopping = false;
    let wake;
    const stop = () => { stopping = true; wake?.(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    while (!stopping && action === 'run') {
      try {
        const result = await service.poll();
        console.log(JSON.stringify({ at: new Date().toISOString(), ...result }));
      } catch { console.error('邮件扫描未完成，请检查状态。'); }
      if (!stopping) await new Promise(resolve => { wake = resolve; const timer = setTimeout(resolve, config.pollSeconds * 1000); wake = () => { clearTimeout(timer); resolve(); }; });
    }
    if (action === 'web') await new Promise(resolve => { wake = resolve; });
    if (server) await new Promise(resolve => server.close(resolve));
  } finally { store.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
