import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, RUNTIME, privateDirectory, loadConfig } from '../src/config.js';

if (process.platform !== 'darwin') throw new Error('此安装入口用于 macOS LaunchAgent');
const config = loadConfig();
if (!config.accounts.some(account => account.enabled)) throw new Error('请先完成邮箱授权');
const label = 'com.pp.mail-assistant';
const directory = path.join(os.homedir(), 'Library', 'LaunchAgents');
const target = path.join(directory, `${label}.plist`);
const logs = path.join(RUNTIME, 'logs');
privateDirectory(logs); fs.mkdirSync(directory, { recursive: true });
if (fs.existsSync(target)) {
  const backups = path.join(RUNTIME, 'backups'); privateDirectory(backups);
  fs.copyFileSync(target, path.join(backups, `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.plist`));
}
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const env = { HOME: os.homedir(), PATH: process.env.PATH, MAIL_ASSISTANT_HOME: RUNTIME,
  ...(process.env.MAIL_ASSISTANT_CONFIG ? { MAIL_ASSISTANT_CONFIG: process.env.MAIL_ASSISTANT_CONFIG } : {}) };
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(ROOT, 'src', 'cli.js'))}</string><string>run</string></array>
<key>WorkingDirectory</key><string>${xml(ROOT)}</string>
<key>EnvironmentVariables</key><dict>${Object.entries(env).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'service-error.log'))}</string>
</dict></plist>`;
for (const name of ['service.log', 'service-error.log']) {
  const file = path.join(logs, name); fs.closeSync(fs.openSync(file, 'a', 0o600)); fs.chmodSync(file, 0o600);
}
fs.writeFileSync(target, plist, { mode: 0o600 }); fs.chmodSync(target, 0o600);
const domain = `gui/${process.getuid()}`;
try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'pipe' }); } catch {}
execFileSync('launchctl', ['bootstrap', domain, target], { stdio: 'pipe' });
console.log('邮件监听已安装为当前用户的登录服务；运行结果请用 npm run status 和页面核实。');
