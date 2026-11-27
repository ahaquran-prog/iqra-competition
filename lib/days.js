'use strict';
// توزيع المتسابقين على أيام التصفيات الأولية.
// الإدارة التنفيذية (لقسمها) تحدد الأيام وتواريخها، وسعة كل يوم لكل فرع وفئة، ثم يوزّع النظام المشاركات الميدانية
// (الفروع التي لها لجان في التصفيات). من له أكثر من مشاركة يُجمع في يوم واحد ما أمكن.
// التوزيع مسودة حتى «الاعتماد والنشر»، فيصل كل متسابق إشعار بيومه، ويظهر في حسابه وفي الاستقبال.
const crypto = require('crypto');
const db = require('./db');
const config = require('./config');
const X = require('./xlsx');
const { SECTIONS, Bad, wrap, need, audit, scope, inScope, comp } = require('./util');

const ORD = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
const dayName = (n) => `اليوم ${ORD[n - 1] || n}`;
const dateLabel = (d) => new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(d + 'T12:00:00Z'));
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && !Number.isNaN(Date.parse(d + 'T12:00:00Z'));
const MAXDAYS = 14;

const canPlan = (u) => ['exec', 'top'].includes(u.role);
const secOf = (req, v) => {
  const s = scope(req.user, v);
  if (!s) throw new Bad('اختر القسم', 400);
  if (!inScope(req.user, s)) throw new Bad('خارج نطاق قسمك', 403);
  return s;
};
// الفروع التي تُختبر حضوريًا في التصفيات: الحفظ والتلاوة، وكل فرع له لجان تصفيات
const fieldBranches = (compId) => new Set(['hifz', 'tilawa', ...db.prepare("SELECT DISTINCT branch FROM committees WHERE comp_id=? AND stage='prelim'").all(compId).map((x) => x.branch)]);
const daysOf = (compId, sec) => db.prepare('SELECT * FROM prelim_days WHERE comp_id=? AND section=? ORDER BY day_no').all(compId, sec);
const plan = (compId, sec) => db.prepare('SELECT * FROM day_plans WHERE comp_id=? AND section=?').get(compId, sec) || { published_at: null, changed_at: null, version: 0 };
const touch = (compId, sec) => db.prepare('INSERT INTO day_plans(comp_id,section,changed_at) VALUES (?,?,?) ON CONFLICT(comp_id,section) DO UPDATE SET changed_at=excluded.changed_at').run(compId, sec, Date.now());

// المشاركات الميدانية الفعالة في القسم، مع تعيينها وحضورها
function fieldEntries(compId, sec) {
  const fb = fieldBranches(compId);
  return db.prepare(`SELECT e.id, e.branch, e.branch_name, e.track_name, e.curriculum_id, r.id reg_id, r.category_id, r.category_name, r.created_at, p.id person_id, p.full_name, p.national_id, p.phone, p.user_id,
      a.day_id, a.manual, (SELECT 1 FROM tickets t WHERE t.entry_id=e.id AND t.stage='prelim' AND t.status<>'cancelled') checked
    FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id LEFT JOIN day_assign a ON a.entry_id=e.id
    WHERE r.comp_id=? AND r.section=? AND r.status='accepted' AND e.status='active'`).all(compId, sec).filter((e) => fb.has(e.branch));
}
const gkey = (e) => String(e.curriculum_id);

// موعد اليوم ومكانه من «مواعيد المراحل» (موعد الفرع إن وُجد، وإلا الموعد العام للقسم)
function sessionFor(compId, sec, branches) {
  const ss = db.prepare("SELECT * FROM stage_sessions WHERE comp_id=? AND stage='prelim' AND section=?").all(compId, sec);
  const s = ss.find((x) => x.branch && branches.includes(x.branch)) || ss.find((x) => !x.branch) || null;
  if (!s) return null;
  const hm = new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: config.timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(s.starts_at));
  const end = s.end_time ? (() => { const [h, m] = s.end_time.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; })() : '';
  return { time: end ? `من ${hm} إلى ${end}` : `من ${hm}`, location: s.location, note: s.note };
}

