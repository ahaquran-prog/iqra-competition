'use strict';
const crypto = require('crypto');
// التشغيل الميداني: اللجان والتكليفات، الاستقبال وتثبيت الحضور، الطوابير والنداء، وشاشة الانتظار.
const db = require('./db');
const R = require('./rules');
const U = require('./util');
const { SECTIONS, STAGES, TICKET_ST, Bad, str, wrap, need, audit, isTop, scope, inScope, comp, jparse } = U;

const PAGE = 25;
const ACTIVE = ['called', 'testing'];
const stageOf = (v) => (STAGES[v] ? v : 'prelim');

// ---------- الصلاحيات ----------
const isMember = (u, cid, kind) => !!db.prepare(`SELECT 1 FROM committee_members WHERE committee_id=? AND user_id=?${kind ? ' AND kind=?' : ''}`).get(...[cid, u.id, ...(kind ? [kind] : [])]);
// إدارة اللجان والاستقبال: الإدارة التنفيذية لقسمها والعليا للقسمين
const canAdmin = (u) => ['exec', 'top'].includes(u.role);
// تشغيل النداء: العليا، ورئيس التحكيم والتنفيذية في القسم، والمنسق المكلَّف باللجنة فقط
const canOperate = (u, c) => inScope(u, c.section) && (['top', 'chief', 'exec'].includes(u.role) || isMember(u, c.id, 'coordinator'));
// رؤية طابور اللجنة: من يشغّلها، والمحكم المكلَّف بها
const canSee = (u, c) => canOperate(u, c) || (inScope(u, c.section) && isMember(u, c.id));

// ---------- أدوات ----------
const committeeRow = (id) => db.prepare('SELECT * FROM committees WHERE id=?').get(id);
function loadCommittee(u, id, test = canSee) {
  const c = committeeRow(+id);
  if (!c || !test(u, c)) throw new Bad('اللجنة غير موجودة', 404);
  return c;
}
const members = (cid) => db.prepare('SELECT m.kind, u.id, u.name, u.role, u.specialty FROM committee_members m JOIN users u ON u.id=m.user_id WHERE m.committee_id=? ORDER BY m.kind DESC, u.name').all(cid)
  .map((m) => ({ userId: m.id, name: m.name, kind: m.kind, role: m.role, specialty: m.specialty }));
function committeeJson(c, withMembers = true) {
  const tracks = jparse(c.tracks, []), cats = jparse(c.categories, []);
  const allCats = R.categoriesOf(c.comp_id), curr = R.curriculaOf(c.comp_id), br = R.branchesOf(c.comp_id).find((b) => b.code === c.branch);
  const trackNames = tracks.map((t) => (curr.find((x) => x.branch === c.branch && x.track === t) || {}).track_name || t);
  return {
    id: c.id, section: c.section, sectionName: SECTIONS[c.section], stage: c.stage, stageName: STAGES[c.stage], name: c.name, hall: c.hall, active: !!c.active,
    branch: c.branch, branchName: br ? br.name : c.branch, tracks, trackNames, categories: cats, categoryNames: cats.map((id) => (allCats.find((x) => x.id === id) || {}).name).filter(Boolean),
    members: withMembers ? members(c.id) : undefined,
  };
}
// اللجان المطابقة لمشاركة: القسم والمرحلة والفرع والمسار والفئة
// اللجان المطابقة لمشاركة، الأنسب أولًا: يُسجَّل المتسابق تلقائيًا في الأولى دون اختيار.
// الأنسب: المخصصة للمسار قبل العامة، ثم الأضيق فئات (المخصصة لفئته وحدها قبل المشتركة)، ثم الأقصر طابورًا، ثم ترتيب اللجان
function matches(compId, section, stage, entry, categoryId) {
  const load = (id) => db.prepare("SELECT COUNT(*) n FROM tickets WHERE committee_id=? AND stage=? AND status IN ('waiting','called','testing')").get(id, stage).n;
  return db.prepare('SELECT * FROM committees WHERE comp_id=? AND section=? AND stage=? AND branch=? AND active=1 ORDER BY sort, id').all(compId, section, stage, entry.branch)
    .map((c) => ({ c, t: jparse(c.tracks, []), k: jparse(c.categories, []) }))
    .filter((x) => (!x.t.length || x.t.includes(entry.track)) && (!x.k.length || x.k.includes(categoryId)))
    .map((x, i) => ({ ...x, i, load: load(x.c.id) }))
    .sort((a, b) => (b.t.length ? 1 : 0) - (a.t.length ? 1 : 0) || (a.k.length || 999) - (b.k.length || 999) || a.load - b.load || a.i - b.i)
    .map((x) => x.c);
}
// الفروع التي تحتاج حضور لجنة في المرحلة (لها لجان معرَّفة)
const branchesWithCommittees = (compId, stage) => new Set(db.prepare('SELECT DISTINCT branch FROM committees WHERE comp_id=? AND stage=?').all(compId, stage).map((x) => x.branch));
const busy = (compId, personId, exceptTicket = 0) => !!db.prepare(`SELECT 1 FROM tickets WHERE comp_id=? AND person_id=? AND id<>? AND status IN ('called','testing')`).get(compId, personId, exceptTicket);
const nextSeq = (compId, stage) => db.prepare('SELECT COALESCE(MAX(seq),0)+1 n FROM tickets WHERE comp_id=? AND stage=?').get(compId, stage).n;
const ticketSelect = `SELECT t.*, p.full_name, r.category_name, e.branch_name, e.track_name, e.branch, e.track, c.name AS committee_name, c.hall
  FROM tickets t JOIN people p ON p.id=t.person_id JOIN registrations r ON r.id=t.registration_id JOIN entries e ON e.id=t.entry_id LEFT JOIN committees c ON c.id=t.committee_id`;
