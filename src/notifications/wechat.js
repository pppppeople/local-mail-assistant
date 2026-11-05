import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../config.js';

export function runNotify(command, args, options, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('微信通知超时')); }, options.timeout);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', () => {}); // Do not echo provider details into mail logs.
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', () => {});
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve({ stdout }) : reject(new Error('微信通知暂未送达')); });
    child.stdin.end(input);
  });
}
export class WechatNotifier {
  constructor({ bridgeDir = process.env.MAIL_WECHAT_BRIDGE_DIR, runCommand = runNotify } = {}) {
    this.bridgeDir = bridgeDir; this.runCommand = runCommand;
  }
  async send(text, { clientId } = {}) {
    if (!this.bridgeDir) throw new Error('Configure an explicit compatible notification adapter path first');
    const { stdout } = await this.runCommand(process.execPath, [path.join(this.bridgeDir, 'scripts', 'mail-notify.js')],
      { cwd: this.bridgeDir, timeout: 30000 }, JSON.stringify({ text, clientId }));
    let result;
    try { result = JSON.parse(stdout.trim()); } catch { throw new Error('微信未返回有效发送回执'); }
    if (typeof result.ret !== 'number' || result.ret !== 0) throw new Error('微信未确认发送成功，通知保留等待重试');
    return { accepted: true };
  }
}
