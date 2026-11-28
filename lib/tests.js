'use strict';
// اختبار التفسير الإلكتروني: بنك أسئلة مُراجع، ومحاولة واحدة بزمن من الخادم، وحفظ تدريجي واستئناف، وتصحيح آلي.
// نوعان منفصلان: اختبار فرع التفسير (مشاركة مستقلة)، واختبار تفسير مقطع التلاوة (شرط لمشاركة التلاوة).
const crypto = require('crypto');
const db = require('./db');
const U = require('./util');
const { SECTIONS, Bad, str, wrap, need, audit, isTop, scope, inScope, comp, jparse } = U;

const KIND = { branch: 'اختبار فرع التفسير', passage: 'اختبار تفسير مقطع التلاوة' };
const TST = { draft: 'مسودة', open: 'مفتوح', closed: 'مغلق' };
const canManage = (u) => u.role === 'top';                 // إنشاء الاختبارات وبنك الأسئلة
const canReview = (u) => ['top', 'chief'].includes(u.role); // مراجعة الأسئلة والاطلاع على النتائج

const testRow = (id) => db.prepare('SELECT * FROM tests WHERE id=?').get(+id);
const curOf = (id) => db.prepare('SELECT cu.*, k.name AS category FROM curricula cu LEFT JOIN categories k ON k.id=cu.category_id WHERE cu.id=?').get(id);
function testJson(t) {
  const c = curOf(t.curriculum_id) || {};
  const q = db.prepare("SELECT COUNT(*) n, SUM(status='approved') ok, SUM(status='approved' AND type='mcq') okm, SUM(status='approved' AND type='tf') okt, SUM(type='mcq') nm, SUM(type='tf') nt FROM test_questions WHERE test_id=?").get(t.id);
  const mixed = t.mcq_count == null;
  return { id: t.id, kind: t.kind, kindName: KIND[t.kind], title: t.title, reference: t.reference, curriculumId: t.curriculum_id,
    curriculum: `${c.track_name ? c.track_name + ' · ' : ''}${c.category || 'لكل الأعمار'}: ${c.content || ''}`, questionCount: t.question_count, durationMin: t.duration_min,
    passMark: t.pass_mark, opensAt: t.opens_at, closesAt: t.closes_at, status: t.status, statusName: TST[t.status], resultsPublished: !!t.results_published,
    mcqCount: mixed ? null : t.mcq_count, tfCount: mixed ? null : t.tf_count, points: t.q_points ?? null, max: t.q_points != null ? t.question_count * t.q_points : null,
    bank: { mcq: q.nm || 0, tf: q.nt || 0, approvedMcq: q.okm || 0, approvedTf: q.okt || 0 },
    questions: q.n || 0, approved: q.ok || 0, attempts: db.prepare('SELECT COUNT(*) n FROM test_attempts WHERE test_id=?').get(t.id).n };
}
// هل الاختبار متاح الآن للبدء؟
function windowState(t, now = Date.now()) {
  if (t.status !== 'open') return { open: false, label: t.status === 'closed' ? 'أُغلق الاختبار' : 'لم يُفتح الاختبار بعد' };
  if (t.opens_at && now < t.opens_at) return { open: false, label: 'يُفتح الاختبار في موعده' };
  if (t.closes_at && now > t.closes_at) return { open: false, label: 'انتهت مدة الاختبار' };
  return { open: true, label: 'متاح الآن' };
}
// المشاركة التي تؤهل المتسابق لاختبار: فرع التفسير لمقرره، أو التلاوة لمقطعها
function myEntryFor(personId, t) {
  return db.prepare(`SELECT e.*, r.section FROM entries e JOIN registrations r ON r.id=e.registration_id
    WHERE r.person_id=? AND r.comp_id=? AND r.status='accepted' AND e.status='active' AND e.curriculum_id=? AND e.branch=?`).get(personId, t.comp_id, t.curriculum_id, t.kind === 'branch' ? 'tafsir' : 'tilawa');
}
// إنهاء المحاولة وتصحيحها على الخادم (عند الإرسال أو انتهاء الوقت)
function finalize(a, auto) {
  if (a.status === 'submitted') return a;
  const qids = a.question_ids.split(',').filter(Boolean).map(Number), ans = jparse(a.answers, {});
  const tp = (db.prepare('SELECT q_points FROM tests WHERE id=?').get(a.test_id) || {}).q_points; // درجة موحدة لكل سؤال إن حُددت
  let score = 0, max = 0;
  for (const id of qids) {
    const q = db.prepare('SELECT correct, points FROM test_questions WHERE id=?').get(id);
    if (!q) continue;
    const pts = tp ?? q.points;
    max += pts;
    if (ans[id] && ans[id].c === q.correct) score += pts;
  }
  const at = auto ? a.deadline : Date.now();
  db.prepare("UPDATE test_attempts SET status='submitted', submitted_at=?, auto_submitted=?, score=?, max=? WHERE id=? AND status='in_progress'").run(at, auto ? 1 : 0, score, max, a.id);
  return db.prepare('SELECT * FROM test_attempts WHERE id=?').get(a.id);
}
// إنهاء آلي عند انتهاء الوقت، يُنفَّذ عند أي قراءة للمحاولة
const settle = (a) => (a && a.status === 'in_progress' && Date.now() > a.deadline ? finalize(a, true) : a);