const ticketJson = (t) => ({
  id: t.id, name: t.full_name, category: t.category_name, branchName: t.branch_name, trackName: t.track_name, committeeId: t.committee_id, committee: t.committee_name || '', hall: t.hall || '',
  stage: t.stage, status: t.status, statusName: TICKET_ST[t.status], seq: t.seq, arrivedAt: t.arrived_at, calledAt: t.called_at, startedAt: t.started_at, finishedAt: t.finished_at, calls: t.calls,
});
function loadTicket(u, id) {
  const t = db.prepare(ticketSelect + ' WHERE t.id=?').get(+id);
  if (!t || !inScope(u, t.section)) throw new Bad('التذكرة غير موجودة', 404);
  return t;
}

module.exports = function field(app) {
  // ---------- اللجان ----------
  app.get('/api/committees', wrap((req) => {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage);
    let rows;
    if (['top', 'exec', 'chief'].includes(u.role)) {
      const sec = scope(u, req.query.section);
      rows = db.prepare(`SELECT * FROM committees WHERE comp_id=? AND stage=?${sec ? ' AND section=?' : ''} ORDER BY section, sort, id`).all(...[c.id, stage, ...(sec ? [sec] : [])]);
    } else if (['judge', 'coordinator'].includes(u.role)) {
      rows = db.prepare('SELECT c.* FROM committees c JOIN committee_members m ON m.committee_id=c.id WHERE m.user_id=? AND c.comp_id=? AND c.stage=? AND c.section=? ORDER BY c.sort').all(u.id, c.id, stage, u.section);
    } else throw new Bad('لا تملك صلاحية لهذا الإجراء', 403);
    return { stage, stageName: STAGES[stage], committees: rows.map((x) => ({ ...committeeJson(x), canOperate: canOperate(u, x), canAdmin: canAdmin(u) && inScope(u, x.section) })) };
  }));

  function committeeFields(b, c, section) {
    const br = R.branchesOf(c.id).find((x) => x.code === b.branch && x.registrable);
    if (!br) throw new Bad('اختر فرع اللجنة');
    const known = new Set(R.curriculaOf(c.id).filter((x) => x.branch === br.code).map((x) => x.track));
    const tracks = (Array.isArray(b.tracks) ? b.tracks : []).filter((t) => known.has(t));
    const catIds = new Set(R.categoriesOf(c.id).filter((x) => x.branches.includes(br.code)).map((x) => x.id));
    const categories = (Array.isArray(b.categories) ? b.categories : []).map(Number).filter((x) => catIds.has(x));
    return { name: str(b.name, 80, 'اسم اللجنة'), hall: str(b.hall, 60, 'القاعة أو الموقع', false), branch: br.code, tracks, categories, section, stage: stageOf(b.stage) };
  }
  app.post('/api/committees', need(canAdmin), wrap((req) => {
    const c = comp(), u = req.user, b = req.body || {};
    const section = isTop(u) ? b.section : u.section;
    if (!SECTIONS[section]) throw new Bad('اختر قسم اللجنة');
    const f = committeeFields(b, c, section);
    if (db.prepare('SELECT 1 FROM committees WHERE comp_id=? AND section=? AND stage=? AND name=?').get(c.id, section, f.stage, f.name)) throw new Bad('توجد لجنة بهذا الاسم في القسم والمرحلة', 409);
    const sort = db.prepare('SELECT COALESCE(MAX(sort),0)+1 n FROM committees WHERE comp_id=? AND section=?').get(c.id, section).n;
    const id = db.prepare('INSERT INTO committees(comp_id,section,stage,name,branch,tracks,categories,hall,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(c.id, section, f.stage, f.name, f.branch, JSON.stringify(f.tracks), JSON.stringify(f.categories), f.hall, sort, Date.now()).lastInsertRowid;
    audit(u, 'create', 'committee', id, { section, summary: `إنشاء لجنة «${f.name}»`, after: f });
    return { committee: committeeJson(committeeRow(id)) };
  }));
  app.put('/api/committees/:id', need(canAdmin), wrap((req) => {
    const u = req.user, old = loadCommittee(u, req.params.id, (x, c) => inScope(x, c.section)), b = req.body || {};
    const f = committeeFields({ ...b, stage: old.stage }, comp(), old.section);
    const used = db.prepare("SELECT COUNT(*) n FROM tickets WHERE committee_id=? AND status<>'cancelled'").get(old.id).n;
    const scopeChanged = f.branch !== old.branch || JSON.stringify(f.tracks) !== old.tracks || JSON.stringify(f.categories) !== old.categories;
    if (used && scopeChanged) throw new Bad('لا يُغيَّر فرع اللجنة أو مسارها أو فئاتها بعد بدء الحضور فيها. أنشئ لجنة جديدة أو انقل الحاضرين أولًا.', 409);
    const active = b.active === undefined ? old.active : b.active ? 1 : 0;
    if (!active && old.active && db.prepare(`SELECT 1 FROM tickets WHERE committee_id=? AND status IN ('waiting','called','testing')`).get(old.id))
      throw new Bad('في اللجنة متسابقون منتظرون أو جاري اختبارهم. انقلهم إلى لجنة أخرى قبل الإيقاف.', 409);
    if (f.name !== old.name && db.prepare('SELECT 1 FROM committees WHERE comp_id=? AND section=? AND stage=? AND name=? AND id<>?').get(old.comp_id, old.section, old.stage, f.name, old.id)) throw new Bad('توجد لجنة بهذا الاسم', 409);
    db.prepare('UPDATE committees SET name=?,hall=?,branch=?,tracks=?,categories=?,active=? WHERE id=?').run(f.name, f.hall, f.branch, JSON.stringify(f.tracks), JSON.stringify(f.categories), active, old.id);
    audit(u, 'update', 'committee', old.id, { section: old.section, summary: `تعديل لجنة «${f.name}»`, before: committeeJson(old, false), after: { ...f, active } });
    return { committee: committeeJson(committeeRow(old.id)) };
  }));
  app.delete('/api/committees/:id', need(canAdmin), wrap((req) => {
    const u = req.user, c = loadCommittee(u, req.params.id, (x, k) => inScope(x, k.section));
    if (db.prepare('SELECT 1 FROM tickets WHERE committee_id=?').get(c.id)) throw new Bad('لا تُحذف لجنة لها سجل حضور؛ أوقفها بدل الحذف', 409);
    db.transaction(() => { db.prepare('DELETE FROM committee_members WHERE committee_id=?').run(c.id); db.prepare('DELETE FROM committees WHERE id=?').run(c.id); })();
    audit(u, 'delete', 'committee', c.id, { section: c.section, summary: `حذف لجنة «${c.name}»`, before: committeeJson(c, false) });
    return { ok: true };
  }));

  // المستخدمون القابلون للتكليف في القسم
  app.get('/api/staff', need(canAdmin), wrap((req) => {
    const sec = scope(req.user, req.query.section);
    const rows = db.prepare(`SELECT id,name,role,section,specialty FROM users WHERE active=1 AND role IN ('judge','coordinator','exec','chief')${sec ? ' AND section=?' : ''} ORDER BY role, name`).all(...(sec ? [sec] : []));
    return { staff: rows.map((x) => ({ id: x.id, name: x.name, role: x.role, roleName: U.ROLES[x.role], section: x.section, specialty: x.specialty })) };
  }));
  app.post('/api/committees/:id/members', need(canAdmin), wrap((req) => {
    const u = req.user, c = loadCommittee(u, req.params.id, (x, k) => inScope(x, k.section)), b = req.body || {};
    const m = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(+b.userId);
    if (!m || m.section !== c.section) throw new Bad('اختر مستخدمًا من قسم اللجنة نفسه');
    const kind = b.kind === 'coordinator' ? 'coordinator' : 'judge';
    if (kind === 'judge' && m.role !== 'judge') throw new Bad('التكليف بالتحكيم لحسابات المحكمين فقط');
    if (kind === 'coordinator' && !['coordinator', 'judge', 'exec'].includes(m.role)) throw new Bad('صلاحية النداء لمنسق أو محكم أو موظف تنفيذي');
    db.prepare('INSERT INTO committee_members(committee_id,user_id,kind,created_at) VALUES (?,?,?,?) ON CONFLICT(committee_id,user_id) DO UPDATE SET kind=excluded.kind').run(c.id, m.id, kind, Date.now());
    audit(u, 'assign', 'committee', c.id, { section: c.section, summary: `تكليف ${m.name} ${kind === 'judge' ? 'محكمًا' : 'منسقًا للنداء'} في «${c.name}»` });
    return { committee: committeeJson(committeeRow(c.id)) };
  }));
  app.delete('/api/committees/:id/members/:uid', need(canAdmin), wrap((req) => {
    const u = req.user, c = loadCommittee(u, req.params.id, (x, k) => inScope(x, k.section));
    const m = db.prepare('SELECT name FROM users WHERE id=?').get(+req.params.uid);
    db.prepare('DELETE FROM committee_members WHERE committee_id=? AND user_id=?').run(c.id, +req.params.uid);
    audit(u, 'unassign', 'committee', c.id, { section: c.section, summary: `إلغاء تكليف ${m ? m.name : ''} من «${c.name}»` });
    return { committee: committeeJson(committeeRow(c.id)) };
  }));

  // ---------- الاستقبال وتثبيت الحضور ----------
  app.get('/api/reception', need(canAdmin), wrap((req) => {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage), sec = scope(u, req.query.section);
    const where = ["r.comp_id=?", "r.status='accepted'"], args = [c.id];
    if (sec) { where.push('r.section=?'); args.push(sec); }
    const text = R.cleanName(req.query.q).slice(0, 80);
    if (text) { const d = R.toLatin(text).replace(/[\s-]/g, ''); where.push('(p.full_name LIKE ? OR p.national_id LIKE ? OR p.phone LIKE ?)'); args.push('%' + text + '%', '%' + d + '%', '%' + d + '%'); }
    if (req.query.category) { where.push('r.category_id=?'); args.push(+req.query.category); }
    // المسار: «الفرع:المسار» مثل hifz:j5 أو tilawa:tadweer. يظهر من له مشاركة قائمة فيه (ومتأهلة في المراحل اللاحقة)
    const [fb, ft] = String(req.query.track || '').split(':');
    if (fb && ft) {
      where.push(`EXISTS (SELECT 1 FROM entries fe WHERE fe.registration_id=r.id AND fe.status='active' AND fe.branch=? AND fe.track=?${stage !== 'prelim' ? " AND EXISTS (SELECT 1 FROM qualifications fq WHERE fq.entry_id=fe.id AND fq.to_stage=? AND fq.status='qualified')" : ''})`);
      args.push(fb, ft, ...(stage !== 'prelim' ? [stage] : []));
    }
    let rows = db.prepare(`SELECT r.id, r.section, r.category_id, r.category_name, p.id AS person_id, p.full_name, p.phone FROM registrations r JOIN people p ON p.id=r.person_id WHERE ${where.join(' AND ')}`).all(...args);
    const withC = branchesWithCommittees(c.id, stage);
    // في قبل النهائي والنهائي: المشاركات المتأهلة بقرار معتمد فقط
    const okFor = (e) => stage === 'prelim' || !!db.prepare("SELECT 1 FROM qualifications WHERE entry_id=? AND to_stage=? AND status='qualified'").get(e.id, stage);
    if (stage !== 'prelim') rows = rows.filter((r) => db.prepare("SELECT 1 FROM qualifications q JOIN entries e ON e.id=q.entry_id WHERE e.registration_id=? AND q.to_stage=? AND q.status='qualified'").get(r.id, stage));
    const pick = (r) => db.prepare("SELECT * FROM entries WHERE registration_id=? AND status='active' ORDER BY id").all(r.id).filter(okFor).map((e) => {
      const t = db.prepare(ticketSelect + ' WHERE t.entry_id=? AND t.stage=?').get(e.id, stage);
      const needs = withC.has(e.branch);
      return { id: e.id, branch: e.branch, branchName: e.branch_name, trackName: e.track_name, needsCommittee: needs, ticket: t ? ticketJson(t) : null,
        day: stage === 'prelim' && needs ? require('./days').dayOfEntry(e.id) : null,
        candidates: needs ? matches(c.id, r.section, stage, e, r.category_id).map((x) => ({ id: x.id, name: x.name, hall: x.hall })) : [] };
    });
    const st = req.query.state;
    // الأسماء مرتبة أبجديًا للبحث؛ والفلترة قبل التقسيم إلى صفحات
    const coll = new Intl.Collator('ar');
    rows.sort((a, b) => coll.compare(a.full_name, b.full_name) || a.id - b.id);
    if (st === 'today' && stage === 'prelim') {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: require('./config').timeZone }).format(new Date());
      rows = rows.filter((r) => db.prepare('SELECT 1 FROM entries e JOIN day_assign a ON a.entry_id=e.id JOIN prelim_days d ON d.id=a.day_id WHERE e.registration_id=? AND d.date=?').get(r.id, today));
    }
    if (st === 'present' || st === 'absent') rows = rows.filter((r) => { const has = !!db.prepare("SELECT 1 FROM tickets WHERE registration_id=? AND stage=? AND status<>'cancelled'").get(r.id, stage); return st === 'present' ? has : !has; });
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const counts = db.prepare(`SELECT COUNT(DISTINCT t.person_id) persons, SUM(t.status='waiting') waiting, SUM(t.status='needs_committee') needs, SUM(t.status IN ('called','testing')) active, SUM(t.status='done') done
      FROM tickets t WHERE t.comp_id=? AND t.stage=? AND t.status<>'cancelled'${sec ? ' AND t.section=?' : ''}`).get(...[c.id, stage, ...(sec ? [sec] : [])]);
    return { stage, stageName: STAGES[stage], total: rows.length, page, pageSize: PAGE, counts,
      rows: rows.slice((page - 1) * PAGE, page * PAGE).map((r) => ({ id: r.id, name: r.full_name, phone: r.phone, section: r.section, sectionName: SECTIONS[r.section], category: r.category_name, entries: pick(r) })) };
  }));

  // تثبيت حضور مشاركة أو أكثر: تذكرة واحدة لكل مشاركة في المرحلة، ورقم وصول من الخادم
  // تثبيت الحضور لمشاركات تسجيل في مرحلة (مشترك بين زر «حضر» ومسح رمز QR)
  function doCheckin(u, reg, stage, items) {
    const c = comp();
    if (reg.status !== 'accepted') throw new Bad('لا يُسجَّل حضور طلب غير مقبول');
    if (!items.length) throw new Bad('اختر مشاركة واحدة على الأقل');
    const withC = branchesWithCommittees(c.id, stage), now = Date.now();
    return db.transaction(() => items.map((it) => {
      const e = db.prepare("SELECT * FROM entries WHERE id=? AND registration_id=? AND status='active'").get(+it.entryId, reg.id);
      if (!e) throw new Bad('مشاركة غير صحيحة');
      if (!withC.has(e.branch)) throw new Bad(`فرع ${e.branch_name} لا يحتاج حضور لجنة في هذه المرحلة`);
      if (stage !== 'prelim' && !db.prepare("SELECT 1 FROM qualifications WHERE entry_id=? AND to_stage=? AND status='qualified'").get(e.id, stage)) throw new Bad(`مشاركة ${e.branch_name} غير متأهلة إلى ${STAGES[stage]}`);
      const old = db.prepare('SELECT * FROM tickets WHERE entry_id=? AND stage=?').get(e.id, stage);
      if (old && old.status !== 'cancelled') return { id: old.id, again: true }; // النقر المتكرر أو جهاز ثانٍ أو مسح مكرر: لا تذكرة جديدة
      const cands = matches(c.id, reg.section, stage, e, reg.category_id);
      let cid = null;
      if (it.committeeId) { cid = +it.committeeId; if (!cands.some((x) => x.id === cid)) throw new Bad(`اللجنة المختارة لا تطابق مشاركة ${e.branch_name}`); }
      else if (cands.length) cid = cands[0].id; // اللجنة المخصصة لفئته ومقرره تلقائيًا
      const status = cid ? 'waiting' : 'needs_committee', seq = nextSeq(c.id, stage);
      let id;
      if (old) { db.prepare('UPDATE tickets SET committee_id=?, status=?, seq=?, arrived_at=?, called_at=NULL, started_at=NULL, finished_at=NULL, calls=0, created_by=?, updated_at=? WHERE id=?').run(cid, status, seq, now, u.id, now, old.id); id = old.id; }
      else id = db.prepare('INSERT INTO tickets(comp_id,entry_id,registration_id,person_id,section,stage,committee_id,status,seq,arrived_at,created_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(c.id, e.id, reg.id, reg.person_id, reg.section, stage, cid, status, seq, now, u.id, now).lastInsertRowid;
      audit(u, 'checkin', 'registration', reg.id, { section: reg.section, summary: `تثبيت حضور ${e.branch_name}${e.track_name ? ' · ' + e.track_name : ''} (${STAGES[stage]}) برقم وصول ${seq}${items.via === 'qr' ? ' بمسح رمز QR' : ''}` });
      return { id, again: false };
    }))();
  }
  app.post('/api/checkin', need(canAdmin), wrap((req) => {
    const u = req.user, c = comp(), b = req.body || {}, stage = stageOf(b.stage);
    const reg = db.prepare('SELECT * FROM registrations WHERE id=? AND comp_id=?').get(+b.registrationId, c.id);
    if (!reg || !inScope(u, reg.section)) throw new Bad('التسجيل غير موجود', 404);
    const out = doCheckin(u, reg, stage, Array.isArray(b.items) ? b.items : []);
    return { tickets: out.map((x) => ticketJson(db.prepare(ticketSelect + ' WHERE t.id=?').get(x.id))) };
  }));

  // ---------- رمز QR للحضور ----------
  // لكل تسجيل رمز عشوائي لا يُخمَّن. الرمز رابط إلى المنصة؛ لا يكشف شيئًا لغير الإدارة المسجّلة الدخول
  const QR = require('qrcode-generator');
  const tokenOf = (reg) => {
    if (reg.qr_token) return reg.qr_token;
    const t = crypto.randomBytes(16).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    db.prepare('UPDATE registrations SET qr_token=? WHERE id=? AND qr_token IS NULL').run(t, reg.id);
    return db.prepare('SELECT qr_token FROM registrations WHERE id=?').get(reg.id).qr_token;
  };
  const codeToken = (code) => { const m = String(code || '').trim().match(/(?:#qr\/|^IQRA:)?([A-Za-z0-9_-]{16,64})\s*$/); return m ? m[1] : null; };
  const regByCode = (u, code) => {
    const t = codeToken(code); if (!t) throw new Bad('رمز غير صالح');
    const reg = db.prepare('SELECT * FROM registrations WHERE qr_token=? AND comp_id=?').get(t, comp().id);
    if (!reg) throw new Bad('الرمز لا يخص متسابقًا في هذه الدورة', 404);
    if (!inScope(u, reg.section)) throw new Bad('المتسابق من القسم الآخر', 403);
    return reg;
  };
  // المشاركات التي تحتاج حضورًا في المرحلة: فرع له لجان، ومؤهلة لما بعد التصفيات
  function dueEntries(reg, stage) {
    const withC = branchesWithCommittees(reg.comp_id, stage);
    return db.prepare("SELECT * FROM entries WHERE registration_id=? AND status='active'").all(reg.id)
      .filter((e) => withC.has(e.branch) && (stage === 'prelim' || db.prepare("SELECT 1 FROM qualifications WHERE entry_id=? AND to_stage=? AND status='qualified'").get(e.id, stage)));
  }
  function qrInfo(reg, stage) {
    const p = db.prepare('SELECT full_name, national_id FROM people WHERE id=?').get(reg.person_id);
    const st = stage || ['final', 'semi'].find((s) => dueEntries(reg, s).length) || 'prelim';
    const D = require('./days');
    return { registrationId: reg.id, name: p.full_name, nationalIdTail: String(p.national_id).slice(-4), section: reg.section, sectionName: SECTIONS[reg.section], category: reg.category_name, stage: st, stageName: STAGES[st],
      entries: dueEntries(reg, st).map((e) => { const t = db.prepare("SELECT * FROM tickets WHERE entry_id=? AND stage=? AND status<>'cancelled'").get(e.id, st);
        return { id: e.id, branchName: e.branch_name, trackName: e.track_name, checkedIn: !!t, seq: t ? t.seq : null, day: st === 'prelim' ? D.dayOfEntry(e.id) : null }; }) };
  }
  app.get('/api/my/qr', need((u) => u.role === 'contestant'), wrap((req) => {
    const reg = db.prepare('SELECT r.* FROM registrations r JOIN people p ON p.id=r.person_id WHERE p.user_id=? AND r.comp_id=?').get(req.user.id, comp().id);
    if (!reg || reg.status !== 'accepted') return { qr: null };
    const origin = req.protocol && req.get('host') ? `${req.protocol}://${req.get('host')}` : globalThis.location ? globalThis.location.origin + globalThis.location.pathname.replace(/\/$/, '') : '';
    const url = `${origin}/#qr/${tokenOf(reg)}`;
    const q = QR(0, 'M'); q.addData(url); q.make();
    return { qr: { url, svg: q.createSvgTag({ cellSize: 6, margin: 3, scalable: true }) } };
  }));
  // معاينة صاحب الرمز (عند فتح الرابط بكاميرا الهاتف أو كتابة الرمز)
  app.get('/api/checkin/qr', need(canAdmin), wrap((req) => {
    const reg = regByCode(req.user, req.query.code);
    return qrInfo(reg, req.query.stage ? stageOf(req.query.stage) : null);
  }));
  // المسح = تسجيل الحضور مباشرة لكل مشاركاته المستحقة في المرحلة
  app.post('/api/checkin/qr', need(canAdmin), wrap((req) => {
    const b = req.body || {}, stage = stageOf(b.stage), reg = regByCode(req.user, b.code);
    const due = dueEntries(reg, stage);
    if (!due.length) throw new Bad(stage === 'prelim' ? 'لا مشاركات تحتاج حضورًا في التصفيات لهذا المتسابق' : `المتسابق غير متأهل إلى ${STAGES[stage]}`, 409);
    const items = due.map((e) => ({ entryId: e.id })); items.via = 'qr';
    const out = doCheckin(req.user, reg, stage, items);
    const info = qrInfo(reg, stage);
    return { ...info, already: out.every((x) => x.again), tickets: out.map((x) => ticketJson(db.prepare(ticketSelect + ' WHERE t.id=?').get(x.id))),
      warnings: stage === 'prelim' ? info.entries.filter((e) => e.day && e.day.published && !e.day.today).map((e) => `${e.branchName}: يومه ${e.day.name} (${e.day.label})، وليس اليوم`) : [] };
  }));

  app.post('/api/tickets/:id/assign', need((u) => ['exec', 'chief', 'top'].includes(u.role)), wrap((req) => {
    const u = req.user, t = loadTicket(u, req.params.id), cid = +(req.body || {}).committeeId;
    if (!['needs_committee', 'waiting'].includes(t.status)) throw new Bad('لا تُنقل إلا تذكرة منتظرة');
    const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(t.registration_id);
    if (!matches(t.comp_id, t.section, t.stage, t, reg.category_id).some((x) => x.id === cid)) throw new Bad('اللجنة لا تطابق القسم والفرع والمسار والفئة');
    db.prepare("UPDATE tickets SET committee_id=?, status='waiting', updated_at=? WHERE id=?").run(cid, Date.now(), t.id); // يحتفظ برقم وصوله الأصلي
    audit(u, 'assign', 'ticket', t.id, { section: t.section, summary: `إسناد ${t.full_name} إلى «${committeeRow(cid).name}»`, before: { committee: t.committee_name }, reason: str((req.body || {}).reason, 300, 'السبب', false) });
    return { ticket: ticketJson(db.prepare(ticketSelect + ' WHERE t.id=?').get(t.id)) };
  }));
  app.post('/api/tickets/:id/cancel', need(canAdmin), wrap((req) => {
    const u = req.user, t = loadTicket(u, req.params.id);
    if (!['needs_committee', 'waiting', 'no_show'].includes(t.status)) throw new Bad('لا يُلغى حضور متسابق نودي أو بدأ اختباره');
    const reason = str((req.body || {}).reason, 300, 'سبب الإلغاء');
    db.prepare("UPDATE tickets SET status='cancelled', updated_at=? WHERE id=?").run(Date.now(), t.id);
    audit(u, 'cancel', 'ticket', t.id, { section: t.section, summary: `إلغاء حضور ${t.full_name} في ${t.branch_name}`, before: { status: t.status, seq: t.seq }, reason });
    return { ok: true };
  }));

  // ---------- الطوابير والنداء ----------
  app.get('/api/queues', wrap((req) => {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage);
    let list;
    if (['top', 'exec', 'chief'].includes(u.role)) { const sec = scope(u, req.query.section); list = db.prepare(`SELECT * FROM committees WHERE comp_id=? AND stage=? AND active=1${sec ? ' AND section=?' : ''} ORDER BY section, sort, id`).all(...[c.id, stage, ...(sec ? [sec] : [])]); }
    else if (['judge', 'coordinator'].includes(u.role)) list = db.prepare('SELECT c.* FROM committees c JOIN committee_members m ON m.committee_id=c.id WHERE m.user_id=? AND c.comp_id=? AND c.stage=? AND c.active=1 AND c.section=? ORDER BY c.sort').all(u.id, c.id, stage, u.section);
    else throw new Bad('لا تملك صلاحية لهذا الإجراء', 403);
    const committees = list.map((k) => {
      const cur = db.prepare(ticketSelect + ` WHERE t.committee_id=? AND t.status IN ('called','testing') ORDER BY t.called_at LIMIT 1`).get(k.id);
      const waiting = db.prepare(ticketSelect + " WHERE t.committee_id=? AND t.status='waiting' ORDER BY t.seq").all(k.id);
      const n = db.prepare("SELECT SUM(status='done') done, COUNT(*) total FROM tickets WHERE committee_id=? AND status<>'cancelled'").get(k.id);
      return { ...committeeJson(k, false), canOperate: canOperate(u, k), current: cur ? ticketJson(cur) : null, done: n.done || 0, total: n.total || 0,
        waiting: waiting.map((t) => ({ ...ticketJson(t), busy: busy(c.id, t.person_id, t.id) })) };
    });
    const sec = scope(u, req.query.section);
    const needs = ['top', 'exec', 'chief'].includes(u.role) ? db.prepare(ticketSelect + ` WHERE t.comp_id=? AND t.stage=? AND t.status='needs_committee'${sec ? ' AND t.section=?' : ''} ORDER BY t.seq`).all(...[c.id, stage, ...(sec ? [sec] : [])])
      .map((t) => { const reg = db.prepare('SELECT category_id FROM registrations WHERE id=?').get(t.registration_id); return { ...ticketJson(t), candidates: matches(c.id, t.section, stage, t, reg.category_id).map((x) => ({ id: x.id, name: x.name })) }; }) : [];
    return { stage, stageName: STAGES[stage], committees, needsCommittee: needs, at: Date.now() };
  }));

  // نداء التالي: أقدم منتظر في اللجنة غير مشغول في لجنة أخرى، داخل معاملة واحدة
  app.post('/api/committees/:id/next', wrap((req) => {
    const u = req.user, k = loadCommittee(u, req.params.id, canOperate);
    const t = db.transaction(() => {
      if (db.prepare("SELECT 1 FROM tickets WHERE committee_id=? AND status IN ('called','testing')").get(k.id)) throw new Bad('في اللجنة متسابق حالي. أنهِ اختباره أو سجّل عدم استجابته أولًا.', 409);
      const waiting = db.prepare("SELECT * FROM tickets WHERE committee_id=? AND status='waiting' ORDER BY seq").all(k.id);
      if (!waiting.length) throw new Bad('لا يوجد متسابقون منتظرون في هذه اللجنة');
      const pick = waiting.find((x) => !busy(k.comp_id, x.person_id));
      if (!pick) throw new Bad('المنتظرون في هذه اللجنة يُختبرون الآن في لجان أخرى. أعد المحاولة بعد قليل.', 409);
      const now = Date.now();
      db.prepare("UPDATE tickets SET status='called', called_at=?, calls=calls+1, updated_at=? WHERE id=? AND status='waiting'").run(now, now, pick.id);
      const ev = db.prepare("INSERT INTO call_events(at,section,committee_id,ticket_id,kind,by_user) VALUES (?,?,?,?,'call',?)").run(now, k.section, k.id, pick.id, u.id).lastInsertRowid;
      return [pick, ev];
    })().slice();
    require('./notify').events.called(t[0], k.name, k.hall, t[1]);
    return { ticket: ticketJson(db.prepare(ticketSelect + ' WHERE t.id=?').get(t[0].id)) };
  }));

  app.post('/api/tickets/:id/action', wrap((req) => {
    const u = req.user, t = loadTicket(u, req.params.id), a = (req.body || {}).action;
    const k = committeeRow(t.committee_id);
    if (!k || !canOperate(u, k)) throw new Bad('لا تملك صلاحية تشغيل هذه اللجنة', 403);
    const now = Date.now();
    db.transaction(() => {
      if (a === 'recall') {
        if (t.status !== 'called') throw new Bad('إعادة النداء لمتسابق نودي ولم يبدأ اختباره');
        db.prepare('UPDATE tickets SET calls=calls+1, called_at=?, updated_at=? WHERE id=?').run(now, now, t.id);
        const ev = db.prepare("INSERT INTO call_events(at,section,committee_id,ticket_id,kind,by_user) VALUES (?,?,?,?,'recall',?)").run(now, t.section, k.id, t.id, u.id).lastInsertRowid;
        setTimeout(() => require('./notify').events.called(t, k.name, k.hall, ev), 0);
      } else if (a === 'start') {
        if (t.status !== 'called') throw new Bad('يبدأ الاختبار بعد النداء');
        db.prepare("UPDATE tickets SET status='testing', started_at=?, updated_at=? WHERE id=?").run(now, now, t.id);
      } else if (a === 'noshow') {
        if (t.status !== 'called') throw new Bad('«لم يستجب» لمتسابق نودي ولم يحضر');
        // يُعاد إلى نهاية الطابور برقم جديد، ويُحفظ وقت حضوره الأصلي وعدد النداءات
        db.prepare("UPDATE tickets SET status='waiting', seq=?, updated_at=? WHERE id=?").run(nextSeq(t.comp_id, t.stage), now, t.id);
        audit(u, 'noshow', 'ticket', t.id, { section: t.section, summary: `${t.full_name} لم يستجب للنداء في «${k.name}»، وأُعيد إلى نهاية الطابور`, before: { seq: t.seq } });
      } else if (a === 'finish') {
        if (t.status !== 'testing') throw new Bad('ينتهي الاختبار بعد بدئه');
        db.prepare("UPDATE tickets SET status='done', finished_at=?, updated_at=? WHERE id=?").run(now, now, t.id);
      } else throw new Bad('إجراء غير معروف');
    })();
    return { ticket: ticketJson(db.prepare(ticketSelect + ' WHERE t.id=?').get(t.id)) };
  }));

  // ---------- شاشة الانتظار: الاسم واللجنة والقاعة والحالة فقط ----------
  app.get('/api/screen', need((u) => ['screen', 'exec', 'chief', 'top'].includes(u.role)), wrap((req) => {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage);
    const sec = isTop(u) ? (SECTIONS[req.query.section] ? req.query.section : 'M') : u.section;
    if (!sec) throw new Bad('الحساب غير مرتبط بقسم', 403);
    const since = Math.max(0, parseInt(req.query.since, 10) || 0);
    const committees = db.prepare('SELECT * FROM committees WHERE comp_id=? AND section=? AND stage=? AND active=1 ORDER BY sort, id').all(c.id, sec, stage).map((k) => {
      const cur = db.prepare(`SELECT t.status, p.full_name FROM tickets t JOIN people p ON p.id=t.person_id WHERE t.committee_id=? AND t.status IN ('called','testing') ORDER BY t.called_at LIMIT 1`).get(k.id);
      const w = db.prepare("SELECT COUNT(*) n FROM tickets WHERE committee_id=? AND status='waiting'").get(k.id).n;
      return { id: k.id, name: k.name, hall: k.hall, waiting: w, current: cur ? { name: cur.full_name, status: cur.status, statusName: TICKET_ST[cur.status] } : null };
    });
    const ev = db.prepare(`SELECT e.id, e.at, e.kind, p.full_name, k.name AS committee, k.hall FROM call_events e JOIN tickets t ON t.id=e.ticket_id JOIN people p ON p.id=t.person_id JOIN committees k ON k.id=e.committee_id
      WHERE e.section=? AND t.comp_id=? AND t.stage=? ORDER BY e.id DESC LIMIT 12`).all(sec, c.id, stage);
    return { section: sec, sectionName: SECTIONS[sec], stageName: STAGES[stage], competition: c.name, committees,
      calls: ev.map((e) => ({ id: e.id, at: e.at, kind: e.kind, name: e.full_name, committee: e.committee, hall: e.hall, fresh: e.id > since })), lastId: ev.length ? ev[0].id : since };
  }));

  // ---------- المتسابق: حالته في الطابور ----------
  app.get('/api/my/queue', need((u) => u.role === 'contestant'), wrap((req) => {
    const c = comp(), p = db.prepare('SELECT id FROM people WHERE user_id=?').get(req.user.id);
    if (!p) return { tickets: [] };
    const rows = db.prepare(ticketSelect + " WHERE t.person_id=? AND t.comp_id=? AND t.status<>'cancelled' ORDER BY t.stage, t.seq").all(p.id, c.id);
    return { tickets: rows.map((t) => ({ entryId: t.entry_id, stageName: STAGES[t.stage], status: t.status, statusName: TICKET_ST[t.status], committee: t.committee_name || '', hall: t.hall || '',
      ahead: t.status === 'waiting' ? db.prepare("SELECT COUNT(*) n FROM tickets WHERE committee_id=? AND status='waiting' AND seq<?").get(t.committee_id, t.seq).n : null })) };
  }));
};
