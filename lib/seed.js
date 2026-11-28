'use strict';
// بيانات الدورة المرجعية 2026 كما وردت في وثيقة المواصفات. تُنشأ مرة واحدة عند أول تشغيل فقط،
// ثم تُعدَّل من «إعداد الدورة» في حساب الإدارة العليا. ليست ثوابت في منطق النظام.
const db = require('./db');

const BRANCHES = [
  { code: 'hifz', name: 'الحفظ', registrable: 1, stages: 'تصفيات أولية ثم نهائي',
    intro: 'حفظ مقرر الفئة، أو أحد مسارات الحفظ لكل الأعمار: خمسة أجزاء أو عشرة أجزاء أو كامل القرآن.',
    conditions: 'التلاوة بمرتبة التدوير أو الحدر.\nمراعاة التلاوة برواية حفص عن عاصم (من طريق الشاطبية).\nسيُختبر متسابقو الحفظ في معاني المفردات للسور المقررة.\nمذكرات معاني المفردات متاحة في حساب المتسابق بعد التسجيل.\nيُسمح للمتسابق بالمشاركة في قسم واحد فقط من كل فرع.\nتُستبعد مشاركة الحاصل على المركز الأول في المسابقة الفائتة في نفس الفرع والقسم والفئة.' },
  { code: 'tilawa', name: 'التلاوة', registrable: 1, stages: 'تصفيات أولية ثم قبل نهائي ثم نهائي',
    intro: 'أداء مقطع محدد للفئة في أحد مسارين: الترتيل أو التدوير، ويختار المتسابق مسارًا واحدًا.',
    conditions: 'التلاوة بالمرتبة المطلوبة لكل قسم.\nمراعاة التلاوة برواية حفص عن عاصم (من طريق الشاطبية).\nسيُختبر متسابقو التلاوة في تفسير المقطع المحدد.\nتُلغى مشاركة متسابق التلاوة في حال عدم تقديم اختبار مقطع التفسير.\nمذكرات التفسير متاحة في حساب المتسابق بعد التسجيل.\nيُسمح للمتسابق بالمشاركة في قسم واحد فقط من كل فرع.\nتُستبعد مشاركة الحاصل على المركز الأول في المسابقة الفائتة في نفس الفرع والقسم والفئة.' },
  { code: 'tafsir', name: 'التفسير', registrable: 1, stages: 'اختبار إلكتروني',
    intro: 'اختبار إلكتروني في مقرر مرتبط بالفئة وكتاب مرجعي.',
    conditions: 'يُعلن الكتاب المرجعي ونسخته والصفحات الدقيقة قبل فتح الاختبار.' },
  { code: 'research', name: 'البحث القرآني', registrable: 0, stages: 'آخر موعد لتسليم البحث 31 أغسطس 2026',
    intro: 'يدور البحث حول سورة الأحزاب المباركة، ويُقبل تناول أي موضوع قرآني يتصل بهذه السورة.',
    conditions: 'أمثلة على العناوين (وليس حصرًا): ذات الطابع التحليلي واللغوي والبلاغي؛ التربوي والأخلاقي؛ المرتبطة بالأمن الاجتماعي والستر والعفة؛ ذات الطابع التاريخي؛ المتعلقة بولاية أهل البيت عليهم السلام؛ دراسات مقارنة ونقدية؛ العناوين البحثية الحديثة.\nلغة البحث: اللغة العربية الفصحى، مع الالتزام بالسلامة اللغوية والأسلوب العلمي الرصين.\nحجم البحث: لا يقل عن 10 صفحات ولا يزيد عن 15 صفحة (A4)، بخط Traditional Arabic، حجم 16، وتباعد 1.5.\nالمصادر: يجب توثيق الآيات والأحاديث والمصادر العلمية توثيقًا دقيقًا في الهامش أو قائمة المراجع.\nالأصالة: يشترط أن يكون البحث من إعداد المشارك نفسه، وأي اقتباس يجب أن يُشار إليه بوضوح، ويُستبعد أي بحث منقول كليًا أو جزئيًا دون توثيق.\nيجب أن يكون البحث غير منشور سابقًا، وغير مستفاد من برامج الذكاء الاصطناعي.\nتُرسل المشاركات بصيغة Word على البريد الإلكتروني research.center@iqrasociety.org مع كتابة الاسم الرباعي، الجنس، سنة الميلاد، رقم الاتصال، البلد.' },
];
const ALL3 = ['hifz', 'tilawa', 'tafsir'];
const CATS = [
  { name: 'البراعم', from: 2022, to: 2024, branches: ['hifz'] },
  { name: 'الناشئة', from: 2018, to: 2021, branches: ['hifz'] },
  { name: 'اليافعون', from: 2014, to: 2017, branches: ALL3 },
  { name: 'الشباب', from: 2010, to: 2013, branches: ALL3 },
  { name: 'الكبار', from: null, to: 2009, branches: ALL3 },
];
// [الفرع، المسار، اسم المسار، الفئة أو null لكل الأعمار، المقرر]
// [الفرع، المسار، اسم المسار، الفئة أو null لكل الأعمار، المقرر، المقطع (سورة، من، إلى) للتلاوة]
const CURR = [
  ['hifz', 'cat', 'مقرر الفئة', 'البراعم', 'من سورة القدر إلى سورة الناس'],
  ['hifz', 'cat', 'مقرر الفئة', 'الناشئة', 'الجزء الثلاثون (جزء عمّ)'],
  ['hifz', 'cat', 'مقرر الفئة', 'اليافعون', 'الجزء التاسع والعشرون (جزء تبارك)'],
  ['hifz', 'cat', 'مقرر الفئة', 'الشباب', 'سورة الصافات'],
  ['hifz', 'cat', 'مقرر الفئة', 'الكبار', 'سورة الأحزاب'],
  ['hifz', 'j5', 'حفظ خمسة أجزاء', null, 'من سورة الأحقاف إلى سورة الناس'],
  ['hifz', 'j10', 'حفظ عشرة أجزاء', null, 'من سورة الروم إلى سورة الناس'],
  ['hifz', 'full', 'كامل القرآن', null, 'حفظ القرآن الكريم كاملًا'],
  ['tilawa', 'tartil', 'ترتيل', 'اليافعون', 'سورة الزخرف، الآيات 1 إلى 7', [43, 1, 7]],
  ['tilawa', 'tartil', 'ترتيل', 'الشباب', 'سورة العنكبوت، الآيات 1 إلى 6', [29, 1, 6]],
  ['tilawa', 'tartil', 'ترتيل', 'الكبار', 'سورة القصص، الآيات 1 إلى 5', [28, 1, 5]],
  ['tilawa', 'tadweer', 'تدوير', 'اليافعون', 'سورة ق، الآيات 1 إلى 15', [50, 1, 15]],
  ['tilawa', 'tadweer', 'تدوير', 'الشباب', 'سورة الأحزاب، الآيات 1 إلى 6', [33, 1, 6]],
  ['tilawa', 'tadweer', 'تدوير', 'الكبار', 'سورة النمل، الآيات 1 إلى 13', [27, 1, 13]],
  ['tafsir', 'main', '', 'اليافعون', 'سورتا الفاتحة والنبأ، والصفحات 7 إلى 35 بحسب الإعلان'],
  ['tafsir', 'main', '', 'الشباب', 'سورة الصافات'],
  ['tafsir', 'main', '', 'الكبار', 'سورة الأحزاب'],
];

