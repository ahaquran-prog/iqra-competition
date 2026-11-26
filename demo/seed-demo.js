'use strict';
// ينشئ قاعدة بيانات النسخة التجريبية بالكود الحقيقي: الدورة المرجعية، وحسابات لكل دور، ومتسابقون متخيَّلون.
// كلمة مرور جميع الحسابات التجريبية: Iqra-2026
const fs = require('fs');
const os = require('os');
const path = require('path');
const outFile = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iqra-demo-'));
process.env.DATA_DIR = tmp;
process.env.SIGNUP_LIMIT = '10000';
const app = require('../server');
const db = require('../lib/db');
const auth = require('../lib/auth');
const PASS = 'Iqra-2026';
const hash = auth.hashPassword(PASS);
const now = Date.now();

const staff = [
  ['admin', 'مدير المسابقة', 'top', '', ''],
  ['exec.m', 'خالد العمر', 'exec', 'M', ''],
  ['exec.f', 'مريم السالم', 'exec', 'F', ''],
  ['chief.m', 'الشيخ عبدالرحمن الناصر', 'chief', 'M', ''],
  ['chief.f', 'الأستاذة نورة الهاجري', 'chief', 'F', ''],
  ['judge.m', 'الشيخ يوسف المنصور', 'judge', 'M', 'محكم جودة الحفظ الأول'],
  ['judge.f', 'الأستاذة هدى الراشد', 'judge', 'F', 'محكم التجويد الأول'],
  ['coord.m', 'سعد الفهد', 'coordinator', 'M', ''],
  ['judge.m2', 'الشيخ أحمد الحمادي', 'judge', 'M', 'محكم جودة الحفظ الثاني'],
  ['judge.m3', 'الشيخ ماجد العلوي', 'judge', 'M', 'محكم التجويد الأول'],
  ['judge.t1', 'الشيخ علي الستري', 'judge', 'M', 'محكم التجويد الأول'],
  ['judge.t2', 'الشيخ جعفر المحروس', 'judge', 'M', 'محكم التجويد الثاني'],
  ['judge.t3', 'الشيخ محمود العرادي', 'judge', 'M', 'محكم الصوت والنغم'],
  ['judge.t4', 'الشيخ حسين الصفار', 'judge', 'M', 'محكم الصوت والنغم الثاني'],
  ['judge.t5', 'الشيخ عيسى القصاب', 'judge', 'M', 'محكم الوقف والابتداء'],
  ['judge.m4', 'الشيخ حسن البلوشي', 'judge', 'M', 'محكم الصوت والنغم'],
  ['screen.m', 'شاشة قاعة الرجال', 'screen', 'M', ''],
  ['screen.f', 'شاشة قاعة النساء', 'screen', 'F', ''],
];
for (const [login, name, role, section, specialty] of staff)
  db.prepare('INSERT INTO users(login,name,role,section,specialty,pass_hash,must_change,created_at) VALUES (?,?,?,?,?,?,0,?)').run(login, name, role, section, specialty, hash, now);

// متسابقون متخيَّلون: [الهوية، الاسم، الهاتف، سنة الميلاد، الجنس، المشاركات، الحالة]
const people = [
  ['1000000001', 'عبدالله محمد أحمد الخالدي', '0500000001', 2011, 'M', [['hifz', 'cat'], ['tafsir', 'main']], 'submitted'],
  ['1000000002', 'يوسف خالد سعيد البدر', '0500000002', 2015, 'M', [['hifz', 'j5'], ['tilawa', 'tartil']], 'accepted'],
  ['1000000003', 'أنس فهد علي الحمد', '0500000003', 2022, 'M', [['hifz', 'cat']], 'accepted'],
  ['1000000004', 'عمر سلمان ناصر الصالح', '0500000004', 2005, 'M', [['hifz', 'full'], ['tilawa', 'tadweer']], 'submitted'],
  ['1000000005', 'حمزة ماجد عبدالعزيز النمر', '0500000005', 2018, 'M', [['hifz', 'cat']], 'returned'],
  ['1000000006', 'إبراهيم عادل حسن العلي', '0500000006', 2010, 'M', [['tilawa', 'tartil'], ['tafsir', 'main']], 'submitted'],
  ['1000000011', 'فاطمة أحمد محمد الكعبي', '0500000011', 2012, 'F', [['hifz', 'j10']], 'accepted'],
  ['1000000012', 'مريم يوسف خليل الزين', '0500000012', 2016, 'F', [['hifz', 'cat'], ['tilawa', 'tadweer'], ['tafsir', 'main']], 'submitted'],
  ['1000000013', 'سارة عبدالله ناصر الحسن', '0500000013', 2020, 'F', [['hifz', 'cat']], 'submitted'],
  ['1000000014', 'نورة سعد فهد العتيق', '0500000014', 1998, 'F', [['tilawa', 'tartil']], 'accepted'],
  ['1000000015', 'هاجر علي إبراهيم السيد', '0500000015', 2023, 'F', [['hifz', 'cat']], 'withdrawn'],
];

