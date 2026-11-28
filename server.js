'use strict';
const path = require('path');
const express = require('express');
const config = require('./lib/config');
const db = require('./lib/db');
const auth = require('./lib/auth');
const R = require('./lib/rules');
const { seedIfEmpty, copyCompetition } = require('./lib/seed');

const U = require('./lib/util');
const { ROLES, SECTIONS, REG_ST, COMP_ST, SPECIALTIES, Bad, str, wrap, need, audit, isTop, scope, inScope, comp } = U;
const PAGE = 25;

// ---------- الصلاحيات (تُفحص هنا على الخادم في كل طلب) ----------
const canSeeRegs = (u) => ['exec', 'chief', 'top'].includes(u.role);     // قائمة التسجيلات
const canManageRegs = (u) => ['exec', 'top'].includes(u.role);           // المراجعة والتصحيح والتصدير

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
// رفع المذكرات وحده يقبل طلبًا كبيرًا (الملف بترميز base64)، وبقية الطلبات محدودة
const bigJson = express.json({ limit: Math.ceil(config.materialMaxMB * 1.4 + 1) + 'mb' }), smallJson = express.json({ limit: '200kb' });
app.use((req, res, next) => ((req.method === 'POST' || req.method === 'PUT') && (/^\/api\/admin\/(materials(\/\d+\/file)?|bank\/import)$/.test(req.path) || /^\/api\/tests\/\d+\/import-xlsx$/.test(req.path)) ? bigJson : smallJson)(req, res, next));
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'حجم الطلب أكبر من المسموح' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'صيغة الطلب غير صحيحة' });
  next(err);
});
app.use(auth.loadUser);
app.use('/api', auth.csrf);
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// ---------- أدوات ----------
const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name, phone: u.phone, email: u.email, role: u.role, roleName: ROLES[u.role], section: u.section, sectionName: SECTIONS[u.section] || (u.role === 'top' ? 'القسمان' : ''), specialty: u.specialty, active: !!u.active, mustChange: !!u.must_change, createdAt: u.created_at, lastLogin: u.last_login });
const compJson = (c) => ({ id: c.id, name: c.name, number: c.number, year: c.year, regOpen: c.reg_open, regClose: c.reg_close, editClose: c.edit_close, status: c.status, statusName: COMP_ST[c.status], minBirthYear: c.min_birth_year, notes: c.notes, state: R.regState(c) });

// ---------- عام ----------
app.get('/api/health', (req, res) => { try { db.prepare('SELECT 1').get(); res.json({ ok: true }); } catch (e) { res.status(503).json({ ok: false }); } });
app.get('/api/meta', (req, res) => res.json({ org: config.orgName, roles: ROLES, sections: SECTIONS, regStatuses: REG_ST, compStatuses: COMP_ST, specialties: SPECIALTIES, allowSignup: config.allowSignup, thisYear: R.thisYear() }));

// تعريف المسابقة قبل التسجيل: الفروع والفئات وسنواتها والمقررات
app.get('/api/public', wrap(() => {
  const c = R.current();
  if (!c) return { competition: null };
  const cats = R.categoriesOf(c.id);
  return {
    competition: compJson(c),
    branches: R.branchesOf(c.id).map((b) => ({ code: b.code, name: b.name, intro: b.intro, conditions: b.conditions, stages: b.stages, registrable: !!b.registrable })),
    categories: cats.map((x) => ({ id: x.id, name: x.name, fromYear: x.from_year, toYear: x.to_year, branches: x.branches })),
    curricula: R.curriculaOf(c.id).map((x) => ({ id: x.id, branch: x.branch, track: x.track, trackName: x.track_name, categoryId: x.category_id, content: x.content, surah: x.surah, ayahFrom: x.ayah_from, ayahTo: x.ayah_to })),
  };
}));

app.post('/api/login', wrap((req, res) => {
  const raw = str(req.body.login, 64, 'رقم الهوية أو اسم المستخدم');
  const login = R.normId(raw) || raw;
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const key = (req.ip || '') + '|' + login.toLowerCase();
  if (auth.tooMany(key)) throw new Bad('محاولات كثيرة خاطئة. انتظر 15 دقيقة ثم حاول مجددًا.', 429);
  const u = db.prepare('SELECT * FROM users WHERE login=?').get(login);
  if (!auth.checkPassword(password, u ? u.pass_hash : auth.DUMMY) || !u) { auth.failed(key); throw new Bad('بيانات الدخول غير صحيحة', 401); }
  if (!u.active) throw new Bad('هذا الحساب موقوف. راجع إدارة المسابقة.', 403);
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(Date.now(), u.id);
  auth.createSession(res, u.id);
  return { user: publicUser(u) };
}));
app.post('/api/logout', wrap((req, res) => { auth.clearSession(req, res); return { ok: true }; }));

// إنشاء حساب متسابق: ينشئ الحساب وملف الشخص معًا. الهوية مرجع الربط وليست كلمة مرور.
app.post('/api/signup', wrap((req, res) => {
  if (!config.allowSignup) throw new Bad('إنشاء الحسابات من الموقع متوقف حاليًا. تواصل مع إدارة المسابقة.', 403);
  const ipKey = (req.ip || '') + '|signup';
  if (auth.tooMany(ipKey, parseInt(process.env.SIGNUP_LIMIT || '20', 10))) throw new Bad('محاولات كثيرة. حاول لاحقًا.', 429);
  auth.failed(ipKey);
  const b = req.body || {};
  const nid = R.normId(b.nationalId); if (!nid) throw new Bad('رقم الهوية يجب أن يكون من 6 إلى 20 رقمًا');
  const name = R.cleanName(b.fullName);
  if (name.split(' ').length < 3 || name.length > 120) throw new Bad('اكتب الاسم الرباعي كاملًا كما في الهوية');
  const phone = R.normPhone(b.phone); if (!phone) throw new Bad('رقم الهاتف غير صحيح (من 7 إلى 15 رقمًا)');
  const p = auth.passwordProblem(b.password); if (p) throw new Bad(p);
  const email = str(b.email, 120, 'البريد', false); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Bad('البريد الإلكتروني غير صحيح');
  if (db.prepare('SELECT 1 FROM users WHERE login=?').get(nid) || db.prepare('SELECT 1 FROM people WHERE national_id=?').get(nid))
    throw new Bad('يوجد حساب بهذا الرقم. سجّل الدخول، أو تواصل مع الإدارة التنفيذية لاستعادة الحساب.', 409);
  const now = Date.now();
  const uid = db.transaction(() => {
    const id = db.prepare("INSERT INTO users(login,name,phone,email,role,pass_hash,created_at) VALUES (?,?,?,?,'contestant',?,?)").run(nid, name, phone, email, auth.hashPassword(b.password), now).lastInsertRowid;
    const pid = db.prepare('INSERT INTO people(user_id,national_id,full_name,phone,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, nid, name, phone, now, now).lastInsertRowid;
    audit({ id }, 'signup', 'person', pid, { summary: 'إنشاء حساب متسابق' });
    return id;
  })();
  auth.createSession(res, uid);
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(uid)) };
}));

