'use strict';
// قرعة مقطع التلاوة للمراحل اللاحقة.
// بعد إعلان التأهل يسحب المتسابق مقطعًا عشوائيًا من بنك مقرره (مساره وفئته) لتلك المرحلة.
// لديه ثلاث محاولات: بعد الأولى والثانية يعتمد المقطع أو يسحب غيره، والثالثة لا خيار بعدها إلا اعتمادها.
// لا رجوع إلى مقطع سابق، ولا يتكرر في سحوباته مقطع ظهر له. تُقفل القرعة عند حضوره تلك المرحلة.
const crypto = require('crypto');
const db = require('./db');
const RB = require('./rubrics');
const X = require('./xlsx');
const config = require('./config');
const { SECTIONS, STAGES, Bad, str, wrap, need, audit, isTop, scope, inScope, comp } = require('./util');

const MAX = 3;
const LATER = { semi: STAGES.semi, final: STAGES.final };
const stageOf = (v) => { if (!LATER[v]) throw new Bad('اختر مرحلة قبل النهائي أو النهائي'); return v; };
const quran = require('./quran.json');

// ---------- السور: بالرقم أو بالاسم ----------
const norm = (s) => String(s || '').replace(/[ً-ٰٟۖ-ۭـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  .replace(/^\s*سوره\s+/, '').replace(/\s+/g, ' ').trim();
const SURAH = new Map();
quran.surahs.forEach((s) => { const n = norm(s.name); SURAH.set(n, s.n); SURAH.set(n.replace(/^ال/, ''), s.n); });
function surahNo(v) {
  const t = String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  if (/^\d+$/.test(t)) return +t >= 1 && +t <= 114 ? +t : null;
  const n = norm(t); return SURAH.get(n) || SURAH.get(n.replace(/^ال/, '')) || null;
}
const latin = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
const label = (p) => `سورة ${quran.surahs[p.surah - 1].name}، الآيات ${p.ayah_from}–${p.ayah_to}`;

// ---------- المقررات ----------
const currSel = "SELECT cu.id, cu.track, cu.track_name, cu.category_id, k.name category FROM curricula cu LEFT JOIN categories k ON k.id=cu.category_id WHERE cu.comp_id=? AND cu.branch='tilawa'";
const currName = (c) => `${c.track_name || ''} · ${c.category || 'لكل الأعمار'}`;
const curricula = (compId) => db.prepare(currSel + ' ORDER BY cu.sort').all(compId);
const bankOf = (currId, stage) => db.prepare('SELECT * FROM passage_bank WHERE curriculum_id=? AND stage=? AND active=1 ORDER BY surah, ayah_from').all(currId, stage);

// ---------- حالة القرعة لمشاركة ----------
const entrySel = `SELECT e.id, e.branch, e.curriculum_id, e.track_name, r.section, r.category_name, r.comp_id, r.status rstatus, e.status estatus, p.full_name, p.national_id, p.user_id
  FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id`;
const liveDraws = (entryId, stage) => db.prepare('SELECT * FROM passage_draws WHERE entry_id=? AND stage=? AND reset_at IS NULL ORDER BY attempt').all(entryId, stage);
// المؤهل للقرعة: تأهل إلى المرحلة وأُعلن كشف تأهله، ولمقرره بنك مقاطع
function announced(entryId, stage) {
  return !!db.prepare("SELECT 1 FROM qualifications q JOIN result_sheets s ON s.id=q.sheet_id WHERE q.entry_id=? AND q.to_stage=? AND q.status='qualified' AND s.status='published'").get(entryId, stage);
}
// مهلة القرعة: يومان من إعلان التأهل (نشر الكشف أو قرار التأهل بعده)، أو من إعادة القرعة
function windowOf(entryId, stage) {
  const q = db.prepare("SELECT q.decided_at, s.published_at FROM qualifications q JOIN result_sheets s ON s.id=q.sheet_id WHERE q.entry_id=? AND q.to_stage=? AND q.status='qualified' AND s.status='published'").get(entryId, stage);
  if (!q) return null;
  const reset = db.prepare('SELECT MAX(reset_at) t FROM passage_draws WHERE entry_id=? AND stage=? AND reset_at IS NOT NULL').get(entryId, stage).t || 0;
  const openAt = Math.max(q.published_at || 0, q.decided_at || 0, reset);
  return { openAt, closesAt: openAt + config.drawHours * 3600e3 };
}
const fmtAt = (t) => new Intl.DateTimeFormat('ar-u-nu-latn-ca-gregory', { timeZone: config.timeZone, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(t));
const checkedIn = (entryId, stage) => !!db.prepare("SELECT 1 FROM tickets WHERE entry_id=? AND stage=? AND status<>'cancelled'").get(entryId, stage);
// المقاطع التي ظهرت لأي متسابق في المقرر والمرحلة والقسم نفسه (بما فيها محاولاته هو):
// لا يظهر المقطع الواحد لأكثر من متسابق، فلكل متسابق خياراته الخاصة
const keyOf = (d) => `${d.surah}:${d.ayah_from}:${d.ayah_to}`;
function takenKeys(currId, stage, section, compId) {
  return new Set(db.prepare(`SELECT d.surah, d.ayah_from, d.ayah_to FROM passage_draws d JOIN entries e2 ON e2.id=d.entry_id JOIN registrations r2 ON r2.id=e2.registration_id
    WHERE d.stage=? AND d.reset_at IS NULL AND e2.curriculum_id=? AND r2.section=? AND r2.comp_id=?`).all(stage, currId, section, compId).map(keyOf));
}
const freeOf = (e, stage) => { const t = takenKeys(e.curriculum_id, stage, e.section, e.comp_id); return bankOf(e.curriculum_id, stage).filter((b) => !t.has(keyOf(b))); };
function state(e, stage) {
  const ds = liveDraws(e.id, stage), bank = e.curriculum_id ? bankOf(e.curriculum_id, stage) : [];
  const approved = ds.find((d) => d.approved_at) || null, last = ds[ds.length - 1] || null;
  const left = e.curriculum_id ? freeOf(e, stage).length : 0;
  const open = e.branch === 'tilawa' && e.rstatus === 'accepted' && e.estatus === 'active' && announced(e.id, stage) && (bank.length > 0 || ds.length > 0);
  const locked = checkedIn(e.id, stage), w = open ? windowOf(e.id, stage) : null, expired = !!w && Date.now() > w.closesAt;
  const adminCanDraw = open && !locked && !approved && ds.length < MAX && left > 0, adminCanApprove = open && !locked && !approved && !!last;
  return { entryId: e.id, stage, stageName: STAGES[stage], open, locked, attempts: ds.length, max: MAX, left,
    closesAt: w ? w.closesAt : null, closes: w ? fmtAt(w.closesAt) : '', expired,
    canDraw: adminCanDraw && !expired, canApprove: adminCanApprove && !expired, adminCanDraw, adminCanApprove,
    status: approved ? 'approved' : last ? 'pending' : 'none', statusName: approved ? 'معتمد' : last ? 'لم يعتمد بعد' : 'لم يسحب',
    draws: ds.map((d) => ({ attempt: d.attempt, surah: d.surah, ayahFrom: d.ayah_from, ayahTo: d.ayah_to, label: label(d), at: d.drawn_at, approved: !!d.approved_at, byAdmin: d.drawn_by !== e.user_id })),
    current: last ? { attempt: last.attempt, label: label(last), approved: !!last.approved_at } : null };
}
// المقطع النافذ في التحكيم: المعتمد، وإلا آخر مقطع ظهر للمتسابق
function effective(entryId, stage) {
  const ds = liveDraws(entryId, stage);
  return ds.find((d) => d.approved_at) || ds[ds.length - 1] || null;
}

const byAdmin = (u) => u.role !== 'contestant';
function doDraw(e, stage, u, expect) {
  return db.transaction(() => {
    const st = state(e, stage);
    if (st.expired && !byAdmin(u) && !(expect && st.attempts >= +expect)) throw new Bad(`انتهت مهلة القرعة (${st.closes}). تواصل مع إدارة المسابقة.`, 409);
    // حماية من الضغط المزدوج أو إعادة الطلب: إن تجاوز عدد السحوبات المتوقع يعاد الوضع كما هو
    if (expect && st.attempts >= +expect) return { state: st, drawn: false };
    if (!st.open) throw new Bad('القرعة غير متاحة لهذه المشاركة', 409);
    if (st.locked) throw new Bad('أُقفلت القرعة بعد تسجيل الحضور لهذه المرحلة', 409);
    if (st.status === 'approved') throw new Bad('اعتُمد المقطع؛ لا سحب بعده', 409);
    if (st.attempts >= MAX) throw new Bad('استُنفدت المحاولات الثلاث', 409);
    const pool = freeOf(e, stage);
    if (!pool.length) throw new Bad(st.attempts ? 'لا توجد مقاطع أخرى متاحة في البنك؛ اعتمد المقطع الحالي' : 'لا توجد مقاطع متاحة في بنك مقررك الآن. تواصل مع إدارة المسابقة.', 409);
    const b = pool[crypto.randomInt(pool.length)], attempt = st.attempts + 1;
    db.prepare('INSERT INTO passage_draws(entry_id,stage,attempt,bank_id,surah,ayah_from,ayah_to,drawn_by,drawn_at) VALUES (?,?,?,?,?,?,?,?,?)').run(e.id, stage, attempt, b.id, b.surah, b.ayah_from, b.ayah_to, u.id, Date.now());
    audit(u, 'draw', 'entry', e.id, { section: e.section, summary: `قرعة ${STAGES[stage]} (المحاولة ${attempt}${u.id !== e.user_id ? '، من الإدارة' : ''}): ${e.full_name} — ${label(b)}` });
    return { state: state(e, stage), drawn: true };
  })();
}
function doApprove(e, stage, u) {
  return db.transaction(() => {
    const st = state(e, stage);
    if (st.status === 'approved') return { state: st, approved: false };
    if (st.expired && !byAdmin(u)) throw new Bad(`انتهت مهلة القرعة (${st.closes})؛ يُعتمد لك آخر مقطع ظهر لك.`, 409);
    if (!st.adminCanApprove) throw new Bad(st.locked ? 'أُقفلت القرعة بعد تسجيل الحضور' : 'لا يوجد مقطع لاعتماده', 409);
    const last = liveDraws(e.id, stage).pop();
    db.prepare('UPDATE passage_draws SET approved_at=?, approved_by=? WHERE id=?').run(Date.now(), u.id, last.id);
    audit(u, 'approve', 'entry', e.id, { section: e.section, summary: `اعتماد مقطع ${STAGES[stage]}${u.id !== e.user_id ? ' من الإدارة' : ''}: ${e.full_name} — ${label(last)}` });
    require('./notify').notify([e.user_id], 'draw_done', { key: `${e.id}:${stage}:${last.id}`, link: 'my', title: `اعتُمد مقطع ${STAGES[stage]}`, body: `${label(last)}.` });
    return { state: state(e, stage), approved: true };
  })();
}

// إشعار من تأهل وأُعلن تأهله ولم يعتمد مقطعه بعد (مرة لكل مشاركة ومرحلة)
function notifyOpen(compId, stage, section) {
  const rows = db.prepare(`${entrySel} JOIN qualifications q ON q.entry_id=e.id AND q.to_stage=? AND q.status='qualified' JOIN result_sheets s ON s.id=q.sheet_id AND s.status='published'
    WHERE r.comp_id=? AND e.branch='tilawa' AND r.status='accepted' AND e.status='active'${section ? ' AND r.section=?' : ''}`).all(...[stage, compId, ...(section ? [section] : [])]);
  const N = require('./notify');
  let n = 0;
  for (const e of rows) {
    const st = state(e, stage);
    if (!st.canDraw || st.attempts) continue;
    n += N.notify([e.user_id], 'draw_open', { key: `${e.id}:${stage}`, link: 'my', title: `قرعة مقطع ${STAGES[stage]}`,
      body: `ادخل «مشاركتي» واضغط «اختيار المقطع» ليختار النظام مقطعك عشوائيًا، قبل ${st.closes}. لديك ${MAX} محاولات: بعد الأولى والثانية تعتمد المقطع أو تسحب غيره، والثالثة تُعتمد. إن لم تعتمد قبل انتهاء المهلة يُعتمد آخر مقطع ظهر لك.` });
  }
  return n;
}

// ---------- الإدارة: قوائم المشاركات ----------
function adminRows(req, stage) {
  const c = comp(), sec = scope(req.user, req.query.section);
  const rows = db.prepare(`${entrySel} JOIN qualifications q ON q.entry_id=e.id AND q.to_stage=? AND q.status='qualified'
    WHERE r.comp_id=? AND e.branch='tilawa' AND r.status='accepted' AND e.status='active'${sec ? ' AND r.section=?' : ''} ORDER BY r.section, e.curriculum_id, p.full_name`).all(...[stage, c.id, ...(sec ? [sec] : [])]);
  const cn = Object.fromEntries(curricula(c.id).map((x) => [x.id, currName(x)]));
  return rows.map((e) => ({ ...state(e, stage), name: e.full_name, nationalId: e.national_id, section: e.section, sectionName: SECTIONS[e.section], group: cn[e.curriculum_id] || e.track_name, announced: announced(e.id, stage) }));
}
const loadEntry = (req) => {
  const e = db.prepare(entrySel + ' WHERE e.id=?').get(+req.params.entryId);
  if (!e || e.comp_id !== comp().id || (req.user.role !== 'contestant' && !inScope(req.user, e.section)) || (req.user.role === 'contestant' && e.user_id !== req.user.id)) throw new Bad('المشاركة غير موجودة', 404);
  return e;
};
const sendXlsx = (res, name, sheets) => {
  const bytes = X.write(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Content-Length', String(bytes.length));
  res.end(bytes);
};
const fail = (res, e) => { if (!(e instanceof Bad)) console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e instanceof Bad ? e.message : 'حدث خطأ في الخادم' }); };

// ---------- البنك: التحقق من صف ----------
function checkRow(cur, stage, surah, from, to) {
  const P = RB.passage(surah, from, to);
  if (!P) return 'السورة أو نطاق الآيات غير صحيح';
  if (db.prepare('SELECT 1 FROM passage_bank WHERE curriculum_id=? AND stage=? AND surah=? AND ayah_from=? AND ayah_to=? AND active=1').get(cur, stage, surah, from, to)) return 'المقطع موجود في بنك هذا المقرر';
  return '';
}
const BANK_HEAD = ['المسار', 'الفئة', 'المرحلة', 'رقم السورة', 'السورة', 'من الآية', 'إلى الآية', 'عدد الآيات', 'ملاحظة', 'مرات السحب'];

function routes(app) {
  const canView = (u) => ['exec', 'top', 'chief'].includes(u.role);
  const canAct = (u) => ['exec', 'top'].includes(u.role);

  app.get('/api/admin/bank', need(canView), wrap((req) => {
    const c = comp(), stage = stageOf(req.query.stage || 'semi');
    return { stage, stageName: STAGES[stage], canEdit: isTop(req.user), surahs: RB.surahList(),
      curricula: curricula(c.id).map((cu) => ({ id: cu.id, name: currName(cu), track: cu.track_name, category: cu.category || 'لكل الأعمار',
        capacity: Object.keys(SECTIONS).filter((sec) => inScope(req.user, sec)).map((sec) => {
          const q = db.prepare(`SELECT COUNT(*) n FROM qualifications q JOIN entries e ON e.id=q.entry_id JOIN registrations r ON r.id=e.registration_id
            WHERE q.to_stage=? AND q.status='qualified' AND e.curriculum_id=? AND r.section=? AND r.status='accepted' AND e.status='active'`).get(stage, cu.id, sec).n;
          const bank = bankOf(cu.id, stage), taken = takenKeys(cu.id, stage, sec, c.id);
          return { section: sec, sectionName: SECTIONS[sec], qualified: q, items: bank.length, taken: taken.size, free: bank.filter((b) => !taken.has(keyOf(b))).length, need: q * MAX };
        }),
        items: bankOf(cu.id, stage).map((b) => ({ id: b.id, surah: b.surah, ayahFrom: b.ayah_from, ayahTo: b.ayah_to, label: label(b), note: b.note,
          drawn: db.prepare('SELECT COUNT(*) n FROM passage_draws WHERE bank_id=? AND reset_at IS NULL').get(b.id).n })) })) };
  }));
  app.post('/api/admin/bank', need(isTop), wrap((req) => {
    const c = comp(), b = req.body || {}, stage = stageOf(b.stage);
    const cu = db.prepare(currSel + ' AND cu.id=?').get(c.id, +b.curriculumId); if (!cu) throw new Bad('اختر المقرر');
    const surah = surahNo(b.surah), from = parseInt(latin(b.ayahFrom), 10), to = parseInt(latin(b.ayahTo), 10);
    const err = surah ? checkRow(cu.id, stage, surah, from, to) : 'اختر السورة'; if (err) throw new Bad(err);
    const id = db.prepare('INSERT INTO passage_bank(comp_id,curriculum_id,stage,surah,ayah_from,ayah_to,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(c.id, cu.id, stage, surah, from, to, str(b.note, 200, 'ملاحظة', false), req.user.id, Date.now()).lastInsertRowid;
    audit(req.user, 'create', 'passage_bank', id, { summary: `إضافة مقطع إلى بنك ${STAGES[stage]} (${currName(cu)}): ${label({ surah, ayah_from: from, ayah_to: to })}` });
    return { ok: true, id };
  }));
  app.delete('/api/admin/bank/:id', need(isTop), wrap((req) => {
    const b = db.prepare('SELECT * FROM passage_bank WHERE id=? AND comp_id=? AND active=1').get(+req.params.id, comp().id); if (!b) throw new Bad('غير موجود', 404);
    const used = db.prepare('SELECT 1 FROM passage_draws WHERE bank_id=?').get(b.id);
    if (used) db.prepare('UPDATE passage_bank SET active=0 WHERE id=?').run(b.id); else db.prepare('DELETE FROM passage_bank WHERE id=?').run(b.id);
    audit(req.user, 'delete', 'passage_bank', b.id, { summary: `حذف مقطع من بنك ${STAGES[b.stage]}: ${label(b)}${used ? ' (سبق سحبه؛ يبقى عند من سحبه)' : ''}` });
    return { ok: true };
  }));
  // استيراد البنك من Excel: كل الصفوف تُفحص أولًا، ولا يُحفظ شيء إن وُجد خطأ
  app.post('/api/admin/bank/import', need(isTop), wrap((req) => {
    const c = comp(), b = req.body || {}, stage = stageOf(b.stage), mode = b.mode === 'replace' ? 'replace' : 'append';
    const f = b.file || {};
    if (!/\.xlsx$/i.test(String(f.name || ''))) throw new Bad('اختر ملف Excel بصيغة xlsx');
    const b64 = String(f.data || '').replace(/^data:[^,]*,/, '');
    if (!b64 || b64.length > 4 * 1024 * 1024) throw new Bad('الملف فارغ أو أكبر من 3 ميغابايت');
    let rows; try { rows = X.read(typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64') : Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))); } catch (e) { throw new Bad(e.message || 'تعذّرت قراءة الملف'); }
    const head = (rows[0] || []).map((h) => norm(h));
    const col = (...names) => head.findIndex((h) => names.some((n) => h === norm(n)));
    const C = { track: col('المسار'), cat: col('الفئة'), stage: col('المرحلة'), no: col('رقم السورة'), name: col('السورة', 'اسم السورة'), from: col('من الآية', 'من آية', 'من'), to: col('إلى الآية', 'الى الاية', 'إلى آية', 'إلى'), note: col('ملاحظة', 'ملاحظات') };
    if (C.track < 0 || C.cat < 0 || (C.no < 0 && C.name < 0) || C.from < 0 || C.to < 0) throw new Bad('الصف الأول يجب أن يحوي العناوين: المسار، الفئة، السورة (أو رقم السورة)، من الآية، إلى الآية. نزّل البنك الحالي واستخدمه نموذجًا.');
    const cus = curricula(c.id), errors = [], add = [], seen = new Set();
    rows.slice(1).forEach((r, i) => {
      const line = i + 2, v = (k) => (C[k] >= 0 ? String(r[C[k]] ?? '').trim() : '');
      const sv = v('no') || v('name');
      if (!sv && !v('from') && !v('to')) return; // صف فارغ أو صف نموذجي بلا مقطع
      if (v('stage') && ![STAGES[stage]].map(norm).includes(norm(v('stage')))) return; // صف لمرحلة أخرى
      const cu = cus.find((x) => norm(x.track_name) === norm(v('track')) && norm(x.category || 'لكل الأعمار') === norm(v('cat') || 'لكل الأعمار'));
      if (!cu) return errors.push(`الصف ${line}: لا يوجد مقرر تلاوة بالمسار «${v('track')}» والفئة «${v('cat')}»`);
      const surah = surahNo(sv), from = parseInt(latin(v('from')), 10), to = parseInt(latin(v('to')), 10);
      if (!surah) return errors.push(`الصف ${line}: السورة «${sv}» غير معروفة`);
      const k = `${cu.id}:${surah}:${from}:${to}`;
      if (seen.has(k)) return errors.push(`الصف ${line}: المقطع مكرر في الملف`);
      seen.add(k);
      if (!RB.passage(surah, from, to)) return errors.push(`الصف ${line}: نطاق الآيات غير صحيح في سورة ${quran.surahs[surah - 1].name} (${quran.surahs[surah - 1].ayat.length} آية)`);
      add.push({ cu, surah, from, to, note: v('note').slice(0, 200) });
    });
    if (errors.length) throw new Bad(`لم يُستورد شيء. صحّح الأخطاء ثم أعد الرفع:\n${errors.slice(0, 15).join('\n')}${errors.length > 15 ? `\n… و${errors.length - 15} أخطاء أخرى` : ''}`);
    if (!add.length) throw new Bad('لا توجد مقاطع في الملف');
    let added = 0, skipped = 0, removed = 0;
    db.transaction(() => {
      if (mode === 'replace') for (const x of db.prepare('SELECT * FROM passage_bank WHERE comp_id=? AND stage=? AND active=1').all(c.id, stage)) {
        if (db.prepare('SELECT 1 FROM passage_draws WHERE bank_id=?').get(x.id)) db.prepare('UPDATE passage_bank SET active=0 WHERE id=?').run(x.id); else db.prepare('DELETE FROM passage_bank WHERE id=?').run(x.id);
        removed++;
      }
      for (const x of add) {
        if (db.prepare('SELECT 1 FROM passage_bank WHERE curriculum_id=? AND stage=? AND surah=? AND ayah_from=? AND ayah_to=? AND active=1').get(x.cu.id, stage, x.surah, x.from, x.to)) { skipped++; continue; }
        db.prepare('INSERT INTO passage_bank(comp_id,curriculum_id,stage,surah,ayah_from,ayah_to,note,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(c.id, x.cu.id, stage, x.surah, x.from, x.to, x.note, req.user.id, Date.now());
        added++;
      }
      audit(req.user, 'import', 'passage_bank', null, { summary: `استيراد بنك ${STAGES[stage]} من Excel (${mode === 'replace' ? 'استبدال' : 'إضافة'}): أُضيف ${added}${skipped ? `، وتُرك ${skipped} موجود` : ''}${removed ? `، وأُزيل ${removed}` : ''}` });
    })();
    return { added, skipped, removed };
  }));
  app.get('/api/admin/bank.xlsx', need(canView), (req, res) => {
    try {
      const c = comp(), stage = stageOf(req.query.stage || 'semi'), rows = [BANK_HEAD];
      for (const cu of curricula(c.id)) {
        const items = bankOf(cu.id, stage);
        if (!items.length) rows.push([cu.track_name, cu.category || 'لكل الأعمار', STAGES[stage]]); // صف نموذجي يُكمل
        for (const b of items) rows.push([cu.track_name, cu.category || 'لكل الأعمار', STAGES[stage], b.surah, quran.surahs[b.surah - 1].name, b.ayah_from, b.ayah_to, b.ayah_to - b.ayah_from + 1, b.note,
          db.prepare('SELECT COUNT(*) n FROM passage_draws WHERE bank_id=? AND reset_at IS NULL').get(b.id).n]);
      }
      sendXlsx(res, `iqra-bank-${stage}.xlsx`, [{ name: `بنك ${STAGES[stage]}`, rows }]);
    } catch (e) { fail(res, e); }
  });

  // ---------- الإدارة: متابعة القرعة ----------
  app.get('/api/admin/draws', need(canView), wrap((req) => {
    const stage = stageOf(req.query.stage || 'semi'), rows = adminRows(req, stage);
    const count = (s) => rows.filter((r) => r.status === s).length;
    return { stage, stageName: STAGES[stage], canAct: canAct(req.user), rows, counts: { total: rows.length, none: count('none'), pending: count('pending'), approved: count('approved') } };
  }));
  app.get('/api/admin/draws.xlsx', need(canView), (req, res) => {
    try {
      const stage = stageOf(req.query.stage || 'semi'), rows = adminRows(req, stage);
      const out = [['القسم', 'الاسم', 'رقم الهوية', 'المسار والفئة', 'الحالة', 'المقطع النافذ', 'آخر موعد للقرعة', 'عدد المحاولات', 'المحاولة 1', 'المحاولة 2', 'المحاولة 3']];
      for (const r of rows) {
        const eff = r.draws.find((d) => d.approved) || r.draws[r.draws.length - 1];
        out.push([r.sectionName, r.name, r.nationalId, r.group, r.statusName, eff ? eff.label : '', r.closes + (r.expired ? ' (انتهت)' : ''), r.attempts, ...[0, 1, 2].map((i) => (r.draws[i] ? r.draws[i].label + (r.draws[i].byAdmin ? ' (الإدارة)' : '') : ''))]);
      }
      audit(req.user, 'export', 'draws', null, { section: scope(req.user, req.query.section), summary: `تصدير قرعة ${STAGES[stage]} (${rows.length})` });
      sendXlsx(res, `iqra-draws-${stage}.xlsx`, [{ name: `قرعة ${STAGES[stage]}`, rows: out }]);
    } catch (e) { fail(res, e); }
  });
  app.post('/api/admin/draws/notify', need(canAct), wrap((req) => {
    const stage = stageOf((req.body || {}).stage), sec = scope(req.user, (req.body || {}).section);
    return { notified: notifyOpen(comp().id, stage, sec) };
  }));
  // السحب أو الاعتماد نيابة عن المتسابق (بالقواعد نفسها)، وإعادة التعيين بسبب موثق
  app.post('/api/admin/draws/:entryId/draw', need(canAct), wrap((req) => doDraw(loadEntry(req), stageOf((req.body || {}).stage), req.user, (req.body || {}).expect)));
  app.post('/api/admin/draws/:entryId/approve', need(canAct), wrap((req) => doApprove(loadEntry(req), stageOf((req.body || {}).stage), req.user)));
  app.post('/api/admin/draws/:entryId/reset', need(canAct), wrap((req) => {
    const e = loadEntry(req), b = req.body || {}, stage = stageOf(b.stage), reason = str(b.reason, 300, 'سبب إعادة القرعة');
    if (checkedIn(e.id, stage)) throw new Bad('لا تُعاد القرعة بعد تسجيل الحضور لهذه المرحلة', 409);
    const ds = liveDraws(e.id, stage); if (!ds.length) throw new Bad('لم يسحب المتسابق بعد', 409);
    db.prepare('UPDATE passage_draws SET reset_at=?, reset_by=? WHERE entry_id=? AND stage=? AND reset_at IS NULL').run(Date.now(), req.user.id, e.id, stage);
    audit(req.user, 'reset', 'entry', e.id, { section: e.section, reason, summary: `إعادة قرعة ${STAGES[stage]}: ${e.full_name} (أُلغيت ${ds.length} محاولات)`, before: ds.map((d) => label(d)) });
    require('./notify').notify([e.user_id], 'draw_open', { key: `${e.id}:${stage}:reset:${Date.now()}`, link: 'my', title: `أُعيدت قرعة مقطع ${STAGES[stage]}`, body: `أعادت الإدارة قرعتك (${reason}). لديك ${MAX} محاولات جديدة من «مشاركتي» حتى ${state(e, stage).closes}.` });
    return { state: state(e, stage) };
  }));

  // ---------- المتسابق ----------
  app.get('/api/my/draws', need((u) => u.role === 'contestant'), wrap((req) => {
    const c = comp();
    const es = db.prepare(`${entrySel} WHERE p.user_id=? AND r.comp_id=? AND e.branch='tilawa'`).all(req.user.id, c.id);
    const out = [];
    for (const e of es) for (const stage of ['semi', 'final']) {
      const st = state(e, stage); if (!st.open) continue;
      const cur = st.current && liveDraws(e.id, stage).pop();
      out.push({ ...st, passage: cur ? RB.passage(cur.surah, cur.ayah_from, cur.ayah_to) : null });
    }
    return { rows: out };
  }));
  app.post('/api/my/draws/:entryId/draw', need((u) => u.role === 'contestant'), wrap((req) => doDraw(loadEntry(req), stageOf((req.body || {}).stage), req.user, (req.body || {}).expect)));
  app.post('/api/my/draws/:entryId/approve', need((u) => u.role === 'contestant'), wrap((req) => doApprove(loadEntry(req), stageOf((req.body || {}).stage), req.user)));
}

module.exports = { routes, effective, notifyOpen, surahNo, sendXlsx };
