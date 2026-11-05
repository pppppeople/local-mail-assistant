import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { privateDirectory } from './config.js';

export class Store {
  constructor(file) {
    if (file !== ':memory:') privateDirectory(path.dirname(file));
    this.db = new DatabaseSync(file);
    if (file !== ':memory:') fs.chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS cursors (account TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY, account TEXT NOT NULL, source_id TEXT NOT NULL,
        data TEXT NOT NULL, summary TEXT, state TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(account, source_id));
      CREATE TABLE IF NOT EXISTS drafts (
        message_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'review', receipt TEXT);
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, kind TEXT NOT NULL,
        text TEXT NOT NULL, client_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0, UNIQUE(message_id, kind));
      CREATE TABLE IF NOT EXISTS health (account TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS digest_items (message_id INTEGER PRIMARY KEY, due_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS web_sessions (token TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);`);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  cursor(account) { const row = this.db.prepare('SELECT data FROM cursors WHERE account=?').get(account); return row ? JSON.parse(row.data) : null; }
  cursorSet(account, cursor) { this.db.prepare('INSERT OR REPLACE INTO cursors VALUES (?,?)').run(account, JSON.stringify(cursor)); }
  ingest(account, messages, cursor) {
    return this.transaction(() => {
      let added = 0;
      for (const mail of messages) added += Number(this.db.prepare('INSERT OR IGNORE INTO messages(account,source_id,data) VALUES (?,?,?)').run(account, mail.sourceId, JSON.stringify(mail)).changes);
      this.cursorSet(account, cursor);
      return added;
    });
  }
  message(id) {
    const row = this.db.prepare('SELECT * FROM messages WHERE id=?').get(id);
    return row ? { ...row, data: JSON.parse(row.data), summary: row.summary ? JSON.parse(row.summary) : null } : null;
  }
  list(limit = 20) { return this.db.prepare('SELECT id FROM messages ORDER BY id DESC LIMIT ?').all(limit).map(row => this.message(row.id)); }
  pendingAnalysis() { return this.db.prepare("SELECT id FROM messages WHERE state='new' ORDER BY id LIMIT 50").all().map(row => this.message(row.id)); }
  analyzed(id, summary, text, dueAt = null) {
    this.transaction(() => {
      this.db.prepare("UPDATE messages SET summary=?,state='ready' WHERE id=?").run(JSON.stringify(summary), id);
      if (dueAt === null) this.notify(id, 'summary', text);
      else this.db.prepare('INSERT OR IGNORE INTO digest_items VALUES (?,?)').run(id, dueAt);
    });
  }
  flushDigests(now, format) {
    return this.transaction(() => {
      const rows = this.db.prepare('SELECT message_id FROM digest_items WHERE due_at<=? ORDER BY message_id').all(now);
      // One compact grouped digest per schedule, regardless of mail volume.
      if (rows.length) {
        this.notify(rows[0].message_id, `digest:${rows[0].message_id}`, format(rows.map(row => this.message(row.message_id))));
        for (const row of rows) this.db.prepare('DELETE FROM digest_items WHERE message_id=?').run(row.message_id);
      }
      return rows.length;
    });
  }
  notify(id, kind, text) {
    // Persist each independently delivered chunk, so a retry resumes only the
    // unsent suffix. Stable client IDs also survive a daemon restart.
    const value = String(text);
    for (let offset = 0, part = 1; offset < value.length; offset += 1600, part++) {
      this.db.prepare('INSERT OR IGNORE INTO notifications(message_id,kind,text,client_id) VALUES (?,?,?,?)')
        .run(id, `${kind}:${part}`, value.slice(offset, offset + 1600), `pp-mail:${crypto.randomUUID()}`);
    }
  }
  pendingNotifications() { return this.db.prepare("SELECT * FROM notifications WHERE state='pending' AND retry_at<=? ORDER BY id LIMIT 50").all(Date.now()); }
  notificationDone(id) { this.db.prepare("UPDATE notifications SET state='sent' WHERE id=?").run(id); }
  notificationRetry(id) { this.db.prepare('UPDATE notifications SET attempts=attempts+1,retry_at=? WHERE id=?').run(Date.now() + 60000, id); }
  draft(id) { return this.db.prepare('SELECT * FROM drafts WHERE message_id=?').get(id); }
  saveDraft(id, body) {
    return this.transaction(() => {
      const previous = this.draft(id);
      if (previous && ['sent', 'sending', 'unknown'].includes(previous.state)) throw new Error('这封邮件已发送或发送结果待核实，不能再次拟稿');
      const revision = (previous?.revision || 0) + 1;
      this.db.prepare("INSERT OR REPLACE INTO drafts(message_id,revision,body,state) VALUES (?,?,?,'review')").run(id, revision, body);
      return this.draft(id);
    });
  }
  claimSend(id, revision) {
    return Number(this.db.prepare("UPDATE drafts SET state='sending' WHERE message_id=? AND revision=? AND state='review'").run(id, revision).changes) === 1;
  }
  finishSend(id, state, receipt = '') { this.db.prepare('UPDATE drafts SET state=?,receipt=? WHERE message_id=?').run(state, receipt, id); }
  cancel(id) { return Number(this.db.prepare("UPDATE drafts SET state='cancelled' WHERE message_id=? AND state='review'").run(id).changes); }
  setHealth(account, data) { this.db.prepare('INSERT OR REPLACE INTO health VALUES (?,?)').run(account, JSON.stringify(data)); }
  health() { return this.db.prepare('SELECT account,data FROM health').all().map(row => ({ account: row.account, ...JSON.parse(row.data) })); }
  acquireLease(name, owner, duration = 300000) {
    return this.transaction(() => {
      const lease = this.db.prepare('SELECT * FROM lease WHERE name=?').get(name);
      if (lease && lease.owner !== owner && lease.expires > Date.now()) return false;
      this.db.prepare('INSERT OR REPLACE INTO lease VALUES (?,?,?)').run(name, owner, Date.now() + duration);
      return true;
    });
  }
  releaseLease(name, owner) { this.db.prepare('DELETE FROM lease WHERE name=? AND owner=?').run(name, owner); }
  close() { this.db.close(); }
}
