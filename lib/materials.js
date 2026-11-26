'use strict';
// مذكرات المقررات: ترفعها إدارة المسابقة متى جهزت، وتظهر لكل متسابق في حسابه بحسب مشاركته.
// المذكرة لفرع، ويمكن تخصيصها بمقرر أو فئة أو قسم، أو بمرحلة لاحقة فلا يراها إلا المتأهلون إليها.
// المسودة لا يراها المتسابقون. النشر وتحديث الملف يرسلان إشعارًا للمعنيين مرة واحدة لكل نسخة.
const db = require('./db');
const config = require('./config');
const store = require('./store');
const { SECTIONS, STAGES, Bad, str, wrap, need, audit, isTop, inScope, comp } = require('./util');

// الأنواع المسموحة، مع فحص بداية الملف حتى لا يُرفع ملف بامتداد مزيف
const ZIP = (b) => b[0] === 0x50 && b[1] === 0x4b;
const TYPES = {
  pdf: ['application/pdf', (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, 'PDF'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP, 'Word'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', ZIP, 'PowerPoint'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ZIP, 'Excel'],
  jpg: ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'صورة'],
  jpeg: ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, 'صورة'],
  png: ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, 'صورة'],
  mp3: ['audio/mpeg', (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0), 'صوت'],
  m4a: ['audio/mp4', (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70, 'صوت'],
};
const EXTS = Object.keys(TYPES);
const maxBytes = () => Math.round(config.materialMaxMB * 1024 * 1024);
const fromB64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64') : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