app.use('/api', (req, res, next) => (['/meta', '/login', '/signup', '/public', '/health'].includes(req.path) ? next() : auth.requireAuth(req, res, next)));
app.get('/api/me', wrap((req) => ({ user: publicUser(req.user) })));
app.post('/api/password', wrap((req, res) => {
  const { current, next: np } = req.body || {};
  if (!auth.checkPassword(String(current || ''), req.user.pass_hash)) throw new Bad('كلمة المرور الحالية غير صحيحة');
  const p = auth.passwordProblem(np); if (p) throw new Bad(p);
  if (np === current) throw new Bad('اختر كلمة مرور مختلفة عن الحالية');
  db.prepare('UPDATE users SET pass_hash=?, must_change=0 WHERE id=?').run(auth.hashPassword(np), req.user.id);
  // تُنهى جلسات الحساب على الأجهزة الأخرى، وتبقى الجلسة الحالية فلا يخرج صاحبها (ولا تفشل طلباته الجارية)
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(req.user.id, auth.currentToken(req));
  return { ok: true };
}));

// ---------- التسجيلات: قراءة ----------
const entriesOf = (rid) => db.prepare('SELECT * FROM entries WHERE registration_id=? ORDER BY id').all(rid)
  .map((e) => ({ id: e.id, branch: e.branch, branchName: e.branch_name, track: e.track, trackName: e.track_name, curriculum: e.curriculum_text, status: e.status }));
const regSelect = `SELECT r.*, p.full_name, p.national_id, p.phone, p.phone2, p.gender, p.user_id, p.is_test, ru.name AS reviewer
  FROM registrations r JOIN people p ON p.id=r.person_id LEFT JOIN users ru ON ru.id=r.reviewed_by`;
// رئيس التحكيم «اطلاع عند الحاجة»: بلا هوية ولا هواتف
function regJson(r, viewer) {
  const full = !viewer || viewer.role !== 'chief';
  return {
    id: r.id, section: r.section, sectionName: SECTIONS[r.section], fullName: r.full_name, gender: r.gender,
    nationalId: full ? r.national_id : '', phone: full ? r.phone : '', phone2: full ? r.phone2 : '',
    birthYear: r.birth_year, categoryId: r.category_id, categoryName: r.category_name,
    status: r.status, statusName: REG_ST[r.status], staffNote: r.staff_note, reviewer: r.reviewer || '', reviewedAt: r.reviewed_at,
    createdAt: r.created_at, updatedAt: r.updated_at, entries: entriesOf(r.id), isTest: !!r.is_test,
  };
}
function loadReg(req, id) {
  const r = db.prepare(regSelect + ' WHERE r.id=?').get(id);
  if (!r || !inScope(req.user, r.section)) throw new Bad('التسجيل غير موجود', 404); // لا يكشف وجود سجل خارج النطاق
  return r;
}

function regQuery(req) {
  const c = comp(), q = req.query;
  const where = ['r.comp_id=?'], args = [c.id];
  const sec = scope(req.user, q.section);
  if (sec) { where.push('r.section=?'); args.push(sec); }
  if (REG_ST[q.status]) { where.push('r.status=?'); args.push(q.status); }
  if (q.category) { where.push('r.category_id=?'); args.push(+q.category); }
  if (q.branch) {
    where.push("EXISTS (SELECT 1 FROM entries e WHERE e.registration_id=r.id AND e.status='active' AND e.branch=?" + (q.track ? ' AND e.track=?' : '') + ')');
    args.push(String(q.branch)); if (q.track) args.push(String(q.track));
  }
  const text = R.cleanName(q.q).slice(0, 80);
  if (text) {
    const d = R.toLatin(text).replace(/[\s\-]/g, '');
    if (req.user.role === 'chief') { where.push('p.full_name LIKE ?'); args.push('%' + text + '%'); }
    else { where.push('(p.full_name LIKE ? OR p.national_id LIKE ? OR p.phone LIKE ? OR p.phone2 LIKE ?)'); args.push('%' + text + '%', '%' + d + '%', '%' + d + '%', '%' + d + '%'); }
  }
  // الفلترة قبل الترتيب الأبجدي وقبل التقسيم إلى صفحات
  const rows = db.prepare(regSelect + ' WHERE ' + where.join(' AND ')).all(...args);
  const coll = new Intl.Collator('ar');
  rows.sort((a, b) => coll.compare(a.full_name, b.full_name) || a.id - b.id);
  return rows;
}

app.get('/api/registrations', need(canSeeRegs), wrap((req) => {
  const rows = regQuery(req);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { total: rows.length, page, pageSize: PAGE, rows: rows.slice((page - 1) * PAGE, page * PAGE).map((r) => regJson(r, req.user)) };
}));

