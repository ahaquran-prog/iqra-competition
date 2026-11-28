'use strict';
// الإشعارات: داخل حساب المتسابق دائمًا، وعبر البريد ورسائل الجوال وواتساب حين تُضبط قنواتها.
// كل إشعار له مفتاح يمنع تكراره عند إعادة المحاولة، وكل إرسال خارجي له سجل بحالته ومحاولاته.
// يتضمن أيضًا مواعيد المراحل، لأن تحديد الموعد وتغييره والتذكير به أحداث إشعار.
const db = require('./db');
const config = require('./config');
const U = require('./util');
const { SECTIONS, STAGES, Bad, str, wrap, need, audit, isTop, scope, inScope, comp } = U;

const EVENTS = { register: 'تأكيد التسجيل', session: 'تحديد موعد', session_change: 'تغيير موعد أو موقع', reminder: 'تذكير بالموعد', called: 'النداء إلى اللجنة', result: 'نشر النتيجة', qualify: 'قرار التأهل', test_open: 'فتح اختبار التفسير', test_result: 'نشر نتيجة اختبار التفسير', material: 'مذكرة مقرر', draw_open: 'قرعة المقطع', prelim_day: 'يوم حضور التصفيات', draw_done: 'اعتماد مقطع القرعة', announce: 'إعلان' };
const CH = { email: 'البريد الإلكتروني', sms: 'رسالة جوال', whatsapp: 'واتساب' };
const DST = { queued: 'في الانتظار', sent: 'أُرسل إلى المزود', failed: 'تعذّر الإرسال', skipped: 'تُخطّي' };

const channels = () => ({ email: !!(config.smtp.host && config.smtp.from), sms: !!config.sms.url, whatsapp: !!config.whatsapp.url });
const when = (t) => new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: config.timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
// وصف الموعد بمدته: يوم واحد أو أيام متتالية، مع وقت الانتهاء اليومي إن حُدِّد
const DAY = (t) => new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: config.timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(t));
const HOUR = (t) => new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: config.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const hm12 = (hm) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; };
const DAYS_AR = (n) => (n === 2 ? 'يومان' : n <= 10 ? `${n} أيام` : `${n} يومًا`);
function span(s) {
  const days = s.days || 1, end = s.end_time ? ` إلى ${hm12(s.end_time)}` : '';
  if (days === 1) return `${DAY(s.starts_at)}، من ${HOUR(s.starts_at)}${end}`;
  return `${DAYS_AR(days)}: من ${DAY(s.starts_at)} إلى ${DAY(s.starts_at + (days - 1) * 864e5)}، يوميًا من ${HOUR(s.starts_at)}${end}`;
}
function intlPhone(p) {
  let s = String(p || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) s = s.slice(1);
  return '+' + config.countryCode + s;
}

// إنشاء إشعار لكل مستخدم، مرة واحدة لكل مفتاح، مع طابور الإرسال الخارجي للقنوات المفعّلة
function notify(userIds, event, { title, body, link = '', key }) {
  const ch = channels(), now = Date.now();
  let n = 0;
  const ids = [...new Set(userIds.filter(Boolean))];
  db.transaction(() => {
    for (const uid of ids) {
      const r = db.prepare('INSERT OR IGNORE INTO notifications(user_id,event,title,body,link,dedupe,created_at) VALUES (?,?,?,?,?,?,?)').run(uid, event, title, body, link, `${event}:${key}:${uid}`, now);
      if (!r.changes) continue;
      n++;
      const u = db.prepare('SELECT u.email, u.phone, p.is_test FROM users u LEFT JOIN people p ON p.user_id=u.id WHERE u.id=?').get(uid) || {};
      if (u.is_test) continue; // حسابات التجربة: إشعار داخل المنصة فقط، لا رسائل لأرقام وهمية قد تخص أشخاصًا حقيقيين
      const add = (c, to) => to && db.prepare("INSERT OR IGNORE INTO deliveries(notification_id,channel,recipient,status,updated_at) VALUES (?,?,?,'queued',?)").run(r.lastInsertRowid, c, to, now);
      if (ch.email) add('email', u.email);
      if (ch.sms) add('sms', intlPhone(u.phone));
      if (ch.whatsapp) add('whatsapp', intlPhone(u.phone));
    }
  })();
  if (n) setTimeout(() => processQueue().catch(() => {}), 10);
  return n;
}

