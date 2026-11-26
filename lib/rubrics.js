'use strict';
// استمارات التحكيم ومحرك الدرجات. يحفظ النظام الدرجة الخام ورصيدها، ويحوّلها إلى وزن المرحلة عند التجميع.
// المصدر: استمارات الجمعية (الحفظ: جودة الحفظ، التجويد والوقف، الصوت والنغم)، ووثيقة المواصفات للتلاوة،
// والأوزان المعتمدة في docs/decisions.md.
const quran = require('./quran.json');

const half = (min, max) => { const out = []; for (let v = min; v <= max + 1e-9; v += 0.5) out.push(+v.toFixed(1)); return out; };
const r6 = (x) => Math.round(x * 1e6) / 1e6;

const RUBRICS = {
  hifz_quality: {
    title: 'استمارة تحكيم الحفظ — جودة الحفظ', branch: 'hifz', kind: 'segments', segments: 3, base: 70,
    note: 'يُرصد عدد الأخطاء في كل مقطع. تُجمع خصومات المقاطع الثلاثة وتُخصم مرة واحدة من 70.',
    groups: [{ key: 'hifz', base: 70, items: [
      { k: 'haraka_t', n: 'الحركة أو الحرف', col: 'تدارك', d: 1 }, { k: 'haraka_s', n: 'الحركة أو الحرف', col: 'صحح له الحكم', d: 2 },
      { k: 'kalima_t', n: 'الكلمة', col: 'تدارك', d: 1.5 }, { k: 'kalima_s', n: 'الكلمة', col: 'صحح له الحكم', d: 2.5 },
      { k: 'ibara_t', n: 'العبارة', col: 'تدارك', d: 2 }, { k: 'ibara_s', n: 'العبارة', col: 'صحح له الحكم', d: 3 },
      { k: 'ayat_t', n: 'الآيات', col: 'تدارك', d: 1 }, { k: 'ayat_s', n: 'الآيات', col: 'صحح له الحكم', d: 2 },
      { k: 'taraddud', n: 'التردد أو التوقف أو التكرار', col: '', d: 0.5 },
    ] }],
    // معاني المفردات: خيار حصري، وتُضاف فوق المجموع (قرار الجمعية)
    extra: { k: 'vocab', n: 'معاني المفردات', options: [0, 4, 7, 10], max: 10 }, // صفر لمن لم يُجب (قرار الجمعية)
  },
  hifz_tajweed: {
    title: 'استمارة تحكيم التجويد والوقف والابتداء — فرع الحفظ', branch: 'hifz', kind: 'segments', segments: 3, base: 40,
    note: 'تُجمع خصومات كل قسم على حدة: التجويد من 30 والوقف والابتداء من 10، بحد أدنى صفر لكل منهما.',
    groups: [
      { key: 'tajweed', n: 'التجويد', base: 30, items: [
        { k: 'sifat_khalal', n: 'الصفات اللازمة والعارضة', col: 'زيادة أو نقصان أو خلل', d: 0.5 },
        { k: 'sifat_tark', n: 'الصفات اللازمة والعارضة', col: 'ترك', d: 1 },
        { k: 'daqaiq', n: 'دقائق التجويد', col: 'بنية الحروف، مساواة الغن ونحوها، الحركات والسواكن، أخرى', d: 0.5 },
      ] },
      { key: 'waqf', n: 'الوقف والابتداء', base: 10, items: [
        { k: 'qabih', n: 'الوقف والابتداء', col: 'القبيح', d: 1 },
        { k: 'naqis', n: 'الوقف والابتداء', col: 'ناقص أو ضعيف', d: 0.5 },
        { k: 'sariqa', n: 'الوقف والابتداء', col: 'سرقة نفس', d: 0.5 },
      ] },
    ],
  },
  hifz_voice: {
    title: 'استمارة تحكيم الصوت والنغم — حفظ', branch: 'hifz', kind: 'criteria', base: 100,
    note: 'يُختار لكل معيار درجة من نصف درجته إلى كاملها بفارق نصف درجة، ثم تُخصم درجة لكل مورد.',
    criteria: [
      { k: 'jamal', n: 'جمالية الصوت', group: 'معايير الصوت', max: 20, desc: 'الجمال والعذوبة واللطافة والتأثير من المعايير الإيجابية، وأما الخشونة والخنة والجرس القبيح والبحة الشديدة وذهاب الصوت وغلظته المستمرة من المعايير السلبية' },
      { k: 'murunah', n: 'مرونة الصوت', group: 'معايير الصوت', max: 10, desc: 'صحة التنقل بين الدرجات الصوتية والتحكم السليم في الزخارف الصوتية والعرب' },
      { k: 'masaha', n: 'مساحة الصوت', group: 'معايير الصوت', max: 10, desc: 'أوكتاف 5، أوكتاف ونصف 8، +1 لأغلظ درجة، +1 لأعلى درجة' },
      { k: 'adaa', n: 'جمالية الأداء', group: 'معايير النغم', max: 30, desc: 'التحزين والعذوبة والجاذبية، وجمال النغمات والأبعاد الصوتية المختارة' },
      { k: 'maqamat', n: 'تنوع المقامات', group: 'معايير النغم', max: 20, desc: 'تنوع المقامات' },
      { k: 'tawzi', n: 'التوزيع النغمي', group: 'معايير النغم', max: 10, desc: 'التوزيع المنشود للحن على بناء الكلمات، والحفاظ على النبر الصحيح للكلمات' },
    ],
    deductions: [{ k: 'nashaz', n: 'النشاز' }, { k: 'ashwaiya', n: 'العشوائية والتكلف' }, { k: 'tawazun', n: 'توازن التلاوة' }],
  },
  tilawa_tajweed: {
    title: 'استمارة تحكيم التجويد — التلاوة', branch: 'tilawa', kind: 'matrix',
    // الأرصدة الأصلية في الاستمارات؛ تُحوَّل نسبيًا إلى وزن المرحلة. النهائي: 45 للترتيل و60 للتدوير (ملاحظة الاستمارة)
    base: { tartil: 50, tadweer: 65 }, baseByStage: { final: { tartil: 45, tadweer: 60 } },
    note: 'تُرصد الأخطاء لكل آية. تُجمع خصومات آيات المقطع وتُخصم من رصيد الاستمارة بحد أدنى صفر. ملاحظات الوقف وصفية لا تنتج خصمًا.',
    cols: [
      { k: 'jali_t', n: 'خطأ جلي', col: 'تدارك', d: 2 }, { k: 'jali_f', n: 'خطأ جلي', col: 'فتح', d: 3 },
      { k: 'lazim_tark', n: 'الصفات اللازمة', col: 'ترك', d: 1 }, { k: 'lazim_ikhlal', n: 'الصفات اللازمة', col: 'إخلال', d: 0.5 },
      { k: 'arid_tark', n: 'الصفات العارضة', col: 'ترك', d: 1 }, { k: 'arid_ikhlal', n: 'الصفات العارضة', col: 'إخلال', d: 0.5 },
      { k: 'majhula', n: 'الحركة المجهولة', col: '', d: 0.5 },
    ],
  },
  // استمارة الوقف والابتداء المستقلة لقبل النهائي والنهائي (D03 لم يُعتمد بعد): مؤقتًا ببنود الوقف في استمارة الحفظ، من 10
  tilawa_waqf: {
    title: 'استمارة تحكيم الوقف والابتداء — التلاوة', branch: 'tilawa', kind: 'segments', segments: 1, base: 10, provisional: true,
    note: 'استمارة مؤقتة ببنود الوقف والابتداء في استمارة الحفظ، حتى تعتمد الجمعية بنودها ورصيدها (D03).',
    groups: [{ key: 'waqf', n: 'الوقف والابتداء', base: 10, items: [
      { k: 'qabih', n: 'الوقف والابتداء', col: 'القبيح', d: 1 },
      { k: 'naqis', n: 'الوقف والابتداء', col: 'ناقص أو ضعيف', d: 0.5 },
      { k: 'sariqa', n: 'الوقف والابتداء', col: 'سرقة نفس', d: 0.5 },
    ] }],
  },
  tilawa_voice: {
    title: 'استمارة تحكيم الصوت والنغم — التلاوة', branch: 'tilawa', kind: 'criteria', base: 100,
    note: 'لكل معيار درجة من 5 إلى 10 بفارق نصف درجة، ثم تُخصم درجة لكل مورد.',
    criteria: [
      ['jamal', 'جمالية الصوت', 'جمال الصوت وعذوبته وطلاقة أدائه وتأثيره'], ['murunah', 'مرونة الصوت', 'التنقل بين الدرجات والتحكم في الزخارف والعرب'],
      ['masaha', 'مساحة الصوت', 'أوكتاف 4، أوكتاف ونصف 6.5، أوكتافان 8، ثم درجتان للأطراف'], ['shidda', 'شدة الصوت', 'القوة والوضوح وحسن التوظيف'],
      ['adaa', 'جمالية الأداء', 'التحزين والعذوبة وجمال النغم والأبعاد'], ['itqan', 'التمكن والإتقان', 'التحكم والتنغيم وأداء النغمات الصعبة بإتقان'],
      ['tadarruj', 'التدرج والتنوع', 'التنوع السلس في الطبقات والألحان وتجنب التكرار الممل'], ['tawzi', 'التوزيع النغمي', 'مناسبة اللحن لبناء الكلمات وصحة النبر'],
      ['qaflat', 'تنوع القفلات', 'إجادتها وتنوعها دون تكرار ممل'], ['taathir', 'المناسبة والتأثير', 'إلقاء المعنى بالتنغيم والتأثر والتأثير'],
    ].map(([k, n, desc]) => ({ k, n, max: 10, min: 5, desc })),
    deductions: [{ k: 'nashaz', n: 'النشاز' }, { k: 'takalluf', n: 'التكلف' }, { k: 'tawazun', n: 'توازن التلاوة' }],
  },
};
for (const r of Object.values(RUBRICS)) if (r.kind === 'criteria') for (const c of r.criteria) c.options = half(c.min ?? c.max / 2, c.max);

