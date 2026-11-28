'use strict';
// بيانات التجربة قبل التدشين: متسابقون وهميون في كل الأقسام والفئات والفروع والمسارات، يُعلَّمون «تجريبي»،
// ويُحذفون مع كل ما يتعلق بهم بضغطة واحدة قبل الإطلاق. الإعداد (الدورة والفئات والمقررات واللجان والحسابات والبنوك) لا يُمس.
const crypto = require('crypto');
const db = require('./db');
const R = require('./rules');
const auth = require('./auth');
const { SECTIONS, Bad, wrap, need, audit, isTop, comp } = require('./util');

const MALE = ['محمد', 'أحمد', 'علي', 'حسن', 'حسين', 'عبدالله', 'يوسف', 'إبراهيم', 'عيسى', 'خالد', 'سلمان', 'جعفر', 'عباس', 'مهدي', 'صالح', 'حمزة', 'زكريا', 'ياسر', 'مصطفى', 'هاشم', 'سيد رضا', 'منتظر', 'قاسم', 'جاسم', 'محمود', 'عمار', 'باقر', 'كميل', 'مجتبى', 'سجاد'];
const FEMALE = ['فاطمة', 'زينب', 'مريم', 'زهراء', 'نور', 'سارة', 'رقية', 'آمنة', 'خديجة', 'حوراء', 'بتول', 'كوثر', 'ريحانة', 'هدى', 'إيمان', 'ملاك', 'جنان', 'دعاء', 'ليلى', 'سكينة', 'نرجس', 'أسماء', 'رباب', 'زهرة', 'منى', 'ضحى', 'شهد', 'تسنيم', 'يقين', 'آيات'];
const FAMILY = ['العلوي', 'الموسوي', 'الشهابي', 'العرادي', 'الستراوي', 'الجمري', 'البحراني', 'المحروس', 'الحايكي', 'العصفور', 'الدرازي', 'الماحوزي', 'السماهيجي', 'التوبلاني', 'الصفار', 'المؤمن', 'الخياط', 'النجار', 'القصاب', 'الحداد', 'السعيد', 'الجشي', 'الكاظم', 'المدني', 'البصري'];
const pick = (a) => a[crypto.randomInt(a.length)];
const fullName = (sec) => `${pick(sec === 'F' ? FEMALE : MALE)} ${pick(MALE)} ${pick(MALE)} ${pick(FAMILY)}`;
const BRANCHES = new Set(['hifz', 'tilawa', 'tafsir']);

// كل المتسابقين التجريبيين (لا يُنشؤون إلا في الدورة الحالية، ويُحذفون جميعًا)
const testPeople = () => db.prepare('SELECT * FROM people WHERE is_test=1 ORDER BY id').all();

function summary(compId) {
  const ps = testPeople(), ids = ps.map((p) => p.id);
  const by = { M: 0, F: 0 }, entries = {};
  for (const r of ids.length ? db.prepare(`SELECT r.section, e.branch_name, COUNT(*) n FROM registrations r JOIN entries e ON e.registration_id=r.id WHERE r.comp_id=? AND r.person_id IN (${ids.map(() => '?').join(',')}) AND e.status='active' GROUP BY r.section, e.branch_name`).all(compId, ...ids) : []) {
    entries[r.branch_name] = (entries[r.branch_name] || 0) + r.n;
  }
  for (const r of ids.length ? db.prepare(`SELECT section, COUNT(*) n FROM registrations WHERE comp_id=? AND person_id IN (${ids.map(() => '?').join(',')}) GROUP BY section`).all(compId, ...ids) : []) by[r.section] = r.n;
  return { people: ps.length, bySection: by, entries };
}

