'use strict';
// الرصد والنتائج: استمارة مستقلة لكل محكم، مسودة ثم إرسال يقفلها، وإعادة فتح موثقة، وتجميع تلقائي وكشف ترتيب.
const db = require('./db');
const U = require('./util');
const RB = require('./rubrics');
const { SECTIONS, STAGES, Bad, str, wrap, need, audit, isTop, scope, inScope, comp, jparse } = U;

const stageOf = (v) => (STAGES[v] ? v : 'prelim');
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const canReview = (u) => ['chief', 'top'].includes(u.role); // رئيس التحكيم لقسمه، والعليا للقسمين

const ticketSel = `SELECT t.*, p.full_name, r.category_name, r.category_id, e.branch, e.branch_name, e.track, e.track_name, e.curriculum_text, e.curriculum_id, c.name AS committee_name
  FROM tickets t JOIN people p ON p.id=t.person_id JOIN registrations r ON r.id=t.registration_id JOIN entries e ON e.id=t.entry_id LEFT JOIN committees c ON c.id=t.committee_id`;

// المقطع المحدد للمشاركة: مقطع المقرر في التصفيات، ومقطع المرحلة المعتمد في قبل النهائي والنهائي
function passageOf(curriculumId, stage = 'prelim') {
  const c = !curriculumId ? null : stage === 'prelim' ? db.prepare('SELECT surah, ayah_from, ayah_to FROM curricula WHERE id=?').get(curriculumId)
    : db.prepare('SELECT surah, ayah_from, ayah_to FROM stage_passages WHERE curriculum_id=? AND stage=?').get(curriculumId, stage);
  return c && c.surah ? RB.passage(c.surah, c.ayah_from, c.ayah_to) : null;
}
// تكليف المحكم في لجنة التذكرة، والاستمارة التي يملؤها بحسب تخصصه
function judgeContext(u, ticketId) {
  const t = db.prepare(ticketSel + ' WHERE t.id=?').get(+ticketId);
  if (!t || t.section !== u.section) throw new Bad('المتسابق غير موجود', 404);
  if (!db.prepare("SELECT 1 FROM committee_members WHERE committee_id=? AND user_id=? AND kind='judge'").get(t.committee_id, u.id)) throw new Bad('المتسابق ليس في لجنة مكلَّف بتحكيمها', 404);
  if (!['testing', 'done'].includes(t.status)) throw new Bad('تُفتح الاستمارة بعد بدء اختبار المتسابق', 409);
  const map = RB.rubricFor(t.branch, u.specialty, t.stage);
  if (!map) throw new Bad('تخصصك لا يقابل استمارة في هذا الفرع والمرحلة', 409);
  return { t, rubric: map[0], slot: map[1] };
}
const evalRow = (entryId, stage, rubric, slot) => db.prepare('SELECT * FROM evaluations WHERE entry_id=? AND stage=? AND rubric=? AND slot=?').get(entryId, stage, rubric, slot);
const evalJson = (e) => !e ? null : { id: e.id, status: e.status, data: jparse(e.data, {}), raw: e.raw, base: e.base, extra: e.extra, version: e.version, submittedAt: e.submitted_at, updatedAt: e.updated_at };

// المجموعة التنافسية: القسم والفرع والمسار والفئة والمرحلة. مسارات «لكل الأعمار» مجموعة واحدة لكل مسار (D07 مفتوح)
function groupOf(t) {
  const cur = t.curriculum_id && db.prepare('SELECT category_id FROM curricula WHERE id=?').get(t.curriculum_id);
  const allAges = cur && cur.category_id == null;
  return { key: [t.section, t.stage, t.branch, t.track, allAges ? 'all' : t.category_id].join('|'), name: `${t.branch_name}${t.track_name ? ' · ' + t.track_name : ''} · ${allAges ? 'لكل الأعمار' : t.category_name}`, section: t.section, branch: t.branch, allAges };
}
// الكشف الحالي (المعتمد أو المنشور) لمجموعة في مرحلة
const currentSheet = (compId, stage, key) => db.prepare("SELECT * FROM result_sheets WHERE comp_id=? AND stage=? AND group_key=? AND status<>'superseded' ORDER BY version DESC LIMIT 1").get(compId, stage, key);
// درجة المشاركة في مرحلة سابقة من الكشف المعتمد المحفوظ، لا من حساب حي
function approvedOf(entryId, stage) {
  for (const sh of db.prepare("SELECT * FROM result_sheets WHERE stage=? AND status<>'superseded' ORDER BY id DESC").all(stage)) {
    const r = jparse(sh.rows, []).find((x) => x.entryId === entryId);
    if (r) return { total: r.total, max: sh.max, rank: r.rank, sheet: sh };
  }
  return null;
}
function resultFor(t) {
  const evs = db.prepare('SELECT * FROM evaluations WHERE entry_id=? AND stage=?').all(t.entry_id, t.stage);
  const prev = {};
  for (const st of ['prelim', 'semi']) { const a = st !== t.stage && approvedOf(t.entry_id, st); if (a) prev[st] = a; }
  return RB.aggregate(t.stage, t.branch, evs, prev);
}
const hashOf = (rows) => rows.map((r) => `${r.entryId}:${(+r.total).toFixed(6)}`).sort().join('|');