// تخصص المحكم ← الاستمارة والخانة، بحسب الفرع والمرحلة
const HIFZ = { 'محكم جودة الحفظ الأول': ['hifz_quality', 1], 'محكم جودة الحفظ الثاني': ['hifz_quality', 2], 'محكم التجويد الأول': ['hifz_tajweed', 1], 'محكم الصوت والنغم': ['hifz_voice', 1] };
const TIL1 = { 'محكم التجويد الأول': ['tilawa_tajweed', 1], 'محكم التجويد الثاني': ['tilawa_tajweed', 2], 'محكم الصوت والنغم': ['tilawa_voice', 1] };
const TIL2 = { ...TIL1, 'محكم الصوت والنغم الثاني': ['tilawa_voice', 2], 'محكم الوقف والابتداء': ['tilawa_waqf', 1] };
const SPEC_MAP = { prelim: { hifz: HIFZ, tilawa: TIL1 }, semi: { tilawa: TIL2 }, final: { hifz: HIFZ, tilawa: TIL2 } };
const rubricFor = (branch, specialty, stage = 'prelim') => ((SPEC_MAP[stage] || {})[branch] || {})[specialty] || null;
// المرحلة التالية لكل فرع
const NEXT = { hifz: { prelim: 'final' }, tilawa: { prelim: 'semi', semi: 'final' } };
const nextStage = (branch, stage) => (NEXT[branch] || {})[stage] || null;
const branchStages = (branch) => (branch === 'tilawa' ? ['prelim', 'semi', 'final'] : branch === 'hifz' ? ['prelim', 'final'] : ['prelim']);