function generate(u, per, sections, password, mixRatio) {
  const c = comp();
  const hash = auth.hashPassword(password), now = Date.now();
  const cats = R.categoriesOf(c.id);
  // سنوات ميلاد تقع في كل فئة
  const years = new Map(cats.map((k) => [k.id, []]));
  for (let y = c.min_birth_year || 1950; y <= R.thisYear(); y++) { const r = R.categoryFor(c, y); if (r.category) years.get(r.category.id).push(y); }
  let seq = (db.prepare("SELECT MAX(CAST(substr(national_id,4) AS INTEGER)) n FROM people WHERE national_id LIKE '99_%' AND is_test=1").get().n || 0);
  const newId = (sec) => { for (;;) { seq++; const nid = `99${sec === 'M' ? 1 : 2}${String(seq).padStart(7, '0')}`; if (!db.prepare('SELECT 1 FROM people WHERE national_id=? UNION SELECT 1 FROM users WHERE login=?').get(nid, nid)) return nid; } };
  let made = 0, entriesMade = 0;
  db.transaction(() => {
    for (const sec of sections) for (const k of cats) {
      const ys = years.get(k.id); if (!ys.length) continue;
      const opts = R.optionsFor(c, k).filter((b) => BRANCHES.has(b.code));
      for (const br of opts) for (const tr of br.tracks) for (let i = 0; i < per; i++) {
        const nid = newId(sec), name = fullName(sec), phone = `0000${String(made).padStart(4, '0')}`, year = pick(ys);
        const uid = db.prepare("INSERT INTO users(login,name,phone,email,role,pass_hash,must_change,created_at) VALUES (?,?,?,'','contestant',?,0,?)").run(nid, name, phone, hash, now).lastInsertRowid;
        const pid = db.prepare('INSERT INTO people(user_id,national_id,full_name,phone,birth_year,gender,is_test,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)').run(uid, nid, name, phone, year, sec, now, now).lastInsertRowid;
        const rid = db.prepare(`INSERT INTO registrations(comp_id,person_id,section,category_id,category_name,birth_year,status,created_at,updated_at) VALUES (?,?,?,?,?,?,'accepted',?,?)`)
          .run(c.id, pid, sec, k.id, k.name, year, now + made, now + made).lastInsertRowid;
        const chosen = [{ br, tr }];
        // نسبة من المتسابقين في فرع ثانٍ، لتجربة الجمع في يوم واحد وتعدد المشاركات
        if (crypto.randomInt(100) < mixRatio) { const others = opts.filter((o) => o.code !== br.code); if (others.length) { const o = pick(others); chosen.push({ br: o, tr: pick(o.tracks) }); } }
        for (const x of chosen) {
          db.prepare(`INSERT INTO entries(registration_id,branch,branch_name,track,track_name,curriculum_id,curriculum_text,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?)`)
            .run(rid, x.br.code, x.br.name, x.tr.track, x.tr.trackName, x.tr.curriculumId, x.tr.content, now, now);
          entriesMade++;
        }
        made++;
      }
    }
    audit(u, 'create', 'trial', null, { summary: `إنشاء ${made} متسابقًا تجريبيًا (${entriesMade} مشاركة) في ${sections.map((s) => SECTIONS[s]).join(' و')}، ${per} لكل مقرر وفئة` });
  })();
  return { people: made, entries: entriesMade };
}