// ---------- الخوارزمية ----------
function distribute(compId, sec, mode, order, u) {
  const days = daysOf(compId, sec);
  if (!days.length) throw new Bad('حدد أيام التصفيات أولًا');
  const caps = new Map(); // key -> [cap per day index]
  for (const [i, d] of days.entries()) for (const c of db.prepare('SELECT * FROM day_caps WHERE day_id=?').all(d.id)) {
    const k = String(c.curriculum_id); if (!caps.has(k)) caps.set(k, days.map(() => 0)); caps.get(k)[i] = c.cap;
  }
  const idx = new Map(days.map((d, i) => [d.id, i]));
  const entries = fieldEntries(compId, sec);
  const keep = (e) => e.checked || (mode === 'fill' && e.day_id && idx.has(e.day_id)) || (e.manual && e.day_id && idx.has(e.day_id));
  const left = new Map([...caps].map(([k, v]) => [k, [...v]]));
  for (const e of entries) if (keep(e) && e.day_id && idx.has(e.day_id)) { const k = gkey(e); if (left.has(k)) left.get(k)[idx.get(e.day_id)]--; }
  // الأشخاص المطلوب توزيعهم
  const byPerson = new Map();
  for (const e of entries) if (!keep(e)) { if (!byPerson.has(e.person_id)) byPerson.set(e.person_id, []); byPerson.get(e.person_id).push(e); }
  let persons = [...byPerson.values()];
  const coll = new Intl.Collator('ar');
  if (order === 'random') { for (let i = persons.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [persons[i], persons[j]] = [persons[j], persons[i]]; } }
  else if (order === 'name') persons.sort((a, b) => coll.compare(a[0].full_name, b[0].full_name));
  else persons.sort((a, b) => a[0].created_at - b[0].created_at || a[0].reg_id - b[0].reg_id);
  // من له أكثر من مشاركة أولًا (ليُجمع في يوم واحد)، مع حفظ الترتيب المختار داخل كل مجموعة
  persons = [...persons.filter((p) => p.length > 1), ...persons.filter((p) => p.length === 1)];
  const res = { assigned: 0, split: 0, unassigned: 0 };
  const put = db.prepare('INSERT INTO day_assign(entry_id,day_id,manual,assigned_at,assigned_by) VALUES (?,?,0,?,?) ON CONFLICT(entry_id) DO UPDATE SET day_id=excluded.day_id, manual=0, assigned_at=excluded.assigned_at, assigned_by=excluded.assigned_by');
  const drop = db.prepare('DELETE FROM day_assign WHERE entry_id=?');
  const now = Date.now();
  db.transaction(() => {
    for (const p of persons) {
      const ks = p.map((e) => gkey(e));
      const d = days.findIndex((_, i) => ks.every((k) => left.has(k) && left.get(k)[i] > 0));
      if (d >= 0) { p.forEach((e, j) => { left.get(ks[j])[d]--; put.run(e.id, days[d].id, now, u.id); res.assigned++; }); continue; }
      let split = false;
      p.forEach((e, j) => {
        const i = left.has(ks[j]) ? left.get(ks[j]).findIndex((x) => x > 0) : -1;
        if (i >= 0) { left.get(ks[j])[i]--; put.run(e.id, days[i].id, now, u.id); res.assigned++; split = p.length > 1; } else { drop.run(e.id); res.unassigned++; }
      });
      if (split) res.split++;
    }
    touch(compId, sec);
    audit(u, 'distribute', 'prelim_days', null, { section: sec, summary: `توزيع المتسابقين على أيام التصفيات (${mode === 'fill' ? 'غير الموزعين فقط' : 'الجميع'}، ${order === 'random' ? 'عشوائي' : order === 'name' ? 'أبجدي' : 'بأسبقية التسجيل'}): وُزّعت ${res.assigned} مشاركة${res.unassigned ? `، ولم تتسع السعة لـ ${res.unassigned}` : ''}` });
  })();
  return res;
}