// اللجان المبدئية للتصفيات: ست لجان في كل قسم، وتُعدَّل من «اللجان»
const COMMITTEES = [
  // لجان الفئات لمقرر الفئة فقط، ولجنة واحدة لمسارات الأجزاء والقرآن لكل الفئات
  ['الحفظ: البراعم والناشئة', 'hifz', ['cat'], ['البراعم', 'الناشئة']],
  ['الحفظ: اليافعون', 'hifz', ['cat'], ['اليافعون']],
  ['الحفظ: الشباب والكبار', 'hifz', ['cat'], ['الشباب', 'الكبار']],
  ['الحفظ: 5 + 10 + القرآن الكريم', 'hifz', ['j5', 'j10', 'full'], []],
  ['الترتيل: اليافعون', 'tilawa', ['tartil'], ['اليافعون']],
  ['الترتيل: الشباب والكبار', 'tilawa', ['tartil'], ['الشباب', 'الكبار']],
  ['التدوير: جميع الفئات', 'tilawa', ['tadweer'], []],
];
// لجان المراحل اللاحقة: لجنة لكل فرع ومسار (تُعدَّل من «اللجان»)
const LATER = [
  ['semi', 'قبل النهائي: الترتيل', 'tilawa', ['tartil']], ['semi', 'قبل النهائي: التدوير', 'tilawa', ['tadweer']],
  ['final', 'نهائي الحفظ', 'hifz', []], ['final', 'النهائي: الترتيل', 'tilawa', ['tartil']], ['final', 'النهائي: التدوير', 'tilawa', ['tadweer']],
];
function seedCommittees(compId) {
  const cats = Object.fromEntries(db.prepare('SELECT id,name FROM categories WHERE comp_id=?').all(compId).map((c) => [c.name, c.id]));
  const now = Date.now();
  const add = (section, stage, name, branch, tracks, catIds, hall, sort) => db.prepare('INSERT INTO committees(comp_id,section,stage,name,branch,tracks,categories,hall,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(compId, section, stage, name, branch, JSON.stringify(tracks), JSON.stringify(catIds), hall, sort, now);
  for (const section of ['M', 'F']) {
    COMMITTEES.forEach(([name, branch, tracks, catNames], i) => add(section, 'prelim', name, branch, tracks, catNames.map((n) => cats[n]).filter(Boolean), 'القاعة ' + (i + 1), i));
    LATER.forEach(([stage, name, branch, tracks], i) => add(section, stage, name, branch, tracks, [], 'القاعة الرئيسية', i));
  }
}

function seedIfEmpty() {
  if (db.prepare('SELECT 1 FROM competitions LIMIT 1').get()) return false;
  const now = Date.now();
  db.transaction(() => {
    const comp = db.prepare(`INSERT INTO competitions(name,number,year,status,min_birth_year,is_current,created_at,updated_at)
      VALUES ('مسابقة اقرأ السنوية',20,2026,'open',1900,1,?,?)`).run(now, now).lastInsertRowid;
    BRANCHES.forEach((b, i) => db.prepare('INSERT INTO branches(comp_id,code,name,intro,conditions,stages,registrable,sort) VALUES (?,?,?,?,?,?,?,?)')
      .run(comp, b.code, b.name, b.intro, b.conditions, b.stages, b.registrable, i));
    const catId = {};
    CATS.forEach((c, i) => { catId[c.name] = db.prepare('INSERT INTO categories(comp_id,name,from_year,to_year,branches,sort) VALUES (?,?,?,?,?,?)').run(comp, c.name, c.from, c.to, JSON.stringify(c.branches), i).lastInsertRowid; });
    CURR.forEach(([b, t, tn, cat, content, pas], i) => db.prepare('INSERT INTO curricula(comp_id,branch,track,track_name,category_id,content,surah,ayah_from,ayah_to,sort) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(comp, b, t, tn, cat ? catId[cat] : null, content, ...(pas || [null, null, null]), i));
    seedCommittees(comp);
    db.prepare("INSERT INTO audit(at,action,entity,entity_id,summary) VALUES (?,'seed','competition',?,'إنشاء الدورة المرجعية 2026 من وثيقة المواصفات')").run(now, comp);
  })();
  return true;
}

// نسخ إعدادات دورة إلى دورة جديدة (الفروع والفئات والمقررات) دون أي تسجيلات
function copyCompetition(fromId, { name, number, year }) {
  const now = Date.now();
  return db.transaction(() => {
    const src = db.prepare('SELECT * FROM competitions WHERE id=?').get(fromId);
    const id = db.prepare(`INSERT INTO competitions(name,number,year,status,min_birth_year,is_current,notes,created_at,updated_at)
      VALUES (?,?,?,'draft',?,0,?,?,?)`).run(name, number, year, src.min_birth_year, src.notes, now, now).lastInsertRowid;
    for (const b of db.prepare('SELECT * FROM branches WHERE comp_id=?').all(fromId))
      db.prepare('INSERT INTO branches(comp_id,code,name,intro,conditions,stages,registrable,sort) VALUES (?,?,?,?,?,?,?,?)').run(id, b.code, b.name, b.intro, b.conditions, b.stages, b.registrable, b.sort);
    const map = {};
    for (const c of db.prepare('SELECT * FROM categories WHERE comp_id=?').all(fromId))
      map[c.id] = db.prepare('INSERT INTO categories(comp_id,name,from_year,to_year,branches,sort) VALUES (?,?,?,?,?,?)').run(id, c.name, c.from_year, c.to_year, c.branches, c.sort).lastInsertRowid;
    for (const c of db.prepare('SELECT * FROM curricula WHERE comp_id=?').all(fromId))
      db.prepare('INSERT INTO curricula(comp_id,branch,track,track_name,category_id,content,surah,ayah_from,ayah_to,sort) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, c.branch, c.track, c.track_name, c.category_id == null ? null : map[c.category_id], c.content, c.surah, c.ayah_from, c.ayah_to, c.sort);
    for (const c of db.prepare('SELECT * FROM committees WHERE comp_id=?').all(fromId))
      db.prepare('INSERT INTO committees(comp_id,section,stage,name,branch,tracks,categories,hall,active,sort,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, c.section, c.stage, c.name, c.branch, c.tracks, JSON.stringify(JSON.parse(c.categories).map((x) => map[x]).filter(Boolean)), c.hall, c.active, c.sort, now);
    db.prepare('UPDATE competitions SET is_current=0').run();
    db.prepare('UPDATE competitions SET is_current=1 WHERE id=?').run(id);
    return id;
  })();
}

module.exports = { seedIfEmpty, copyCompetition, seedCommittees };