// أوزان التصفيات الأولية المعتمدة. avg = الخانات التي يُحتسب متوسطها
const WEIGHTS = {
  prelim: {
    hifz: { max: 110, parts: [
      { key: 'hifz', n: 'جودة الحفظ', rubric: 'hifz_quality', slots: [1, 2], weight: 70 },
      { key: 'tajweed', n: 'التجويد والوقف', rubric: 'hifz_tajweed', slots: [1], weight: 20 },
      { key: 'voice', n: 'الصوت والنغم', rubric: 'hifz_voice', slots: [1], weight: 10 },
      { key: 'vocab', n: 'معاني المفردات', rubric: 'hifz_quality', slots: [1, 2], weight: 10, extra: true },
    ] },
    tilawa: { max: 100, parts: [
      { key: 'tajweed', n: 'التجويد', rubric: 'tilawa_tajweed', slots: [1, 2], weight: 50 },
      { key: 'voice', n: 'الصوت والنغم', rubric: 'tilawa_voice', slots: [1], weight: 50 },
    ] },
  },
  // درجة المرحلة السابقة = نسبتها المعتمدة × الوزن (prev)
  semi: {
    tilawa: { max: 100, parts: [
      { key: 'tajweed', n: 'التجويد', rubric: 'tilawa_tajweed', slots: [1, 2], weight: 40 },
      { key: 'voice', n: 'الصوت والنغم', rubric: 'tilawa_voice', slots: [1, 2], weight: 40 },
      { key: 'waqf', n: 'الوقف والابتداء', rubric: 'tilawa_waqf', slots: [1], weight: 10 },
      { key: 'p1', n: 'درجة التصفيات', prev: 'prelim', weight: 10 },
    ] },
  },
  final: {
    hifz: { max: 110, parts: [
      { key: 'hifz', n: 'جودة الحفظ', rubric: 'hifz_quality', slots: [1, 2], weight: 65 },
      { key: 'tajweed', n: 'التجويد والوقف', rubric: 'hifz_tajweed', slots: [1], weight: 15 },
      { key: 'voice', n: 'الصوت والنغم', rubric: 'hifz_voice', slots: [1], weight: 10 },
      { key: 'p1', n: 'درجة التصفيات', prev: 'prelim', weight: 10 },
      { key: 'vocab', n: 'معاني المفردات', rubric: 'hifz_quality', slots: [1, 2], weight: 10, extra: true },
    ] },
    tilawa: { max: 100, parts: [
      { key: 'tajweed', n: 'التجويد', rubric: 'tilawa_tajweed', slots: [1, 2], weight: 36 },
      { key: 'voice', n: 'الصوت والنغم', rubric: 'tilawa_voice', slots: [1, 2], weight: 36 },
      { key: 'waqf', n: 'الوقف والابتداء', rubric: 'tilawa_waqf', slots: [1], weight: 8 },
      { key: 'p1', n: 'درجة التصفيات', prev: 'prelim', weight: 10 },
      { key: 'p2', n: 'درجة قبل النهائي', prev: 'semi', weight: 10 },
    ] },
  },
};