// يقرأ الملف المرفوع ويتحقق منه، ثم يحفظه ويعيد بياناته
function readFile(f) {
  if (!f || typeof f !== 'object' || typeof f.data !== 'string' || !f.data) throw new Bad('اختر الملف');
  const name = String(f.name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(-120);
  const ext = (name.match(/\.([A-Za-z0-9]+)$/) || [])[1];
  const t = ext && TYPES[ext.toLowerCase()];
  if (!t) throw new Bad(`نوع الملف غير مسموح. المسموح: ${EXTS.filter((x) => x !== 'jpeg').join('، ')}`);
  const b64 = f.data.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Bad('تعذّرت قراءة الملف');
  if (Math.floor(b64.length * 3 / 4) > maxBytes() + 4) throw new Bad(`حجم الملف أكبر من المسموح (${config.materialMaxMB} ميغابايت)`, 413);
  const bytes = fromB64(b64);
  if (!bytes.length) throw new Bad('الملف فارغ');
  if (bytes.length > maxBytes()) throw new Bad(`حجم الملف أكبر من المسموح (${config.materialMaxMB} ميغابايت)`, 413);
  if (!t[1](bytes)) throw new Bad('محتوى الملف لا يطابق امتداده. احفظه بصيغته الصحيحة ثم ارفعه.');
  return { name, mime: t[0], size: bytes.length, sha: store.put(bytes) };
}

// ---------- الجمهور والصلاحية ----------
// شروط مطابقة المذكرة لمشاركة متسابق (e مشاركة، r تسجيل)
const MATCH = `m.comp_id=r.comp_id AND m.branch=e.branch AND m.deleted_at IS NULL AND m.published_at IS NOT NULL
  AND (m.section='' OR m.section=r.section) AND (m.curriculum_id IS NULL OR m.curriculum_id=e.curriculum_id)
  AND (m.category_id IS NULL OR m.category_id=r.category_id)
  AND (m.stage='' OR EXISTS (SELECT 1 FROM qualifications q WHERE q.entry_id=e.id AND q.to_stage=m.stage AND q.status='qualified'))`;
const ACTIVE = "r.status='accepted' AND e.status='active'";
const FROM = 'FROM materials m JOIN entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id';
const audience = (id) => db.prepare(`SELECT DISTINCT p.user_id id ${FROM} WHERE m.id=? AND ${ACTIVE} AND ${MATCH}`).all(id).map((x) => x.id).filter(Boolean);
const canSee = (m, u) => {
  if (u.role === 'contestant') return !!db.prepare(`SELECT 1 ${FROM} WHERE m.id=? AND p.user_id=? AND ${ACTIVE} AND ${MATCH}`).get(m.id, u.id);
  return ['exec', 'top', 'chief'].includes(u.role) && (m.section === '' ? true : inScope(u, m.section));
};
const canManage = (u) => ['exec', 'top'].includes(u.role);
// الإدارة التنفيذية تدير مذكرات قسمها فقط، والمذكرة المشتركة للقسمين من صلاحية الإدارة العليا
const canEdit = (m, u) => isTop(u) || (u.role === 'exec' && m.section === u.section);

// ---------- العرض ----------
const nameOf = {
  branch: (cid, code) => (db.prepare('SELECT name FROM branches WHERE comp_id=? AND code=?').get(cid, code) || {}).name || code,
  curr: (id) => (id ? db.prepare('SELECT content, track_name FROM curricula WHERE id=?').get(id) : null),
  cat: (id) => (id ? (db.prepare('SELECT name FROM categories WHERE id=?').get(id) || {}).name || '' : ''),
};
function target(m) {
  const c = nameOf.curr(m.curriculum_id);
  return [nameOf.branch(m.comp_id, m.branch), c ? `${c.track_name ? c.track_name + ': ' : ''}${c.content}` : '', m.category_id ? 'فئة ' + nameOf.cat(m.category_id) : '',
    m.section ? 'قسم ' + SECTIONS[m.section] : '', m.stage ? 'المتأهلون إلى ' + STAGES[m.stage] : ''].filter(Boolean).join(' · ');
}
const typeName = (n) => { const e = (String(n).match(/\.([A-Za-z0-9]+)$/) || [])[1]; return (TYPES[String(e || '').toLowerCase()] || [])[2] || ''; };
function json(m, u) {
  const c = nameOf.curr(m.curriculum_id);
  return { id: m.id, title: m.title, note: m.note, branch: m.branch, branchName: nameOf.branch(m.comp_id, m.branch), section: m.section, sectionName: m.section ? SECTIONS[m.section] : 'القسمان',
    curriculumId: m.curriculum_id, curriculum: c ? c.content : '', categoryId: m.category_id, categoryName: nameOf.cat(m.category_id), stage: m.stage, stageName: m.stage ? STAGES[m.stage] : '',
    target: target(m), fileName: m.file_name, fileType: typeName(m.file_name), size: m.size, version: m.version, published: !!m.published_at, publishedAt: m.published_at, updatedAt: m.updated_at,
    ...(u && u.role !== 'contestant' ? { canEdit: canEdit(m, u) } : {}) };
}

// ---------- الإشعار ----------
function announce(m, updated) {
  if (!m.published_at || m.deleted_at) return 0;
  const N = require('./notify');
  return N.notify(audience(m.id), 'material', { key: `${m.id}:${m.version}`, link: 'my',
    title: updated ? `تحديث مذكرة: ${m.title}` : `مذكرة جديدة: ${m.title}`,
    body: `${target(m)}. ${updated ? 'رُفعت نسخة محدّثة من المذكرة' : 'أُتيحت مذكرة للمقرر'}، وتجدها في «مشاركتي».` });
}

// قراءة الحقول وتحققها (الفرع والمقرر والفئة والقسم والمرحلة)
function fields(b, u, old) {
  const c = comp();
  const out = { title: str(b.title, 150, 'عنوان المذكرة'), note: str(b.note, 500, 'وصف', false) };
  out.branch = String(b.branch || '');
  if (!db.prepare('SELECT 1 FROM branches WHERE comp_id=? AND code=?').get(c.id, out.branch)) throw new Bad('اختر الفرع');
  out.curriculum_id = b.curriculumId ? +b.curriculumId : null;
  if (out.curriculum_id && !db.prepare('SELECT 1 FROM curricula WHERE id=? AND comp_id=? AND branch=?').get(out.curriculum_id, c.id, out.branch)) throw new Bad('المقرر لا يتبع هذا الفرع');
  out.category_id = b.categoryId ? +b.categoryId : null;
  if (out.category_id && !db.prepare('SELECT 1 FROM categories WHERE id=? AND comp_id=?').get(out.category_id, c.id)) throw new Bad('فئة غير صحيحة');
  if (out.curriculum_id) {
    const cc = db.prepare('SELECT category_id FROM curricula WHERE id=?').get(out.curriculum_id);
    if (out.category_id && cc.category_id && cc.category_id !== out.category_id) throw new Bad('المقرر المختار لفئة أخرى');
  }
  out.stage = ['', 'semi', 'final'].includes(b.stage || '') ? b.stage || '' : null;
  if (out.stage === null) throw new Bad('مرحلة غير صحيحة');
  if (isTop(u)) { out.section = ['', 'M', 'F'].includes(b.section || '') ? b.section || '' : null; if (out.section === null) throw new Bad('قسم غير صحيح'); }
  else out.section = old ? old.section : u.section;
  return out;
}

function routes(app) {
  // ---------- الإدارة ----------
  app.get('/api/admin/materials', need((u) => ['exec', 'top', 'chief'].includes(u.role)), wrap((req) => {
    const c = comp(), u = req.user;
    const rows = db.prepare(`SELECT m.*, (SELECT COUNT(*) FROM material_downloads d WHERE d.material_id=m.id) dl FROM materials m WHERE m.comp_id=? AND m.deleted_at IS NULL${isTop(u) ? '' : " AND m.section IN ('', ?)"} ORDER BY m.branch, m.id DESC`)
      .all(...[c.id, ...(isTop(u) ? [] : [u.section])]);
    return { maxMB: config.materialMaxMB, types: EXTS.filter((x) => x !== 'jpeg'), canManage: canManage(u),
      materials: rows.map((m) => ({ ...json(m, u), downloads: m.dl, audience: m.published_at ? audience(m.id).length : null, wouldReach: m.published_at ? null : wouldReach(m) })) };
  }));
  // عدد من ستصلهم المذكرة لو نُشرت (للمسودة)
  function wouldReach(m) { return db.prepare(`SELECT COUNT(DISTINCT p.user_id) n FROM (SELECT ${['id', 'comp_id', 'branch', 'section', 'curriculum_id', 'category_id', 'stage'].map((k) => `? AS ${k}`).join(',')}, NULL AS deleted_at, 1 AS published_at) m JOIN entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id WHERE ${ACTIVE} AND ${MATCH}`).get(m.id, m.comp_id, m.branch, m.section, m.curriculum_id, m.category_id, m.stage).n; }

  app.post('/api/admin/materials', need(canManage), wrap((req) => {
    const c = comp(), u = req.user, b = req.body || {};
    const f = fields(b, u, null);
    if (f.section === '' && !isTop(u)) throw new Bad('المذكرة المشتركة للقسمين من صلاحية الإدارة العليا', 403);
    const file = readFile(b.file), now = Date.now();
    const id = db.prepare('INSERT INTO materials(comp_id,section,branch,curriculum_id,category_id,stage,title,note,file_name,mime,size,sha256,file_at,published_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(c.id, f.section, f.branch, f.curriculum_id, f.category_id, f.stage, f.title, f.note, file.name, file.mime, file.size, file.sha, now, b.publish ? now : null, u.id, now, now).lastInsertRowid;
    const m = db.prepare('SELECT * FROM materials WHERE id=?').get(id);
    audit(u, 'create', 'material', id, { section: f.section, summary: `رفع مذكرة «${f.title}» (${file.name}) لـ ${target(m)}${b.publish ? ' ونشرها' : ' مسودة'}`, after: { ...json(m), sha256: file.sha } });
    return { material: json(m, u), notified: announce(m, false) };
  }));

  const own = (req) => {
    const m = db.prepare('SELECT * FROM materials WHERE id=? AND deleted_at IS NULL').get(+req.params.id);
    if (!m || !canSee(m, req.user)) throw new Bad('المذكرة غير موجودة', 404);
    if (!canEdit(m, req.user)) throw new Bad('لا تملك صلاحية تعديل هذه المذكرة', 403);
    return m;
  };
  // تعديل البيانات أو الجمهور أو حالة النشر. توسيع جمهور مذكرة منشورة يشعر من أُضيفوا فقط
  app.put('/api/admin/materials/:id', need(canManage), wrap((req) => {
    const old = own(req), u = req.user, b = req.body || {};
    const f = fields(b, u, old);
    const pub = b.publish === undefined ? old.published_at : b.publish ? old.published_at || Date.now() : null;
    db.prepare('UPDATE materials SET section=?, branch=?, curriculum_id=?, category_id=?, stage=?, title=?, note=?, published_at=?, updated_at=? WHERE id=?')
      .run(f.section, f.branch, f.curriculum_id, f.category_id, f.stage, f.title, f.note, pub, Date.now(), old.id);
    const m = db.prepare('SELECT * FROM materials WHERE id=?').get(old.id);
    const st = !old.published_at && pub ? 'ونشرها' : old.published_at && !pub ? 'وإيقاف نشرها' : '';
    audit(u, 'update', 'material', m.id, { section: m.section, summary: `تعديل مذكرة «${m.title}»${st ? ' ' + st : ''}`, before: json(old), after: json(m) });
    return { material: json(m, u), notified: announce(m, m.version > 1) };
  }));
  // استبدال الملف بنسخة محدّثة: ترتفع نسخة المذكرة ويُشعَر من نشرت لهم
  app.put('/api/admin/materials/:id/file', need(canManage), wrap((req) => {
    const old = own(req), u = req.user, file = readFile((req.body || {}).file);
    if (file.sha === old.sha256) throw new Bad('هذا هو الملف الحالي نفسه', 409);
    db.prepare('UPDATE materials SET file_name=?, mime=?, size=?, sha256=?, version=version+1, file_at=?, updated_at=? WHERE id=?').run(file.name, file.mime, file.size, file.sha, Date.now(), Date.now(), old.id);
    const m = db.prepare('SELECT * FROM materials WHERE id=?').get(old.id);
    audit(u, 'update', 'material', m.id, { section: m.section, summary: `استبدال ملف مذكرة «${m.title}»: ${old.file_name} ← ${file.name} (النسخة ${m.version})`, before: { fileName: old.file_name, sha256: old.sha256 }, after: { fileName: file.name, sha256: file.sha } });
    return { material: json(m, u), notified: announce(m, true) };
  }));
  // الحذف يخفي المذكرة عن الجميع، ويبقى أثرها في سجل التدقيق
  app.delete('/api/admin/materials/:id', need(canManage), wrap((req) => {
    const m = own(req);
    db.prepare('UPDATE materials SET deleted_at=?, updated_at=? WHERE id=?').run(Date.now(), Date.now(), m.id);
    audit(req.user, 'delete', 'material', m.id, { section: m.section, summary: `حذف مذكرة «${m.title}»`, before: json(m) });
    return { ok: true };
  }));

  // ---------- التنزيل ----------
  app.get('/api/materials/:id/file', (req, res) => {
    try {
      const m = db.prepare('SELECT * FROM materials WHERE id=? AND deleted_at IS NULL').get(+req.params.id);
      if (!m || !canSee(m, req.user)) return res.status(404).json({ error: 'المذكرة غير موجودة' });
      const bytes = store.get(m.sha256);
      if (!bytes) return res.status(410).json({ error: 'تعذّر العثور على ملف المذكرة؛ أبلغ الإدارة' });
      if (req.user.role === 'contestant') {
        const now = Date.now();
        db.prepare('INSERT INTO material_downloads(material_id,user_id,first_at,last_at) VALUES (?,?,?,?) ON CONFLICT(material_id,user_id) DO UPDATE SET last_at=excluded.last_at, count=count+1').run(m.id, req.user.id, now, now);
      }
      const ext = (m.file_name.match(/\.([A-Za-z0-9]+)$/) || [, 'bin'])[1].toLowerCase();
      res.setHeader('Content-Type', m.mime);
      res.setHeader('Content-Disposition', `attachment; filename="material-${m.id}.${ext}"; filename*=UTF-8''${encodeURIComponent(m.file_name)}`);
      res.setHeader('Content-Length', String(bytes.length));
      res.end(bytes);
    } catch (e) { console.error(e); res.status(500).json({ error: 'حدث خطأ في الخادم' }); }
  });

  // ---------- مذكراتي ----------
  app.get('/api/my/materials', need((u) => u.role === 'contestant'), wrap((req) => {
    const c = comp();
    const rows = db.prepare(`SELECT m.*, e.id entry_id, d.last_at dl_at FROM materials m JOIN entries e JOIN registrations r ON r.id=e.registration_id JOIN people p ON p.id=r.person_id
      LEFT JOIN material_downloads d ON d.material_id=m.id AND d.user_id=p.user_id
      WHERE r.comp_id=? AND p.user_id=? AND ${ACTIVE} AND ${MATCH} ORDER BY m.stage, m.id`).all(c.id, req.user.id);
    return { rows: rows.map((m) => ({ ...json(m), entryId: m.entry_id, downloaded: !!m.dl_at, updatedSince: !!m.dl_at && m.file_at > m.dl_at })) };
  }));
}

module.exports = { routes, TYPES, readFile, audience };