// صفوف تصدير المسجلين (CSV وExcel)
function regRows(req) {
  const rows = regQuery(req);
  const out = [['القسم', 'الاسم الرباعي', 'رقم الهوية', 'الهاتف', 'هاتف آخر', 'سنة الميلاد', 'الفئة', 'الفروع والمسارات', 'المقررات', 'حالة الطلب', 'تاريخ التسجيل']];
  for (const r of rows) {
    const es = entriesOf(r.id).filter((e) => e.status === 'active');
    out.push([SECTIONS[r.section], r.full_name, r.national_id, r.phone, r.phone2, r.birth_year, r.category_name,
      es.map((e) => e.branchName + (e.trackName ? ' — ' + e.trackName : '')).join(' | '), es.map((e) => e.curriculum).join(' | '),
      REG_ST[r.status], new Date(r.created_at).toISOString().slice(0, 10)]);
  }
  audit(req.user, 'export', 'registrations', null, { section: scope(req.user, req.query.section), summary: `تصدير ${rows.length} تسجيلًا` });
  return out;
}
app.get('/api/registrations.csv', need(canManageRegs), (req, res) => {
  try {
    // يمنع تفسير نص يبدأ بعلامة مساواة أو صيغة بوصفه معادلة في Excel
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const lines = regRows(req).map((r) => r.map(cell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="iqra-registrations-${R.today()}.csv"`);
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (e) { console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e.message || 'حدث خطأ' }); }
});
app.get('/api/registrations.xlsx', need(canManageRegs), (req, res) => {
  try { require('./lib/draws').sendXlsx(res, `iqra-registrations-${R.today()}.xlsx`, [{ name: 'المسجلون', rows: regRows(req).map((r) => r.map((v, i) => (i === 2 || i === 3 || i === 4 ? String(v ?? '') : v))) }]); }
  catch (e) { console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e.message || 'حدث خطأ' }); }
});

app.get('/api/registrations/:id', need(canSeeRegs), wrap((req) => {
  const r = loadReg(req, +req.params.id);
  const hist = db.prepare('SELECT a.*, u.name AS actor FROM audit a LEFT JOIN users u ON u.id=a.actor_id WHERE (a.entity=? AND a.entity_id=?) OR (a.entity=? AND a.entity_id=?) ORDER BY a.id DESC LIMIT 100')
    .all('registration', r.id, 'person', r.person_id)
    .map((a) => ({ at: a.at, action: a.action, actor: a.actor || '', summary: a.summary, reason: a.reason, before: req.user.role === 'chief' ? null : JSON.parse(a.before || 'null'), after: req.user.role === 'chief' ? null : JSON.parse(a.after || 'null') }));
  return { registration: regJson(r, req.user), history: hist };
}));

app.get('/api/stats', need(canSeeRegs), wrap((req) => {
  const c = comp(), sec = scope(req.user, req.query.section);
  const w = 'r.comp_id=?' + (sec ? ' AND r.section=?' : ''), a = sec ? [c.id, sec] : [c.id];
  return {
    total: db.prepare(`SELECT COUNT(*) n FROM registrations r WHERE ${w} AND r.status='accepted'`).get(...a).n,
    bySection: db.prepare(`SELECT section k, COUNT(*) n FROM registrations r WHERE ${w} GROUP BY section`).all(...a),
    byStatus: db.prepare(`SELECT status k, COUNT(*) n FROM registrations r WHERE ${w} GROUP BY status`).all(...a),
    byBranch: db.prepare(`SELECT e.branch k, COUNT(*) n FROM entries e JOIN registrations r ON r.id=e.registration_id WHERE ${w} AND e.status='active' AND r.status='accepted' GROUP BY e.branch`).all(...a),
    byCategory: db.prepare(`SELECT category_name k, COUNT(*) n FROM registrations r WHERE ${w} AND r.status<>'withdrawn' GROUP BY category_name ORDER BY n DESC`).all(...a),
    byTrack: db.prepare(`SELECT e.branch_name||CASE WHEN e.track_name<>'' THEN ' — '||e.track_name ELSE '' END k, COUNT(*) n FROM entries e JOIN registrations r ON r.id=e.registration_id
      WHERE ${w} AND e.status='active' AND r.status<>'withdrawn' GROUP BY k ORDER BY n DESC`).all(...a),
    accounts: isTop(req.user) ? db.prepare("SELECT COUNT(*) n FROM users WHERE role='contestant'").get().n : undefined,
  };
}));

// ---------- المتسابق: ملفه ومشاركاته فقط ----------
const myPerson = (u) => db.prepare('SELECT * FROM people WHERE user_id=?').get(u.id);
const onlyContestant = need((u) => u.role === 'contestant');

app.get('/api/my', onlyContestant, wrap((req) => {
  const p = myPerson(req.user); if (!p) throw new Bad('ملف المتسابق غير موجود', 404);
  const c = R.current();
  const r = c ? db.prepare(regSelect + ' WHERE r.comp_id=? AND r.person_id=?').get(c.id, p.id) : null;
  const st = R.regState(c);
  return {
    person: { nationalId: p.national_id, fullName: p.full_name, phone: p.phone, phone2: p.phone2, email: req.user.email, birthYear: p.birth_year, gender: p.gender },
    competition: c ? compJson(c) : null,
    registration: r ? regJson(r) : null,
    canRegister: !r && st.open,
    canEdit: !!r && st.open && st.editable && r.status === 'accepted' && !db.prepare("SELECT 1 FROM tickets WHERE registration_id=? AND status<>'cancelled'").get(r.id),
    canWithdraw: !!r && r.status === 'accepted',
  };
}));

// معاينة الفئة والفروع المتاحة لسنة ميلاد (لا تحفظ شيئًا)
app.get('/api/eligibility', wrap((req) => {
  const c = comp();
  const res = R.categoryFor(c, R.normYear(req.query.year));
  if (res.error) throw new Bad(res.error);
  return { category: { id: res.category.id, name: res.category.name }, branches: R.optionsFor(c, res.category) };
}));

// تأكيد التسجيل أو تعديله: شخص واحد، وتسجيل واحد في الدورة، ومشاركة مستقلة لكل فرع، في معاملة واحدة
app.post('/api/my/registration', onlyContestant, wrap((req) => {
  const c = comp(), st = R.regState(c), b = req.body || {};
  const p = myPerson(req.user); if (!p) throw new Bad('ملف المتسابق غير موجود', 404);
  if (!st.open) throw new Bad(st.label);
  const year = R.normYear(b.birthYear);
  const cat = R.categoryFor(c, year); if (cat.error) throw new Bad(cat.error);
  if (!SECTIONS[b.gender]) throw new Bad('اختر الجنس');
  let phone2 = '';
  if (String(b.phone2 || '').trim()) { phone2 = R.normPhone(b.phone2); if (!phone2) throw new Bad('رقم الهاتف الآخر غير صحيح'); if (phone2 === p.phone) throw new Bad('الهاتف الآخر مطابق للهاتف الأساسي'); }
  const opts = R.optionsFor(c, cat.category);
  const picks = Array.isArray(b.entries) ? b.entries : [];
  if (!picks.length) throw new Bad('اختر فرعًا واحدًا على الأقل');
  const seen = new Set(), chosen = [];
  for (const x of picks) {
    const br = opts.find((o) => o.code === x.branch);
    if (!br) throw new Bad('أحد الفروع المختارة غير متاح لفئة ' + cat.category.name);
    if (seen.has(br.code)) throw new Bad('لا يمكن اختيار الفرع نفسه مرتين');
    seen.add(br.code);
    const tr = br.tracks.find((t) => t.track === x.track);
    if (!tr) throw new Bad(`اختر ${br.code === 'tilawa' ? 'مسار التلاوة' : br.code === 'hifz' ? 'قسم الحفظ' : 'المقرر'} في فرع ${br.name}`);
    chosen.push({ branch: br.code, branchName: br.name, track: tr.track, trackName: tr.trackName, curriculumId: tr.curriculumId, curriculum: tr.content });
  }
  const now = Date.now(), section = b.gender;
  let created = false;
  const out = db.transaction(() => {
    const before = { ...p };
    db.prepare('UPDATE people SET birth_year=?, gender=?, phone2=?, updated_at=? WHERE id=?').run(year, b.gender, phone2, now, p.id);
    let r = db.prepare('SELECT * FROM registrations WHERE comp_id=? AND person_id=?').get(c.id, p.id);
    if (!r) {
      const rid = db.prepare(`INSERT INTO registrations(comp_id,person_id,section,category_id,category_name,birth_year,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'accepted',?,?)`).run(c.id, p.id, section, cat.category.id, cat.category.name, year, now, now).lastInsertRowid;
      for (const e of chosen) db.prepare(`INSERT INTO entries(registration_id,branch,branch_name,track,track_name,curriculum_id,curriculum_text,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',?,?)`).run(rid, e.branch, e.branchName, e.track, e.trackName, e.curriculumId, e.curriculum, now, now);
      audit(req.user, 'register', 'registration', rid, { section, summary: 'التسجيل في: ' + chosen.map((e) => e.branchName).join('، '), after: { category: cat.category.name, entries: chosen } });
      created = true;
      return rid;
    }
    // تسجيل قائم: التعديل ضمن موعد التعديل وقبل تثبيت أي حضور
    if (!st.editable || r.status !== 'accepted') throw new Bad('انتهت مدة تعديل التسجيل. تواصل مع الإدارة التنفيذية.', 409);
    if (db.prepare("SELECT 1 FROM tickets WHERE registration_id=? AND status<>'cancelled'").get(r.id)) throw new Bad('لا يُعدَّل التسجيل بعد تثبيت حضورك. تواصل مع الإدارة التنفيذية.', 409);
    const old = entriesOf(r.id);
    db.prepare("UPDATE registrations SET section=?, category_id=?, category_name=?, birth_year=?, updated_at=? WHERE id=?").run(section, cat.category.id, cat.category.name, year, now, r.id);
    for (const e of old) if (!chosen.some((x) => x.branch === e.branch) && e.status === 'active')
      db.prepare("UPDATE entries SET status='withdrawn', updated_at=? WHERE id=?").run(now, e.id); // لا يحذف السجل التاريخي
    for (const e of chosen) {
      const ex = old.find((o) => o.branch === e.branch);
      if (ex) db.prepare("UPDATE entries SET track=?, track_name=?, curriculum_id=?, curriculum_text=?, status='active', updated_at=? WHERE id=?").run(e.track, e.trackName, e.curriculumId, e.curriculum, now, ex.id);
      else db.prepare(`INSERT INTO entries(registration_id,branch,branch_name,track,track_name,curriculum_id,curriculum_text,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',?,?)`).run(r.id, e.branch, e.branchName, e.track, e.trackName, e.curriculumId, e.curriculum, now, now);
    }
    audit(req.user, 'edit', 'registration', r.id, { section, summary: 'تعديل التسجيل من المتسابق', before: { birthYear: before.birth_year, gender: before.gender, category: r.category_name, entries: old }, after: { birthYear: year, gender: b.gender, category: cat.category.name, entries: chosen } });
    return r.id;
  })();
  if (created) require('./lib/notify').events.registered(req.user.id, out, c.name, cat.category.name, chosen.map((e) => e.branchName + (e.trackName ? ' (' + e.trackName + ')' : '')));
  return { registration: regJson(db.prepare(regSelect + ' WHERE r.id=?').get(out)) };
}));

