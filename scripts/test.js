'use strict';
// اختبارات القبول الأساسية للتسجيل والصلاحيات. تعمل على قاعدة بيانات مؤقتة ولا تمس البيانات الفعلية.
// التشغيل: npm test
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iqra-test-'));
process.env.DATA_DIR = tmp;
process.env.ADMIN_PASSWORD = 'Admin-12345';
process.env.ADMIN_USERNAME = 'admin';
const app = require('../server');
const db = require('../lib/db');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name, extra !== undefined ? JSON.stringify(extra) : ''); } };

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, { method, headers: { 'X-Iqra': '1', 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

(async () => {
  const srv = app.listen(0); const base = `http://127.0.0.1:${srv.address().port}`;
  const admin = client(base);
  try {
    console.log('الدخول والحسابات');
    let r = await admin('POST', '/api/login', { login: 'admin', password: 'Admin-12345' });
    ok('دخول الإدارة العليا', r.status === 200 && r.data.user.role === 'top');
    r = await admin('GET', '/api/registrations');
    ok('إلزام تغيير كلمة المرور المؤقتة', r.status === 403 && r.data.mustChange);
    r = await admin('POST', '/api/password', { current: 'Admin-12345', next: 'NewAdmin-2026' });
    ok('تغيير كلمة المرور', r.status === 200);
    const csrf = await fetch(base + '/api/logout', { method: 'POST' });
    ok('رفض الطلب دون ترويسة الحماية', csrf.status === 403);

    const mk = async (login, role, section, specialty) => {
      const x = await admin('POST', '/api/users', { login, name: 'حساب ' + login, role, section, specialty });
      const c = client(base); await c('POST', '/api/login', { login, password: x.data.tempPassword }); await c('POST', '/api/password', { current: x.data.tempPassword, next: 'Staff-pass-1' });
      return c;
    };
    r = await admin('POST', '/api/users', { login: 'execx', name: 'تنفيذي', role: 'exec' });
    ok('رفض حساب تنفيذي بلا قسم', r.status === 400);
    const execM = await mk('exec.m', 'exec', 'M'), execF = await mk('exec.f', 'exec', 'F'), chiefM = await mk('chief.m', 'chief', 'M'), judgeM = await mk('judge.m', 'judge', 'M', 'محكم جودة الحفظ الأول');

    console.log('التسجيل والأهلية');
    const ahmad = client(base);
    r = await ahmad('POST', '/api/signup', { nationalId: '٠١٢٣٤٥٦٧٨٩', fullName: '  أحمد   محمد علي الكعبي ', phone: '٠٥٠ ١٢٣ ٤٥٦٧', password: 'Ahmad-2026' });
    ok('إنشاء حساب متسابق بأرقام عربية', r.status === 200 && r.data.user.login === '0123456789', r.data);
    r = await client(base)('POST', '/api/signup', { nationalId: '0123456789', fullName: 'شخص آخر بالاسم نفسه', phone: '0500000000', password: 'Other-2026' });
    ok('REG02: الهوية نفسها لا تنشئ حسابًا ثانيًا', r.status === 409);
    r = await ahmad('GET', '/api/eligibility?year=2022');
    ok('AGE01: البراعم يرون الحفظ وحده', r.status === 200 && r.data.category.name === 'البراعم' && r.data.branches.map((b) => b.code).join() === 'hifz', r.data);
    r = await ahmad('GET', '/api/eligibility?year=2014');
    ok('اليافعون: الحفظ والتلاوة والتفسير', r.data.branches.map((b) => b.code).join() === 'hifz,tilawa,tafsir');
    const tilawa = r.data.branches.find((b) => b.code === 'tilawa');
    ok('التلاوة: ترتيل وتدوير بمقطع الفئة', tilawa.tracks.length === 2 && tilawa.tracks[0].content.includes('الزخرف'));
    ok('الحفظ: مقرر الفئة والمسارات لكل الأعمار', r.data.branches[0].tracks.map((t) => t.track).join() === 'cat,j5,j10,full');
    r = await ahmad('GET', '/api/eligibility?year=2025');
    ok('AGE03: سنة لا تقابل فئة', r.status === 400);
    r = await ahmad('POST', '/api/my/registration', { birthYear: 2022, gender: 'M', entries: [{ branch: 'hifz', track: 'cat' }, { branch: 'tilawa', track: 'tartil' }] });
    ok('AGE01: الخادم يرفض التلاوة للبراعم', r.status === 400);
    r = await ahmad('POST', '/api/my/registration', { birthYear: 2014, gender: 'M', entries: [{ branch: 'hifz', track: 'j5' }, { branch: 'tafsir', track: 'main' }] });
    ok('REG01: شخص واحد ومشاركتان', r.status === 200 && r.data.registration.entries.length === 2, r.data);
    const [r1, r2] = await Promise.all([1, 2].map(() => ahmad('POST', '/api/my/registration', { birthYear: 2014, gender: 'M', entries: [{ branch: 'hifz', track: 'j5' }, { branch: 'tafsir', track: 'main' }] })));
    ok('REG02: تكرار التأكيد لا ينشئ تسجيلًا ثانيًا', r1.status === 200 && r2.status === 200 && db.prepare('SELECT COUNT(*) n FROM registrations').get().n === 1);
    r = await ahmad('POST', '/api/my/registration', { birthYear: 2022, gender: 'M', entries: [{ branch: 'hifz', track: 'cat' }] });
    ok('AGE02: التحول إلى البراعم يزيل التفسير ويعيد المقرر', r.status === 200 && r.data.registration.categoryName === 'البراعم'
      && r.data.registration.entries.find((e) => e.branch === 'tafsir').status === 'withdrawn' && r.data.registration.entries.find((e) => e.branch === 'hifz').curriculum.includes('القدر'), r.data);
    const regId = r.data.registration.id;

    const sara = client(base);
    await sara('POST', '/api/signup', { nationalId: '987654321', fullName: 'سارة خالد عبدالله المري', phone: '+97333001122', password: 'Sara-2026' });
    r = await sara('POST', '/api/my/registration', { birthYear: 2010, gender: 'F', entries: [{ branch: 'tilawa', track: 'tadweer' }] });
    const saraReg = r.data.registration.id;
    ok('تسجيل متسابقة في قسم النساء', r.status === 200 && r.data.registration.section === 'F');

    console.log('الصلاحيات والأقسام');
    r = await ahmad('GET', '/api/registrations');
    ok('المتسابق لا يرى قائمة التسجيلات', r.status === 403);
    r = await ahmad('GET', '/api/registrations/' + saraReg);
    ok('المتسابق لا يفتح ملف متسابق آخر', r.status === 403);
    r = await judgeM('GET', '/api/registrations');
    ok('المحكم لا يرى التسجيلات', r.status === 403);
    r = await execM('GET', '/api/registrations');
    ok('التنفيذية (رجال) ترى قسمها فقط', r.data.total === 1 && r.data.rows[0].section === 'M');
    r = await execM('GET', '/api/registrations?section=F');
    ok('التنفيذية لا تتجاوز قسمها بتغيير المرشح', r.data.total === 1 && r.data.rows[0].section === 'M');
    r = await execM('GET', '/api/registrations/' + saraReg);
    ok('SEC02: سجل قسم النساء مرفوض لتنفيذية الرجال حتى مع معرفة المعرف', r.status === 404);
    r = await execF('POST', `/api/registrations/${regId}/status`, { status: 'accepted' });
    ok('تنفيذية النساء لا تعتمد طلب رجال', r.status === 404);
    r = await chiefM('GET', '/api/registrations');
    ok('رئيس التحكيم: اطلاع بلا هوية أو هاتف', r.status === 200 && r.data.rows[0].nationalId === '' && r.data.rows[0].phone === '');
    r = await chiefM('POST', `/api/registrations/${regId}/status`, { status: 'accepted' });
    ok('رئيس التحكيم لا يغير حالة الطلب', r.status === 403);
    r = await chiefM('GET', '/api/registrations.csv');
    ok('رئيس التحكيم لا يصدّر', r.status === 403);
    r = await execM('GET', '/api/admin/competition');
    ok('التنفيذية لا تفتح إعداد الدورة', r.status === 403);
    r = await execM('GET', '/api/users');
    ok('التنفيذية لا تدير الحسابات', r.status === 403);
    r = await admin('GET', '/api/registrations');
    ok('الإدارة العليا ترى القسمين', r.data.total === 2);
    r = await admin('GET', '/api/registrations?section=F');
    ok('الإدارة العليا تصفي بقسم', r.data.total === 1 && r.data.rows[0].section === 'F');

    console.log('المراجعة والتصحيح');
    r = await execM('POST', `/api/registrations/${regId}/status`, { status: 'returned' });
    ok('طلب الاستكمال يحتاج ملاحظة', r.status === 400);
    r = await execM('POST', `/api/registrations/${regId}/status`, { status: 'accepted' });
    ok('قبول الطلب', r.status === 200 && r.data.registration.status === 'accepted');
    r = await ahmad('POST', '/api/my/registration', { birthYear: 2022, gender: 'M', entries: [{ branch: 'hifz', track: 'j10' }] });
    ok('المتسابق لا يعدل طلبًا مقبولًا', r.status === 409);
    r = await execM('POST', `/api/registrations/${regId}/correct`, { birthYear: 2014 });
    ok('معاينة أثر تغيير سنة الميلاد قبل التطبيق', r.status === 200 && r.data.preview.category.to === 'اليافعون' && r.data.preview.recurr.length === 1, r.data);
    r = await execM('POST', `/api/registrations/${regId}/correct`, { birthYear: 2014, confirm: true });
    ok('التصحيح يحتاج سببًا', r.status === 400);
    r = await execM('POST', `/api/registrations/${regId}/correct`, { birthYear: 2014, confirm: true, reason: 'خطأ في إدخال سنة الميلاد حسب الهوية' });
    ok('تطبيق التصحيح وتحديث المقرر', r.status === 200 && r.data.registration.categoryName === 'اليافعون');
    r = await execM('POST', `/api/registrations/${regId}/correct`, { gender: 'F', confirm: true, reason: 'نقل إلى قسم آخر' });
    ok('التنفيذية لا تنقل المتسابق للقسم الآخر', r.status === 403);
    r = await execM('GET', '/api/registrations/' + regId);
    ok('السجل يحفظ التصحيح بالسبب والقيم السابقة', r.data.history.some((h) => h.action === 'correct' && h.reason && h.before.birthYear === 2022));
    r = await execM('GET', '/api/registrations.csv');
    ok('تصدير CSV ضمن القسم', r.status === 200 && typeof r.data === 'string' && r.data.includes('أحمد') && !r.data.includes('سارة'));
    const bad = await admin('POST', '/api/audit', {});
    ok('سجل التدقيق لا يُكتب من الواجهة', bad.status === 404);
    let threw = false; try { db.prepare('DELETE FROM audit').run(); } catch { threw = true; }
    ok('سجل التدقيق غير قابل للحذف في قاعدة البيانات', threw);

    console.log('اللجان والحضور والطوابير والنداء');
    const coordM = await mk('coord.m', 'coordinator', 'M'), screenM = await mk('screen.m', 'screen', 'M'), screenF = await mk('screen.f', 'screen', 'F');
    const ppl = {};
    for (const [k, nid, name, entries] of [['c1', '2000000001', 'بلال سامي عادل العمري', [['hifz', 'cat'], ['tilawa', 'tartil']]], ['c2', '2000000002', 'زياد فهد خالد الشمري', [['hifz', 'cat']]], ['c3', '2000000003', 'ثامر علي حسن الدوسري', [['tilawa', 'tartil']]], ['c4', '2000000004', 'ياسر نايف محمد العنزي', [['hifz', 'cat']]]]) {
      const c = client(base); await c('POST', '/api/signup', { nationalId: nid, fullName: name, phone: '05' + nid.slice(2), password: 'Pass-2026' });
      const x = await c('POST', '/api/my/registration', { birthYear: 2014, gender: 'M', entries: entries.map(([branch, track]) => ({ branch, track })) });
      ppl[k] = { c, reg: x.data.registration };
    }
    r = await execM('POST', '/api/checkin', { registrationId: ppl.c1.reg.id, items: [{ entryId: ppl.c1.reg.entries[0].id }] });
    ok('لا حضور لطلب غير مقبول', r.status === 400);
    for (const k of ['c1', 'c2', 'c3', 'c4']) await execM('POST', `/api/registrations/${ppl[k].reg.id}/status`, { status: 'accepted' });
    r = await execM('GET', '/api/committees');
    const hifzY = r.data.committees.find((x) => x.name === 'الحفظ: اليافعون'), tarY = r.data.committees.find((x) => x.name === 'الترتيل: اليافعون');
    ok('اللجان المبدئية: ست لجان لقسم الرجال', r.data.committees.length === 6 && hifzY && tarY);
    r = await execF('GET', '/api/committees');
    ok('تنفيذية النساء ترى لجان قسمها فقط', r.data.committees.length === 6 && r.data.committees.every((x) => x.section === 'F'));
    r = await execM('GET', '/api/reception?q=' + encodeURIComponent('ياسر'));
    ok('ATT01: البحث يجد الاسم أيًّا كان موضعه الأبجدي', r.data.total === 1 && r.data.rows[0].entries[0].candidates.length === 1);
    const ci = (k, idx) => execM('POST', '/api/checkin', { registrationId: ppl[k].reg.id, items: idx.map((i) => ({ entryId: ppl[k].reg.entries[i].id })) });
    const a1 = await ci('c1', [0, 1]), a1b = await ci('c1', [0, 1]);
    ok('ATT03: تثبيت الحضور مرتين يعطي التذكرة ورقم الوصول نفسيهما', a1.status === 200 && a1b.data.tickets[0].id === a1.data.tickets[0].id && a1b.data.tickets[0].seq === a1.data.tickets[0].seq);
    ok('الحضور يُسند تلقائيًا للجنة المطابقة الوحيدة', a1.data.tickets[0].committee === 'الحفظ: اليافعون' && a1.data.tickets[1].committee === 'الترتيل: اليافعون');
    await ci('c3', [0]); const a2 = await ci('c2', [0]);
    ok('ATT02: الوصول الجديد يضاف إلى نهاية الطابور', a2.data.tickets[0].seq > a1.data.tickets[1].seq);
    r = await coordM('POST', `/api/committees/${hifzY.id}/next`);
    ok('المنسق غير المكلَّف لا ينادي', r.status === 404);
    await execM('POST', `/api/committees/${hifzY.id}/members`, { userId: (await admin('GET', '/api/users?role=coordinator')).data.users[0].id, kind: 'coordinator' });
    const judgeId = (await admin('GET', '/api/users?role=judge')).data.users.find((u) => u.section === 'M').id;
    r = await execM('POST', `/api/committees/${hifzY.id}/members`, { userId: judgeId, kind: 'judge' });
    ok('تكليف محكم في اللجنة', r.status === 200 && r.data.committee.members.length === 2);
    r = await judgeM('POST', `/api/committees/${hifzY.id}/next`);
    ok('المحكم لا ينادي (النداء للمنسق المكلَّف)', r.status === 404);
    r = await judgeM('GET', '/api/queues');
    ok('المحكم يرى طابور لجنته فقط', r.status === 200 && r.data.committees.length === 1 && r.data.committees[0].id === hifzY.id);
    const [n1, n2] = await Promise.all([coordM('POST', `/api/committees/${hifzY.id}/next`), coordM('POST', `/api/committees/${hifzY.id}/next`)]);
    ok('QUE01: ضغط «التالي» مرتين يحجز متسابقًا واحدًا', [n1.status, n2.status].sort().join() === '200,409');
    const called = (n1.status === 200 ? n1 : n2).data.ticket;
    ok('النداء لأقدم منتظر', called.name === 'بلال سامي عادل العمري');
    r = await chiefM('POST', `/api/committees/${tarY.id}/next`);
    ok('QUE02: الشخص المنادى في لجنة لا يُنادى في أخرى، وتنتقل للمنتظر التالي', r.status === 200 && r.data.ticket.name === 'ثامر علي حسن الدوسري', r.data);
    const t3 = r.data.ticket;
    r = await screenM('GET', '/api/screen');
    const scr = JSON.stringify(r.data);
    ok('الشاشة تعرض الاسم واللجنة والقاعة', r.status === 200 && r.data.calls.length === 2 && r.data.calls[0].hall && r.data.committees.find((x) => x.id === hifzY.id).current.name === 'بلال سامي عادل العمري');
    ok('الشاشة لا تعرض الهوية أو الهاتف', !scr.includes('2000000001') && !scr.includes('0500000001'));
    r = await screenF('GET', '/api/screen');
    ok('DSP01: شاشة النساء لا تعرض نداء الرجال', r.data.calls.length === 0 && !JSON.stringify(r.data).includes('بلال'));
    r = await screenF('GET', '/api/screen?section=M');
    ok('شاشة النساء لا تتجاوز قسمها بالمرشح', r.data.section === 'F');
    r = await screenM('GET', '/api/registrations');
    ok('حساب الشاشة لا يصل إلى التسجيلات', r.status === 403);
    r = await ppl.c1.c('GET', '/api/queues');
    ok('المتسابق لا يرى الطوابير', r.status === 403);
    r = await execF('POST', `/api/committees/${hifzY.id}/next`);
    ok('تنفيذية النساء لا تشغّل لجنة رجال', r.status === 404);
    r = await chiefM('POST', `/api/tickets/${t3.id}/action`, { action: 'noshow' });
    ok('QUE03: «لم يستجب» يعيده إلى نهاية الطابور مع حفظ وقت حضوره', r.status === 200 && r.data.ticket.status === 'waiting' && r.data.ticket.seq > a2.data.tickets[0].seq && r.data.ticket.arrivedAt === t3.arrivedAt && r.data.ticket.calls === 1);
    r = await coordM('POST', `/api/committees/${hifzY.id}/next`);
    ok('لا نداء جديد واللجنة لديها متسابق حالي', r.status === 409);
    r = await coordM('POST', `/api/tickets/${called.id}/action`, { action: 'finish' });
    ok('لا ينتهي الاختبار قبل بدئه', r.status === 400);
    await coordM('POST', `/api/tickets/${called.id}/action`, { action: 'recall' });
    await coordM('POST', `/api/tickets/${called.id}/action`, { action: 'start' });
    r = await coordM('POST', `/api/tickets/${called.id}/action`, { action: 'finish' });
    ok('إعادة النداء ثم بدء الاختبار ثم إنهاؤه', r.status === 200 && r.data.ticket.status === 'done' && r.data.ticket.calls === 2);
    r = await ppl.c2.c('GET', '/api/my/queue');
    ok('المتسابق يرى حالته ولجنته وعدد من قبله', r.data.tickets[0].status === 'waiting' && r.data.tickets[0].committee === 'الحفظ: اليافعون' && r.data.tickets[0].ahead === 0);
    r = await execM('POST', '/api/committees', { name: 'الحفظ: اليافعون 2', branch: 'hifz', categories: [hifzY.categories[0]], hall: 'القاعة 7' });
    ok('إنشاء لجنة إضافية في القسم', r.status === 200 && r.data.committee.section === 'M');
    const extra = r.data.committee;
    r = await ci('c4', [0]);
    ok('عند وجود أكثر من لجنة مطابقة: بانتظار تحديد اللجنة', r.data.tickets[0].status === 'needs_committee');
    r = await chiefM('POST', `/api/tickets/${r.data.tickets[0].id}/assign`, { committeeId: tarY.id });
    ok('رفض إسناد إلى لجنة لا تطابق الفرع', r.status === 400);
    const t4 = (await execM('GET', '/api/queues')).data.needsCommittee[0];
    r = await chiefM('POST', `/api/tickets/${t4.id}/assign`, { committeeId: extra.id });
    ok('إسناد اللجنة مع الحفاظ على رقم الوصول', r.status === 200 && r.data.ticket.status === 'waiting' && r.data.ticket.seq === t4.seq);
    r = await execM('PUT', `/api/committees/${hifzY.id}`, { ...hifzY, branch: 'tilawa', tracks: ['tartil'] });
    ok('لا يُغيَّر اختصاص لجنة بعد بدء الحضور فيها', r.status === 409);
    r = await execM('DELETE', `/api/committees/${hifzY.id}`);
    ok('لا تُحذف لجنة لها سجل حضور', r.status === 409);

    console.log('إعداد الدورة');
    r = await admin('GET', '/api/admin/competition');
    const cats = r.data.categories.map((c) => ({ ...c }));
    cats[0].fromYear = 2019;
    let x = await admin('PUT', '/api/admin/categories', { categories: cats });
    ok('AGE03: رفض الحدود المتداخلة', x.status === 400 && /متداخلة/.test(x.data.error));
    x = await admin('PUT', '/api/admin/categories', { categories: r.data.categories.slice(1) });
    ok('منع حذف فئة عليها مقررات أو تسجيلات', x.status === 400);
    x = await admin('PUT', '/api/admin/competition', { ...r.data.competition, status: 'closed' });
    r = await sara('POST', '/api/my/registration', { birthYear: 2010, gender: 'F', entries: [{ branch: 'tilawa', track: 'tartil' }] });
    ok('إغلاق الدورة يمنع التسجيل والتعديل', x.status === 200 && r.status === 400);
  } catch (e) { fail++; console.error(e); }
  srv.close();
  console.log(`\n${pass} نجح، ${fail} أخفق`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
