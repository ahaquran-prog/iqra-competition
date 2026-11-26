'use strict';
// قواعد التحقق والأهلية. كل ما يخص الدورة (الفئات والسنوات والمقررات) يُقرأ من قاعدة البيانات، ولا يُكتب هنا.
const db = require('./db');
const config = require('./config');

// تطبيع الأرقام العربية والفارسية إلى أرقام لاتينية قبل المقارنة
const toLatin = (s) => String(s ?? '')
  .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06F0));

// الهوية نص وليست عددًا: تحفظ الأصفار الابتدائية. التحقق أولي وليس تحققًا حكوميًا.
function normId(v) {
  const s = toLatin(v).replace(/[\s\-_.‏‎]/g, '');
  return /^\d{6,20}$/.test(s) ? s : null;
}
// الهاتف نص: تزال فواصل التنسيق، ويحفظ رمز الدولة إن وُجد
function normPhone(v) {
  let s = toLatin(v).replace(/[\s\-().‏‎]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  return /^\+?\d{7,15}$/.test(s) ? s : null;
}
const cleanName = (v) => String(v ?? '').replace(/[\s ]+/g, ' ').trim();
function normYear(v) {
  const s = toLatin(v).trim();
  return /^\d{4}$/.test(s) ? parseInt(s, 10) : null;
}

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const thisYear = () => parseInt(today().slice(0, 4), 10);

const current = () => db.prepare('SELECT * FROM competitions WHERE is_current=1 ORDER BY id DESC LIMIT 1').get();
const categoriesOf = (compId) => db.prepare('SELECT * FROM categories WHERE comp_id=? ORDER BY sort, id').all(compId)
  .map((c) => ({ ...c, branches: JSON.parse(c.branches || '[]') }));
const branchesOf = (compId) => db.prepare('SELECT * FROM branches WHERE comp_id=? ORDER BY sort, id').all(compId);
const curriculaOf = (compId) => db.prepare('SELECT * FROM curricula WHERE comp_id=? ORDER BY sort, id').all(compId);

// حالة التسجيل للدورة الآن
function regState(comp) {
  const t = today();
  if (!comp) return { open: false, editable: false, label: 'لا توجد دورة حالية' };
  if (comp.status !== 'open') return { open: false, editable: false, label: comp.status === 'draft' ? 'التسجيل لم يفتح بعد' : 'التسجيل مغلق' };
  if (comp.reg_open && t < comp.reg_open) return { open: false, editable: false, label: 'يفتح التسجيل في ' + comp.reg_open };
  if (comp.reg_close && t > comp.reg_close) return { open: false, editable: false, label: 'انتهت مدة التسجيل' };
  const editable = !comp.edit_close || t <= comp.edit_close;
  return { open: true, editable, label: 'التسجيل مفتوح' };
}

// يتحقق من عدم تداخل حدود الفئات. يعيد رسالة الخطأ أو null.
function overlapProblem(cats) {
  for (const c of cats) {
    if (c.from_year != null && c.to_year != null && c.from_year > c.to_year) return `حدود الفئة «${c.name}» غير صحيحة: البداية بعد النهاية`;
    if (c.from_year == null && c.to_year == null) return `حدد سنة بداية أو نهاية للفئة «${c.name}»`;
  }
  for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) {
    const a = cats[i], b = cats[j];
    const aLo = a.from_year ?? -Infinity, aHi = a.to_year ?? Infinity, bLo = b.from_year ?? -Infinity, bHi = b.to_year ?? Infinity;
    if (aLo <= bHi && bLo <= aHi) return `حدود الفئتين «${a.name}» و«${b.name}» متداخلة`;
  }
  return null;
}

// الفئة من سنة الميلاد. يعيد {category} أو {error}
function categoryFor(comp, year) {
  if (!Number.isInteger(year)) return { error: 'أدخل سنة ميلاد صحيحة من أربعة أرقام' };
  if (year < comp.min_birth_year || year > thisYear()) return { error: `سنة الميلاد يجب أن تكون بين ${comp.min_birth_year} و${thisYear()}` };
  const cats = categoriesOf(comp.id);
  const hit = cats.filter((c) => (c.from_year == null || year >= c.from_year) && (c.to_year == null || year <= c.to_year));
  if (hit.length > 1) return { error: 'إعداد الفئات في هذه الدورة متداخل؛ تواصل مع إدارة المسابقة' };
  if (!hit.length) return { error: `سنة الميلاد ${year} لا تقابل أي فئة مفتوحة في هذه الدورة` };
  return { category: hit[0] };
}

// الفروع والمسارات والمقررات المتاحة لفئة
function optionsFor(comp, category) {
  const curr = curriculaOf(comp.id);
  return branchesOf(comp.id)
    .filter((b) => b.registrable && category.branches.includes(b.code))
    .map((b) => {
      const tracks = [];
      for (const c of curr.filter((x) => x.branch === b.code && (x.category_id === category.id || x.category_id == null))) {
        if (tracks.some((t) => t.track === c.track)) continue; // مقرر الفئة يتقدم على العام إن تكرر المسار
        tracks.push({ track: c.track, trackName: c.track_name, curriculumId: c.id, content: c.content, allAges: c.category_id == null });
      }
      return { code: b.code, name: b.name, tracks };
    })
    .filter((b) => b.tracks.length);
}

module.exports = { toLatin, normId, normPhone, cleanName, normYear, today, thisYear, current, categoriesOf, branchesOf, curriculaOf, regState, overlapProblem, categoryFor, optionsFor };
