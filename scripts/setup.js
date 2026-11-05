import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';
import { ROOT, RUNTIME, CONFIG_FILE, savePrivateJson, privateDirectory } from '../src/config.js';

if (!process.stdin.isTTY) throw new Error('请在本机交互终端运行 npm run setup，授权码不会回显。');
let hidden = false;
const output = new Writable({ write(chunk, _, done) { if (!hidden) process.stdout.write(chunk); done(); } });
const terminal = readline.createInterface({ input: process.stdin, output, terminal: true });
const config = fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : JSON.parse(fs.readFileSync(path.join(ROOT, 'config/accounts.example.json'), 'utf8'));
const secretFile = path.join(RUNTIME, 'config', 'secrets.env');
if (fs.existsSync(secretFile)) process.loadEnvFile(secretFile);
const secrets = {};
for (const account of config.accounts) if (account.passwordEnv && process.env[account.passwordEnv]) secrets[account.passwordEnv] = process.env[account.passwordEnv];

try {
  console.log('配置四种邮箱；留空跳过。授权码只保存在本机私有运行目录。');
  for (const account of config.accounts) {
    const address = (await terminal.question(`${account.provider} 邮箱地址（留空保留现状）：`)).trim();
    if (!address) continue;
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(address)) throw new Error('邮箱地址无效，尚未保存本次配置');
    account.email = address;
    if (account.provider === 'outlook') {
      account.oauth.clientId = (await terminal.question('Microsoft 应用 clientId（需启用公共客户端/设备代码登录）：')).trim();
      if (!account.oauth.clientId) throw new Error('Outlook clientId 不能为空');
      account.enabled = true;
    } else {
      process.stdout.write(`${account.provider} 应用专用密码/授权码（不回显，留空沿用）：`);
      hidden = true;
      const password = (await terminal.question('')).trim();
      hidden = false; process.stdout.write('\n');
      if (password) secrets[account.passwordEnv] = account.provider === 'gmail' ? password.replace(/\s/g, '') : password;
      if (!secrets[account.passwordEnv]) throw new Error('尚未提供授权码，该邮箱无法启用');
      account.enabled = true;
    }
  }
  savePrivateJson(CONFIG_FILE, config);
  privateDirectory(path.dirname(secretFile));
  // dotenv double-quoted values are suitable for provider-generated app passwords.
  fs.writeFileSync(secretFile, Object.entries(secrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600 });
  fs.chmodSync(secretFile, 0o600);
  console.log('已保存本机配置。Outlook 还需运行 npm run mail -- auth-outlook outlook-personal。');
} finally { hidden = false; terminal.close(); }
