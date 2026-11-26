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

// المقطع المحدد للمشاركة من المقرر (للتلاوة)
function passageOf(curriculumId) {
  const c = curriculumId && db.prepare('SELECT surah, ayah_from, ayah_to FROM curricula WHERE id=?').get(curriculumId);
  return c && c.surah ? RB.passage(c.surah, c.ayah_from, c.ayah_to) : null;
}
// تكليف المحكم في لجنة التذكرة، والاستمارة التي يملؤها بحسب تخصصه
function judgeContext(u, ticketId) {
  const t = db.prepare(ticketSel + ' WHERE t.id=?').get(+ticketId);
  if (!t || t.section !== u.section) throw new Bad('المتسابق غير موجود', 404);
  if (!db.prepare("SELECT 1 FROM committee_members WHERE committee_id=? AND user_id=? AND kind='judge'").get(t.committee_id, u.id)) throw new Bad('المتسابق ليس في لجنة مكلَّف بتحكيمها', 404);
  if (!['testing', 'done'].includes(t.status)) throw new Bad('تُفتح الاستمارة بعد بدء اختبار المتسابق', 409);
  const map = RB.rubricFor(t.branch, u.specialty);
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
function resultFor(t) {
  const evs = db.prepare('SELECT * FROM evaluations WHERE entry_id=? AND stage=?').all(t.entry_id, t.stage);
  return RB.aggregate(t.stage, t.branch, evs);
}

module.exports = function judging(app) {
  // ---------- المحكم ----------
  app.get('/api/judge/work', need((u) => u.role === 'judge'), wrap((req) => {
    const u = req.user, c = comp(), stage = stageOf(req.query.stage);
    const cms = db.prepare("SELECT c.* FROM committees c JOIN committee_members m ON m.committee_id=c.id WHERE m.user_id=? AND m.kind='judge' AND c.comp_id=? AND c.stage=? AND c.section=? ORDER BY c.sort").all(u.id, c.id, stage, u.section);
    return { stage, stageName: STAGES[stage], specialty: u.specialty, committees: cms.map((k) => {
      const map = RB.rubricFor(k.branch, u.specialty);
      const rows = db.prepare(ticketSel + " WHERE t.committee_id=? AND t.status IN ('testing','done') ORDER BY t.status='testing' DESC, t.started_at DESC").all(k.id);
      return { id: k.id, name: k.name, hall: k.hall, rubric: map ? map[0] : null, rubricTitle: map ? RB.RUBRICS[map[0]].title : '',
        rows: rows.map((t) => { const e = map && evalRow(t.entry_id, t.stage, map[0], map[1]); return { ticketId: t.id, name: t.full_name, category: t.category_name, trackName: t.track_name, status: t.status, evalStatus: e ? e.status : 'none', raw: e && e.status === 'submitted' ? e.raw : null, base: e ? e.base : null }; }) };
    }) };
  }));

  app.get('/api/judge/form/:ticketId', need((u) => u.role === 'judge'), wrap((req) => {
    const { t, rubric, slot } = judgeContext(req.user, req.params.ticketId);
    const e = evalRow(t.entry_id, t.stage, rubric, slot);
    const pas = RB.RUBRICS[rubric].kind === 'matrix' ? passageOf(t.curriculum_id) : null;
    if (RB.RUBRICS[rubric].kind === 'matrix' && !pas) throw new Bad('لم يُحدَّد مقطع التلاوة لهذا المقرر. تحدده الإدارة العليا من «إعداد الدورة».', 409);
    return {
      contestant: { name: t.full_name, category: t.category_name, branchName: t.branch_name, trackName: t.track_name, curriculum: t.curriculum_text, stageName: STAGES[t.stage], committee: t.committee_name },
      rubric: RB.rubricJson(rubric), slot, track: t.track, passage: pas, evaluation: evalJson(e),
      mine: !e || e.judge_id === req.user.id,
    };
  }));

  app.put('/api/judge/form/:ticketId', need((u) => u.role === 'judge'), wrap((req) => {
    const u = req.user, b = req.body || {}, { t, rubric, slot } = judgeContext(u, req.params.ticketId);
    const R = RB.RUBRICS[rubric];
    const pas = R.kind === 'matrix' ? passageOf(t.curriculum_id) : null;
    const data = b.data && typeof b.data === 'object' ? b.data : {};
    if (JSON.stringify(data).length > 50000) throw new Bad('بيانات الاستمارة أكبر من المسموح');
    const res = RB.compute(rubric, data, { track: t.track, ayat: pas ? pas.ayat.map((a) => a.n) : [] }, !!b.submit);
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
    const where = ["t.comp_id=?", "t.stage=?", "t.status IN ('testing','done')"], args = [c.id, stage];
    if (sec) { where.push('t.section=?'); args.push(sec); }
    if (req.query.branch) { where.push('e.branch=?'); args.push(String(req.query.branch)); }
    const rows = db.prepare(ticketSel + ' WHERE ' + where.join(' AND ')).all(...args);
    const groups = new Map();
    for (const t of rows) {
      const g = groupOf(t);
      if (!groups.has(g.key)) groups.set(g.key, { ...g, sectionName: SECTIONS[g.section], rows: [] });
      const res = resultFor(t);
      if (!res) continue;
      groups.get(g.key).rows.push({ entryId: t.entry_id, name: t.full_name, category: t.category_name, ticketStatus: t.status, committee: t.committee_name, ...res });
    }
    const out = [...groups.values()].filter((g) => g.rows.length).map((g) => {
      // الترتيب للمكتملين فقط، والمتساوون يأخذون الترتيب نفسه (لا فصل أبجدي خفي)
      const done = g.rows.filter((r) => r.complete).sort((a, b) => b.total - a.total);
      for (const r of done) { r.rank = 1 + done.filter((x) => x.total > r.total + 1e-9).length; r.tie = done.filter((x) => Math.abs(x.total - r.total) < 1e-9).length > 1; }
      const coll = new Intl.Collator('ar');
      return { ...g, max: g.rows[0].max, ranked: done, pending: g.rows.filter((r) => !r.complete).sort((a, b) => coll.compare(a.name, b.name)), rows: undefined };
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

  // قائمة السور وعدد آياتها لإعداد المقاطع
  app.get('/api/quran/surahs', wrap(() => ({ surahs: RB.surahList() })));
};
