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
  ['1000000015', 'هاجر علي إبراهيم السيد', '0500000015', 2023, 'F', [['hifz', 'cat']], 'rejected'],
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
    const note = status === 'returned' ? 'يرجى التأكد من سنة الميلاد وإرفاق صورة الهوية لدى الإدارة' : status === 'rejected' ? 'سنة الميلاد خارج الفئات المعتمدة في هذه الدورة' : '';
    if (status !== 'submitted') await mgr[g]('POST', `/api/registrations/${r.registration.id}/status`, { status, note });
  }
  // اللجان: تكليف المحكمين والمنسق، ثم حضور معظم المقبولين وبعض النداءات
  const adm = client(base); await adm('POST', '/api/login', { login: 'admin', password: PASS });
  const uid = (l) => db.prepare('SELECT id FROM users WHERE login=?').get(l).id;
  const cms = (await mgr.M('GET', '/api/committees')).committees;
  const hifzY = cms.find((c) => c.name === 'الحفظ: اليافعون');
  for (const [l, kind] of [['judge.m', 'judge'], ['judge.m2', 'judge'], ['judge.m3', 'judge'], ['judge.m4', 'judge'], ['coord.m', 'coordinator']]) await mgr.M('POST', `/api/committees/${hifzY.id}/members`, { userId: uid(l), kind });
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