// ---------- العرض ----------
function overview(compId, sec) {
  const days = daysOf(compId, sec), entries = fieldEntries(compId, sec), p = plan(compId, sec);
  // مجموعة لكل مقرر في الفروع الميدانية، ولو لم يسجل فيه أحد
  const fb = fieldBranches(compId);
  const cus = db.prepare(`SELECT cu.id, cu.branch, cu.track, cu.track_name, cu.sort, k.name cat, b.name branch_name, b.sort bsort FROM curricula cu
    LEFT JOIN categories k ON k.id=cu.category_id LEFT JOIN branches b ON b.comp_id=cu.comp_id AND b.code=cu.branch WHERE cu.comp_id=? ORDER BY b.sort, cu.sort, cu.id`).all(compId).filter((x) => fb.has(x.branch));
  const label = (x) => (x.track === 'cat' || !x.track_name ? [x.branch_name, x.cat] : [x.branch_name, x.track_name, x.cat]).filter(Boolean).join(' · ');
  const groups = new Map(cus.map((x) => [String(x.id), { key: String(x.id), curriculumId: x.id, branch: x.branch, label: label(x), registered: 0, caps: {}, assigned: {}, unassigned: 0 }]));
  for (const e of entries) { const g = groups.get(gkey(e)); if (!g) continue; g.registered++; if (e.day_id) g.assigned[e.day_id] = (g.assigned[e.day_id] || 0) + 1; else if (!e.checked) g.unassigned++; }
  for (const d of days) for (const c of db.prepare('SELECT * FROM day_caps WHERE day_id=?').all(d.id)) { const g = groups.get(String(c.curriculum_id)); if (g) g.caps[d.id] = c.cap; }
  const gl = [...groups.values()];
  const persons = new Set(entries.map((e) => e.person_id));
  const assignedPersons = (dayId) => new Set(entries.filter((e) => e.day_id === dayId).map((e) => e.person_id)).size;
  const s = sessionFor(compId, sec, []);
  const gs = db.prepare("SELECT starts_at, days FROM stage_sessions WHERE comp_id=? AND stage='prelim' AND section=? ORDER BY branch<>'' , id LIMIT 1").get(compId, sec);
  const start = gs ? new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(new Date(gs.starts_at)) : null;
  const suggest = gs ? Array.from({ length: gs.days || 1 }, (_, i) => new Date(Date.parse(start + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10)) : [];
  return {
    suggest,
    section: sec, sectionName: SECTIONS[sec], persons: persons.size, entries: entries.length,
    unassigned: entries.filter((e) => !e.day_id && !e.checked).length, checkedIn: entries.filter((e) => e.checked).length,
    days: days.map((d) => ({ id: d.id, no: d.day_no, date: d.date, name: dayName(d.day_no), label: dateLabel(d.date), persons: assignedPersons(d.id),
      entries: entries.filter((e) => e.day_id === d.id).length, cap: gl.reduce((n, g) => n + (g.caps[d.id] || 0), 0) })),
    groups: gl, published: !!p.published_at, publishedAt: p.published_at, changed: !!p.changed_at && (!p.published_at || p.changed_at > p.published_at), version: p.version,
    session: s, regClose: comp().reg_close || null,
  };
}
const personRows = (compId, sec, dayId) => {
  const es = fieldEntries(compId, sec), byP = new Map();
  for (const e of es) { if (!byP.has(e.person_id)) byP.set(e.person_id, { personId: e.person_id, regId: e.reg_id, name: e.full_name, nationalId: e.national_id, phone: e.phone, category: e.category_name, entries: [] }); byP.get(e.person_id).entries.push({ id: e.id, branch: e.branch_name + (e.track_name ? ' · ' + e.track_name : ''), dayId: e.day_id, manual: !!e.manual, checked: !!e.checked }); }
  const coll = new Intl.Collator('ar');
  let rows = [...byP.values()];
  if (dayId === 'none') rows = rows.filter((p) => p.entries.some((e) => !e.dayId && !e.checked));
  else if (dayId) rows = rows.filter((p) => p.entries.some((e) => e.dayId === +dayId));
  return rows.sort((a, b) => coll.compare(a.name, b.name));
};

// إشعار المتسابق بيومه (أو أيامه إن قُسمت مشاركاته)، مرة لكل تعيين مختلف
function announce(compId, sec) {
  const N = require('./notify');
  const days = new Map(daysOf(compId, sec).map((d) => [d.id, d]));
  const es = fieldEntries(compId, sec).filter((e) => e.day_id && days.has(e.day_id) && !e.checked);
  const byP = new Map();
  for (const e of es) { if (!byP.has(e.person_id)) byP.set(e.person_id, []); byP.get(e.person_id).push(e); }
  let n = 0;
  for (const list of byP.values()) {
    const uid = list[0].user_id; if (!uid) continue;
    const ds = [...new Set(list.map((e) => e.day_id))].map((id) => days.get(id)).sort((a, b) => a.day_no - b.day_no);
    const sig = ds.map((d) => `${d.id}@${d.date}`).join(',') + '|' + list.map((e) => `${e.id}>${e.day_id}`).sort().join(',');
    const prior = db.prepare("SELECT 1 FROM notifications WHERE user_id=? AND event='prelim_day'").get(uid);
    const s = sessionFor(compId, sec, list.map((e) => e.branch));
    const what = ds.length === 1 ? `${dayName(ds[0].day_no)}، ${dateLabel(ds[0].date)}` : ds.map((d) => `${list.filter((e) => e.day_id === d.id).map((e) => e.branch_name).join(' و')}: ${dayName(d.day_no)}، ${dateLabel(d.date)}`).join(' — ');
    n += N.notify([uid], 'prelim_day', { key: `${uid}:${crypto.createHash('sha256').update(sig).digest('hex').slice(0, 16)}`, link: 'my',
      title: prior ? 'تغيّر يوم حضورك للتصفيات الأولية' : 'يوم حضورك للتصفيات الأولية',
      body: `${what}${s ? `، ${s.time}، في ${s.location}` : ''}. احضر في يومك المحدد.` });
  }
  return n;
}

function routes(app) {
  app.get('/api/days', need(canPlan), wrap((req) => overview(comp().id, secOf(req, req.query.section))));

  // حفظ الأيام والسعة معًا. حذف يوم يعيد مشاركاته إلى «غير موزّع» ما لم يحضر أصحابها
  app.put('/api/days', need(canPlan), wrap((req) => {
    const c = comp(), b = req.body || {}, sec = secOf(req, b.section);
    const ds = Array.isArray(b.days) ? b.days : [];
    if (!ds.length || ds.length > MAXDAYS) throw new Bad(`عدد الأيام من 1 إلى ${MAXDAYS}`);
    ds.forEach((d, i) => { if (!okDate(d.date)) throw new Bad(`تاريخ ${dayName(i + 1)} غير صحيح`); });
    if (new Set(ds.map((d) => d.date)).size !== ds.length) throw new Bad('تكرر التاريخ نفسه في يومين');
    const fb = fieldBranches(c.id), cuIds = new Set(db.prepare('SELECT id, branch FROM curricula WHERE comp_id=?').all(c.id).filter((x) => fb.has(x.branch)).map((x) => x.id));
    const caps = (Array.isArray(b.caps) ? b.caps : []).map((x) => ({ day: +x.dayNo, cu: +x.curriculumId, cap: parseInt(x.cap, 10) || 0 }));
    for (const x of caps) {
      if (!cuIds.has(x.cu) || !(x.day >= 1 && x.day <= ds.length)) throw new Bad('بيانات السعة غير صحيحة');
      if (x.cap < 0 || x.cap > 5000) throw new Bad('السعة من 0 إلى 5000');
    }
    const old = daysOf(c.id, sec);
    const removed = old.filter((d) => d.day_no > ds.length);
    for (const d of removed) if (db.prepare("SELECT 1 FROM day_assign a JOIN tickets t ON t.entry_id=a.entry_id AND t.stage='prelim' AND t.status<>'cancelled' WHERE a.day_id=?").get(d.id))
      throw new Bad(`لا يمكن حذف ${dayName(d.day_no)}: حضر بعض المتسابقين الموزعين عليه`);
    db.transaction(() => {
      for (const d of removed) db.prepare('DELETE FROM prelim_days WHERE id=?').run(d.id);
      ds.forEach((d, i) => db.prepare('INSERT INTO prelim_days(comp_id,section,day_no,date) VALUES (?,?,?,?) ON CONFLICT(comp_id,section,day_no) DO UPDATE SET date=excluded.date').run(c.id, sec, i + 1, d.date));
      const ids = new Map(daysOf(c.id, sec).map((d) => [d.day_no, d.id]));
      for (const id of ids.values()) db.prepare('DELETE FROM day_caps WHERE day_id=?').run(id);
      for (const x of caps) if (x.cap > 0) db.prepare('INSERT INTO day_caps(day_id,curriculum_id,cap) VALUES (?,?,?) ON CONFLICT(day_id,curriculum_id) DO UPDATE SET cap=excluded.cap').run(ids.get(x.day), x.cu, x.cap);
      touch(c.id, sec);
      audit(req.user, 'update', 'prelim_days', null, { section: sec, summary: `أيام التصفيات (${SECTIONS[sec]}): ${ds.length} أيام من ${ds[0].date}، وسعة إجمالية ${caps.reduce((n, x) => n + x.cap, 0)}${removed.length ? `، وحُذف ${removed.length}` : ''}` });
    })();
    return overview(c.id, sec);
  }));

  app.post('/api/days/distribute', need(canPlan), wrap((req) => {
    const c = comp(), b = req.body || {}, sec = secOf(req, b.section);
    const mode = b.mode === 'fill' ? 'fill' : 'all', order = ['random', 'name'].includes(b.order) ? b.order : 'registration';
    const r = distribute(c.id, sec, mode, order, req.user);
    return { result: r, ...overview(c.id, sec) };
  }));

  app.get('/api/days/people', need(canPlan), wrap((req) => {
    const c = comp(), sec = secOf(req, req.query.section);
    return { rows: personRows(c.id, sec, req.query.day || '') };
  }));

  // نقل متسابق (كل مشاركاته الميدانية التي لم يحضرها) إلى يوم آخر يدويًا
  app.post('/api/days/move', need(canPlan), wrap((req) => {
    const c = comp(), b = req.body || {};
    const reg = db.prepare('SELECT r.*, p.full_name FROM registrations r JOIN people p ON p.id=r.person_id WHERE r.id=? AND r.comp_id=?').get(+b.registrationId, c.id);
    if (!reg || !inScope(req.user, reg.section)) throw new Bad('التسجيل غير موجود', 404);
    const day = b.dayId ? db.prepare('SELECT * FROM prelim_days WHERE id=? AND comp_id=? AND section=?').get(+b.dayId, c.id, reg.section) : null;
    if (b.dayId && !day) throw new Bad('اليوم غير موجود');
    const es = fieldEntries(c.id, reg.section).filter((e) => e.reg_id === reg.id && !e.checked);
    if (!es.length) throw new Bad('لا توجد مشاركات يمكن نقلها (حضر المتسابق أو لا مشاركات ميدانية له)', 409);
    db.transaction(() => {
      for (const e of es) {
        if (day) db.prepare('INSERT INTO day_assign(entry_id,day_id,manual,assigned_at,assigned_by) VALUES (?,?,1,?,?) ON CONFLICT(entry_id) DO UPDATE SET day_id=excluded.day_id, manual=1, assigned_at=excluded.assigned_at, assigned_by=excluded.assigned_by').run(e.id, day.id, Date.now(), req.user.id);
        else db.prepare('DELETE FROM day_assign WHERE entry_id=?').run(e.id);
      }
      touch(c.id, reg.section);
      audit(req.user, 'update', 'registration', reg.id, { section: reg.section, summary: `نقل ${reg.full_name} إلى ${day ? `${dayName(day.day_no)} (${day.date})` : '«غير موزّع»'}` });
    })();
    return { ok: true };
  }));

  app.post('/api/days/publish', need(canPlan), wrap((req) => {
    const c = comp(), sec = secOf(req, (req.body || {}).section), o = overview(c.id, sec);
    if (!o.days.length) throw new Bad('حدد أيام التصفيات أولًا');
    if (!(o.entries - o.unassigned)) throw new Bad('لا يوجد متسابقون موزعون للنشر');
    const notified = announce(c.id, sec);
    db.prepare('INSERT INTO day_plans(comp_id,section,published_at,changed_at,version) VALUES (?,?,?,?,1) ON CONFLICT(comp_id,section) DO UPDATE SET published_at=excluded.published_at, version=version+1').run(c.id, sec, Date.now(), Date.now());
    audit(req.user, 'publish', 'prelim_days', null, { section: sec, summary: `اعتماد توزيع أيام التصفيات (${SECTIONS[sec]}) ونشره: أُشعر ${notified}${o.unassigned ? `، وبقي ${o.unassigned} غير موزّع` : ''}` });
    return { notified, ...overview(c.id, sec) };
  }));

  app.get('/api/days.xlsx', need(canPlan), (req, res) => {
    try {
      const c = comp(), sec = secOf(req, req.query.section), days = new Map(daysOf(c.id, sec).map((d) => [d.id, d]));
      const rows = personRows(c.id, sec, '');
      const head = ['اليوم', 'التاريخ', 'الاسم', 'رقم الهوية', 'الهاتف', 'الفئة', 'المشاركات', 'ملاحظة'];
      const line = (p, d) => [d ? dayName(d.day_no) : 'غير موزّع', d ? d.date : '', p.name, p.nationalId, p.phone, p.category,
        p.entries.filter((e) => (d ? e.dayId === d.id : !e.dayId)).map((e) => e.branch).join(' | '), p.entries.some((e) => e.checked) ? 'حضر' : ''];
      const sheets = [...days.values()].map((d) => ({ name: `${dayName(d.day_no)} ${d.date}`, rows: [head, ...rows.filter((p) => p.entries.some((e) => e.dayId === d.id)).map((p) => line(p, d))] }));
      const un = rows.filter((p) => p.entries.some((e) => !e.dayId));
      if (un.length) sheets.push({ name: 'غير موزّعين', rows: [head, ...un.map((p) => line(p, null))] });
      if (!sheets.length) sheets.push({ name: 'التوزيع', rows: [head] });
      audit(req.user, 'export', 'prelim_days', null, { section: sec, summary: `تصدير توزيع أيام التصفيات (${rows.length})` });
      require('./draws').sendXlsx(res, `iqra-days-${sec}.xlsx`, sheets);
    } catch (e) { if (!(e instanceof Bad)) console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e instanceof Bad ? e.message : 'حدث خطأ في الخادم' }); }
  });

  // المتسابق: يومه بعد نشر التوزيع
  app.get('/api/my/day', need((u) => u.role === 'contestant'), wrap((req) => {
    const c = comp();
    const es = db.prepare(`SELECT e.id, e.branch, e.branch_name, r.section, d.day_no, d.date, d.id day_id FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id
      JOIN day_assign a ON a.entry_id=e.id JOIN prelim_days d ON d.id=a.day_id WHERE p.user_id=? AND r.comp_id=? AND r.status='accepted' AND e.status='active'`).all(req.user.id, c.id);
    if (!es.length || !plan(c.id, es[0].section).published_at) return { days: [] };
    const ds = [...new Set(es.map((e) => e.day_id))].map((id) => es.find((e) => e.day_id === id)).sort((a, b) => a.day_no - b.day_no);
    return { days: ds.map((d) => { const br = es.filter((e) => e.day_id === d.day_id); const s = sessionFor(c.id, d.section, br.map((e) => e.branch));
      return { name: dayName(d.day_no), date: d.date, label: dateLabel(d.date), entryIds: br.map((e) => e.id), branches: br.map((e) => e.branch_name), time: s ? s.time : '', location: s ? s.location : '' }; }) };
  }));
}

// للاستقبال: يوم المشاركة (إن نُشر التوزيع) وهل هو اليوم
function dayOfEntry(entryId) {
  const r = db.prepare('SELECT d.*, pl.published_at FROM day_assign a JOIN prelim_days d ON d.id=a.day_id LEFT JOIN day_plans pl ON pl.comp_id=d.comp_id AND pl.section=d.section WHERE a.entry_id=?').get(entryId);
  if (!r) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone }).format(new Date());
  return { name: dayName(r.day_no), date: r.date, label: dateLabel(r.date), today: r.date === today, published: !!r.published_at };
}

module.exports = { routes, distribute, dayOfEntry, dayName };