const MAX_COUNT = 999;
const count = (v) => { const n = Number(v ?? 0); return Number.isInteger(n) && n >= 0 && n <= MAX_COUNT ? n : NaN; };

// المقطع: نص الآيات من مصدر تنزيل كما ورد، دون تعديل
function passage(surah, from, to) {
  const s = quran.surahs[surah - 1];
  if (!s || !(from >= 1) || !(to >= from) || to > s.ayat.length) return null;
  return { surah, name: s.name, from, to, bismillah: s.bismillah && from === 1 ? quran.bismillah : '', ayat: s.ayat.slice(from - 1, to).map((t, i) => ({ n: from + i, text: t })) };
}
const surahList = () => quran.surahs.map((s) => ({ n: s.n, name: s.name, ayat: s.ayat.length }));

// يحسب الدرجة الخام ويتحقق من القيم. strict = عند الإرسال
// يعيد { raw, base, extra, detail, errors }
function compute(key, data, ctx = {}, strict = false) {
  const R = RUBRICS[key], errors = [], d = data && typeof data === 'object' ? data : {};
  if (!R) return { errors: ['استمارة غير معروفة'] };
  if (R.kind === 'segments') {
    const segs = Array.isArray(d.segments) ? d.segments : [];
    const detail = { groups: {} };
    let raw = 0;
    for (const g of R.groups) {
      let ded = 0;
      for (let i = 0; i < R.segments; i++) for (const it of g.items) {
        const c = count((segs[i] || {})[it.k]);
        if (Number.isNaN(c)) { errors.push(`عدد غير صحيح في المقطع ${i + 1}: ${it.n} ${it.col}`); continue; }
        ded += c * it.d;
      }
      const net = Math.max(0, g.base - ded);
      detail.groups[g.key] = { base: g.base, deductions: r6(ded), net: r6(net) };
      raw += net;
    }
    let extra = null;
    if (R.extra) {
      const v = d[R.extra.k];
      if (v === undefined || v === null || v === '') { if (strict) errors.push(`اختر درجة ${R.extra.n}`); }
      else if (!R.extra.options.includes(Number(v))) errors.push(`${R.extra.n}: القيم المسموحة ${R.extra.options.join(' أو ')}`);
      else extra = Number(v);
    }
    return { raw: r6(raw), base: R.base, extra, detail, errors };
  }
  if (R.kind === 'criteria') {
    let sum = 0, missing = 0;
    for (const c of R.criteria) {
      const v = d[c.k];
      if (v === undefined || v === null || v === '') { missing++; continue; }
      const n = Number(v);
      if (!c.options.includes(n)) { errors.push(`${c.n}: اختر قيمة من ${c.options[0]} إلى ${c.max} بفارق نصف درجة`); continue; }
      sum += n;
    }
    if (strict && missing) errors.push(`اختر الدرجة لكل المعايير (${missing} بلا اختيار)`);
    let ded = 0;
    for (const x of R.deductions) { const c = count((d.deductions || {})[x.k]); if (Number.isNaN(c)) errors.push(`عدد غير صحيح: ${x.n}`); else ded += c; }
    return { raw: r6(Math.max(0, sum - ded)), base: R.base, extra: null, detail: { sum: r6(sum), deductions: ded, missing }, errors };
  }
  if (R.kind === 'matrix') {
    const base = ((R.baseByStage || {})[ctx.stage] || R.base)[ctx.track];
    if (!base) return { errors: ['لا يوجد رصيد لهذا المسار'] };
    const rows = d.rows && typeof d.rows === 'object' ? d.rows : {};
    const ayat = ctx.ayat || [];
    let ded = 0;
    for (const k of Object.keys(rows)) if (!ayat.includes(Number(k))) errors.push(`الآية ${k} خارج المقطع`);
    for (const n of ayat) for (const c of R.cols) {
      const v = count((rows[n] || {})[c.k]);
      if (Number.isNaN(v)) { errors.push(`عدد غير صحيح في الآية ${n}`); continue; }
      ded += v * c.d;
    }
    return { raw: r6(Math.max(0, base - ded)), base, extra: null, detail: { deductions: r6(ded) }, errors };
  }
  return { errors: ['نوع غير معروف'] };
}