app.post('/api/my/withdraw', onlyContestant, wrap((req) => {
  const c = comp(), p = myPerson(req.user);
  const r = p && db.prepare('SELECT * FROM registrations WHERE comp_id=? AND person_id=?').get(c.id, p.id);
  if (!r) throw new Bad('لا يوجد طلب', 404);
  if (r.status !== 'accepted') throw new Bad('لا يمكن الانسحاب في حالة التسجيل الحالية');
  const reason = str(req.body.reason, 300, 'سبب الانسحاب', false);
  db.prepare("UPDATE registrations SET status='withdrawn', updated_at=? WHERE id=?").run(Date.now(), r.id);
  audit(req.user, 'withdraw', 'registration', r.id, { section: r.section, summary: 'انسحاب المتسابق', before: { status: r.status }, after: { status: 'withdrawn' }, reason });
  return { ok: true };
}));

app.patch('/api/my/profile', onlyContestant, wrap((req) => {
  const p = myPerson(req.user), b = req.body || {};
  const phone = R.normPhone(b.phone); if (!phone) throw new Bad('رقم الهاتف الأساسي غير صحيح');
  let phone2 = ''; if (String(b.phone2 || '').trim()) { phone2 = R.normPhone(b.phone2); if (!phone2) throw new Bad('رقم الهاتف الآخر غير صحيح'); }
  const email = str(b.email, 120, 'البريد', false); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Bad('البريد الإلكتروني غير صحيح');
  db.transaction(() => {
    db.prepare('UPDATE people SET phone=?, phone2=?, updated_at=? WHERE id=?').run(phone, phone2, Date.now(), p.id);
    db.prepare('UPDATE users SET phone=?, email=? WHERE id=?').run(phone, email, req.user.id);
    audit(req.user, 'profile', 'person', p.id, { summary: 'تحديث أرقام التواصل', before: { phone: p.phone, phone2: p.phone2 }, after: { phone, phone2 } });
  })();
  return { ok: true };
}));