// استيراد نصي: كل سؤال كتلة تفصلها سطر فارغ. السطر الأول السؤال، وما بعده الخيارات، والصحيح ينتهي بعلامة *
// «صح» و«خطأ» وحدهما يجعلان السؤال صحًّا أو خطأً. سطر يبدأ بـ«المصدر:» يحفظ المرجع، و«الدرجة:» الدرجة.
function parseBank(text) {
  const out = [], errors = [];
  String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean)).filter((b) => b.length).forEach((lines, i) => {
    let src = '', pts = 1;
    lines = lines.filter((l) => { const m = l.match(/^(المصدر|الدرجة)\s*[:：]\s*(.*)$/); if (!m) return true; if (m[1] === 'المصدر') src = m[2]; else pts = Number(m[2]) || 1; return false; });
    const qtext = (lines.shift() || '').replace(/^(س|سؤال)?\s*\d*\s*[:.)-]\s*/, '').trim();
    const opts = lines.map((l) => l.replace(/^[أ-يa-z0-9]\s*[).\-:]\s*/i, '').trim());
    const correct = opts.findIndex((o) => /\*\s*$/.test(o));
    const clean = opts.map((o) => o.replace(/\s*\*\s*$/, ''));
    if (!qtext) return errors.push(`السؤال ${i + 1}: بلا نص`);
    if (clean.length < 2) return errors.push(`السؤال ${i + 1}: يحتاج خيارين على الأقل`);
    if (correct < 0 || opts.filter((o) => /\*\s*$/.test(o)).length !== 1) return errors.push(`السؤال ${i + 1}: علّم إجابة صحيحة واحدة بعلامة *`);
    const tf = clean.length === 2 && clean.includes('صح') && clean.includes('خطأ');
    out.push({ type: tf ? 'tf' : 'mcq', text: qtext, options: clean, correct, points: pts, source: src });
  });
  return { questions: out, errors };
}
function questionFields(b) {
  const type = b.type === 'tf' ? 'tf' : 'mcq';
  const options = type === 'tf' ? ['صح', 'خطأ'] : (Array.isArray(b.options) ? b.options : []).map((o) => String(o || '').trim()).filter(Boolean);
  if (options.length < 2 || options.length > 6) throw new Bad('الخيارات من 2 إلى 6');
  const correct = Number(b.correct);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) throw new Bad('حدد الإجابة الصحيحة');
  const points = Number(b.points ?? 1);
  if (!(points > 0 && points <= 100)) throw new Bad('درجة السؤال غير صحيحة');
  return { type, text: str(b.text, 1000, 'نص السؤال'), options, correct, points, source: str(b.source, 300, 'المصدر', false) };
}
const qJson = (q, withKey) => ({ id: q.id, type: q.type, text: q.text, options: jparse(q.options, []), points: q.points, ...(withKey ? { correct: q.correct, source: q.source, status: q.status } : {}) });