module.exports = function judging(app) {
  // ---------- المحكم ----------
  app.get('/api/judge/work', need((u) => u.role === 'judge'), wrap((req) => {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage);
    const cms = db.prepare("SELECT c.* FROM committees c JOIN committee_members m ON m.committee_id=c.id WHERE m.user_id=? AND m.kind='judge' AND c.comp_id=? AND c.stage=? AND c.section=? ORDER BY c.sort").all(u.id, c.id, stage, u.section);
    return { stage, stageName: STAGES[stage], specialty: u.specialty, committees: cms.map((k) => {
      const map = RB.rubricFor(k.branch, u.specialty, k.stage);
      const rows = db.prepare(ticketSel + " WHERE t.committee_id=? AND t.status IN ('testing','done') ORDER BY t.status='testing' DESC, t.started_at DESC").all(k.id);
      return { id: k.id, name: k.name, hall: k.hall, rubric: map ? map[0] : null, rubricTitle: map ? RB.RUBRICS[map[0]].title : '',
        rows: rows.map((t) => { const e = map && evalRow(t.entry_id, t.stage, map[0], map[1]); return { ticketId: t.id, name: t.full_name, category: t.category_name, trackName: t.track_name, status: t.status, evalStatus: e ? e.status : 'none', raw: e && e.status === 'submitted' ? e.raw : null, base: e ? e.base : null }; }) };
    }) };
  }));

  app.get('/api/judge/form/:ticketId', need((u) => u.role === 'judge'), wrap((req) => {
    const { t, rubric, slot } = judgeContext(req.user, req.params.ticketId);
    const e = evalRow(t.entry_id, t.stage, rubric, slot);
    const pas = RB.RUBRICS[rubric].kind === 'matrix' ? passageOf(t.curriculum_id, t.stage) : null;
    if (RB.RUBRICS[rubric].kind === 'matrix' && !pas) throw new Bad(`لم يُحدَّد مقطع التلاوة لهذا المقرر في ${STAGES[t.stage]}. تحدده الإدارة العليا من «إعداد الدورة».`, 409);
    return {
      contestant: { name: t.full_name, category: t.category_name, branchName: t.branch_name, trackName: t.track_name, stageName: STAGES[t.stage], committee: t.committee_name,
        // في المراحل اللاحقة للتلاوة: مقطع المرحلة بدل مقطع التسجيل
        curriculum: t.stage !== 'prelim' && t.branch === 'tilawa' ? (() => { const p = passageOf(t.curriculum_id, t.stage); return p ? `مقطع ${STAGES[t.stage]}: سورة ${p.name}، الآيات ${p.from} إلى ${p.to}` : `لم يُحدَّد مقطع ${STAGES[t.stage]} بعد`; })() : t.curriculum_text },
      rubric: RB.rubricJson(rubric), slot, track: t.track, passage: pas, evaluation: evalJson(e),
      mine: !e || e.judge_id === req.user.id,
    };
  }));

  app.put('/api/judge/form/:ticketId', need((u) => u.role === 'judge'), wrap((req) => {
    const u = req.user, b = req.body || {}, { t, rubric, slot } = judgeContext(u, req.params.ticketId);
    const R = RB.RUBRICS[rubric];
    const pas = R.kind === 'matrix' ? passageOf(t.curriculum_id, t.stage) : null;
    const data = b.data && typeof b.data === 'object' ? b.data : {};
    if (JSON.stringify(data).length > 50000) throw new Bad('بيانات الاستمارة أكبر من المسموح');
    const res = RB.compute(rubric, data, { track: t.track, stage: t.stage, ayat: pas ? pas.ayat.map((a) => a.n) : [] }, !!b.submit);
    if (res.errors.length) throw new Bad(res.errors[0], 400, { errors: res.errors });
    const now = Date.now(), json = JSON.stringify(data);
    const out = db.transaction(() => {
      const e = evalRow(t.entry_id, t.stage, rubric, slot);
      if (e && e.judge_id !== u.id) throw new Bad('هذه الخانة يرصدها محكم آخر في اللجنة', 409);
      if (e && e.status === 'submitted') {
        if (b.submit && e.data === json) return e.id; // تكرار الطلب نفسه: يعيد نتيجة الإرسال الأول
        throw new Bad('أُرسل التقييم وأُقفل. لإعادة فتحه تواصل مع رئيس لجنة التحكيم.', 409);
      }
      // كشف الكتابة فوق نسخة أحدث (فتح الاستمارة من جهازين)
      if (e && b.version != null && +b.version !== e.version) throw new Bad('حُفظت نسخة أحدث من هذه الاستمارة من جهاز آخر. أعد فتحها لتحديثها.', 409, { conflict: true });
      const status = b.submit ? 'submitted' : 'draft';
      if (!e) return db.prepare(`INSERT INTO evaluations(comp_id,entry_id,registration_id,section,stage,rubric,slot,judge_id,committee_id,status,data,raw,base,extra,version,created_at,updated_at,submitted_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`).run(t.comp_id, t.entry_id, t.registration_id, t.section, t.stage, rubric, slot, u.id, t.committee_id, status, json, res.raw, res.base, res.extra, now, now, b.submit ? now : null).lastInsertRowid;
      db.prepare('UPDATE evaluations SET status=?, data=?, raw=?, base=?, extra=?, version=version+1, updated_at=?, submitted_at=? WHERE id=?').run(status, json, res.raw, res.base, res.extra, now, b.submit ? now : null, e.id);
      return e.id;
    })();
    const e = db.prepare('SELECT * FROM evaluations WHERE id=?').get(out);
    if (b.submit) audit(u, 'submit', 'evaluation', e.id, { section: t.section, summary: `إرسال ${R.title} لـ${t.full_name} (${STAGES[t.stage]})` });
    return { evaluation: evalJson(e), computed: res };
  }));

  // ---------- النتائج (رئيس التحكيم لقسمه والعليا للقسمين) ----------
  function results(req) {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage), sec = scope(u, req.query.section);
    // تظهر في الكشف المشاركات التي بدأ اختبارها أو انتهى
    const where = ["t.comp_id=?", "t.stage=?", "t.status<>'cancelled'"], args = [c.id, stage];
    if (sec) { where.push('t.section=?'); args.push(sec); }
    if (req.query.branch) { where.push('e.branch=?'); args.push(String(req.query.branch)); }
    const rows = db.prepare(ticketSel + ' WHERE ' + where.join(' AND ')).all(...args);
    const groups = new Map();
    for (const t of rows) {
      const g = groupOf(t);
      if (!groups.has(g.key)) groups.set(g.key, { ...g, sectionName: SECTIONS[g.section], rows: [], untested: 0 });
      if (!['testing', 'done'].includes(t.status)) { groups.get(g.key).untested++; continue; } // في الطابور ولم يُختبر بعد
      const res = resultFor(t);
      if (!res) continue;
      groups.get(g.key).rows.push({ entryId: t.entry_id, name: t.full_name, category: t.category_name, ticketStatus: t.status, committee: t.committee_name, ...res });
    }
    const out = [...groups.values()].filter((g) => g.rows.length || g.untested).map((g) => {
      // الترتيب للمكتملين فقط، والمتساوون يأخذون الترتيب نفسه (لا فصل أبجدي خفي)
      const done = g.rows.filter((r) => r.complete).sort((a, b) => b.total - a.total);
      for (const r of done) { r.rank = 1 + done.filter((x) => x.total > r.total + 1e-9).length; r.tie = done.filter((x) => Math.abs(x.total - r.total) < 1e-9).length > 1; }
      const coll = new Intl.Collator('ar');
      const pending = g.rows.filter((r) => !r.complete).sort((a, b) => coll.compare(a.name, b.name));
      const sh = currentSheet(c.id, stage, g.key);
      const next = RB.nextStage(g.branch, stage);
      for (const r of done) { const q = next && db.prepare('SELECT status, exceptional FROM qualifications WHERE entry_id=? AND to_stage=?').get(r.entryId, next); r.qualified = q ? q.status : null; r.exceptional = q ? !!q.exceptional : false; }
      const sheet = sh ? { id: sh.id, version: sh.version, status: sh.status, approvedAt: sh.approved_at, publishedAt: sh.published_at,
        stale: sh.hash !== hashOf(done) || pending.length > 0 || g.untested > 0 } : null;
      return { ...g, max: (g.rows[0] || {}).max || (RB.WEIGHTS[stage][g.branch] || {}).max, ranked: done, pending, sheet, canApprove: done.length > 0 && !pending.length && !g.untested,
        nextStage: next, nextStageName: next ? STAGES[next] : null, qualifiedCount: done.filter((r) => r.qualified === 'qualified').length, rows: undefined };
    });
    const coll = new Intl.Collator('ar');
    out.sort((a, b) => a.section.localeCompare(b.section) || a.branch.localeCompare(b.branch) || coll.compare(a.name, b.name));
    return { stage, stageName: STAGES[stage], groups: out };
  }
  app.get('/api/results', need(canReview), wrap((req) => results(req)));

  app.get('/api/results.csv', need(canReview), (req, res) => {
    try {
      const d = results(req);
      const cell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
      const lines = [];
      for (const g of d.groups) {
        if (!g.ranked.length && !g.pending.length) continue;
        lines.push([`${d.stageName} — ${g.sectionName} — ${g.name}`].map(cell).join(','));
        const parts = (g.ranked[0] || g.pending[0]).parts;
        lines.push(['الترتيب', 'الاسم', 'الفئة', ...parts.map((p) => `${p.n} (${p.weight})`), `المجموع (${g.max})`, 'الحالة'].map(cell).join(','));
        for (const r of g.ranked) lines.push([r.rank + (r.tie ? ' (تعادل)' : ''), r.name, r.category, ...r.parts.map((p) => r2(p.value)), r2(r.total), 'مكتمل'].map(cell).join(','));
        for (const r of g.pending) lines.push(['—', r.name, r.category, ...r.parts.map((p) => r2(p.value)), '', 'غير مكتمل: ' + r.missing.map((m) => m.n).join('، ')].map(cell).join(','));
        lines.push('');
      }
      audit(req.user, 'export', 'results', null, { section: scope(req.user, req.query.section), summary: `تصدير كشف ${d.stageName}` });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="iqra-results-${d.stage}.csv"`);
      res.send('﻿' + lines.join('\r\n'));
    } catch (e) { console.error(e); res.status(e instanceof Bad ? e.code : 500).json({ error: e.message || 'حدث خطأ' }); }
  });

  app.get('/api/results/entry/:entryId', need(canReview), wrap((req) => {
    const stage = stageOf(req.query.stage);
    const t = db.prepare(ticketSel + ' WHERE t.entry_id=? AND t.stage=?').get(+req.params.entryId, stage);
    if (!t || !inScope(req.user, t.section)) throw new Bad('غير موجود', 404);
    const evs = db.prepare('SELECT e.*, u.name AS judge FROM evaluations e LEFT JOIN users u ON u.id=e.judge_id WHERE e.entry_id=? AND e.stage=? ORDER BY e.rubric, e.slot').all(t.entry_id, stage);
    return {
      contestant: { name: t.full_name, category: t.category_name, branchName: t.branch_name, trackName: t.track_name, committee: t.committee_name, stageName: STAGES[stage] },
      result: resultFor(t),
      evaluations: evs.map((e) => ({ ...evalJson(e), rubric: e.rubric, title: RB.RUBRICS[e.rubric].title, slot: e.slot, judge: e.judge || '',
        revisions: db.prepare('SELECT r.*, u.name AS actor FROM evaluation_revisions r LEFT JOIN users u ON u.id=r.actor_id WHERE r.evaluation_id=? ORDER BY r.id DESC').all(e.id).map((r) => ({ version: r.version, action: r.action, raw: r.raw, extra: r.extra, reason: r.reason, actor: r.actor || '', at: r.at })) })),
    };
  }));

  // إعادة فتح تقييم مرسل: تُحفظ النسخة السابقة كاملة، وتصبح النتيجة غير مكتملة حتى إعادة الإرسال
  app.post('/api/evaluations/:id/reopen', need(canReview), wrap((req) => {
    const e = db.prepare('SELECT * FROM evaluations WHERE id=?').get(+req.params.id);
    if (!e || !inScope(req.user, e.section)) throw new Bad('التقييم غير موجود', 404);
    if (e.status !== 'submitted') throw new Bad('التقييم ليس مرسلًا');
    const reason = str((req.body || {}).reason, 500, 'سبب إعادة الفتح');
    const now = Date.now();
    db.transaction(() => {
      db.prepare('INSERT INTO evaluation_revisions(evaluation_id,version,status,data,raw,extra,judge_id,action,reason,actor_id,at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(e.id, e.version, e.status, e.data, e.raw, e.extra, e.judge_id, 'reopen', reason, req.user.id, now);
      db.prepare("UPDATE evaluations SET status='draft', version=version+1, submitted_at=NULL, updated_at=? WHERE id=?").run(now, e.id);
    })();
    audit(req.user, 'reopen', 'evaluation', e.id, { section: e.section, summary: `إعادة فتح ${RB.RUBRICS[e.rubric].title}`, before: { raw: e.raw, extra: e.extra, version: e.version }, reason });
    return { ok: true };
  }));

  // ---------- الاعتماد والنشر ----------
  const findGroup = (req, stage, key) => {
    const d = results({ user: req.user, query: { stage } });
    const g = d.groups.find((x) => x.key === key);
    if (!g || !inScope(req.user, g.section)) throw new Bad('المجموعة غير موجودة', 404);
    return g;
  };
  app.post('/api/results/approve', need(canReview), wrap((req) => {
    const b = req.body || {}, stage = stageOf(b.stage), c = comp(), g = findGroup(req, stage, String(b.groupKey || ''));
    if (g.untested) throw new Bad(`في المجموعة ${g.untested} متسابقًا لم يُختبروا بعد. يُعتمد الكشف بعد اختبار الجميع أو إلغاء حضور الغائب.`, 409);
    if (g.pending.length) throw new Bad('لا يُعتمد كشف فيه نتائج غير مكتملة', 409);
    if (!g.ranked.length) throw new Bad('لا توجد نتائج');
    if (g.sheet && !g.sheet.stale) throw new Bad('الكشف معتمد ولم يتغير', 409);
    const rows = g.ranked.map((r) => ({ entryId: r.entryId, name: r.name, category: r.category, rank: r.rank, tie: r.tie, total: r.total, parts: r.parts.map((p) => ({ n: p.n, weight: p.weight, value: p.value })) }));
    const now = Date.now();
    const id = db.transaction(() => {
      const old = currentSheet(c.id, stage, g.key);
      if (old) db.prepare("UPDATE result_sheets SET status='superseded' WHERE id=?").run(old.id);
      return db.prepare(`INSERT INTO result_sheets(comp_id,stage,group_key,group_name,section,branch,version,status,rows,hash,max,approved_by,approved_at,note) VALUES (?,?,?,?,?,?,?,'approved',?,?,?,?,?,?)`)
        .run(c.id, stage, g.key, g.name, g.section, g.branch, old ? old.version + 1 : 1, JSON.stringify(rows), hashOf(g.ranked), g.max, req.user.id, now, str(b.note, 500, 'ملاحظة', false)).lastInsertRowid;
    })();
    audit(req.user, 'approve', 'sheet', id, { section: g.section, summary: `اعتماد كشف ${STAGES[stage]}: ${g.name}`, after: { rows: rows.map((r) => [r.rank, r.name, r.total]) } });
    return { ok: true, id };
  }));
  app.post('/api/results/publish', need(isTop), wrap((req) => {
    const sh = db.prepare('SELECT * FROM result_sheets WHERE id=?').get(+(req.body || {}).sheetId);
    if (!sh || sh.status === 'superseded') throw new Bad('الكشف غير موجود أو استُبدل بنسخة أحدث', 404);
    const pub = (req.body || {}).publish !== false;
    db.prepare('UPDATE result_sheets SET status=?, published_by=?, published_at=? WHERE id=?').run(pub ? 'published' : 'approved', pub ? req.user.id : null, pub ? Date.now() : null, sh.id);
    audit(req.user, pub ? 'publish' : 'unpublish', 'sheet', sh.id, { section: sh.section, summary: `${pub ? 'نشر' : 'إيقاف نشر'} كشف ${STAGES[sh.stage]}: ${sh.group_name}` });
    return { ok: true };
  }));

  // ---------- التأهل ----------
  // المقترح من الكشف المعتمد: بعدد المقاعد أو بحد الدرجة. التعادل على المقعد الأخير يُترك لقرار صريح
  function proposal(req, b) {
    const stage = stageOf(b.stage), g = findGroup(req, stage, String(b.groupKey || ''));
    if (!g.nextStage) throw new Bad('لا توجد مرحلة تالية لهذه المجموعة');
    if (!g.sheet || g.sheet.stale) throw new Bad('اعتمد الكشف أولًا (أو أعد اعتماده بعد التعديل)', 409);
    const rows = jparse(db.prepare('SELECT rows FROM result_sheets WHERE id=?').get(g.sheet.id).rows, []);
    const mode = b.mode === 'score' ? 'score' : 'count', v = Number(b.value);
    if (!(v > 0)) throw new Bad(mode === 'count' ? 'أدخل عدد المتأهلين' : 'أدخل حد الدرجة');
    let out;
    if (mode === 'count') {
      const within = rows.filter((r) => r.rank <= v);
      const over = within.length > v; // التعادل يجعل المستحقين أكثر من المقاعد
      const lastRank = within.length ? Math.max(...within.map((r) => r.rank)) : 0;
      out = rows.map((r) => ({ ...r, proposed: r.rank <= v && !(over && r.rank === lastRank), tieAtCut: over && r.rank === lastRank }));
    } else out = rows.map((r) => ({ ...r, proposed: r.total >= v - 1e-9, tieAtCut: false }));
    return { g, stage, rows: out, rule: mode === 'count' ? `أول ${v}` : `الدرجة ${v} فأعلى`, seats: mode === 'count' ? v : null };
  }
  app.post('/api/qualify/preview', need(canReview), wrap((req) => {
    const p = proposal(req, req.body || {});
    return { rule: p.rule, nextStageName: p.g.nextStageName, rows: p.rows, tie: p.rows.some((r) => r.tieAtCut) };
  }));
  app.post('/api/qualify/approve', need(canReview), wrap((req) => {
    const b = req.body || {}, p = proposal(req, b), c = comp(), dec = new Map((Array.isArray(b.decisions) ? b.decisions : []).map((d) => [+d.entryId, d]));
    const now = Date.now();
    db.transaction(() => {
      for (const r of p.rows) {
        const d = dec.get(r.entryId);
        const qualified = d ? !!d.qualified : r.proposed;
        if (r.tieAtCut && !d) throw new Bad(`تعادل على المقعد الأخير: حدّد قرار «${r.name}» وسببه وفق اللائحة`);
        const exceptional = r.tieAtCut || qualified !== r.proposed;
        const reason = d ? String(d.reason || '').trim().slice(0, 300) : '';
        if (exceptional && reason.length < 3) throw new Bad(`اكتب سبب القرار الاستثنائي لـ«${r.name}»`);
        const to = p.g.nextStage;
        const old = db.prepare('SELECT * FROM qualifications WHERE entry_id=? AND to_stage=?').get(r.entryId, to);
        if (old && old.status === 'qualified' && !qualified && db.prepare("SELECT 1 FROM tickets WHERE entry_id=? AND stage=? AND status<>'cancelled'").get(r.entryId, to))
          throw new Bad(`«${r.name}» حضر ${STAGES[to]}؛ لا يُلغى تأهله قبل إلغاء حضوره`, 409);
        db.prepare(`INSERT INTO qualifications(comp_id,entry_id,from_stage,to_stage,sheet_id,status,exceptional,rule,reason,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(entry_id,to_stage) DO UPDATE SET sheet_id=excluded.sheet_id, status=excluded.status, exceptional=excluded.exceptional, rule=excluded.rule, reason=excluded.reason, decided_by=excluded.decided_by, decided_at=excluded.decided_at`)
          .run(c.id, r.entryId, p.stage, to, p.g.sheet.id, qualified ? 'qualified' : 'excluded', exceptional ? 1 : 0, p.rule, reason, req.user.id, now);
      }
      audit(req.user, 'qualify', 'sheet', p.g.sheet.id, { section: p.g.section, summary: `اعتماد التأهل إلى ${p.g.nextStageName}: ${p.g.name} (${p.rule})`, after: p.rows.map((r) => [r.name, (dec.get(r.entryId) ? !!dec.get(r.entryId).qualified : r.proposed)]) });
    })();
    return { ok: true };
  }));

  // ---------- مقاطع المراحل اللاحقة (الإدارة العليا) ----------
  app.get('/api/admin/stage-passages', need(isTop), wrap(() => {
    const c = comp();
    const rows = db.prepare("SELECT cu.id, cu.track_name, cu.content, cu.category_id, k.name AS category FROM curricula cu LEFT JOIN categories k ON k.id=cu.category_id WHERE cu.comp_id=? AND cu.branch='tilawa' ORDER BY cu.sort").all(c.id);
    return { rows: rows.map((r) => ({ id: r.id, name: `${r.track_name} · ${r.category || 'لكل الأعمار'}`, prelim: r.content,
      semi: db.prepare("SELECT surah, ayah_from AS ayahFrom, ayah_to AS ayahTo FROM stage_passages WHERE curriculum_id=? AND stage='semi'").get(r.id) || null,
      final: db.prepare("SELECT surah, ayah_from AS ayahFrom, ayah_to AS ayahTo FROM stage_passages WHERE curriculum_id=? AND stage='final'").get(r.id) || null })) };
  }));
  app.put('/api/admin/stage-passages', need(isTop), wrap((req) => {
    const c = comp(), list = Array.isArray((req.body || {}).rows) ? req.body.rows : [];
    db.transaction(() => {
      for (const x of list) for (const st of ['semi', 'final']) {
        const cur = db.prepare("SELECT id FROM curricula WHERE id=? AND comp_id=? AND branch='tilawa'").get(+x.id, c.id);
        if (!cur) throw new Bad('مقرر غير صحيح');
        const v = x[st] || {};
        if (!v.surah) { db.prepare('DELETE FROM stage_passages WHERE curriculum_id=? AND stage=?').run(cur.id, st); continue; }
        const P = RB.passage(+v.surah, +v.ayahFrom, +v.ayahTo);
        if (!P) throw new Bad(`مقطع ${STAGES[st]} غير صحيح: تحقق من السورة ونطاق الآيات`);
        db.prepare('INSERT INTO stage_passages(curriculum_id,stage,surah,ayah_from,ayah_to) VALUES (?,?,?,?,?) ON CONFLICT(curriculum_id,stage) DO UPDATE SET surah=excluded.surah, ayah_from=excluded.ayah_from, ayah_to=excluded.ayah_to').run(cur.id, st, P.surah, P.from, P.to);
      }
      audit(req.user, 'settings', 'stage_passages', c.id, { summary: 'تعديل مقاطع قبل النهائي والنهائي', after: list });
    })();
    return { ok: true };
  }));

  // ---------- المتسابق: نتائجه المنشورة وتأهله ----------
  app.get('/api/my/results', need((u) => u.role === 'contestant'), wrap((req) => {
    const c = comp(), p = db.prepare('SELECT id FROM people WHERE user_id=?').get(req.user.id);
    if (!p) return { results: [] };
    const entries = db.prepare("SELECT e.* FROM entries e JOIN registrations r ON r.id=e.registration_id WHERE r.person_id=? AND r.comp_id=? AND e.status='active'").all(p.id, c.id);
    const out = [];
    for (const e of entries) for (const sh of db.prepare("SELECT * FROM result_sheets WHERE comp_id=? AND status='published' ORDER BY id").all(c.id)) {
      const rows = jparse(sh.rows, []), r = rows.find((x) => x.entryId === e.id);
      if (!r) continue;
      const next = RB.nextStage(e.branch, sh.stage), q = next && db.prepare("SELECT status FROM qualifications WHERE entry_id=? AND to_stage=? AND sheet_id=?").get(e.id, next, sh.id);
      out.push({ entryId: e.id, stageName: STAGES[sh.stage], total: r.total, max: sh.max, rank: r.rank, count: rows.length, nextStageName: next ? STAGES[next] : null, qualified: q ? q.status === 'qualified' : null });
    }
    return { results: out };
  }));

  // قائمة السور وعدد آياتها لإعداد المقاطع
  app.get('/api/quran/surahs', wrap(() => ({ surahs: RB.surahList() })));
};
