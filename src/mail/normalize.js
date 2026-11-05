import { simpleParser } from 'mailparser';

export async function parseMime(source, { sourceId, folder = 'INBOX', receivedAt } = {}) {
  const parsed = await simpleParser(source, { skipHtmlToText: false, skipTextToHtml: true });
  return {
    sourceId, folder, subject: parsed.subject || '（无主题）',
    from: parsed.from?.value?.[0]?.address || '',
    fromName: parsed.from?.value?.[0]?.name || '',
    replyTo: parsed.replyTo?.value?.[0]?.address || parsed.from?.value?.[0]?.address || '',
    to: (parsed.to?.value || []).map(item => item.address),
    text: (parsed.text || '').slice(0, 40000),
    messageId: parsed.messageId || '', references: parsed.references || [],
    receivedAt: receivedAt || parsed.date?.toISOString() || new Date().toISOString(),
    attachments: (parsed.attachments || []).map(a => ({ name: a.filename || '附件', size: a.size, type: a.contentType })),
  };
}

export function normalizeGraph(message) {
  return {
    sourceId: message.id, folder: 'inbox', subject: message.subject || '（无主题）',
    from: message.from?.emailAddress?.address || '', fromName: message.from?.emailAddress?.name || '',
    replyTo: message.replyTo?.[0]?.emailAddress?.address || message.from?.emailAddress?.address || '',
    to: (message.toRecipients || []).map(item => item.emailAddress.address),
    text: (message.body?.content || message.bodyPreview || '').slice(0, 40000),
    messageId: message.internetMessageId || '', references: [], receivedAt: message.receivedDateTime,
    attachments: message.hasAttachments ? [{ name: '邮件包含附件（未读取）' }] : [],
  };
}
