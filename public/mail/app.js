const $ = id => document.getElementById(id);
const categories = { notification: '通知邮件', meeting: '会议邀请', transaction: '账单与交易', security: '账号与安全', promotion: '推广与订阅', conversation: '沟通与工作请求', other: '其他邮件' };
const states = { review: '待审核', cancelled: '已取消', sent: '服务器已接受发送', sending: '发送中／结果待核实', unknown: '发送结果待核实' };
let mails = []; let current = null;
function notice(text = '') { $('notice').textContent = text; }
async function api(url, body) {
  const response = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (response.status === 401) showLogin();
  if (!response.ok) throw new Error(result.error || '操作未完成');
  return result;
}
function showLogin() { $('login').hidden = false; $('workspace').hidden = true; $('logout').hidden = true; $('refresh').hidden = true; current = null; mails = []; $('detail').replaceChildren(); $('mail-list').replaceChildren(); }
function element(tag, text, className) { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; }
function renderList() {
  $('mail-list').replaceChildren();
  for (const mail of mails.filter(m => !$('category').value || m.summary?.category === $('category').value)) {
    const button = element('button', '', `mail-item${current?.id === mail.id ? ' active' : ''}`);
    button.append(element('span', `#${mail.id} · ${categories[mail.summary?.category] || '分析中'}`, 'tag'), element('strong', mail.subject), element('small', mail.fromName || mail.from));
    button.addEventListener('click', () => openMail(mail.id).catch(error => notice(error.message))); $('mail-list').append(button);
  }
  if (!$('mail-list').children.length) $('mail-list').append(element('p', '暂无邮件记录。', 'hint'));
}
async function reload() {
  const [list, status] = await Promise.all([api('/api/mail'), api('/api/status')]);
  mails = list; $('login').hidden = true; $('workspace').hidden = false; $('logout').hidden = false; $('refresh').hidden = false;
  $('status').textContent = `常规邮件 ${status.digestHours.map(h => `${h}:00`).join(' / ')} 汇总 · 待汇总 ${status.pendingDigest} 封 · 待推送 ${status.pendingNotifications} 条`;
  renderList();
  const id = Number(location.hash.match(/^#mail-(\d+)$/)?.[1]) || current?.id || mails[0]?.id;
  if (id) await openMail(id);
}
async function openMail(id) { current = await api(`/api/mail/${id}`); location.hash = `mail-${id}`; renderDetail(); renderList(); }
function renderDetail() {
  const mail = current; const article = $('detail'); article.replaceChildren();
  article.append(element('span', categories[mail.summary?.category] || '正在分析', 'tag'), element('h2', mail.subject));
  article.append(element('p', `收件邮箱：${mail.accountEmail}\n发件人：${mail.fromName ? `${mail.fromName} · ` : ''}${mail.from}\n回复收件人：${mail.replyTo || '未提供'}`, 'meta body'));
  article.append(element('h3', '摘要'), element('div', mail.summary?.summary || '尚未生成摘要；原文已入库。', 'summary'));
  if (mail.summary?.actions.length) { const list = element('ul', '', 'actions'); for (const action of mail.summary.actions) list.append(element('li', action)); article.append(list); }
  if (mail.summary?.needsReply) article.append(element('p', `建议回复的依据：${mail.summary.replyEvidence}`, 'hint'));
  const original = element('details'); original.append(element('summary', '查看原邮件')); original.append(element('pre', mail.text, 'body'));
  if (mail.attachments?.length) original.append(element('p', `附件：${mail.attachments.map(a => a.name).join('、')}（未读取内容）`, 'hint')); article.append(original);
  const section = element('section', '', 'draft'); section.append(element('h3', '回复草稿'));
  if (mail.draft) {
    section.append(element('p', `第 ${mail.draft.revision} 版 · ${states[mail.draft.state] || mail.draft.state}`, 'hint'));
    const editor = element('textarea'); editor.value = mail.draft.body; editor.setAttribute('aria-label', '回复草稿正文'); section.append(editor);
    const review = mail.draft.state === 'review'; editor.readOnly = !review;
    if (review) {
      const controls = element('div', '', 'controls');
      const save = element('button', '保存修改为新版本'); const send = element('button', `确认发送第 ${mail.draft.revision} 版`, 'primary'); const cancel = element('button', '取消草稿');
      save.onclick = () => operation(save, 'edit', { revision: mail.draft.revision, body: editor.value });
      send.onclick = () => {
        if (editor.value !== mail.draft.body) return notice('正文已修改，请先保存为新版本，再检查并确认发送。');
        if (window.confirm(`确认从 ${mail.accountEmail} 发给 ${mail.replyTo}？\n发送的是刚展示的第 ${mail.draft.revision} 版。`)) operation(send, 'confirm', { revision: mail.draft.revision, confirm: true });
      };
      cancel.onclick = () => operation(cancel, 'cancel', { revision: mail.draft.revision }); controls.append(save, send, cancel); section.append(controls);
    } else if (['sending', 'unknown'].includes(mail.draft.state)) section.append(element('p', '请先检查邮箱已发送记录；系统不会自动重发。', 'hint'));
  }
  if (!mail.draft || ['review', 'cancelled'].includes(mail.draft.state)) {
    const label = element('label', '按你的意思拟稿'); const instruction = element('textarea'); instruction.placeholder = '例如：告诉他周三下午有空，礼貌确认地点。'; instruction.setAttribute('aria-label', '回复意思');
    const draft = element('button', mail.draft ? '重新拟稿为新版本' : '生成回复草稿', 'primary'); draft.onclick = () => operation(draft, 'draft', { instruction: instruction.value });
    section.append(label, instruction, element('p', '拟稿不会发送。发送前会展示发件邮箱、收件人和草稿版本。', 'hint'), draft);
  }
  article.append(section);
}
async function operation(button, action, body) {
  button.disabled = true; notice(action === 'draft' ? '正在拟稿，请稍等…' : '正在处理…');
  try { const result = await api(`/api/mail/${current.id}/${action}`, body); current = result.mail; renderDetail(); notice(result.message || (action === 'edit' ? '修改已保存为新版本，请检查后确认。' : '操作完成。')); }
  catch (error) { notice(error.message); } finally { button.disabled = false; }
}
$('login-form').onsubmit = async event => { event.preventDefault(); try { await api('/api/session', { code: $('code').value.trim(), remember: $('remember').checked }); $('code').value = ''; notice(); await reload(); } catch (error) { notice(error.message); } };
$('category').onchange = renderList;
$('refresh').onclick = () => reload().then(() => notice()).catch(error => notice(error.message));
$('logout').onclick = () => api('/api/logout', {}).then(() => { showLogin(); notice(); });
reload().catch(error => { if (!error.message.includes('访问码')) notice(error.message); });