// متسابقون إضافيون مقبولون لتعبئة الطوابير
const FM = ['محمد', 'عبدالرحمن', 'خالد', 'سلمان', 'فيصل', 'راشد', 'علي', 'حسين', 'جاسم', 'مالك', 'طلال', 'نواف', 'معاذ', 'أسامة', 'زكريا', 'هشام', 'وليد', 'مازن'];
const FF = ['آمنة', 'خديجة', 'زينب', 'رقية', 'حصة', 'شيخة', 'لطيفة', 'عائشة', 'جود', 'ريم', 'دانة', 'لولوة'];
const MID = ['عبدالله', 'أحمد', 'يوسف', 'إبراهيم', 'سعيد', 'ناصر'], LAST = ['الدوسري', 'المناعي', 'الخياط', 'الجودر', 'البنعلي', 'المطوع', 'الشيراوي', 'القحطاني', 'السعدي', 'الكواري'];
const PLAN = [[2015, [['hifz', 'cat']]], [2014, [['hifz', 'cat'], ['tilawa', 'tartil']]], [2019, [['hifz', 'cat']]], [2022, [['hifz', 'cat']]], [2010, [['tilawa', 'tartil']]], [2004, [['hifz', 'cat'], ['tilawa', 'tadweer']]], [2013, [['tilawa', 'tadweer']]], [2011, [['hifz', 'cat']]]];
const gen = (names, g, base) => names.map((n, i) => { const [y, en] = PLAN[i % PLAN.length]; return [String(base + i), `${n} ${MID[i % MID.length]} ${MID[(i + 2) % MID.length]} ${LAST[i % LAST.length]}`, '05' + String(base + i).slice(-8), y, g, en, 'accepted']; });
people.push(...gen(FM, 'M', 1100000001), ...gen(FF, 'F', 1200000001));

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'X-Iqra': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const data = await res.json(); if (!res.ok) throw new Error(url + ': ' + data.error); return data;
  };
}
(async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const mgr = { M: client(base), F: client(base) };
  await mgr.M('POST', '/api/login', { login: 'exec.m', password: PASS });
  await mgr.F('POST', '/api/login', { login: 'exec.f', password: PASS });
  for (const [nid, name, phone, year, g, entries, status] of people) {
    const c = client(base);
    await c('POST', '/api/signup', { nationalId: nid, fullName: name, phone, password: PASS });
    const r = await c('POST', '/api/my/registration', { birthYear: year, gender: g, entries: entries.map(([branch, track]) => ({ branch, track })) });
    if (status === 'withdrawn') await c('POST', '/api/my/withdraw', { reason: 'ظرف عائلي' });
  }
  // المواعيد: التصفيات اليوم في القسمين، وقبل النهائي بعد يومين
  const day = (d, h) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, 0, 0, 0); return t.getTime(); };
  await mgr.M('POST', '/api/sessions', { stage: 'prelim', branch: '', startsAt: day(0, 16), location: 'مقر جمعية اقرأ — قاعات التصفيات', note: 'يرجى الحضور قبل الموعد بنصف ساعة مع الهوية' });
  await mgr.F('POST', '/api/sessions', { stage: 'prelim', branch: '', startsAt: day(0, 16), location: 'مقر جمعية اقرأ — قسم النساء' });
  // اللجان: تكليف المحكمين والمنسق، ثم حضور معظم المقبولين وبعض النداءات
  const adm = client(base); await adm('POST', '/api/login', { login: 'admin', password: PASS });
  const uid = (l) => db.prepare('SELECT id FROM users WHERE login=?').get(l).id;
  const cms = (await mgr.M('GET', '/api/committees')).committees;
  const hifzY = cms.find((c) => c.name === 'الحفظ: اليافعون');
  for (const [l, kind] of [['judge.m', 'judge'], ['judge.m2', 'judge'], ['judge.m3', 'judge'], ['judge.m4', 'judge'], ['coord.m', 'coordinator']]) await mgr.M('POST', `/api/committees/${hifzY.id}/members`, { userId: uid(l), kind });
  const tadM = cms.find((c) => c.name === 'التدوير: جميع الفئات');
  for (const l of ['judge.t1', 'judge.t2', 'judge.t3']) await mgr.M('POST', `/api/committees/${tadM.id}/members`, { userId: uid(l), kind: 'judge' });
  await mgr.M('POST', `/api/committees/${tadM.id}/members`, { userId: uid('coord.m'), kind: 'coordinator' });
  const cmsF = (await mgr.F('GET', '/api/committees')).committees;
  await mgr.F('POST', `/api/committees/${cmsF[0].id}/members`, { userId: uid('judge.f'), kind: 'judge' });
  for (const g of ['M', 'F']) {
    const rec = await mgr[g]('GET', '/api/reception?page=1');
    let all = rec.rows;
    for (let pg = 2; pg <= Math.ceil(rec.total / rec.pageSize); pg++) all = all.concat((await mgr[g]('GET', '/api/reception?page=' + pg)).rows);
    all.forEach((r, i) => { r._i = i; });
    for (const r of all.filter((x) => x._i % 4 !== 3)) {
      const items = r.entries.filter((e) => e.needsCommittee && e.candidates.length === 1).map((e) => ({ entryId: e.id, committeeId: e.candidates[0].id }));
      if (items.length) await mgr[g]('POST', '/api/checkin', { registrationId: r.id, items });
    }
    const cs = (await mgr[g]('GET', '/api/committees')).committees;
    for (const [i, c] of cs.entries()) {
      if (i % 3 === 2) continue;
      try { const t = (await mgr[g]('POST', `/api/committees/${c.id}/next`)).ticket;
        await mgr[g]('POST', `/api/tickets/${t.id}/action`, { action: 'start' });
        if (i % 2 === 0) { await mgr[g]('POST', `/api/tickets/${t.id}/action`, { action: 'finish' }); await mgr[g]('POST', `/api/committees/${c.id}/next`); }
      } catch (e) {}
    }
  }
  const hz = hifzY.id;
  // الرصد: تُختبر مجموعات «الحفظ: اليافعون» و«التدوير» كاملة، وتُرصد كل استماراتها
  const J = {};
  for (const l of ['judge.m', 'judge.m2', 'judge.m3', 'judge.m4', 'judge.t1', 'judge.t2', 'judge.t3', 'judge.t4', 'judge.t5']) { J[l] = client(base); await J[l]('POST', '/api/login', { login: l, password: PASS }); }
  const act = (id, action) => mgr.M('POST', `/api/tickets/${id}/action`, { action });
  async function runCommittee(cid) {
    for (let guard = 0; guard < 40; guard++) {
      const q = (await mgr.M('GET', '/api/queues')).committees.find((c) => c.id === cid);
      if (q.current) { if (q.current.status === 'called') await act(q.current.id, 'start'); await act(q.current.id, 'finish'); continue; }
      if (!q.waiting.length) break;
      // من يُختبر في لجنة أخرى: يُنهى اختباره هناك أولًا
      for (const k of (await mgr.M('GET', '/api/queues')).committees) if (k.current && k.id !== cid && q.waiting.some((w) => w.name === k.current.name)) { if (k.current.status === 'called') await act(k.current.id, 'start'); await act(k.current.id, 'finish'); }
      const t = (await mgr.M('POST', `/api/committees/${cid}/next`)).ticket; await act(t.id, 'start');
    }
  }
  await runCommittee(hz); await runCommittee(tadM.id);
  const V = [[2, 1, 0, 3, 7, 10], [1, 0, 1, 1, 10, 10], [4, 2, 1, 5, 4, 7], [0, 1, 0, 2, 10, 7], [3, 0, 2, 1, 7, 7]];
  const seg = (o) => ({ segments: [o, {}, {}] });
  const hw = (await J['judge.m']('GET', '/api/judge/work')).committees.find((k) => k.id === hz).rows;
  for (const [i, r] of hw.entries()) {
    const v = V[i % V.length];
    await J['judge.m']('PUT', '/api/judge/form/' + r.ticketId, { data: { ...seg({ haraka_t: v[0], kalima_s: v[1], taraddud: v[3] }), vocab: v[4] }, submit: true });
    // آخر متسابق: استمارة المحكم الثاني مسودة، لتجربة إكمالها ثم اعتماد الكشف
    if (i === hw.length - 1) await J['judge.m2']('PUT', '/api/judge/form/' + r.ticketId, { data: seg({ haraka_t: v[0] }) });
    else await J['judge.m2']('PUT', '/api/judge/form/' + r.ticketId, { data: { ...seg({ haraka_t: v[0] + 1, ayat_t: v[2] }), vocab: v[5] }, submit: true });
    await J['judge.m3']('PUT', '/api/judge/form/' + r.ticketId, { data: seg({ sifat_khalal: v[3], sifat_tark: v[2], naqis: 1 }), submit: true });
    await J['judge.m4']('PUT', '/api/judge/form/' + r.ticketId, { data: { jamal: 18, murunah: 8, masaha: 8.5, adaa: 25 - i, maqamat: 16, tawzi: 8, deductions: { nashaz: i % 2 } }, submit: true });
  }
  const tw = (await J['judge.t1']('GET', '/api/judge/work')).committees.find((k) => k.id === tadM.id).rows;
  for (const [i, r] of tw.entries()) {
    await J['judge.t1']('PUT', '/api/judge/form/' + r.ticketId, { data: { rows: { 1: { jali_t: i % 3 }, 2: { arid_ikhlal: i + 1 } } }, submit: true });
    await J['judge.t2']('PUT', '/api/judge/form/' + r.ticketId, { data: { rows: { 1: { majhula: i + 2 } } }, submit: true });
    const tv = { jamal: 9, murunah: 8.5, masaha: 8, shidda: 9, adaa: 9 - (i % 2) * 0.5, itqan: 8, tadarruj: 8.5, tawzi: 9, qaflat: 8, taathir: 9, deductions: {} };
    await J['judge.t3']('PUT', '/api/judge/form/' + r.ticketId, { data: tv, submit: true });
  }
  // التدوير: اعتماد كشوف التصفيات، وتأهل الأول من كل فئة، ومقاطع قبل النهائي
  const chief = client(base); await chief('POST', '/api/login', { login: 'chief.m', password: PASS });
  for (const g of (await chief('GET', '/api/results?branch=tilawa')).groups.filter((g) => g.name.includes('تدوير') && g.canApprove)) {
    await chief('POST', '/api/results/approve', { stage: 'prelim', groupKey: g.key });
    const pv = await chief('POST', '/api/qualify/preview', { stage: 'prelim', groupKey: g.key, mode: 'count', value: 1 });
    await chief('POST', '/api/qualify/approve', { stage: 'prelim', groupKey: g.key, mode: 'count', value: 1, decisions: pv.tie ? pv.rows.filter((r) => r.tieAtCut).map((r, k) => ({ entryId: r.entryId, qualified: k === 0, reason: 'قرار اللجنة' })) : [] });
  }
  for (const g of (await chief('GET', '/api/results?branch=tilawa')).groups.filter((g) => g.sheet && !g.sheet.stale)) await adm('POST', '/api/results/publish', { sheetId: g.sheet.id });
  const sp = (await adm('GET', '/api/admin/stage-passages')).rows;
  const SEMI = { 'ترتيل · اليافعون': [43, 8, 14], 'ترتيل · الشباب': [29, 7, 12], 'ترتيل · الكبار': [28, 6, 10], 'تدوير · اليافعون': [50, 16, 30], 'تدوير · الشباب': [33, 7, 12], 'تدوير · الكبار': [27, 14, 26] };
  await adm('PUT', '/api/admin/stage-passages', { rows: sp.map((x) => { const p = SEMI[x.name]; return { id: x.id, semi: p ? { surah: p[0], ayahFrom: p[1], ayahTo: p[2] } : null }; }) });
  const semiT = (await mgr.M('GET', '/api/committees?stage=semi')).committees.find((k) => k.name.includes('التدوير'));
  for (const l of ['judge.t1', 'judge.t2', 'judge.t3', 'judge.t4', 'judge.t5']) await mgr.M('POST', `/api/committees/${semiT.id}/members`, { userId: uid(l), kind: 'judge' });
  await mgr.M('POST', `/api/committees/${semiT.id}/members`, { userId: uid('coord.m'), kind: 'coordinator' });
  await mgr.M('POST', '/api/sessions', { stage: 'semi', branch: 'tilawa', startsAt: day(2, 17), location: 'مقر جمعية اقرأ — القاعة الرئيسية' });
  const rs = await mgr.M('GET', '/api/reception?stage=semi');
  for (const r of rs.rows) await mgr.M('POST', '/api/checkin', { registrationId: r.id, stage: 'semi', items: r.entries.map((e) => ({ entryId: e.id })) });
  // اختبارات التفسير: أسئلة تجريبية للعرض فقط، وليست بنك الأسئلة المعتمد
  const tl = await adm('GET', '/api/tests');
  const curB = tl.curricula.find((x) => x.kind === 'branch' && x.name.includes('الشباب'));
  const curP = tl.curricula.find((x) => x.kind === 'passage' && x.name.includes('ترتيل') && x.name.includes('اليافعون'));
  const tB = (await adm('POST', '/api/tests', { curriculumId: curB.id, title: 'اختبار فرع التفسير — الشباب (سورة الصافات)', reference: 'يُحدَّد الكتاب المرجعي ونسخته قبل الاختبار الفعلي', questionCount: 5, durationMin: 15 })).test;
  await adm('POST', `/api/tests/${tB.id}/import`, { text: [
    'كم عدد آيات سورة الصافات؟\nأ) 112\nب) 182 *\nج) 128\nد) 200\nالمصدر: المصحف الشريف',
    'سورة الصافات مكية\nصح *\nخطأ',
    'ما ترتيب سورة الصافات في المصحف؟\nأ) 36\nب) 37 *\nج) 38',
    'تقع سورة الصافات بين سورتي:\nأ) يس وص *\nب) ص والزمر\nج) فاطر ويس',
    'تبدأ سورة الصافات بالقسم\nصح *\nخطأ',
    'السورة التي تلي الصافات في ترتيب المصحف:\nأ) الزمر\nب) ص *\nج) غافر',
  ].join('\n\n') });
  for (const q of (await chief('GET', `/api/tests/${tB.id}`)).questions) await chief('POST', `/api/questions/${q.id}/review`, { approve: true });
  await adm('PUT', `/api/tests/${tB.id}`, { ...tB, status: 'open' });
  const tP = (await adm('POST', '/api/tests', { curriculumId: curP.id, title: 'اختبار تفسير مقطع الترتيل — اليافعون (الزخرف 1–7)', questionCount: 3, durationMin: 10 })).test;
  await adm('POST', `/api/tests/${tP.id}/import`, { text: ['سورة الزخرف مكية\nصح *\nخطأ', 'تبدأ سورة الزخرف بالحروف المقطعة\nصح *\nخطأ', 'كم عدد آيات سورة الزخرف؟\nأ) 89 *\nب) 99\nج) 75'].join('\n\n') });
  for (const q of (await chief('GET', `/api/tests/${tP.id}`)).questions) await chief('POST', `/api/questions/${q.id}/review`, { approve: true });
  await adm('PUT', `/api/tests/${tP.id}`, { ...tP, status: 'open' });
  srv.close();
  db.prepare('DELETE FROM sessions').run();
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.pragma('journal_mode = DELETE');
  db.close();
  fs.copyFileSync(path.join(tmp, 'iqra.db'), outFile);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`✓ قاعدة بيانات تجريبية: ${staff.length} حسابات موظفين، ${people.length} متسابقًا`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