// ---------- التسجيلات: إدارة (الإدارة التنفيذية لقسمها والعليا للقسمين) ----------
// تصحيح إداري موثق: بدون confirm يعيد الأثر فقط، ومع confirm وسبب يُطبَّق
app.post('/api/registrations/:id/correct', need(canManageRegs), wrap((req) => {
  const r = loadReg(req, +req.params.id), b = req.body || {}, c = comp();
  if (r.comp_id !== c.id) throw new Bad('هذا التسجيل لدورة سابقة');
  const p = db.prepare('SELECT * FROM people WHERE id=?').get(r.person_id);
  const next = { fullName: p.full_name, nationalId: p.national_id, phone: p.phone, phone2: p.phone2, birthYear: r.birth_year, gender: r.section };
  if (b.fullName !== undefined) { next.fullName = R.cleanName(b.fullName); if (next.fullName.split(' ').length < 3) throw new Bad('الاسم الرباعي غير مكتمل'); }
  if (b.nationalId !== undefined) { next.nationalId = R.normId(b.nationalId); if (!next.nationalId) throw new Bad('رقم الهوية غير صحيح'); }
  if (b.phone !== undefined) { next.phone = R.normPhone(b.phone); if (!next.phone) throw new Bad('الهاتف الأساسي غير صحيح'); }
  if (b.phone2 !== undefined) { next.phone2 = String(b.phone2).trim() ? R.normPhone(b.phone2) : ''; if (next.phone2 === null) throw new Bad('الهاتف الآخر غير صحيح'); }
  if (b.birthYear !== undefined) next.birthYear = R.normYear(b.birthYear);
  if (b.gender !== undefined) { if (!SECTIONS[b.gender]) throw new Bad('الجنس غير صحيح'); next.gender = b.gender; }
  if (next.gender !== r.section && !isTop(req.user)) throw new Bad('نقل المتسابق إلى القسم الآخر من صلاحية الإدارة العليا', 403);
  if (next.nationalId !== p.national_id && (db.prepare('SELECT 1 FROM people WHERE national_id=? AND id<>?').get(next.nationalId, p.id) || db.prepare('SELECT 1 FROM users WHERE login=? AND id<>?').get(next.nationalId, p.user_id)))
    throw new Bad('رقم الهوية الجديد مسجل لشخص آخر', 409);
  const cat = R.categoryFor(c, next.birthYear); if (cat.error) throw new Bad(cat.error);
  // أثر التغيير على الفئة والمشاركات
  const opts = R.optionsFor(c, cat.category), es = entriesOf(r.id).filter((e) => e.status === 'active');
  const dropped = [], recurr = [];
  for (const e of es) {
    const br = opts.find((o) => o.code === e.branch), tr = br && br.tracks.find((t) => t.track === e.track);
    if (!tr) dropped.push({ id: e.id, branchName: e.branchName, trackName: e.trackName });
    else if (tr.content !== e.curriculum) recurr.push({ id: e.id, branchName: e.branchName, trackName: e.trackName, from: e.curriculum, to: tr.content, curriculumId: tr.curriculumId });
  }
  const labels = { fullName: 'الاسم', nationalId: 'رقم الهوية', phone: 'الهاتف', phone2: 'الهاتف الآخر', birthYear: 'سنة الميلاد', gender: 'القسم' };
  const prev = { fullName: p.full_name, nationalId: p.national_id, phone: p.phone, phone2: p.phone2, birthYear: r.birth_year, gender: r.section };
  const changes = Object.keys(labels).filter((k) => String(prev[k] ?? '') !== String(next[k] ?? '')).map((k) => ({ field: labels[k], from: k === 'gender' ? SECTIONS[prev[k]] : prev[k], to: k === 'gender' ? SECTIONS[next[k]] : next[k] }));
  const impact = { changes, category: { from: r.category_name, to: cat.category.name }, dropped, recurr };
  if (!changes.length) throw new Bad('لا توجد تغييرات');
  if (!b.confirm) return { preview: impact };
  const reason = str(b.reason, 500, 'سبب التصحيح');
  if (reason.length < 5) throw new Bad('اكتب سببًا واضحًا للتصحيح');
  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE people SET full_name=?, national_id=?, phone=?, phone2=?, birth_year=?, gender=?, updated_at=? WHERE id=?').run(next.fullName, next.nationalId, next.phone, next.phone2, next.birthYear, next.gender, now, p.id);
    if (p.user_id) db.prepare('UPDATE users SET login=?, name=?, phone=? WHERE id=?').run(next.nationalId, next.fullName, next.phone, p.user_id);
    db.prepare('UPDATE registrations SET section=?, category_id=?, category_name=?, birth_year=?, updated_at=? WHERE id=?').run(next.gender, cat.category.id, cat.category.name, next.birthYear, now, r.id);
    for (const d of dropped) db.prepare("UPDATE entries SET status='withdrawn', updated_at=? WHERE id=?").run(now, d.id);
    for (const x of recurr) db.prepare('UPDATE entries SET curriculum_id=?, curriculum_text=?, updated_at=? WHERE id=?').run(x.curriculumId, x.to, now, x.id);
    audit(req.user, 'correct', 'registration', r.id, { section: next.gender, summary: 'تصحيح إداري: ' + changes.map((x) => x.field).join('، '), before: prev, after: { ...next, impact }, reason });
  })();
  return { registration: regJson(db.prepare(regSelect + ' WHERE r.id=?').get(r.id), req.user) };
}));