module.exports = function tests(app) {
  // ---------- الإدارة ----------
  app.get('/api/tests', need((u) => canReview(u) || u.role === 'exec'), wrap(() => {
    const c = comp();
    const curr = db.prepare("SELECT cu.*, k.name AS category FROM curricula cu LEFT JOIN categories k ON k.id=cu.category_id WHERE cu.comp_id=? AND cu.branch IN ('tafsir','tilawa') ORDER BY cu.branch DESC, cu.sort").all(c.id);
    return { tests: db.prepare('SELECT * FROM tests WHERE comp_id=? ORDER BY kind, id').all(c.id).map(testJson),
      curricula: curr.map((x) => ({ id: x.id, kind: x.branch === 'tafsir' ? 'branch' : 'passage', name: `${x.track_name ? x.track_name + ' · ' : ''}${x.category || 'لكل الأعمار'}: ${x.content}` })) };
  }));
  function testFields(b) {
    const ts = (v, label) => { if (v === '' || v == null) return null; const n = typeof v === 'number' ? v : Date.parse(v); if (!Number.isFinite(n)) throw new Bad(`${label}: موعد غير صحيح`); return n; };
    const f = { title: str(b.title, 120, 'عنوان الاختبار'), reference: str(b.reference, 300, 'الكتاب المرجعي ونسخته', false),
      mcq_count: b.mcqCount === undefined ? 25 : parseInt(b.mcqCount, 10), tf_count: b.tfCount === undefined ? 25 : parseInt(b.tfCount, 10), q_points: b.points === undefined || b.points === '' ? 2 : Number(b.points),
      duration_min: parseInt(b.durationMin, 10), pass_mark: b.passMark === '' || b.passMark == null ? null : Number(b.passMark),
      opens_at: ts(b.opensAt, 'بداية الاختبار'), closes_at: ts(b.closesAt, 'نهاية الاختبار') };
    if (!(f.mcq_count >= 0 && f.mcq_count <= 200) || !(f.tf_count >= 0 && f.tf_count <= 200)) throw new Bad('عدد الأسئلة من كل نوع من 0 إلى 200');
    f.question_count = f.mcq_count + f.tf_count;
    if (!(f.question_count >= 1)) throw new Bad('حدد عدد الأسئلة');
    if (!(f.q_points > 0 && f.q_points <= 100)) throw new Bad('درجة السؤال من أكثر من صفر إلى 100');
    if (!(f.duration_min >= 1 && f.duration_min <= 300)) throw new Bad('المدة من 1 إلى 300 دقيقة');
    if (f.pass_mark != null && !(f.pass_mark >= 0)) throw new Bad('حد النجاح غير صحيح');
    if (f.opens_at && f.closes_at && f.opens_at >= f.closes_at) throw new Bad('نهاية الاختبار قبل بدايته');
    return f;
  }
  app.post('/api/tests', need(canManage), wrap((req) => {
    const c = comp(), b = req.body || {}, cu = db.prepare("SELECT * FROM curricula WHERE id=? AND comp_id=? AND branch IN ('tafsir','tilawa')").get(+b.curriculumId, c.id);
    if (!cu) throw new Bad('اختر مقرر التفسير أو مقطع التلاوة');
    const kind = cu.branch === 'tafsir' ? 'branch' : 'passage', f = testFields(b), now = Date.now();
    if (db.prepare('SELECT 1 FROM tests WHERE comp_id=? AND kind=? AND curriculum_id=?').get(c.id, kind, cu.id)) throw new Bad('يوجد اختبار لهذا المقرر', 409);
    const id = db.prepare('INSERT INTO tests(comp_id,kind,curriculum_id,title,reference,question_count,mcq_count,tf_count,q_points,duration_min,pass_mark,opens_at,closes_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(c.id, kind, cu.id, f.title, f.reference, f.question_count, f.mcq_count, f.tf_count, f.q_points, f.duration_min, f.pass_mark, f.opens_at, f.closes_at, now, now).lastInsertRowid;
    audit(req.user, 'create', 'test', id, { summary: `إنشاء ${KIND[kind]}: ${f.title}`, after: f });
    return { test: testJson(testRow(id)) };
  }));
  app.put('/api/tests/:id', need(canManage), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const b = req.body || {}, f = testFields(b), status = TST[b.status] ? b.status : t.status;
    const started = db.prepare('SELECT COUNT(*) n FROM test_attempts WHERE test_id=?').get(t.id).n;
    if (started && (f.mcq_count !== t.mcq_count || f.tf_count !== t.tf_count || f.q_points !== t.q_points || f.duration_min !== t.duration_min)) throw new Bad('لا يُغيَّر عدد الأسئلة أو درجتها أو المدة بعد بدء محاولات', 409);
    if (status === 'open') {
      const ok = (type) => db.prepare("SELECT COUNT(*) n FROM test_questions WHERE test_id=? AND status='approved' AND type=?").get(t.id, type).n;
      if (ok('mcq') < f.mcq_count || ok('tf') < f.tf_count)
        throw new Bad(`لا يُفتح الاختبار قبل اعتماد ${f.mcq_count} سؤال اختيار من متعدد و${f.tf_count} سؤال صح أو خطأ على الأقل في البنك (المعتمد الآن ${ok('mcq')} و${ok('tf')})`, 409);
    }
    db.prepare('UPDATE tests SET title=?,reference=?,question_count=?,mcq_count=?,tf_count=?,q_points=?,duration_min=?,pass_mark=?,opens_at=?,closes_at=?,status=?,updated_at=? WHERE id=?')
      .run(f.title, f.reference, f.question_count, f.mcq_count, f.tf_count, f.q_points, f.duration_min, f.pass_mark, f.opens_at, f.closes_at, status, Date.now(), t.id);
    audit(req.user, 'update', 'test', t.id, { summary: `تعديل الاختبار «${f.title}» (${TST[status]})`, before: testJson(t), after: { ...f, status } });
    if (status === 'open' && t.status !== 'open') {
      const ids = db.prepare(`SELECT DISTINCT p.user_id id FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id WHERE r.comp_id=? AND r.status='accepted' AND e.status='active' AND e.curriculum_id=?`).all(t.comp_id, t.curriculum_id).map((x) => x.id);
      require('./notify').events.testOpened(testRow(t.id), ids);
    }
    return { test: testJson(testRow(t.id)) };
  }));
  app.get('/api/tests/:id', need(canReview), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    return { test: testJson(t), questions: db.prepare('SELECT * FROM test_questions WHERE test_id=? ORDER BY id').all(t.id).map((q) => ({ ...qJson(q, true), used: !!db.prepare('SELECT 1 FROM test_attempts WHERE test_id=? AND question_ids LIKE ?').get(t.id, `%,${q.id},%`) })) };
  }));
  app.post('/api/tests/:id/questions', need(canManage), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const f = questionFields(req.body || {});
    const id = db.prepare('INSERT INTO test_questions(test_id,type,text,options,correct,points,source,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(t.id, f.type, f.text, JSON.stringify(f.options), f.correct, f.points, f.source, req.user.id, Date.now()).lastInsertRowid;
    return { id };
  }));
  app.post('/api/tests/:id/import', need(canManage), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const { questions, errors } = parseBank((req.body || {}).text);
    if (errors.length) throw new Bad(errors[0], 400, { errors });
    if (!questions.length) throw new Bad('لا توجد أسئلة في النص');
    db.transaction(() => { for (const q of questions) db.prepare('INSERT INTO test_questions(test_id,type,text,options,correct,points,source,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(t.id, q.type, q.text, JSON.stringify(q.options), q.correct, q.points, q.source, req.user.id, Date.now()); })();
    audit(req.user, 'import', 'test', t.id, { summary: `استيراد ${questions.length} سؤالًا إلى «${t.title}»` });
    return { imported: questions.length };
  }));
  const usedQ = (q) => !!db.prepare('SELECT 1 FROM test_attempts WHERE test_id=? AND question_ids LIKE ?').get(q.test_id, `%,${q.id},%`);
  // ---------- بنك الأسئلة بملف Excel ----------
  // الأعمدة: النوع، السؤال، الخيار 1..6، الإجابة الصحيحة، المصدر (والحالة عند التنزيل فقط)
  const X = require('./xlsx');
  const TYPE_NAME = { mcq: 'اختيار من متعدد', tf: 'صح أو خطأ' };
  const nz = (v) => String(v ?? '').replace(/[ً-ٰٟـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  const digits = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).trim();
  const LETTERS = ['ا', 'ب', 'ج', 'د', 'ه', 'و'];
  function typeOf(v) {
    const x = nz(v).toLowerCase();
    if (!x) return null;
    if (x === 'mcq' || x.includes('اختيار') || x.includes('متعدد')) return 'mcq';
    if (x === 'tf' || x.includes('صح') || x.includes('خطا')) return 'tf';
    return undefined;
  }
  function parseXlsxBank(rows) {
    const head = (rows[0] || []).map(nz);
    const col = (...names) => head.findIndex((h) => names.map(nz).includes(h));
    const C = { type: col('النوع', 'نوع السؤال'), text: col('السؤال', 'نص السؤال'), correct: col('الإجابة الصحيحة', 'الاجابه الصحيحه', 'الصحيح'), source: col('المصدر', 'المرجع') };
    const optCols = head.map((h, i) => (/^الخيار\s*\d*$/.test(h) || /^خيار\s*\d*$/.test(h) ? i : -1)).filter((i) => i >= 0);
    if (C.type < 0 || C.text < 0 || C.correct < 0) throw new Bad('الصف الأول يجب أن يحوي العناوين: النوع، السؤال، الخيار 1، الخيار 2…، الإجابة الصحيحة. نزّل البنك واستخدمه نموذجًا.');
    const out = [], errors = [];
    rows.slice(1).forEach((r, i) => {
      const line = i + 2, v = (k) => (C[k] >= 0 ? String(r[C[k]] ?? '').trim() : '');
      const text = v('text'), tv = v('type'), cv = v('correct');
      if (!text && !tv && !cv) return;
      const type = typeOf(tv);
      if (type === undefined || type === null) return errors.push(`الصف ${line}: النوع يُكتب «اختيار من متعدد» أو «صح أو خطأ»`);
      if (!text) return errors.push(`الصف ${line}: بلا نص سؤال`);
      if (text.length > 1000) return errors.push(`الصف ${line}: نص السؤال أطول من 1000 حرف`);
      let options, correct;
      if (type === 'tf') {
        options = ['صح', 'خطأ'];
        const c = nz(cv);
        correct = ['صح', 'صحيح', 'نعم', '1', 'true'].map(nz).includes(c) ? 0 : ['خطا', 'خاطئ', 'لا', '2', '0', 'false'].map(nz).includes(c) ? 1 : -1;
        if (correct < 0) return errors.push(`الصف ${line}: الإجابة الصحيحة لسؤال الصح والخطأ تُكتب «صح» أو «خطأ»`);
      } else {
        options = optCols.map((ci) => String(r[ci] ?? '').trim()).filter(Boolean);
        if (options.length < 2 || options.length > 6) return errors.push(`الصف ${line}: سؤال الاختيار يحتاج من خيارين إلى ستة خيارات`);
        const d = digits(cv), c = nz(cv);
        correct = /^\d+$/.test(d) ? +d - 1 : LETTERS.indexOf(c.replace(/[).\s]/g, '')) >= 0 ? LETTERS.indexOf(c.replace(/[).\s]/g, '')) : options.map(nz).indexOf(c);
        if (!(correct >= 0 && correct < options.length)) return errors.push(`الصف ${line}: الإجابة الصحيحة تُكتب رقم الخيار (1–${options.length}) أو حرفه أو نصه`);
      }
      out.push({ type, text, options, correct, source: v('source').slice(0, 300) });
    });
    return { questions: out, errors };
  }
  app.post('/api/tests/:id/import-xlsx', need(canManage), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const b = req.body || {}, f = b.file || {}, mode = b.mode === 'replace' ? 'replace' : 'append', approve = !!b.approve;
    if (!/\.xlsx$/i.test(String(f.name || ''))) throw new Bad('اختر ملف Excel بصيغة xlsx');
    const b64 = String(f.data || '').replace(/^data:[^,]*,/, '');
    if (!b64 || b64.length > 6 * 1024 * 1024) throw new Bad('الملف فارغ أو أكبر من 4 ميغابايت');
    let rows; try { rows = X.read(typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64') : Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))); } catch (e) { throw new Bad(e.message || 'تعذّرت قراءة الملف'); }
    const { questions, errors } = parseXlsxBank(rows);
    if (errors.length) throw new Bad(`لم يُستورد شيء. صحّح الأخطاء ثم أعد الرفع:\n${errors.slice(0, 15).join('\n')}${errors.length > 15 ? `\n… و${errors.length - 15} أخطاء أخرى` : ''}`);
    if (!questions.length) throw new Bad('لا توجد أسئلة في الملف');
    let added = 0, skipped = 0, removed = 0, kept = 0;
    db.transaction(() => {
      if (mode === 'replace') for (const q of db.prepare('SELECT * FROM test_questions WHERE test_id=?').all(t.id)) {
        if (usedQ(q)) { kept++; continue; }
        db.prepare('DELETE FROM test_questions WHERE id=?').run(q.id); removed++;
      }
      const have = new Set(db.prepare('SELECT type, text FROM test_questions WHERE test_id=?').all(t.id).map((q) => q.type + '|' + nz(q.text)));
      for (const q of questions) {
        const k = q.type + '|' + nz(q.text);
        if (have.has(k)) { skipped++; continue; }
        have.add(k);
        db.prepare('INSERT INTO test_questions(test_id,type,text,options,correct,points,source,status,created_by,reviewed_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(t.id, q.type, q.text, JSON.stringify(q.options), q.correct, t.q_points ?? 1, q.source, approve ? 'approved' : 'draft', req.user.id, approve ? req.user.id : null, Date.now());
        added++;
      }
      audit(req.user, 'import', 'test', t.id, { summary: `رفع بنك أسئلة «${t.title}» من Excel (${mode === 'replace' ? 'استبدال' : 'إضافة'}${approve ? '، مع الاعتماد' : ''}): أُضيف ${added}${skipped ? `، وتُرك ${skipped} مكرر` : ''}${removed ? `، وحُذف ${removed}` : ''}${kept ? `، وبقي ${kept} ظهرت في محاولات` : ''}` });
    })();
    return { added, skipped, removed, kept };
  }));
  app.get('/api/tests/:id/bank.xlsx', need(canReview), (req, res) => {
    try {
      const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
      const qs = db.prepare('SELECT * FROM test_questions WHERE test_id=? ORDER BY type, id').all(t.id);
      const head = ['النوع', 'السؤال', 'الخيار 1', 'الخيار 2', 'الخيار 3', 'الخيار 4', 'الإجابة الصحيحة', 'المصدر', 'الحالة'];
      const rows = [head];
      for (const q of qs) {
        const o = jparse(q.options, []);
        rows.push(q.type === 'tf' ? [TYPE_NAME.tf, q.text, '', '', '', '', o[q.correct], q.source, q.status === 'approved' ? 'معتمد' : 'بانتظار المراجعة']
          : [TYPE_NAME.mcq, q.text, o[0] || '', o[1] || '', o[2] || '', o[3] || '', q.correct + 1, q.source, q.status === 'approved' ? 'معتمد' : 'بانتظار المراجعة']);
        if (q.type === 'mcq' && o.length > 4) { rows[0][9] = 'الخيار 5'; rows[0][10] = 'الخيار 6'; rows[rows.length - 1][9] = o[4] || ''; rows[rows.length - 1][10] = o[5] || ''; }
      }
      if (!qs.length) rows.push([TYPE_NAME.mcq, 'مثال: في أي سورة وردت آية الكرسي؟', 'آل عمران', 'البقرة', 'النساء', 'المائدة', 2, 'المرجع، ص 10'], [TYPE_NAME.tf, 'مثال: سورة النبأ مكية', '', '', '', '', 'صح', '']);
      audit(req.user, 'export', 'test', t.id, { summary: `تنزيل بنك أسئلة «${t.title}» (${qs.length})` });
      require('./draws').sendXlsx(res, `iqra-tafsir-bank-${t.id}.xlsx`, [{ name: 'بنك الأسئلة', rows, widths: [16, 60, 22, 22, 22, 22, 16, 24, 16, 22, 22] }]);
    } catch (e) { if (!(e instanceof Bad)) console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e instanceof Bad ? e.message : 'حدث خطأ في الخادم' }); }
  });
  app.post('/api/tests/:id/approve-all', need(canReview), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const n = db.prepare("UPDATE test_questions SET status='approved', reviewed_by=? WHERE test_id=? AND status='draft'").run(req.user.id, t.id).changes;
    audit(req.user, 'approve', 'test', t.id, { summary: `اعتماد كل الأسئلة بانتظار المراجعة في «${t.title}» (${n})` });
    return { approved: n };
  }));
  // السؤال المستخدم في محاولة لا يُعدَّل ولا يُحذف؛ إلغاؤه يحتاج مراجعة وإعادة احتساب موثقة
  app.put('/api/questions/:id', need(canManage), wrap((req) => {
    const q = db.prepare('SELECT * FROM test_questions WHERE id=?').get(+req.params.id); if (!q) throw new Bad('السؤال غير موجود', 404);
    if (usedQ(q)) throw new Bad('السؤال ظهر في محاولة؛ لا يُعدَّل', 409);
    const f = questionFields(req.body || {});
    db.prepare("UPDATE test_questions SET type=?,text=?,options=?,correct=?,points=?,source=?,status='draft',reviewed_by=NULL WHERE id=?").run(f.type, f.text, JSON.stringify(f.options), f.correct, f.points, f.source, q.id);
    return { ok: true };
  }));
  app.delete('/api/questions/:id', need(canManage), wrap((req) => {
    const q = db.prepare('SELECT * FROM test_questions WHERE id=?').get(+req.params.id); if (!q) throw new Bad('السؤال غير موجود', 404);
    if (usedQ(q)) throw new Bad('السؤال ظهر في محاولة؛ لا يُحذف', 409);
    db.prepare('DELETE FROM test_questions WHERE id=?').run(q.id);
    return { ok: true };
  }));
  app.post('/api/questions/:id/review', need(canReview), wrap((req) => {
    const q = db.prepare('SELECT * FROM test_questions WHERE id=?').get(+req.params.id); if (!q) throw new Bad('السؤال غير موجود', 404);
    const ok = (req.body || {}).approve !== false;
    if (!ok && usedQ(q)) throw new Bad('السؤال ظهر في محاولة', 409);
    db.prepare('UPDATE test_questions SET status=?, reviewed_by=? WHERE id=?').run(ok ? 'approved' : 'draft', ok ? req.user.id : null, q.id);
    audit(req.user, ok ? 'approve' : 'unapprove', 'question', q.id, { summary: `${ok ? 'اعتماد' : 'سحب اعتماد'} سؤال: ${q.text.slice(0, 60)}` });
    return { ok: true };
  }));
  // النتائج: الترتيب لكل قسم بالدرجة، وعند التساوي بسرعة التسليم (زمن الحل من البدء إلى الإرسال، بالملّي ثانية من الخادم).
  // من أُرسل آليًا عند انتهاء الوقت زمنه المدة كاملة. التنفيذية ترى الإنجاز دون الدرجة
  function ranked(t, sec) {
    const rows = db.prepare(`SELECT a.* FROM test_attempts a WHERE a.test_id=?${sec ? ' AND a.section=?' : ''}`).all(...[t.id, ...(sec ? [sec] : [])]).map(settle)
      .map((a) => { const p = db.prepare('SELECT full_name, national_id FROM people WHERE id=?').get(a.person_id);
        return { personId: a.person_id, name: p.full_name, nationalId: p.national_id, section: a.section, sectionName: SECTIONS[a.section], status: a.status, score: a.score, max: a.max,
          ms: a.submitted_at ? a.submitted_at - a.started_at : null, seconds: a.submitted_at ? Math.round((a.submitted_at - a.started_at) / 1000) : null, auto: !!a.auto_submitted,
          passed: t.pass_mark == null || a.score == null ? null : a.score >= t.pass_mark }; });
    for (const s of Object.keys(SECTIONS)) {
      const done = rows.filter((r) => r.section === s && r.status === 'submitted').sort((a, b) => b.score - a.score || a.ms - b.ms);
      done.forEach((r) => {
        r.rank = 1 + done.filter((x) => x.score > r.score || (x.score === r.score && x.ms < r.ms)).length;
        r.tie = done.some((x) => x !== r && x.score === r.score); // تساوٍ في الدرجة حُسم بالزمن
        r.tieExact = done.some((x) => x !== r && x.score === r.score && x.ms === r.ms); // تساوٍ في الدرجة والزمن معًا
      });
    }
    return rows.sort((a, b) => a.section.localeCompare(b.section) || (a.rank || 1e9) - (b.rank || 1e9));
  }
  app.get('/api/tests/:id/results', need((u) => canReview(u) || u.role === 'exec'), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const sec = scope(req.user, req.query.section), full = canReview(req.user);
    const rows = ranked(t, sec).map((r) => (full ? r : { name: r.name, section: r.section, sectionName: r.sectionName, status: r.status }));
    // المسجلون الذين لم يبدؤوا
    const eligible = db.prepare(`SELECT p.full_name, r.section FROM entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id
      WHERE r.comp_id=? AND r.status='accepted' AND e.status='active' AND e.curriculum_id=?${sec ? ' AND r.section=?' : ''} AND p.id NOT IN (SELECT person_id FROM test_attempts WHERE test_id=?)`).all(...[t.comp_id, t.curriculum_id, ...(sec ? [sec] : []), t.id]);
    return { test: testJson(t), rows, notStarted: eligible.map((x) => ({ name: x.full_name, sectionName: SECTIONS[x.section] })) };
  }));
  app.get('/api/tests/:id/results.xlsx', need(canReview), (req, res) => {
    try {
      const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
      const sec = scope(req.user, req.query.section), rows = ranked(t, sec);
      const mmss = (s) => (s == null ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      const head = ['المركز', 'الاسم', 'رقم الهوية', 'الدرجة', 'من', 'زمن الحل (دقيقة:ثانية)', 'زمن الحل بالثواني', 'ملاحظة'];
      const sheets = Object.keys(SECTIONS).filter((s) => !sec || s === sec).map((s) => ({ name: `${SECTIONS[s]}`, rows: [head, ...rows.filter((r) => r.section === s).map((r) => [
        r.rank || '—', r.name, r.nationalId, r.score ?? '', r.max ?? '', mmss(r.seconds), r.ms != null ? Math.round(r.ms / 100) / 10 : '',
        [r.status !== 'submitted' ? 'لم يُرسل' : '', r.auto ? 'إرسال آلي عند انتهاء الوقت' : '', r.tie && r.status === 'submitted' ? (r.tieExact ? 'تساوٍ في الدرجة والزمن' : 'تساوٍ في الدرجة، والتمايز بالزمن') : '', r.passed === false ? 'دون حد النجاح' : ''].filter(Boolean).join('، ')])] }));
      audit(req.user, 'export', 'test', t.id, { section: sec, summary: `تنزيل نتائج «${t.title}» (${rows.length})` });
      require('./draws').sendXlsx(res, `iqra-tafsir-results-${t.id}.xlsx`, sheets);
    } catch (e) { if (!(e instanceof Bad)) console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e instanceof Bad ? e.message : 'حدث خطأ في الخادم' }); }
  });
  app.post('/api/tests/:id/publish', need(canManage), wrap((req) => {
    const t = testRow(req.params.id); if (!t) throw new Bad('الاختبار غير موجود', 404);
    const pub = (req.body || {}).publish !== false;
    if (pub && t.status !== 'closed') throw new Bad('أغلق الاختبار قبل نشر نتائجه', 409);
    db.prepare('UPDATE tests SET results_published=? WHERE id=?').run(pub ? 1 : 0, t.id);
    audit(req.user, pub ? 'publish' : 'unpublish', 'test', t.id, { summary: `${pub ? 'نشر' : 'إيقاف نشر'} نتائج «${t.title}»` });
    if (pub) require('./notify').events.testResults(t, db.prepare("SELECT DISTINCT p.user_id id FROM test_attempts a JOIN people p ON p.id=a.person_id WHERE a.test_id=? AND a.status='submitted'").all(t.id).map((x) => x.id));
    return { ok: true };
  }));

  // ---------- المتسابق ----------
  const myPerson = (u) => db.prepare('SELECT * FROM people WHERE user_id=?').get(u.id);
  const onlyC = need((u) => u.role === 'contestant');
  function myTest(req) {
    const p = myPerson(req.user), t = testRow(req.params.id);
    if (!p || !t || t.status === 'draft') throw new Bad('الاختبار غير موجود', 404);
    const e = myEntryFor(p.id, t);
    if (!e) throw new Bad('الاختبار غير موجود', 404);
    return { p, t, e };
  }
  const attemptOf = (t, p) => settle(db.prepare('SELECT * FROM test_attempts WHERE test_id=? AND person_id=?').get(t.id, p.id));
  app.get('/api/my/tests', onlyC, wrap((req) => {
    const c = comp(), p = myPerson(req.user); if (!p) return { tests: [] };
    const out = [];
    for (const t of db.prepare("SELECT * FROM tests WHERE comp_id=? AND status<>'draft' ORDER BY kind").all(c.id)) {
      if (!myEntryFor(p.id, t)) continue;
      const a = attemptOf(t, p), w = windowState(t);
      out.push({ id: t.id, kind: t.kind, kindName: KIND[t.kind], title: t.title, reference: t.reference, questionCount: t.question_count, mcqCount: t.mcq_count, tfCount: t.tf_count, points: t.q_points, max: t.q_points != null ? t.question_count * t.q_points : null, durationMin: t.duration_min, opensAt: t.opens_at, closesAt: t.closes_at,
        window: w, attempt: a ? { status: a.status, deadline: a.deadline, submittedAt: a.submitted_at } : null,
        result: a && a.status === 'submitted' && t.results_published ? (() => { const mine = ranked(t, a.section).filter((r) => r.status === 'submitted'), me = mine.find((r) => r.personId === p.id);
          return { score: a.score, max: a.max, passed: t.pass_mark == null ? null : a.score >= t.pass_mark, rank: me ? me.rank : null, count: mine.length }; })() : null });
    }
    return { tests: out, now: Date.now() };
  }));
  app.post('/api/my/tests/:id/start', onlyC, wrap((req) => {
    const { p, t, e } = myTest(req);
    const old = attemptOf(t, p);
    if (old) return { ok: true }; // بدء مكرر أو من جهاز ثانٍ: المحاولة نفسها وزمنها نفسه
    const w = windowState(t); if (!w.open) throw new Bad(w.label, 409);
    // سحب عشوائي مستقل لكل متسابق: أسئلة الاختيار من متعدد أولًا ثم الصح والخطأ، بالعدد المحدد لكل نوع
    const pick = (type, n) => {
      const bank = db.prepare(`SELECT id FROM test_questions WHERE test_id=? AND status='approved'${type ? ' AND type=?' : ''}`).all(...[t.id, ...(type ? [type] : [])]).map((x) => x.id);
      if (bank.length < n) throw new Bad('بنك الأسئلة غير مكتمل؛ تواصل مع إدارة المسابقة', 409);
      for (let i = bank.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [bank[i], bank[j]] = [bank[j], bank[i]]; }
      return bank.slice(0, n);
    };
    const qids = t.mcq_count == null ? pick(null, t.question_count) : [...pick('mcq', t.mcq_count), ...pick('tf', t.tf_count)], now = Date.now();
    const deadline = Math.min(now + t.duration_min * 60000, t.closes_at || Infinity);
    db.prepare('INSERT INTO test_attempts(test_id,entry_id,person_id,section,question_ids,started_at,deadline) VALUES (?,?,?,?,?,?,?)').run(t.id, e.id, p.id, e.section, ',' + qids.join(',') + ',', now, deadline);
    audit(req.user, 'start', 'test', t.id, { section: e.section, summary: `بدء ${t.title}` });
    return { ok: true };
  }));
  app.get('/api/my/tests/:id/attempt', onlyC, wrap((req) => {
    const { p, t } = myTest(req), a = attemptOf(t, p);
    if (!a) throw new Bad('لم تبدأ الاختبار بعد', 404);
    const ans = jparse(a.answers, {});
    const qids = a.question_ids.split(',').filter(Boolean).map(Number);
    return { title: t.title, kindName: KIND[t.kind], status: a.status, deadline: a.deadline, now: Date.now(), submittedAt: a.submitted_at, auto: !!a.auto_submitted,
      result: a.status === 'submitted' && t.results_published ? { score: a.score, max: a.max } : null,
      // بلا مفتاح التصحيح
      questions: qids.map((id) => db.prepare('SELECT * FROM test_questions WHERE id=?').get(id)).filter(Boolean).map((q) => ({ ...qJson(q, false), points: t.q_points ?? q.points, answer: ans[q.id] ? ans[q.id].c : null })) };
  }));
  app.put('/api/my/tests/:id/answer', onlyC, wrap((req) => {
    const { p, t } = myTest(req), a = attemptOf(t, p), b = req.body || {};
    if (!a) throw new Bad('لم تبدأ الاختبار بعد', 404);
    if (a.status !== 'in_progress') throw new Bad('انتهى الاختبار؛ لا تُقبل إجابات جديدة', 409);
    const qid = +b.questionId, qids = a.question_ids.split(',').filter(Boolean).map(Number);
    if (!qids.includes(qid)) throw new Bad('سؤال غير صحيح');
    const q = db.prepare('SELECT options FROM test_questions WHERE id=?').get(qid), n = jparse(q.options, []).length;
    const c = b.choice === null ? null : Number(b.choice);
    if (c !== null && !(Number.isInteger(c) && c >= 0 && c < n)) throw new Bad('اختيار غير صحيح');
    const ans = jparse(a.answers, {}), now = Date.now();
    if (c === null) delete ans[qid]; else ans[qid] = { c, at: now };
    db.prepare("UPDATE test_attempts SET answers=? WHERE id=? AND status='in_progress'").run(JSON.stringify(ans), a.id);
    return { savedAt: now, deadline: a.deadline };
  }));
  app.post('/api/my/tests/:id/submit', onlyC, wrap((req) => {
    const { p, t } = myTest(req), a = attemptOf(t, p);
    if (!a) throw new Bad('لم تبدأ الاختبار بعد', 404);
    const f = finalize(a, false);
    if (a.status === 'in_progress') audit(req.user, 'submit', 'test', t.id, { section: a.section, summary: `إرسال ${t.title}` });
    return { status: f.status, submittedAt: f.submitted_at };
  }));
};
module.exports.parseBank = parseBank;
module.exports.KIND = KIND;