// حذف المتسابقين التجريبيين وكل ما يخصهم. كشوف النتائج التي تضم أحدًا منهم تُحذف مع قرارات تأهلها
function clear(u) {
  const c = comp();
  const P = testPeople().map((p) => p.id);
  if (!P.length) return { people: 0 };
  const inn = (a) => `(${a.map(() => '?').join(',')})`;
  const U = db.prepare(`SELECT user_id FROM people WHERE id IN ${inn(P)} AND user_id IS NOT NULL`).all(...P).map((x) => x.user_id);
  const Rg = db.prepare(`SELECT id FROM registrations WHERE person_id IN ${inn(P)}`).all(...P).map((x) => x.id);
  const E = Rg.length ? db.prepare(`SELECT id FROM entries WHERE registration_id IN ${inn(Rg)}`).all(...Rg).map((x) => x.id) : [];
  const run = (sql, ids) => (ids.length ? db.prepare(sql.replace('$', inn(ids))).run(...ids).changes : 0);
  let sheets = 0;
  db.transaction(() => {
    const Es = new Set(E);
    const S = db.prepare('SELECT id, rows FROM result_sheets WHERE comp_id=?').all(c.id).filter((s) => { try { return JSON.parse(s.rows).some((r) => Es.has(r.entryId)); } catch (e) { return false; } }).map((s) => s.id);
    run('DELETE FROM qualifications WHERE sheet_id IN $', S); sheets = run('DELETE FROM result_sheets WHERE id IN $', S);
    run('DELETE FROM qualifications WHERE entry_id IN $', E);
    const T = E.length ? db.prepare(`SELECT id FROM tickets WHERE entry_id IN ${inn(E)}`).all(...E).map((x) => x.id) : [];
    run('DELETE FROM call_events WHERE ticket_id IN $', T); run('DELETE FROM tickets WHERE id IN $', T);
    const Ev = E.length ? db.prepare(`SELECT id FROM evaluations WHERE entry_id IN ${inn(E)}`).all(...E).map((x) => x.id) : [];
    run('DELETE FROM evaluation_revisions WHERE evaluation_id IN $', Ev); run('DELETE FROM evaluations WHERE id IN $', Ev);
    run('DELETE FROM passage_draws WHERE entry_id IN $', E); run('DELETE FROM day_assign WHERE entry_id IN $', E);
    run('DELETE FROM test_attempts WHERE person_id IN $', P);
    const N = U.length ? db.prepare(`SELECT id FROM notifications WHERE user_id IN ${inn(U)}`).all(...U).map((x) => x.id) : [];
    run('DELETE FROM deliveries WHERE notification_id IN $', N); run('DELETE FROM notifications WHERE id IN $', N);
    run('DELETE FROM material_downloads WHERE user_id IN $', U); run('DELETE FROM sessions WHERE user_id IN $', U);
    run('DELETE FROM entries WHERE id IN $', E); run('DELETE FROM registrations WHERE id IN $', Rg);
    run('DELETE FROM people WHERE id IN $', P); run('DELETE FROM users WHERE id IN $', U);
    audit(u, 'delete', 'trial', null, { summary: `حذف بيانات التجربة: ${P.length} متسابقًا و${E.length} مشاركة${sheets ? `، و${sheets} كشف نتائج ضمّهم` : ''}` });
  })();
  return { people: P.length, entries: E.length, sheets };
}

function routes(app) {
  app.get('/api/admin/trial', need(isTop), wrap(() => summary(comp().id)));
  app.post('/api/admin/trial', need(isTop), wrap((req) => {
    const b = req.body || {}, per = parseInt(b.perGroup, 10), mix = b.mixRatio === undefined ? 30 : parseInt(b.mixRatio, 10);
    if (!(per >= 1 && per <= 20)) throw new Bad('العدد لكل مقرر وفئة من 1 إلى 20');
    const sections = (Array.isArray(b.sections) ? b.sections : ['M', 'F']).filter((s) => SECTIONS[s]);
    if (!sections.length) throw new Bad('اختر قسمًا واحدًا على الأقل');
    const pw = String(b.password || '');
    const prob = auth.passwordProblem(pw); if (prob) throw new Bad(prob);
    if (!(mix >= 0 && mix <= 100)) throw new Bad('نسبة المشاركة في فرعين من 0 إلى 100');
    const r = generate(req.user, per, sections, pw, mix);
    return { ...r, totals: summary(comp().id) };
  }));
  app.post('/api/admin/trial/clear', need(isTop), wrap((req) => {
    if ((req.body || {}).confirm !== 'حذف بيانات التجربة') throw new Bad('اكتب «حذف بيانات التجربة» للتأكيد');
    return clear(req.user);
  }));
  app.get('/api/admin/trial.xlsx', need(isTop), (req, res) => {
    try {
      const c = comp(), P = testPeople();
      const rows = [['القسم', 'الاسم', 'رقم الهوية (اسم الدخول)', 'الهاتف', 'سنة الميلاد', 'الفئة', 'المشاركات']];
      for (const p of P) {
        const r = db.prepare('SELECT * FROM registrations WHERE person_id=? AND comp_id=?').get(p.id, c.id); if (!r) continue;
        rows.push([SECTIONS[r.section], p.full_name, p.national_id, p.phone, r.birth_year, r.category_name,
          db.prepare("SELECT branch_name, track_name FROM entries WHERE registration_id=? AND status='active'").all(r.id).map((e) => e.branch_name + (e.track_name ? ' · ' + e.track_name : '')).join(' | ')]);
      }
      require('./draws').sendXlsx(res, 'iqra-trial-accounts.xlsx', [{ name: 'حسابات التجربة', rows }]);
    } catch (e) { console.error(e); res.status(500).json({ error: 'حدث خطأ في الخادم' }); }
  });
}

module.exports = { routes, generate, clear, summary };