app.post('/api/registrations/:id/reset-password', need(canManageRegs), wrap((req) => {
  const r = loadReg(req, +req.params.id);
  if (!r.user_id) throw new Bad('لا يوجد حساب مرتبط بهذا المتسابق');
  const pass = auth.tempPassword();
  db.prepare('UPDATE users SET pass_hash=?, must_change=1 WHERE id=?').run(auth.hashPassword(pass), r.user_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(r.user_id);
  audit(req.user, 'reset', 'person', r.person_id, { section: r.section, summary: 'إعادة تعيين كلمة مرور المتسابق' });
  return { tempPassword: pass, login: r.national_id };
}));

// ---------- إعداد الدورة (الإدارة العليا) ----------
const yearOrNull = (v, label) => { if (v === null || v === undefined || v === '') return null; const y = R.normYear(v); if (!y) throw new Bad(`${label}: سنة غير صحيحة`); return y; };
const dateOrNull = (v, label) => { if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Bad(`${label}: تاريخ غير صحيح`); return v; };

app.get('/api/admin/competition', need(isTop), wrap(() => {
  const c = comp();
  const used = new Set(db.prepare("SELECT DISTINCT e.curriculum_id id FROM entries e JOIN registrations r ON r.id=e.registration_id WHERE r.comp_id=? AND e.status='active'").all(c.id).map((x) => x.id));
  const usedCats = new Set(db.prepare('SELECT DISTINCT category_id id FROM registrations WHERE comp_id=?').all(c.id).map((x) => x.id));
  return {
    competition: compJson(c),
    all: db.prepare('SELECT id,name,number,year,status,is_current FROM competitions ORDER BY id DESC').all().map((x) => ({ id: x.id, name: x.name, number: x.number, year: x.year, statusName: COMP_ST[x.status], current: !!x.is_current })),
    branches: R.branchesOf(c.id).map((b) => ({ id: b.id, code: b.code, name: b.name, intro: b.intro, conditions: b.conditions, stages: b.stages, registrable: !!b.registrable })),
    categories: R.categoriesOf(c.id).map((x) => ({ id: x.id, name: x.name, fromYear: x.from_year, toYear: x.to_year, branches: x.branches, used: usedCats.has(x.id) })),
    curricula: R.curriculaOf(c.id).map((x) => ({ id: x.id, branch: x.branch, track: x.track, trackName: x.track_name, categoryId: x.category_id, content: x.content, surah: x.surah, ayahFrom: x.ayah_from, ayahTo: x.ayah_to, used: used.has(x.id) })),
    registrations: db.prepare('SELECT COUNT(*) n FROM registrations WHERE comp_id=?').get(c.id).n,
  };
}));

app.put('/api/admin/competition', need(isTop), wrap((req) => {
  const c = comp(), b = req.body || {};
  if (!COMP_ST[b.status]) throw new Bad('حالة الدورة غير صحيحة');
  const v = { name: str(b.name, 120, 'اسم المسابقة'), number: parseInt(R.toLatin(b.number), 10), year: R.normYear(b.year), reg_open: dateOrNull(b.regOpen, 'فتح التسجيل'), reg_close: dateOrNull(b.regClose, 'إغلاق التسجيل'), edit_close: dateOrNull(b.editClose, 'آخر موعد للتعديل'), status: b.status, min_birth_year: R.normYear(b.minBirthYear) || 1900, notes: str(b.notes, 2000, 'ملاحظات', false) };
  if (!v.number || v.number < 1) throw new Bad('رقم الدورة غير صحيح');
  if (!v.year) throw new Bad('سنة الدورة غير صحيحة');
  if (v.reg_open && v.reg_close && v.reg_open > v.reg_close) throw new Bad('موعد الإغلاق قبل موعد الفتح');
  db.prepare('UPDATE competitions SET name=?,number=?,year=?,reg_open=?,reg_close=?,edit_close=?,status=?,min_birth_year=?,notes=?,updated_at=? WHERE id=?')
    .run(v.name, v.number, v.year, v.reg_open, v.reg_close, v.edit_close, v.status, v.min_birth_year, v.notes, Date.now(), c.id);
  audit(req.user, 'settings', 'competition', c.id, { summary: 'تعديل بيانات الدورة', before: compJson(c), after: v });
  return { competition: compJson(comp()) };
}));

app.put('/api/admin/branches/:id', need(isTop), wrap((req) => {
  const c = comp(), b = req.body || {};
  const old = db.prepare('SELECT * FROM branches WHERE id=? AND comp_id=?').get(+req.params.id, c.id);
  if (!old) throw new Bad('الفرع غير موجود', 404);
  const v = { name: str(b.name, 60, 'اسم الفرع'), intro: str(b.intro, 600, 'التعريف', false), conditions: str(b.conditions, 3000, 'الشروط', false), stages: str(b.stages, 200, 'المراحل', false), registrable: b.registrable ? 1 : 0 };
  db.prepare('UPDATE branches SET name=?,intro=?,conditions=?,stages=?,registrable=? WHERE id=?').run(v.name, v.intro, v.conditions, v.stages, v.registrable, old.id);
  audit(req.user, 'settings', 'branch', old.id, { summary: 'تعديل فرع ' + v.name, before: old, after: v });
  return { ok: true };
}));

// تُرسل قائمة الفئات كاملة؛ الخادم يتحقق من عدم التداخل ويمنع حذف فئة عليها تسجيلات
app.put('/api/admin/categories', need(isTop), wrap((req) => {
  const c = comp(), list = Array.isArray(req.body.categories) ? req.body.categories : [];
  const codes = R.branchesOf(c.id).map((b) => b.code);
  const items = list.map((x, i) => ({ id: x.id ? +x.id : null, name: str(x.name, 40, 'اسم الفئة'), from_year: yearOrNull(x.fromYear, 'بداية الفئة'), to_year: yearOrNull(x.toYear, 'نهاية الفئة'), branches: (Array.isArray(x.branches) ? x.branches : []).filter((b) => codes.includes(b)), sort: i }));
  if (!items.length) throw new Bad('أضف فئة واحدة على الأقل');
  if (new Set(items.map((x) => x.name)).size !== items.length) throw new Bad('أسماء الفئات مكررة');
  const prob = R.overlapProblem(items); if (prob) throw new Bad(prob);
  const old = R.categoriesOf(c.id);
  db.transaction(() => {
    for (const o of old) if (!items.some((x) => x.id === o.id)) {
      if (db.prepare('SELECT 1 FROM registrations WHERE category_id=?').get(o.id) || db.prepare('SELECT 1 FROM curricula WHERE category_id=?').get(o.id))
        throw new Bad(`لا يمكن حذف فئة «${o.name}»: عليها تسجيلات أو مقررات`);
      if (db.prepare('SELECT 1 FROM materials WHERE category_id=? AND deleted_at IS NULL').get(o.id)) throw new Bad(`لا يمكن حذف فئة «${o.name}»: عليها مذكرات؛ عدّلها أو احذفها أولًا`);
      db.prepare('UPDATE materials SET category_id=NULL WHERE category_id=? AND deleted_at IS NOT NULL').run(o.id);
      db.prepare('DELETE FROM categories WHERE id=?').run(o.id);
    }
    // أسماء مؤقتة لتجنب تعارض القيد الفريد عند تبادل الأسماء
    for (const x of items) if (x.id && old.some((o) => o.id === x.id)) db.prepare('UPDATE categories SET name=? WHERE id=?').run('~' + x.id, x.id);
    for (const x of items) {
      if (x.id && old.some((o) => o.id === x.id)) db.prepare('UPDATE categories SET name=?,from_year=?,to_year=?,branches=?,sort=? WHERE id=?').run(x.name, x.from_year, x.to_year, JSON.stringify(x.branches), x.sort, x.id);
      else db.prepare('INSERT INTO categories(comp_id,name,from_year,to_year,branches,sort) VALUES (?,?,?,?,?,?)').run(c.id, x.name, x.from_year, x.to_year, JSON.stringify(x.branches), x.sort);
    }
    audit(req.user, 'settings', 'categories', c.id, { summary: 'تعديل الفئات', before: old, after: items });
  })();
  return { ok: true };
}));

app.put('/api/admin/curricula', need(isTop), wrap((req) => {
  const c = comp(), list = Array.isArray(req.body.curricula) ? req.body.curricula : [];
  const codes = R.branchesOf(c.id).map((b) => b.code), cats = R.categoriesOf(c.id).map((x) => x.id);
  const items = list.map((x, i) => {
    const branch = String(x.branch || ''); if (!codes.includes(branch)) throw new Bad('فرع غير صحيح في المقررات');
    const track = str(x.track, 20, 'رمز المسار'); if (!/^[a-z0-9_]+$/.test(track)) throw new Bad('رمز المسار بالإنجليزية الصغيرة والأرقام فقط، مثل tartil');
    const cat = x.categoryId ? +x.categoryId : null; if (cat && !cats.includes(cat)) throw new Bad('فئة غير صحيحة في المقررات');
    // المقطع اختياري، ويلزم صحته إن أُدخل: سورة موجودة ونطاق آيات لا يتجاوز عددها
    let surah = null, from = null, to = null;
    if (x.surah) {
      surah = +x.surah; from = +x.ayahFrom; to = +x.ayahTo;
      if (!require('./lib/rubrics').passage(surah, from, to)) throw new Bad(`المقطع غير صحيح في «${String(x.content || '').slice(0, 40)}»: تحقق من السورة وبداية الآيات ونهايتها`);
    }
    return { id: x.id ? +x.id : null, branch, track, track_name: str(x.trackName, 60, 'اسم المسار', false), category_id: cat, content: str(x.content, 300, 'نص المقرر'), surah, ayah_from: from, ayah_to: to, sort: i };
  });
  const key = (x) => `${x.branch}|${x.track}|${x.category_id ?? 'all'}`;
  if (new Set(items.map(key)).size !== items.length) throw new Bad('يوجد مقرران للفرع والمسار والفئة نفسها');
  const old = R.curriculaOf(c.id);
  db.transaction(() => {
    for (const o of old) if (!items.some((x) => x.id === o.id)) {
      if (db.prepare("SELECT 1 FROM entries WHERE curriculum_id=? AND status='active'").get(o.id)) throw new Bad(`لا يمكن حذف مقرر «${o.content}»: عليه مشاركات قائمة`);
      if (db.prepare('SELECT 1 FROM materials WHERE curriculum_id=? AND deleted_at IS NULL').get(o.id)) throw new Bad(`لا يمكن حذف مقرر «${o.content}»: عليه مذكرات؛ عدّلها أو احذفها أولًا`);
      db.prepare('UPDATE materials SET curriculum_id=NULL WHERE curriculum_id=? AND deleted_at IS NOT NULL').run(o.id);
      db.prepare('DELETE FROM curricula WHERE id=?').run(o.id);
    }
    for (const x of items) {
      if (x.id && old.some((o) => o.id === x.id)) db.prepare('UPDATE curricula SET branch=?,track=?,track_name=?,category_id=?,content=?,surah=?,ayah_from=?,ayah_to=?,sort=? WHERE id=?').run(x.branch, x.track, x.track_name, x.category_id, x.content, x.surah, x.ayah_from, x.ayah_to, x.sort, x.id);
      else db.prepare('INSERT INTO curricula(comp_id,branch,track,track_name,category_id,content,surah,ayah_from,ayah_to,sort) VALUES (?,?,?,?,?,?,?,?,?,?)').run(c.id, x.branch, x.track, x.track_name, x.category_id, x.content, x.surah, x.ayah_from, x.ayah_to, x.sort);
    }
    audit(req.user, 'settings', 'curricula', c.id, { summary: 'تعديل المقررات (لا يغيّر المقررات المحفوظة في المشاركات السابقة)', before: old, after: items });
  })();
  return { ok: true };
}));

app.post('/api/admin/competitions', need(isTop), wrap((req) => {
  const c = comp(), b = req.body || {};
  const v = { name: str(b.name, 120, 'اسم المسابقة'), number: parseInt(R.toLatin(b.number), 10), year: R.normYear(b.year) };
  if (!v.number || !v.year) throw new Bad('أدخل رقم الدورة وسنتها');
  const id = copyCompetition(c.id, v);
  audit(req.user, 'create', 'competition', id, { summary: `إنشاء الدورة ${v.number} بنسخ إعدادات الدورة ${c.number}` });
  return { id };
}));

// ---------- الحسابات (الإدارة العليا) ----------
function staffFields(b, partial) {
  const f = {};
  if (!partial || b.name !== undefined) f.name = R.cleanName(str(b.name, 100, 'الاسم'));
  if (!partial || b.phone !== undefined) { const s = String(b.phone || '').trim(); f.phone = s ? R.normPhone(s) : ''; if (f.phone === null) throw new Bad('رقم الهاتف غير صحيح'); }
  if (!partial || b.email !== undefined) { f.email = str(b.email, 120, 'البريد', false); if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) throw new Bad('البريد غير صحيح'); }
  if (!partial || b.role !== undefined) { if (!ROLES[b.role] || b.role === 'contestant') throw new Bad('اختر دور الحساب'); f.role = b.role; }
  if (!partial || b.section !== undefined) f.section = SECTIONS[b.section] ? b.section : '';
  if (!partial || b.specialty !== undefined) f.specialty = SPECIALTIES.includes(b.specialty) ? b.specialty : '';
  return f;
}
function checkStaff(f) {
  if (f.role === 'top') { f.section = ''; } else if (!f.section) throw new Bad('حدد القسم الذي يعمل فيه الحساب (رجال أو نساء)');
  if (f.role !== 'judge') f.specialty = '';
  else if (!f.specialty) throw new Bad('حدد تخصص المحكم');
}
app.get('/api/users', need(isTop), wrap((req) => {
  const role = ROLES[req.query.role] ? req.query.role : '';
  const rows = role ? db.prepare('SELECT * FROM users WHERE role=? ORDER BY active DESC, name').all(role) : db.prepare("SELECT * FROM users WHERE role<>'contestant' ORDER BY active DESC, role, name").all();
  return { users: rows.slice(0, 2000).map(publicUser) };
}));
app.post('/api/users', need(isTop), wrap((req) => {
  const b = req.body || {}, f = staffFields(b, false); checkStaff(f);
  // اسم المستخدم: الرقم الشخصي (أرقام فقط، ويُطبَّع كما في الدخول) أو اسم بالإنجليزية
  const raw = str(b.login, 64, 'اسم المستخدم'), login = R.normId(raw) || raw;
  if (!R.normId(raw) && !/^[A-Za-z][A-Za-z0-9._@-]{2,63}$/.test(login)) throw new Bad('اسم المستخدم: الرقم الشخصي (أرقام فقط)، أو اسم بالإنجليزية يبدأ بحرف');
  if (db.prepare('SELECT 1 FROM users WHERE login=?').get(login)) throw new Bad('اسم المستخدم مستخدم من قبل (قد يكون حساب متسابق بالرقم نفسه)', 409);
  const pass = auth.tempPassword();
  const id = db.prepare('INSERT INTO users(login,name,phone,email,role,section,specialty,pass_hash,must_change,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,1,?,?)')
    .run(login, f.name, f.phone, f.email, f.role, f.section, f.specialty, auth.hashPassword(pass), Date.now(), req.user.id).lastInsertRowid;
  audit(req.user, 'create', 'user', id, { section: f.section, summary: `إنشاء حساب ${ROLES[f.role]} «${login}»`, after: { ...f, login } });
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)), tempPassword: pass };
}));
app.patch('/api/users/:id', need(isTop), wrap((req) => {
  const id = +req.params.id, u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new Bad('الحساب غير موجود', 404);
  const b = req.body || {};
  if (u.role === 'contestant') {
    // حساب المتسابق: الإيقاف والتفعيل فقط؛ بياناته تُصحَّح من ملف التسجيل
    if (b.active === undefined) throw new Bad('بيانات المتسابق تُصحَّح من ملف تسجيله');
    db.prepare('UPDATE users SET active=? WHERE id=?').run(b.active ? 1 : 0, id);
    if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    audit(req.user, b.active ? 'activate' : 'deactivate', 'user', id, { summary: (b.active ? 'تفعيل' : 'إيقاف') + ' حساب متسابق' });
    return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
  }
  const f = { ...{ name: u.name, phone: u.phone, email: u.email, role: u.role, section: u.section, specialty: u.specialty }, ...staffFields(b, true) };
  checkStaff(f);
  if (b.active !== undefined) f.active = b.active ? 1 : 0;
  if (id === req.user.id && (f.active === 0 || f.role !== 'top')) throw new Bad('لا يمكنك إيقاف حسابك أو سحب صلاحية الإدارة العليا من نفسك');
  if (u.role === 'top' && (f.role !== 'top' || f.active === 0) && db.prepare("SELECT COUNT(*) n FROM users WHERE role='top' AND active=1").get().n <= 1)
    throw new Bad('يجب أن يبقى حساب إدارة عليا نشط واحد على الأقل');
  const keys = Object.keys(f);
  db.prepare(`UPDATE users SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => f[k]), id);
  if (f.active === 0 || f.role !== u.role || f.section !== u.section) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(req.user, 'update', 'user', id, { section: f.section, summary: `تعديل حساب «${u.login}»`, before: publicUser(u), after: f });
  return { user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) };
}));
app.post('/api/users/:id/reset', need(isTop), wrap((req) => {
  const id = +req.params.id, u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  if (!u) throw new Bad('الحساب غير موجود', 404);
  const pass = auth.tempPassword();
  db.prepare('UPDATE users SET pass_hash=?, must_change=1 WHERE id=?').run(auth.hashPassword(pass), id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  audit(req.user, 'reset', 'user', id, { section: u.section, summary: `إعادة تعيين كلمة مرور «${u.login}»` });
  return { tempPassword: pass };
}));

// ---------- سجل التدقيق (الإدارة العليا) ----------
app.get('/api/audit', need(isTop), wrap((req) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1), sec = SECTIONS[req.query.section] ? req.query.section : '';
  const w = sec ? 'WHERE a.section=?' : '', args = sec ? [sec] : [];
  const total = db.prepare(`SELECT COUNT(*) n FROM audit a ${w}`).get(...args).n;
  const rows = db.prepare(`SELECT a.*, u.name AS actor, u.role AS actor_role FROM audit a LEFT JOIN users u ON u.id=a.actor_id ${w} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...args, 50, (page - 1) * 50);
  return { total, page, pageSize: 50, rows: rows.map((a) => ({ id: a.id, at: a.at, action: a.action, entity: a.entity, entityId: a.entity_id, section: a.section, actor: a.actor || 'النظام', actorRole: ROLES[a.actor_role] || '', summary: a.summary, reason: a.reason, before: JSON.parse(a.before || 'null'), after: JSON.parse(a.after || 'null') })) };
}));

