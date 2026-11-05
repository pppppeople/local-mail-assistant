import { MicrosoftAuth } from './oauth.js';
import { normalizeGraph } from './normalize.js';

export class OutlookMailbox {
  constructor(account, runtime, { fetchImpl = fetch, auth = new MicrosoftAuth(account, runtime, fetchImpl) } = {}) {
    this.account = account; this.fetch = fetchImpl; this.auth = auth;
  }
  async request(url, options = {}) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://graph.microsoft.com') throw new Error('拒绝无效 Graph 分页地址');
    const response = await this.fetch(url, { ...options,
      headers: { Authorization: `Bearer ${await this.auth.token()}`, 'Content-Type': 'application/json',
        Prefer: 'IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=50', ...options.headers },
      signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Microsoft Graph HTTP ${response.status}（请求未完成）`);
    return response.status === 202 || response.status === 204 ? null : response.json();
  }
  async scan(cursor, limit = 50) {
    const select = 'id,subject,from,replyTo,toRecipients,body,internetMessageId,receivedDateTime,hasAttachments';
    const initial = `https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?changeType=created&$select=${select}`;
    let url = cursor?.nextLink || cursor?.deltaLink || initial;
    const baselining = !cursor || cursor.baselining === true;
    const messages = [];
    const page = await this.request(url, { headers: { Prefer: `IdType="ImmutableId", outlook.body-content-type="text", odata.maxpagesize=${limit}` } });
    for (const item of page.value || []) if (!baselining && !item['@removed']) messages.push(normalizeGraph(item));
    if (!page['@odata.nextLink'] && !page['@odata.deltaLink']) throw new Error('Graph 未返回同步游标');
    return { messages, baseline: baselining,
      cursor: page['@odata.nextLink'] ? { nextLink: page['@odata.nextLink'], baselining } : { deltaLink: page['@odata.deltaLink'], baselining: false } };
  }
  async sendReply(mail, body) {
    const message = encodeURIComponent(mail.sourceId);
    // Graph's native reply preserves the conversation and honors Reply-To.
    await this.request(`https://graph.microsoft.com/v1.0/me/messages/${message}/reply`, {
      method: 'POST', body: JSON.stringify({ message: { body: { contentType: 'Text', content: body } } }) });
    return { status: 'accepted', id: mail.sourceId };
  }
}
