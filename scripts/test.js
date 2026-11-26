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