// ---------- الإرسال الخارجي ----------
let mailer = null;
async function sendEmail(to, subject, text) {
  if (!mailer) { const nm = require('nodemailer'); mailer = nm.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.secure, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined }); }
  const r = await mailer.sendMail({ from: config.smtp.from, to, subject, text });
  return r.messageId || '';
}
async function sendWebhook(c, to, text) {
  const res = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(c.token ? { Authorization: 'Bearer ' + c.token } : {}) }, body: JSON.stringify({ to, message: text }), signal: AbortSignal.timeout(15000) });
  const t = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`);
  return t.slice(0, 120);
}
// تشغيل واحد للطابور في كل وقت؛ الطلب أثناء التشغيل ينتظر دورة إضافية تشمل ما أُضيف بعده
let running = null, again = false;
function processQueue() {
  if (running) { again = true; return running; }
  running = (async () => { do { again = false; await drain(); } while (again); })().finally(() => { running = null; });
  return running;
}
async function drain() {
  {
    const rows = db.prepare("SELECT d.*, n.title, n.body FROM deliveries d JOIN notifications n ON n.id=d.notification_id WHERE d.status='queued' AND d.next_at<=? ORDER BY d.id LIMIT 20").all(Date.now());
    for (const d of rows) {
      const text = `${d.title}\n${d.body}\n— ${config.orgName}`;
      try {
        const ch = channels();
        if (!ch[d.channel]) { db.prepare("UPDATE deliveries SET status='skipped', last_error=?, updated_at=? WHERE id=?").run('القناة غير مفعّلة', Date.now(), d.id); continue; }
        const ref = d.channel === 'email' ? await sendEmail(d.recipient, d.title, text) : await sendWebhook(config[d.channel], d.recipient, text);
        db.prepare("UPDATE deliveries SET status='sent', attempts=attempts+1, provider_ref=?, last_error='', updated_at=? WHERE id=?").run(String(ref || ''), Date.now(), d.id);
      } catch (e) {
        const a = d.attempts + 1, last = a >= 3;
        // إعادة محاولة مضبوطة: بعد 2 ثم 4 دقائق، ثم «تعذّر الإرسال»
        db.prepare('UPDATE deliveries SET status=?, attempts=?, next_at=?, last_error=?, updated_at=? WHERE id=?').run(last ? 'failed' : 'queued', a, Date.now() + 2 ** a * 60000, String(e.message || e).slice(0, 300), Date.now(), d.id);
      }
    }
  }
}

// ---------- الجمهور ----------
const contestantUser = (entryId) => (db.prepare('SELECT p.user_id FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id WHERE e.id=?').get(entryId) || {}).user_id;
// المتسابقون المعنيون بمرحلة في قسم (ولفرع إن حُدِّد): المسجلون في التصفيات، والمتأهلون بعدها
function audience(compId, { stage = 'prelim', section = '', branch = '' } = {}) {
  const w = ["r.comp_id=?", "r.status='accepted'", "e.status='active'"], a = [compId];
  if (section) { w.push('r.section=?'); a.push(section); }
  if (branch) { w.push('e.branch=?'); a.push(branch); }
  if (stage !== 'prelim') { w.push("EXISTS (SELECT 1 FROM qualifications q WHERE q.entry_id=e.id AND q.to_stage=? AND q.status='qualified')"); a.push(stage); }
  return db.prepare(`SELECT DISTINCT p.user_id AS id FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id WHERE ${w.join(' AND ')}`).all(...a).map((x) => x.id);
}
const branchName = (compId, code) => (db.prepare('SELECT name FROM branches WHERE comp_id=? AND code=?').get(compId, code) || {}).name || '';

// ---------- أحداث تستدعيها الوحدات الأخرى ----------
const events = {
  registered(userId, regId, compName, catName, branches) {
    notify([userId], 'register', { key: regId, title: 'تأكيد التسجيل', body: `سُجّلت في ${compName}: ${branches.join('، ')}. فئتك: ${catName}. يظهر موعد المرحلة في حسابك عند إعلانه.`, link: 'my' });
  },
  called(ticket, committee, hall, eventId) {
    const uid = contestantUser(ticket.entry_id);
    notify([uid], 'called', { key: eventId, title: 'تم نداؤك', body: `توجّه الآن إلى ${committee}${hall ? ' — ' + hall : ''}.`, link: 'my' });
  },
  resultPublished(sheet, rows, nextName, qualOf) {
    for (const r of rows) {
      const q = nextName ? qualOf(r.entryId) : null;
      notify([contestantUser(r.entryId)], 'result', { key: `${sheet.id}:${r.entryId}`, link: 'my', title: `نُشرت نتيجة ${STAGES[sheet.stage]}`,
        body: `${sheet.group_name}: ${Math.round(r.total * 100) / 100} من ${sheet.max}، الترتيب ${r.rank} من ${rows.length}.${q ? (q === 'qualified' ? ` تأهلت إلى ${nextName}.` : ` لم تتأهل إلى ${nextName}.`) : ''}` });
    }
  },
  // قرار التأهل بعد نشر الكشف (إن اعتُمد قبل النشر يُذكر في إشعار النتيجة)
  qualified(sheet, decisions, nextName) {
    for (const [entryId, ok] of decisions)
      notify([contestantUser(entryId)], 'qualify', { key: `${sheet.id}:${entryId}:${ok ? 1 : 0}`, link: 'my', title: `قرار التأهل إلى ${nextName}`,
        body: ok ? `تأهلت إلى ${nextName} في ${sheet.group_name}. يظهر موعدها في حسابك عند إعلانه.` : `لم تتأهل إلى ${nextName} في ${sheet.group_name}.` });
  },
  testOpened(t, userIds) {
    notify(userIds, 'test_open', { key: t.id, link: 'tests', title: 'اختبار التفسير متاح', body: `${t.title}: ${t.question_count} أسئلة في ${t.duration_min} دقيقة.${t.closes_at ? ' يُغلق ' + when(t.closes_at) + '.' : ''} محاولة واحدة.` });
  },
  testResults(t, userIds) {
    notify(userIds, 'test_result', { key: t.id, link: 'tests', title: 'نُشرت نتيجة اختبار التفسير', body: `${t.title}: تجد نتيجتك في حسابك.` });
  },
};

// التذكير قبل الموعد، مرة واحدة لكل نسخة من الموعد
function runReminders() {
  const c = require('./rules').current(); if (!c) return 0;
  const now = Date.now(), until = now + config.reminderHours * 3600e3;
  let n = 0;
  const published = (sec) => !!db.prepare('SELECT 1 FROM day_plans WHERE comp_id=? AND section=? AND published_at IS NOT NULL').get(c.id, sec);
  for (const s of db.prepare('SELECT * FROM stage_sessions WHERE comp_id=? AND starts_at>? AND starts_at<=?').all(c.id, now, until)) {
    if (s.stage === 'prelim' && published(s.section)) continue; // يُذكَّر كل متسابق قبل يومه المحدد (أدناه)
    n += notify(audience(c.id, s), 'reminder', { key: `${s.id}:${s.version}`, link: 'my', title: `تذكير: موعد ${STAGES[s.stage]}`, body: `${span(s)}، في ${s.location}.${s.note ? ' ' + s.note : ''}` });
  }
  // بعد نشر توزيع الأيام: تذكير كل متسابق قبل يومه، بوقت بدء التصفيات في ذلك اليوم
  const D = require('./days');
  for (const sec of ['M', 'F']) {
    if (!published(sec)) continue;
    const s = db.prepare("SELECT * FROM stage_sessions WHERE comp_id=? AND stage='prelim' AND section=? ORDER BY branch<>'', id LIMIT 1").get(c.id, sec);
    if (!s) continue;
    const s0 = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(new Date(s.starts_at));
    for (const d of db.prepare('SELECT * FROM prelim_days WHERE comp_id=? AND section=?').all(c.id, sec)) {
      const at = s.starts_at + Math.round((Date.parse(d.date + 'T12:00:00Z') - Date.parse(s0 + 'T12:00:00Z')) / 864e5) * 864e5;
      if (!(at > now && at <= until)) continue;
      const ids = db.prepare(`SELECT DISTINCT p.user_id id FROM day_assign a JOIN entries e ON e.id=a.entry_id JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id
        WHERE a.day_id=? AND r.status='accepted' AND e.status='active'`).all(d.id).map((x) => x.id).filter(Boolean);
      n += notify(ids, 'reminder', { key: `day:${d.id}:${d.date}`, link: 'my', title: 'تذكير: يوم حضورك للتصفيات الأولية',
        body: `${D.dayName(d.day_no)}، ${new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: config.timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(at))}، في ${s.location}.` });
    }
  }
  return n;
}

const sessionJson = (s) => ({ id: s.id, stage: s.stage, stageName: STAGES[s.stage], section: s.section, sectionName: SECTIONS[s.section], branch: s.branch, branchName: s.branch ? branchName(s.comp_id, s.branch) : 'كل الفروع', startsAt: s.starts_at, days: s.days || 1, endTime: s.end_time || '', when: span(s), location: s.location, note: s.note, version: s.version });

function routes(app) {
  // ---------- إشعاراتي (لكل حساب) ----------
  app.get('/api/notifications', wrap((req) => {
    const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60').all(req.user.id);
    return { unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id).n,
      rows: rows.map((n) => ({ id: n.id, event: n.event, eventName: EVENTS[n.event] || '', title: n.title, body: n.body, link: n.link, at: n.created_at, read: !!n.read_at })) };
  }));
  app.get('/api/notifications/unread', wrap((req) => ({ unread: db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL').get(req.user.id).n })));
  app.post('/api/notifications/read', wrap((req) => {
    db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(Date.now(), req.user.id);
    return { ok: true };
  }));

  // ---------- المواعيد ----------
  const canSched = (u) => ['exec', 'top'].includes(u.role);
  app.get('/api/sessions', need((u) => ['exec', 'top', 'chief'].includes(u.role)), wrap((req) => {
    const c = comp(), sec = scope(req.user, req.query.section);
    return { sessions: db.prepare(`SELECT * FROM stage_sessions WHERE comp_id=?${sec ? ' AND section=?' : ''} ORDER BY starts_at`).all(...[c.id, ...(sec ? [sec] : [])]).map(sessionJson) };
  }));
  function saveSession(req, old) {
    const c = comp(), b = req.body || {}, u = req.user;
    const section = old ? old.section : isTop(u) ? b.section : u.section;
    if (!SECTIONS[section]) throw new Bad('اختر القسم');
    if (!inScope(u, section)) throw new Bad('لا تملك صلاحية لهذا القسم', 403);
    const stage = old ? old.stage : STAGES[b.stage] ? b.stage : null; if (!stage) throw new Bad('اختر المرحلة');
    const branch = old ? old.branch : String(b.branch || '');
    if (branch && !db.prepare('SELECT 1 FROM branches WHERE comp_id=? AND code=?').get(c.id, branch)) throw new Bad('فرع غير صحيح');
    const at = typeof b.startsAt === 'number' ? b.startsAt : Date.parse(b.startsAt);
    if (!Number.isFinite(at)) throw new Bad('أدخل تاريخ الموعد ووقته');
    const location = str(b.location, 200, 'الموقع'), note = str(b.note, 300, 'ملاحظة', false), now = Date.now();
    const days = b.days === undefined || b.days === '' ? (old ? old.days : 1) : parseInt(b.days, 10);
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new Bad('المدة من يوم إلى 30 يومًا');
    const endTime = b.endTime === undefined ? (old ? old.end_time : '') : String(b.endTime || '').trim();
    if (endTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Bad('وقت الانتهاء غير صحيح');
    if (endTime) { const st = new Intl.DateTimeFormat('en-GB', { timeZone: config.timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at)); if (endTime <= st) throw new Bad('وقت الانتهاء يجب أن يكون بعد وقت البدء'); }
    let id, version;
    if (old) {
      if (old.starts_at === at && old.days === days && old.end_time === endTime && old.location === location && old.note === note) return { session: sessionJson(old), notified: 0 };
      version = old.version + 1; id = old.id;
      db.prepare('UPDATE stage_sessions SET starts_at=?, days=?, end_time=?, location=?, note=?, version=?, updated_at=? WHERE id=?').run(at, days, endTime, location, note, version, now, id);
    } else {
      if (db.prepare('SELECT 1 FROM stage_sessions WHERE comp_id=? AND stage=? AND section=? AND branch=?').get(c.id, stage, section, branch)) throw new Bad('يوجد موعد لهذه المرحلة والقسم والفرع؛ عدّله', 409);
      version = 1; id = db.prepare('INSERT INTO stage_sessions(comp_id,stage,section,branch,starts_at,days,end_time,location,note,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(c.id, stage, section, branch, at, days, endTime, location, note, u.id, now).lastInsertRowid;
    }
    const s = db.prepare('SELECT * FROM stage_sessions WHERE id=?').get(id);
    audit(u, old ? 'update' : 'create', 'session', id, { section, summary: `${old ? 'تغيير' : 'تحديد'} موعد ${STAGES[stage]} (${s.branch ? branchName(c.id, s.branch) : 'كل الفروع'}): ${span(s)} — ${location}`, before: old ? sessionJson(old) : undefined });
    const n = notify(audience(c.id, s), old ? 'session_change' : 'session', { key: `${id}:${version}`, link: 'my',
      title: old ? `تغيير موعد ${STAGES[stage]}` : `موعد ${STAGES[stage]}`, body: `${span(s)}، في ${location}.${note ? ' ' + note : ''}${old ? ' (يحل محل الموعد السابق)' : ''}` });
    return { session: sessionJson(s), notified: n };
  }
  app.post('/api/sessions', need(canSched), wrap((req) => saveSession(req, null)));
  app.put('/api/sessions/:id', need(canSched), wrap((req) => {
    const old = db.prepare('SELECT * FROM stage_sessions WHERE id=?').get(+req.params.id);
    if (!old || !inScope(req.user, old.section)) throw new Bad('الموعد غير موجود', 404);
    return saveSession(req, old);
  }));
  // مواعيدي: موعد خاص بفرع المشاركة يتقدم على موعد «كل الفروع»
  app.get('/api/my/schedule', need((u) => u.role === 'contestant'), wrap((req) => {
    const c = comp(), p = db.prepare('SELECT id FROM people WHERE user_id=?').get(req.user.id); if (!p) return { rows: [] };
    const es = db.prepare("SELECT e.id, e.branch, r.section FROM entries e JOIN registrations r ON r.id=e.registration_id WHERE r.person_id=? AND r.comp_id=? AND r.status='accepted' AND e.status='active'").all(p.id, c.id);
    const out = [];
    for (const e of es) for (const stage of ['prelim', 'semi', 'final']) {
      if (stage !== 'prelim' && !db.prepare("SELECT 1 FROM qualifications WHERE entry_id=? AND to_stage=? AND status='qualified'").get(e.id, stage)) continue;
      const s = db.prepare("SELECT * FROM stage_sessions WHERE comp_id=? AND stage=? AND section=? AND branch IN (?, '') ORDER BY branch DESC LIMIT 1").get(c.id, stage, e.section, e.branch);
      out.push({ entryId: e.id, stage, stageName: STAGES[stage], session: s ? sessionJson(s) : null });
    }
    return { rows: out };
  }));

  // ---------- الإدارة: السجل والإعلانات والتذكير ----------
  app.get('/api/admin/notifications', need(isTop), wrap((req) => {
    const st = DST[req.query.status] ? req.query.status : '', page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const rows = db.prepare(`SELECT d.*, n.title, n.event, u.name FROM deliveries d JOIN notifications n ON n.id=d.notification_id JOIN users u ON u.id=n.user_id${st ? ' WHERE d.status=?' : ''} ORDER BY d.id DESC LIMIT 50 OFFSET ?`).all(...[...(st ? [st] : []), (page - 1) * 50]);
    const counts = Object.fromEntries(db.prepare('SELECT status k, COUNT(*) n FROM deliveries GROUP BY status').all().map((x) => [x.k, x.n]));
    const recent = db.prepare('SELECT event, COUNT(*) n, MAX(created_at) last FROM notifications GROUP BY event ORDER BY last DESC').all();
    return { channels: Object.entries(channels()).map(([k, on]) => ({ key: k, name: CH[k], on })), counts, page,
      events: recent.map((x) => ({ event: x.event, name: EVENTS[x.event] || x.event, n: x.n, last: x.last })),
      rows: rows.map((d) => ({ id: d.id, channel: d.channel, channelName: CH[d.channel], recipient: d.recipient, status: d.status, statusName: DST[d.status], attempts: d.attempts, error: d.last_error, ref: d.provider_ref, at: d.updated_at, title: d.title, eventName: EVENTS[d.event] || '', name: d.name })) };
  }));
  app.post('/api/admin/deliveries/:id/resend', need(isTop), wrap((req) => {
    const d = db.prepare('SELECT * FROM deliveries WHERE id=?').get(+req.params.id); if (!d) throw new Bad('غير موجود', 404);
    if (d.status === 'sent') throw new Bad('أُرسل من قبل؛ لا يُكرَّر الإرسال', 409);
    db.prepare("UPDATE deliveries SET status='queued', attempts=0, next_at=0, updated_at=? WHERE id=?").run(Date.now(), d.id);
    audit(req.user, 'resend', 'delivery', d.id, { summary: `إعادة إرسال (${CH[d.channel]}) إلى ${d.recipient}` });
    setTimeout(() => processQueue().catch(() => {}), 10);
    return { ok: true };
  }));
  app.post('/api/admin/announce', need(isTop), wrap((req) => {
    const c = comp(), b = req.body || {};
    const a = { stage: STAGES[b.stage] ? b.stage : 'prelim', section: SECTIONS[b.section] ? b.section : '', branch: String(b.branch || '') };
    const title = str(b.title, 100, 'عنوان الإعلان'), body = str(b.body, 600, 'نص الإعلان');
    const ids = audience(c.id, a);
    if (!ids.length) throw new Bad('لا يوجد متسابقون في هذا الجمهور');
    const n = notify(ids, 'announce', { key: `${Date.now()}`, title, body });
    audit(req.user, 'announce', 'notification', null, { section: a.section, summary: `إعلان «${title}» إلى ${n} متسابقًا`, after: { ...a, title, body } });
    return { sent: n };
  }));
  app.post('/api/admin/reminders', need(isTop), wrap(() => ({ sent: runReminders() })));
}

// تشغيل الطابور والتذكيرات دوريًا
setInterval(() => { processQueue().catch(() => {}); }, 30e3).unref();
setInterval(() => { try { runReminders(); } catch (e) {} }, 10 * 60e3).unref();

module.exports = { notify, events, routes, runReminders, processQueue, audience, channels, intlPhone, contestantUser };
