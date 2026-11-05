import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const privateHome = process.env.MAIL_ASSISTANT_BASE || path.join(os.homedir(), '.local', 'share');
export const RUNTIME = path.resolve(process.env.MAIL_ASSISTANT_HOME || path.join(privateHome, 'pp-mail-assistant', 'runtime'));
export const CONFIG_FILE = path.resolve(process.env.MAIL_ASSISTANT_CONFIG || path.join(RUNTIME, 'config', 'config.json'));
export const PRESETS = {
  qq: { imap: 'imap.qq.com', smtp: 'smtp.qq.com', smtpPort: 465, smtpSecure: true },
  gmail: { imap: 'imap.gmail.com', smtp: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true },
  icloud: { imap: 'imap.mail.me.com', smtp: 'smtp.mail.me.com', smtpPort: 587, smtpSecure: false },
};

export function loadConfig(file = CONFIG_FILE) {
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (config.ai?.provider && !['codex', 'deepseek'].includes(config.ai.provider)) throw new Error('当前模型适配器支持 codex 或 deepseek');
  if (config.notification?.provider && config.notification.provider !== 'wechat') throw new Error('当前通知渠道支持 wechat');
  if (!Array.isArray(config.accounts)) throw new Error('配置缺少 accounts');
  const ids = new Set();
  for (const account of config.accounts) {
    if (!/^[a-zA-Z0-9_-]+$/.test(account.id || '') || ids.has(account.id)) throw new Error('邮箱 id 必须唯一且只含字母、数字、下划线或短横线');
    ids.add(account.id);
    if (!PRESETS[account.provider] && account.provider !== 'outlook') throw new Error(`不支持的邮箱类型：${account.provider}`);
    if (!/^[^\s<>@]+@[^\s<>@]+$/.test(account.email || '')) throw new Error(`邮箱 ${account.id} 地址无效`);
    if (account.provider === 'outlook' && account.enabled && !account.oauth?.clientId) throw new Error('Outlook 必须配置 OAuth clientId');
  }
  const pollSeconds = Number(config.pollSeconds ?? 60);
  const maxMessagesPerPoll = Number(config.maxMessagesPerPoll ?? 50);
  if (!Number.isFinite(pollSeconds) || pollSeconds < 10) throw new Error('pollSeconds 至少为 10');
  if (!Number.isInteger(maxMessagesPerPoll) || maxMessagesPerPoll < 1 || maxMessagesPerPoll > 200) throw new Error('每次处理数量应在 1–200');
  const digestHours = config.notification?.digestHours ?? [9, 18];
  if (!Array.isArray(digestHours) || !digestHours.length || digestHours.some((hour, i) => !Number.isInteger(hour) || hour < 0 || hour > 23 || (i && hour <= digestHours[i - 1]))) throw new Error('汇总时间应为升序的 0–23 点整数');
  if (config.web?.port !== undefined && (!Number.isInteger(config.web.port) || config.web.port < 1024 || config.web.port > 65535)) throw new Error('邮件页面端口无效');
  if (config.web?.publicUrl) {
    const url = new URL(config.web.publicUrl);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.ts.net') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('手机页面只支持私人 Tailscale HTTPS 根地址');
  }
  return { ...config, pollSeconds, maxMessagesPerPoll };
}

export function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

export function savePrivateJson(file, data) {
  privateDirectory(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

export function secretFor(account, env = process.env) {
  const password = env[account.passwordEnv || ''];
  if (!password) throw new Error(`邮箱 ${account.id} 缺少 ${account.passwordEnv || 'passwordEnv'} 授权码`);
  return account.provider === 'gmail' ? password.replace(/\s/g, '') : password;
}
