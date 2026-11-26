'use strict';
// أدوات مشتركة بين مسارات الخادم: الأسماء، والأخطاء، والتحقق، وسجل التدقيق، ونطاق الأقسام.
const db = require('./db');
const R = require('./rules');

const ROLES = { contestant: 'متسابق', judge: 'محكم', coordinator: 'منسق لجنة التحكيم', chief: 'رئيس لجنة التحكيم', exec: 'الإدارة التنفيذية', top: 'الإدارة العليا', screen: 'شاشة الانتظار' };
const SECTIONS = { M: 'قسم الرجال', F: 'قسم النساء' };
const REG_ST = { submitted: 'بانتظار المراجعة', returned: 'مطلوب استكمال', accepted: 'مقبول', rejected: 'غير مقبول', withdrawn: 'منسحب' };
const COMP_ST = { draft: 'مسودة', open: 'مفتوحة', closed: 'مغلقة', archived: 'مؤرشفة' };
const SPECIALTIES = ['محكم جودة الحفظ الأول', 'محكم جودة الحفظ الثاني', 'محكم التجويد الأول', 'محكم التجويد الثاني', 'محكم الصوت والنغم', 'محكم الوقف والابتداء'];
const STAGES = { prelim: 'التصفيات الأولية', semi: 'قبل النهائي', final: 'النهائي' };
// حالات المتسابق في الطابور
const TICKET_ST = { needs_committee: 'بانتظار تحديد اللجنة', waiting: 'منتظر', called: 'تم النداء', testing: 'قيد الاختبار', no_show: 'لم يستجب', done: 'انتهى الاختبار', cancelled: 'أُلغي الحضور' };

class Bad extends Error { constructor(m, c = 400, extra) { super(m); this.code = c; this.extra = extra; } }
function str(v, max, label, required = true) {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
  if (required && !s) throw new Bad(`الحقل «${label}» مطلوب`);
  if (s.length > max) throw new Bad(`الحقل «${label}» أطول من المسموح (${max} حرفًا)`);
  return s;
}
const wrap = (fn) => (req, res) => {
  try { const r = fn(req, res); if (r !== undefined) res.json(r); }
  catch (e) {
    if (e instanceof Bad) return res.status(e.code).json({ error: e.message, ...(e.extra || {}) });
    if (e && e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'السجل موجود من قبل' });
    console.error(e);
    res.status(500).json({ error: 'حدث خطأ في الخادم' });
  }
};
const need = (test) => (req, res, next) => (test(req.user) ? next() : res.status(403).json({ error: 'لا تملك صلاحية لهذا الإجراء' }));
const json = (v) => (v === undefined ? null : JSON.stringify(v));
function audit(actor, action, entity, entityId, { section = '', summary = '', before, after, reason = '' } = {}) {
  db.prepare('INSERT INTO audit(at,actor_id,action,entity,entity_id,section,summary,before,after,reason) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(Date.now(), actor ? actor.id : null, action, entity, entityId ?? null, section, summary, json(before), json(after), reason);
}
const isTop = (u) => u.role === 'top';
// نطاق القسم: الإدارة العليا ترى القسمين ويمكنها التصفية، وغيرها يرى قسمه فقط
const scope = (u, wanted) => (isTop(u) ? (SECTIONS[wanted] ? wanted : '') : u.section);
const inScope = (u, section) => isTop(u) || (!!u.section && u.section === section);
function comp() { const c = R.current(); if (!c) throw new Bad('لا توجد دورة حالية', 404); return c; }
const jparse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

module.exports = { ROLES, SECTIONS, REG_ST, COMP_ST, SPECIALTIES, STAGES, TICKET_ST, Bad, str, wrap, need, json, audit, isTop, scope, inScope, comp, jparse };