// التشغيل الميداني: اللجان والحضور والطوابير والنداء وشاشة الانتظار
require('./lib/field')(app);
// الرصد والنتائج
require('./lib/judging')(app);
// اختبار التفسير الإلكتروني
require('./lib/tests')(app);
require('./lib/materials').routes(app);
require('./lib/draws').routes(app);
require('./lib/days').routes(app);
require('./lib/trial').routes(app);
// الإشعارات ومواعيد المراحل
const N = require('./lib/notify');
N.routes(app);

app.use('/api', (req, res) => res.status(404).json({ error: 'غير موجود' }));

// ---------- الواجهة ----------
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: '1h', setHeaders: (res, p) => { if (/\.(js|css|html)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- التشغيل ----------
if (seedIfEmpty()) console.log('✓ أُنشئت الدورة المرجعية 2026 (الفروع والفئات والمقررات). عدّلها من «إعداد الدورة».');
// إنشاء حساب الإدارة العليا تلقائيًا عند أول تشغيل إذا ضُبط ADMIN_PASSWORD (مثل الاستضافة على Render)
if (!db.prepare("SELECT 1 FROM users WHERE role='top' LIMIT 1").get() && process.env.ADMIN_PASSWORD) {
  const u0 = (process.env.ADMIN_USERNAME || 'admin').trim(), u = R.normId(u0) || u0;
  if ((R.normId(u0) || /^[A-Za-z][A-Za-z0-9._@-]{2,63}$/.test(u)) && process.env.ADMIN_PASSWORD.length >= 8) {
    db.prepare("INSERT INTO users(login,name,role,pass_hash,must_change,created_at) VALUES (?,?,'top',?,1,?)").run(u, process.env.ADMIN_NAME || 'الإدارة العليا', auth.hashPassword(process.env.ADMIN_PASSWORD), Date.now());
    console.log(`✓ أُنشئ حساب الإدارة العليا «${u}» (يُطلب تغيير كلمة المرور عند أول دخول).`);
  } else console.warn('⚠  ADMIN_USERNAME أو ADMIN_PASSWORD غير صالح (كلمة المرور 8 أحرف على الأقل).');
}
if (/^(1|true|yes)$/i.test(process.env.AUTO_BACKUP || '')) {
  const { runBackup } = require('./lib/backup');
  const go = () => runBackup().then((r) => console.log(`✓ نسخة احتياطية تلقائية: ${path.basename(r.file)}`)).catch((e) => console.error('تعذّر النسخ الاحتياطي:', e.message));
  setTimeout(go, 10 * 60 * 1000).unref();
  setInterval(go, 24 * 60 * 60 * 1000).unref();
}
if (!db.prepare("SELECT 1 FROM users WHERE role='top' LIMIT 1").get())
  console.warn('\n⚠  لا يوجد حساب للإدارة العليا بعد. أنشئه بالأمر:\n   npm run create-admin -- <اسم_المستخدم> "<الاسم الكامل>"\n');

if (require.main === module) app.listen(config.port, config.host, () => console.log(`منصة اقرأ تعمل على http://localhost:${config.port}`));
module.exports = app;
