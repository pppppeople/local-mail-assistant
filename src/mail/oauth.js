import fs from 'node:fs';
import path from 'node:path';
import { savePrivateJson } from '../config.js';

export class MicrosoftAuth {
  constructor(account, runtime, fetchImpl = fetch) {
    this.account = account; this.fetch = fetchImpl;
    this.file = path.join(runtime, 'config', 'oauth', `${account.id}.json`);
    const tenant = account.oauth?.tenant || 'consumers';
    if (!/^[a-zA-Z0-9-]+$/.test(tenant)) throw new Error('无效 Microsoft tenant');
    this.base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
    this.scope = 'offline_access https://graph.microsoft.com/User.Read https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.Send';
  }
  async post(endpoint, params) {
    const response = await this.fetch(`${this.base}/${endpoint}`, { method: 'POST',
      body: new URLSearchParams({ client_id: this.account.oauth.clientId, ...params }),
      signal: AbortSignal.timeout(30000) });
    const result = await response.json();
    if (!response.ok) { const error = new Error(`Microsoft OAuth：${result.error || response.status}`); error.code = result.error; throw error; }
    return result;
  }
  save(token) { savePrivateJson(this.file, { ...token, expiresAt: Date.now() + token.expires_in * 1000 }); }
  async token() {
    if (!fs.existsSync(this.file)) throw new Error(`邮箱 ${this.account.id} 尚未授权，请运行 auth-outlook`);
    const token = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (token.accountEmail !== this.account.email.toLowerCase()) throw new Error('OAuth 账户绑定与配置邮箱不一致，请重新授权');
    if (token.expiresAt > Date.now() + 60000) return token.access_token;
    const refreshed = await this.post('token', { grant_type: 'refresh_token', refresh_token: token.refresh_token, scope: this.scope });
    this.save({ ...refreshed, accountEmail: token.accountEmail, refresh_token: refreshed.refresh_token || token.refresh_token });
    return refreshed.access_token;
  }
  async authorize(onCode) {
    const code = await this.post('devicecode', { scope: this.scope });
    onCode({ url: code.verification_uri, code: code.user_code, expiresIn: code.expires_in });
    const until = Date.now() + code.expires_in * 1000;
    let seconds = code.interval || 5;
    while (Date.now() < until) {
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      try {
        const result = await this.post('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.device_code });
        const identityResponse = await this.fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', {
          headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(30000) });
        if (!identityResponse.ok) throw new Error('无法核实登录邮箱身份');
        const identity = await identityResponse.json();
        if (![identity.mail, identity.userPrincipalName].some(email => email?.toLowerCase() === this.account.email.toLowerCase())) throw new Error('授权账户与配置邮箱不一致，未保存令牌');
        this.save({ ...result, accountEmail: this.account.email.toLowerCase() }); return;
      } catch (error) {
        if (error.code === 'slow_down') seconds += 5;
        else if (error.code !== 'authorization_pending') throw error;
      }
    }
    throw new Error('Microsoft 登录已过期，请重新运行授权');
  }
}