// تجميع مشاركة في مرحلة من التقييمات المرسلة فقط. لا يُستبدل تقييم ناقص بصفر.
// prev: { prelim: {total, max}, semi: {...} } من الكشوف المعتمدة للمراحل السابقة
function aggregate(stage, branch, evals, prev = {}) {
  const W = (WEIGHTS[stage] || {})[branch];
  if (!W) return null;
  const sub = evals.filter((e) => e.status === 'submitted');
  const parts = [], missing = [];
  let total = 0;
  for (const p of W.parts) {
    if (p.prev) {
      const src = prev[p.prev];
      if (!src) { missing.push({ prev: p.prev, n: p.n + ' (بانتظار اعتماد كشف المرحلة)' }); parts.push({ key: p.key, n: p.n, weight: p.weight, value: null, judges: [] }); continue; }
      const value = r6((src.total / src.max) * p.weight);
      parts.push({ key: p.key, n: p.n, weight: p.weight, value, judges: [src.total], bases: [src.max] });
      total += value; continue;
    }
    const got = p.slots.map((s) => sub.find((e) => e.rubric === p.rubric && e.slot === s));
    const lack = p.slots.filter((s, i) => !got[i]);
    if (lack.length) {
      if (!p.extra || !missing.some((m) => m.rubric === p.rubric)) lack.forEach((s) => missing.push({ rubric: p.rubric, slot: s, n: p.n + (p.slots.length > 1 ? ` (المحكم ${s})` : '') }));
      parts.push({ key: p.key, n: p.n, weight: p.weight, value: null, judges: got.map((e) => (e ? (p.extra ? e.extra : e.raw) : null)) });
      continue;
    }
    // كل تقييم يُحوَّل أولًا إلى نسبة من رصيده، ثم يُؤخذ المتوسط ويُضرب في الوزن
    const ratios = got.map((e) => (p.extra ? e.extra / RUBRICS[p.rubric].extra.max : e.raw / e.base));
    const value = r6((ratios.reduce((a, b) => a + b, 0) / ratios.length) * p.weight);
    parts.push({ key: p.key, n: p.n, weight: p.weight, value, judges: got.map((e) => (p.extra ? e.extra : e.raw)), bases: got.map((e) => (p.extra ? RUBRICS[p.rubric].extra.max : e.base)) });
    total += value;
  }
  return { max: W.max, parts, missing, complete: !missing.length, total: missing.length ? null : r6(total) };
}

// الاستمارة بصيغة تعرضها الواجهة
function rubricJson(key) {
  const R = RUBRICS[key];
  return { key, ...R, base: R.base };
}

module.exports = { RUBRICS, WEIGHTS, SPEC_MAP, rubricFor, nextStage, branchStages, compute, aggregate, passage, surahList, rubricJson };
