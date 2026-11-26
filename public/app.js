'use strict';
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => (t ? new Date(t).toLocaleString('ar-u-nu-latn-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const fmtD = (t) => (t ? new Date(t).toLocaleDateString('ar-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
const dateLabel = (d) => (d ? fmtD(d + 'T12:00:00') : 'بانتظار الإعلان');
const yrs = (c) => (c.fromYear == null ? `${c.toYear} فما قبل` : c.toYear == null ? `${c.fromYear} فما بعد` : `${c.fromYear} – ${c.toYear}`);
const ST_TAG = { submitted: 'info', returned: 'warn', accepted: 'ok', rejected: 'bad', withdrawn: '' };

let meta = null, me = null, pub = null, view = '', busy = false;
const S = { my: null, wz: null, regs: { q: '', section: '', category: '', branch: '', status: '', page: 1, data: null }, dash: { section: '' }, adm: null, users: null, usersRole: '', audit: { page: 1, section: '', data: null } };

// ---------- الاتصال بالخادم ----------
async function api(path, opt = {}) {
  const o = { method: opt.method || 'GET', headers: { 'X-Iqra': '1' }, credentials: 'same-origin' };
  if (opt.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body); }
  let res;
  try { res = await fetch('/api' + path, o); } catch (e) { throw new Error('تعذّر الاتصال بالخادم. تحقق من الشبكة.'); }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (res.status === 401 && !['/login', '/me'].includes(path)) { me = null; go('login'); throw new Error(data.error || 'انتهت الجلسة، سجّل الدخول مجددًا'); }
  if (res.status === 403 && data.mustChange) { me.mustChange = true; render(); throw new Error(data.error); }
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}
let tt;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 3800); }
const showErr = (box, e) => { if (box) { box.textContent = e.message; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); } else toast(e.message); };

// ---------- النافذة ----------
const dlg = $('#dlg');
function modal(title, html) { $('#dlg-t').textContent = title; $('#dlg-b').innerHTML = html; if (!dlg.open) dlg.showModal(); afterRender($('#dlg-b')); }
const closeModal = () => dlg.open && dlg.close();
function pwBox(title, login, pass) {
  modal(title, `<p>سلّم بيانات الدخول لصاحب الحساب. تظهر كلمة المرور المؤقتة مرة واحدة فقط، ويُطلب تغييرها عند أول دخول.</p>
  <dl class="kv"><dt>الدخول</dt><dd class="ltr">${esc(login)}</dd></dl><p class="pw">${esc(pass)}</p>
  <div class="acts"><button class="btn pri" data-act="copy" data-v="${esc(pass)}">نسخ كلمة المرور</button><button class="btn" data-act="close">تم</button></div>`);
}

// ---------- التوجيه والأدوار ----------
const NAV = {
  public: [['home', 'تعريف المسابقة'], ['login', 'تسجيل الدخول'], ['signup', 'إنشاء حساب متسابق']],
  contestant: [['my', 'مشاركتي'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  judge: [['space', 'مساحتي'], ['queues', 'طابور لجنتي'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  coordinator: [['queues', 'النداء'], ['space', 'مساحتي'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  chief: [['queues', 'الطوابير والنداء'], ['committees', 'اللجان'], ['regs', 'التسجيلات (اطلاع)'], ['screen', 'شاشة الانتظار'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  exec: [['dash', 'لوحة القسم'], ['reception', 'الاستقبال والحضور'], ['queues', 'الطوابير والنداء'], ['committees', 'اللجان'], ['regs', 'التسجيلات'], ['screen', 'شاشة الانتظار'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  top: [['dash', 'لوحة المتابعة'], ['regs', 'التسجيلات'], ['reception', 'الاستقبال والحضور'], ['queues', 'الطوابير والنداء'], ['committees', 'اللجان'], ['screen', 'شاشة الانتظار'], ['setup', 'إعداد الدورة'], ['users', 'الحسابات'], ['audit', 'سجل التدقيق'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  screen: [['screen', 'شاشة الانتظار']],
};
const navFor = () => NAV[me ? me.role : 'public'];
const homeOf = () => navFor()[0][0];
function go(v) { if (location.hash !== '#' + v) location.hash = v; else route(); }
function route() {
  const h = location.hash.slice(1);
  if (h === 'view') { $('#view').focus(); history.replaceState(null, '', '#' + view); return; }
  const allowed = navFor().map((x) => x[0]);
  view = allowed.includes(h) ? h : homeOf();
  stopPoll(); document.body.classList.toggle('screen-mode', view === 'screen');
  if (view === 'screen') { SCR.first = true; SCR.last = 0; }
  render(); scrollTo(0, 0);
}
addEventListener('hashchange', route);

function shell() {
  $('#nav').innerHTML = navFor().map(([k, n]) => `<a href="#${k}" ${k === view ? 'aria-current="page"' : ''}>${n}</a>`).join('');
  $('#who').innerHTML = me ? `<span class="chip">${esc(me.name)} · <b>${esc(me.roleName)}</b>${me.sectionName && me.role !== 'contestant' ? ' · ' + esc(me.sectionName) : ''}</span><button class="btn sm ghost" data-act="logout">خروج</button>`
    : `<a class="btn sm gold" href="#login">تسجيل الدخول</a>`;
}
// تحديث دوري للطوابير والشاشة ومتابعة المتسابق
let pollT = null;
function stopPoll() { clearInterval(pollT); pollT = null; }
function startPoll(ms, fn) { stopPoll(); pollT = setInterval(() => { if (!dlg.open && !document.hidden) fn(); }, ms); }
async function repaint() { const v = $('#view'), y = scrollY; try { v.innerHTML = await VIEWS[view](); afterRender(v); scrollTo(0, y); } catch (e) {} }
async function render() {
  shell();
  const v = $('#view');
  if (me && me.mustChange) { v.innerHTML = vPassword(true); afterRender(v); return; }
  const fn = VIEWS[view];
  try { v.innerHTML = await fn(); } catch (e) { v.innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; }
  afterRender(v);
}
function afterRender(root) {
  $$('[data-w]', root).forEach((e) => { e.style.width = Math.max(0, Math.min(100, +e.dataset.w)) + '%'; });
  $$('table.stack', root).forEach((t) => { const hs = [...t.querySelectorAll('thead th')].map((th) => th.textContent); t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { td.dataset.l = hs[i] || ''; })); });
}

// ---------- عناصر مشتركة ----------
const PAT = `<svg class="pat" aria-hidden="true"><defs><pattern id="st" width="72" height="72" patternUnits="userSpaceOnUse"><g fill="none" stroke="#d8a73e" stroke-width="1.4"><rect x="16" y="16" width="40" height="40"/><rect x="16" y="16" width="40" height="40" transform="rotate(45 36 36)"/><circle cx="36" cy="36" r="8"/><path d="M0 0L16 16M72 0L56 16M0 72L16 56M72 72L56 56"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#st)"/></svg>`;
const stTag = (s, n) => `<span class="tag ${ST_TAG[s] || ''}">${esc(n || meta.regStatuses[s] || s)}</span>`;
const opts = (arr, sel, ph) => (ph !== undefined ? `<option value="">${esc(ph)}</option>` : '') + arr.map(([v, n]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(n)}</option>`).join('');
const catName = (id) => (pub.categories.find((c) => c.id === id) || {}).name || '';
const entryChips = (es) => `<span class="chips">${es.filter((e) => e.status === 'active').map((e) => `<span class="tag plum">${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</span>`).join('')}</span>`;
async function refreshPublic() { pub = await api('/public'); }

// ---------- تعريف المسابقة ----------
function vHome() {
  const c = pub.competition;
  if (!c) return `<div class="card empty"><h2>لا توجد دورة معلنة حاليًا</h2></div>`;
  const cats = pub.categories, curr = pub.curricula;
  const branchCats = (code) => cats.filter((x) => x.branches.includes(code));
  const row = (label, content) => `<tr><td>${esc(label)}</td><td>${esc(content)}</td></tr>`;
  const card = (b) => {
    let body = '';
    const list = curr.filter((x) => x.branch === b.code);
    if (b.code === 'hifz') {
      const own = list.filter((x) => x.track === 'cat' || (x.categoryId != null && !['j5', 'j10', 'full'].includes(x.track)));
      const all = list.filter((x) => x.categoryId == null);
      body = `<p class="subhead">مقرر الفئة</p><table class="curr"><tbody>${own.map((x) => row(catName(x.categoryId), x.content)).join('')}</tbody></table>
        ${all.length ? `<p class="subhead">مسارات لكل الأعمار</p><table class="curr"><tbody>${all.map((x) => row(x.trackName, x.content)).join('')}</tbody></table>` : ''}`;
    } else if (list.length) {
      const tracks = [...new Set(list.map((x) => x.track))];
      body = tracks.map((t) => { const xs = list.filter((x) => x.track === t); const tn = xs[0].trackName;
        return `${tn ? `<p class="subhead">${esc(tn)}</p>` : ''}<table class="curr"><tbody>${xs.map((x) => row(x.categoryId == null ? 'لكل الأعمار' : catName(x.categoryId), x.content)).join('')}</tbody></table>`; }).join('');
    }
    const bc = branchCats(b.code);
    return `<article class="card branch"><h3>${esc(b.name)} ${b.registrable ? '' : '<span class="tag">للتعريف فقط</span>'}</h3>
      <p>${esc(b.intro)}</p>${b.stages ? `<p class="stages">المراحل: ${esc(b.stages)}</p>` : ''}
      ${bc.length && b.registrable ? `<p class="note">الفئات: ${bc.map((x) => `${esc(x.name)} (${esc(yrs(x))})`).join('، ')}</p>` : ''}
      ${body}
      <div class="acts">${b.conditions ? `<button class="btn" data-act="more" data-code="${esc(b.code)}">المزيد: الشروط والمتطلبات</button>` : ''}
      ${b.registrable && c.state.open && (!me || me.role === 'contestant') ? `<a class="btn pri" href="#${me ? 'my' : 'signup'}">بدء التسجيل</a>` : ''}</div></article>`;
  };
  return `<section class="hero">${PAT}<div class="hero-in"><div>
    <p class="lbl">المسابقة الحالية</p><h1>${esc(c.name)}</h1>
    <p>الدورة ${esc(c.number)} · ${esc(c.year)}</p>
    <div class="facts"><span><b>حالة التسجيل</b>${esc(c.state.label)}</span><span><b>فتح التسجيل</b>${esc(dateLabel(c.regOpen))}</span><span><b>إغلاق التسجيل</b>${esc(dateLabel(c.regClose))}</span></div>
    <div class="acts">${!me ? `${c.state.open ? '<a class="btn gold" href="#signup">بدء التسجيل</a>' : ''}<a class="btn ghost" href="#login">تسجيل الدخول</a>` : `<a class="btn gold" href="#${homeOf()}">مساحة العمل</a>`}</div></div>
    <figure class="quote"><span class="glyph">إ</span><blockquote>«خيركم من تعلّم القرآن وعلّمه»</blockquote><figcaption>رواه البخاري</figcaption><p class="motto">علمٌ يُتقن… وأثرٌ يمتد</p></figure></div></section>
  <h2 class="sec-title">الفئات العمرية</h2>
  <p class="note">تُحدَّد الفئة تلقائيًا من سنة الميلاد، ولا يختارها المتسابق.</p>
  <div class="cats">${cats.map((x) => `<div class="cat"><b>${esc(x.name)}</b><span class="yrs">${esc(yrs(x))}</span><span class="br">${x.branches.map((k) => esc((pub.branches.find((b) => b.code === k) || {}).name || k)).join('، ')}</span></div>`).join('')}</div>
  <h2 class="sec-title">فروع المسابقة ومقرراتها</h2>
  <div class="branches">${pub.branches.map(card).join('')}</div>
  <section class="assoc"><h2>${esc(meta.org)}</h2><p>عشرون عامًا… والأثر يمتد</p></section>`;
}

// ---------- الدخول وإنشاء الحساب ----------
const vLogin = () => `<div class="auth card"><h1>تسجيل الدخول</h1><p class="note">المتسابق يدخل برقم هويته، والموظفون والمحكمون باسم المستخدم الذي سلّمته الإدارة.</p>
  <form data-form="login"><p class="err" hidden></p>
  <div class="field"><label for="l-login">رقم الهوية أو اسم المستخدم</label><input id="l-login" class="ltr" autocomplete="username" required></div>
  <div class="field"><label for="l-pass">كلمة المرور</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
  <button class="btn pri" type="submit">دخول</button></form>
  ${meta.allowSignup ? '<p class="switch">ليس لديك حساب متسابق؟ <a href="#signup">أنشئ حسابًا</a></p>' : ''}
  <p class="switch note">نسيت كلمة المرور؟ تواصل مع الإدارة التنفيذية لقسمك لإعادة تعيينها.</p></div>`;
const vSignup = () => !meta.allowSignup ? `<div class="auth card"><h1>إنشاء حساب</h1><p>إنشاء الحسابات من الموقع متوقف حاليًا. تواصل مع إدارة المسابقة.</p></div>` :
  `<div class="auth card"><h1>إنشاء حساب متسابق</h1><p class="note">حساب واحد لكل متسابق، ومنه يسجّل في الفروع ويتابع مشاركاته.${pub.competition && !pub.competition.state.open ? ' التسجيل في الدورة الحالية غير متاح الآن، ويمكنك إنشاء الحساب مسبقًا.' : ''}</p>
  <form data-form="signup"><p class="err" hidden></p>
  <div class="field"><label for="s-id">رقم الهوية أو الرقم الشخصي <span class="req">*</span></label><input id="s-id" class="ltr" inputmode="numeric" autocomplete="off" required><small>من 6 إلى 20 رقمًا، وهو رقم الدخول إلى حسابك.</small></div>
  <div class="field"><label for="s-name">الاسم الرباعي <span class="req">*</span></label><input id="s-name" autocomplete="name" required></div>
  <div class="field"><label for="s-phone">الهاتف الأساسي <span class="req">*</span></label><input id="s-phone" class="ltr" type="tel" inputmode="tel" autocomplete="tel" required><small>مع رمز الدولة إن كان خارج الدولة، مثل ‎+973‎.</small></div>
  <div class="row2"><div class="field"><label for="s-pass">كلمة المرور <span class="req">*</span></label><input id="s-pass" type="password" autocomplete="new-password" required><small>8 أحرف على الأقل، أحرف وأرقام.</small></div>
  <div class="field"><label for="s-pass2">تأكيد كلمة المرور <span class="req">*</span></label><input id="s-pass2" type="password" autocomplete="new-password" required></div></div>
  <button class="btn pri" type="submit">إنشاء الحساب</button></form>
  <p class="switch">لديك حساب؟ <a href="#login">سجّل الدخول</a></p></div>`;
const vPassword = (forced) => `<div class="auth card"><h1>${forced ? 'غيّر كلمة المرور المؤقتة' : 'تغيير كلمة المرور'}</h1>${forced ? '<p class="note">هذه كلمة مرور مؤقتة. اختر كلمة مرور خاصة بك للمتابعة.</p>' : ''}
  <form data-form="password"><p class="err" hidden></p>
  <div class="field"><label for="p-cur">كلمة المرور الحالية</label><input id="p-cur" type="password" autocomplete="current-password" required></div>
  <div class="field"><label for="p-new">كلمة المرور الجديدة</label><input id="p-new" type="password" autocomplete="new-password" required><small>8 أحرف على الأقل، أحرف وأرقام.</small></div>
  <div class="field"><label for="p-new2">تأكيد كلمة المرور الجديدة</label><input id="p-new2" type="password" autocomplete="new-password" required></div>
  <div class="acts"><button class="btn pri" type="submit">حفظ</button>${forced ? '<button class="btn" type="button" data-act="logout">خروج</button>' : ''}</div></form></div>`;
const vAccount = () => `<div class="grid2"><div class="card"><h2>حسابي</h2><dl class="kv"><dt>الاسم</dt><dd>${esc(me.name)}</dd><dt>الدخول</dt><dd class="ltr">${esc(me.login)}</dd><dt>الدور</dt><dd>${esc(me.roleName)}</dd>
  ${me.role !== 'contestant' ? `<dt>القسم</dt><dd>${esc(me.sectionName || '—')}</dd>` : ''}${me.specialty ? `<dt>التخصص</dt><dd>${esc(me.specialty)}</dd>` : ''}<dt>آخر دخول</dt><dd>${esc(fmt(me.lastLogin) || '—')}</dd></dl></div>${vPassword(false).replace('auth card', 'card')}</div>`;

// ---------- مساحة المحكم والمنسق ورئيس التحكيم ----------
async function vSpace() {
  const { committees } = await api('/committees');
  return `<div class="head"><div><h1>مساحتي</h1><p>${esc(me.roleName)} · ${esc(me.sectionName)}${me.specialty ? ' · ' + esc(me.specialty) : ''}</p></div></div>
  <div class="card"><h2>تكليفي</h2>${committees.length ? committees.map((c) => `<div class="entry"><b>${esc(c.name)}</b><span class="tag">${esc(c.hall || '—')}</span>
    <span class="cur">${esc(c.stageName)} · ${c.members.filter((m) => m.userId === me.id).map((m) => (m.kind === 'judge' ? 'محكم' : 'منسق النداء')).join('، ')}</span></div>`).join('')
    : '<p class="note">لم تُكلَّف بلجنة بعد. تكلّفك الإدارة التنفيذية لقسمك من صفحة «اللجان».</p>'}
  ${committees.length ? `<div class="acts"><a class="btn pri" href="#queues">${me.role === 'coordinator' ? 'فتح شاشة النداء' : 'طابور لجنتي'}</a></div>` : ''}</div>
  ${me.role === 'judge' ? '<div class="card"><h2>رصد الدرجات</h2><p class="note">استمارات التحكيم بالخصومات تُفعَّل في الخطوة القادمة. ستظهر لك استمارة تخصصك للمتسابق الجاري في لجنتك.</p></div>' : ''}`;
}

// ---------- المتسابق: مشاركتي ومعالج التسجيل ----------
async function vMy() {
  S.my = await api('/my');
  S.myQ = S.my.registration ? (await api('/my/queue')).tickets : [];
  if (S.myQ.some((t) => ['waiting', 'called', 'testing', 'needs_committee'].includes(t.status))) startPoll(10000, repaint); else stopPoll();
  const m = S.my, c = m.competition;
  if (!c) return `<div class="card empty"><h2>لا توجد دورة حالية</h2></div>`;
  if (S.wz) return wizard();
  if (!m.registration) {
    return `<div class="head"><div><h1>مرحبًا ${esc(m.person.fullName.split(' ')[0])}</h1><p>${esc(c.name)} · الدورة ${esc(c.number)}</p></div></div>
    <div class="card"><h2>لم تسجّل في هذه الدورة بعد</h2><p>${esc(c.state.label)}.</p>
    ${m.canRegister ? '<p>أدخل سنة ميلادك فتظهر فئتك والفروع المتاحة لها، ثم اختر فروعك وراجع طلبك قبل تأكيده.</p><button class="btn pri" data-act="wz-start">ابدأ التسجيل</button>' : ''}</div>`;
  }
  const r = m.registration;
  const active = r.entries.filter((e) => e.status === 'active'), old = r.entries.filter((e) => e.status !== 'active');
  return `<div class="head"><div><h1>مشاركتي</h1><p>${esc(c.name)} · الدورة ${esc(c.number)}</p></div>
    <div class="acts">${m.canEdit ? '<button class="btn pri" data-act="wz-edit">تعديل الطلب</button>' : ''}${m.canWithdraw ? '<button class="btn badb" data-act="withdraw">الانسحاب من المسابقة</button>' : ''}</div></div>
  ${r.status === 'returned' ? `<div class="banner"><span><b>مطلوب استكمال:</b> ${esc(r.staffNote)}</span>${m.canEdit ? '<button class="btn sm" data-act="wz-edit">استكمال الطلب</button>' : ''}</div>` : ''}
  ${r.status === 'rejected' && r.staffNote ? `<div class="banner"><span><b>ملاحظة الإدارة:</b> ${esc(r.staffNote)}</span></div>` : ''}
  <div class="grid2"><div class="card"><div class="status"><span class="big">${esc(r.statusName)}</span>${stTag(r.status)}</div>
    <p class="note">قُدّم الطلب ${esc(fmt(r.createdAt))}${r.updatedAt !== r.createdAt ? ' · آخر تحديث ' + esc(fmt(r.updatedAt)) : ''}</p>
    <h3>مشاركاتي (${active.length})</h3>
    ${active.map((e) => { const t = (S.myQ || []).find((x) => x.entryId === e.id); return `<div class="entry"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b>${myTag(t)}<span class="cur">المقرر: ${esc(e.curriculum)}</span>${t && t.status === 'called' ? `<p class="callnow">تم نداؤك: توجّه الآن إلى ${esc(t.committee)}${t.hall ? ' — ' + esc(t.hall) : ''}</p>` : ''}</div>`; }).join('') || '<p class="note">لا توجد مشاركات قائمة.</p>'}
    ${old.length ? `<details><summary class="note">مشاركات ملغاة (${old.length})</summary>${old.map((e) => `<div class="entry off"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b><span class="tag">ملغاة</span><span class="cur">${esc(e.curriculum)}</span></div>`).join('')}</details>` : ''}</div>
  <div class="card"><h3>ملفي</h3><dl class="kv"><dt>الاسم</dt><dd>${esc(m.person.fullName)}</dd><dt>رقم الهوية</dt><dd class="ltr">${esc(m.person.nationalId)}</dd><dt>سنة الميلاد</dt><dd>${esc(r.birthYear)}</dd><dt>الفئة</dt><dd>${esc(r.categoryName)}</dd><dt>القسم</dt><dd>${esc(r.sectionName)}</dd><dt>الهاتف</dt><dd class="ltr">${esc(m.person.phone)}</dd><dt>هاتف آخر</dt><dd class="ltr">${esc(m.person.phone2 || '—')}</dd></dl>
    <div class="acts"><button class="btn sm" data-act="phones">تحديث أرقام التواصل</button></div>
    <p class="note">لتصحيح الاسم أو رقم الهوية أو سنة الميلاد بعد المراجعة، تواصل مع الإدارة التنفيذية لقسمك.</p></div></div>`;
}

function myTag(t) {
  if (!t) return '<span class="tag">موعد المرحلة: بانتظار الإعلان</span>';
  const cls = { waiting: 'info', called: 'warn', testing: 'plum', done: 'ok', needs_committee: 'warn' }[t.status] || '';
  const extra = t.status === 'waiting' ? ` · ${t.ahead ? 'قبلك ' + t.ahead : 'أنت التالي'} · ${esc(t.committee)}` : t.status === 'testing' ? ' · ' + esc(t.committee) : '';
  return `<span class="tag ${cls}">${esc(t.stageName)}: ${esc(t.statusName)}${extra}</span>`;
}
function wzInit(edit) {
  const m = S.my, r = edit ? m.registration : null;
  S.wz = { step: 1, year: r ? r.birthYear : m.person.birthYear || '', gender: r ? r.section : m.person.gender || '', phone2: m.person.phone2 || '', elig: null, eligErr: '', picks: {}, edit: !!r, agree: false };
  if (r) for (const e of r.entries.filter((x) => x.status === 'active')) S.wz.picks[e.branch] = e.track;
  if (S.wz.year) checkYear(true); else render();
}
let yt;
async function checkYear(now) {
  clearTimeout(yt);
  const run = async () => {
    const w = S.wz; if (!w) return;
    const y = String(w.year).trim();
    if (!/^\d{4}$/.test(y.replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632))) { w.elig = null; w.eligErr = y ? 'أدخل سنة الميلاد بأربعة أرقام' : ''; return paintWz(); }
    try { w.elig = await api('/eligibility?year=' + encodeURIComponent(y)); w.eligErr = '';
      // عند تغيير السنة تزال الفروع والمسارات غير المتاحة
      for (const b of Object.keys(w.picks)) { const br = w.elig.branches.find((x) => x.code === b); if (!br || !br.tracks.some((t) => t.track === w.picks[b])) { if (br && br.tracks.length === 1) w.picks[b] = br.tracks[0].track; else if (br) w.picks[b] = ''; else delete w.picks[b]; } }
    } catch (e) { w.elig = null; w.eligErr = e.message; }
    paintWz();
  };
  if (now) await run(); else yt = setTimeout(run, 350);
}
function paintWz() { if (view !== 'my' || !S.wz) return; const v = $('#view'); const keep = document.activeElement && document.activeElement.id; v.innerHTML = wizard(); afterRender(v); if (keep && document.getElementById(keep)) { const e = document.getElementById(keep); e.focus(); if (e.setSelectionRange && e.type === 'text') e.setSelectionRange(e.value.length, e.value.length); } }
function wizard() {
  const w = S.wz, m = S.my, p = m.person;
  const steps = ['البيانات الأساسية', 'الفروع والمقررات', 'المراجعة والتأكيد'];
  let body = '';
  const catBox = w.elig ? `<div class="catbox"><span>فئتك في هذه الدورة:</span><b>${esc(w.elig.category.name)}</b><span class="note">الفروع المتاحة: ${w.elig.branches.map((b) => esc(b.name)).join('، ')}</span></div>` : w.eligErr ? `<p class="err">${esc(w.eligErr)}</p>` : '';
  if (w.step === 1) {
    body = `<div class="row2"><div class="field"><label>الاسم الرباعي</label><input value="${esc(p.fullName)}" readonly></div><div class="field"><label>رقم الهوية</label><input class="ltr" value="${esc(p.nationalId)}" readonly></div></div>
    <div class="row3"><div class="field"><label for="w-year">سنة الميلاد <span class="req">*</span></label><input id="w-year" data-wz="year" inputmode="numeric" maxlength="4" value="${esc(w.year)}" placeholder="مثل 2012"></div>
    <div class="field"><span class="lab" id="w-g">الجنس <span class="req">*</span></span><div class="acts" role="radiogroup" aria-labelledby="w-g">${[['M', 'ذكر'], ['F', 'أنثى']].map(([v, n]) => `<label class="check"><input type="radio" name="w-gender" data-wz="gender" value="${v}" ${w.gender === v ? 'checked' : ''}>${n}</label>`).join('')}</div><small>يحدد القسم: الرجال أو النساء.</small></div>
    <div class="field"><label for="w-phone2">هاتف آخر</label><input id="w-phone2" class="ltr" data-wz="phone2" type="tel" value="${esc(w.phone2)}"><small>اختياري.</small></div></div>
    ${catBox}<div class="acts"><button class="btn pri" data-act="wz-next" ${w.elig && w.gender ? '' : 'disabled'}>التالي: اختيار الفروع</button><button class="btn" data-act="wz-cancel">إلغاء</button></div>`;
  } else if (w.step === 2) {
    const lab = { hifz: 'اختر قسمًا واحدًا داخل الحفظ', tilawa: 'اختر مسارًا واحدًا للتلاوة' };
    body = catBox + w.elig.branches.map((b) => {
      const on = b.code in w.picks;
      return `<div class="pick ${on ? 'on' : ''}"><label class="check"><input type="checkbox" data-wz="branch" value="${esc(b.code)}" ${on ? 'checked' : ''}>${esc(b.name)}</label>
      ${on ? `<div class="tracks" role="radiogroup" aria-label="${esc(lab[b.code] || b.name)}">${b.tracks.length > 1 ? `<p class="note">${esc(lab[b.code] || 'اختر المسار')}</p>` : ''}${b.tracks.map((t) => `<label><input type="radio" name="tr-${esc(b.code)}" data-wz="track" data-branch="${esc(b.code)}" value="${esc(t.track)}" ${w.picks[b.code] === t.track ? 'checked' : ''}><span><b>${esc(t.trackName || 'المقرر')}${t.allAges ? ' <span class="tag">لكل الأعمار</span>' : ''}</b><small>${esc(t.content)}</small></span></label>`).join('')}</div>` : ''}</div>`;
    }).join('');
    const ready = Object.keys(w.picks).length && Object.values(w.picks).every(Boolean);
    body += `<div class="acts"><button class="btn pri" data-act="wz-next" ${ready ? '' : 'disabled'}>التالي: المراجعة</button><button class="btn" data-act="wz-back">السابق</button></div>`;
  } else {
    const chosen = w.elig.branches.filter((b) => b.code in w.picks).map((b) => ({ b, t: b.tracks.find((t) => t.track === w.picks[b.code]) }));
    body = `<p class="err" hidden></p><table class="review"><tbody>
      <tr><th>الاسم الرباعي</th><td>${esc(p.fullName)}</td></tr><tr><th>رقم الهوية</th><td class="ltr">${esc(p.nationalId)}</td></tr>
      <tr><th>الهاتف</th><td class="ltr">${esc(p.phone)}${w.phone2 ? ' · ' + esc(w.phone2) : ''}</td></tr>
      <tr><th>سنة الميلاد والفئة</th><td>${esc(w.year)} · ${esc(w.elig.category.name)}</td></tr><tr><th>القسم</th><td>${w.gender === 'M' ? 'قسم الرجال' : 'قسم النساء'}</td></tr>
      ${chosen.map(({ b, t }) => `<tr><th>${esc(b.name)}${t.trackName ? ' · ' + esc(t.trackName) : ''}</th><td>${esc(t.content)}</td></tr>`).join('')}</tbody></table>
      <label class="check"><input type="checkbox" data-wz="agree" ${w.agree ? 'checked' : ''}>أقرّ بصحة البيانات، وأن الفئة محسوبة من سنة ميلادي.</label>
      <div class="acts"><button class="btn pri" data-act="wz-submit" ${w.agree ? '' : 'disabled'}>${w.edit ? 'حفظ التعديل' : 'تأكيد الطلب'}</button><button class="btn" data-act="wz-back">السابق</button></div>`;
  }
  return `<div class="head"><div><h1>${w.edit ? 'تعديل طلب التسجيل' : 'التسجيل في المسابقة'}</h1><p>${esc(m.competition.name)} · الدورة ${esc(m.competition.number)}</p></div></div>
  <ol class="steps">${steps.map((s, i) => `<li class="${i + 1 < w.step ? 'done' : i + 1 === w.step ? 'now' : ''}" ${i + 1 === w.step ? 'aria-current="step"' : ''}>${s}</li>`).join('')}</ol>
  <div class="card">${body}</div>`;
}

// ---------- التسجيلات (الإدارة) ----------
const canManage = () => ['exec', 'top'].includes(me.role);
function regParams(extra = {}) {
  const f = { ...S.regs, ...extra }, u = new URLSearchParams();
  for (const k of ['q', 'section', 'category', 'status', 'page']) if (f[k]) u.set(k, f[k]);
  if (f.branch) { const [b, t] = f.branch.split(':'); u.set('branch', b); if (t) u.set('track', t); }
  return u.toString();
}
async function vRegs() {
  const f = S.regs;
  f.data = await api('/registrations?' + regParams());
  const d = f.data, chief = me.role === 'chief';
  const trackOpts = [];
  for (const b of pub.branches.filter((x) => x.registrable)) {
    trackOpts.push([b.code, b.name]);
    const ts = [...new Map(pub.curricula.filter((x) => x.branch === b.code && x.trackName).map((x) => [x.track, x.trackName])).entries()];
    if (ts.length > 1) ts.forEach(([t, n]) => trackOpts.push([b.code + ':' + t, '— ' + b.name + ': ' + n]));
  }
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  return `<div class="head"><div><h1>التسجيلات</h1><p>${me.role === 'top' ? 'القسمان' : esc(me.sectionName)} · مرتبة أبجديًا${chief ? ' · اطلاع دون بيانات الاتصال' : ''}</p></div>
    ${canManage() ? `<div class="acts"><button class="btn" data-act="csv" data-href="/api/registrations.csv?${esc(regParams({ page: '' }))}">تصدير إلى Excel (CSV)</button></div>` : ''}</div>
  <div class="card"><form class="filters" data-form="regf" role="search">
    <input type="search" id="f-q" value="${esc(f.q)}" placeholder="${chief ? 'بحث بالاسم' : 'بحث بالاسم أو الهوية أو الهاتف'}" aria-label="بحث">
    ${me.role === 'top' ? `<select id="f-section" aria-label="القسم">${opts(Object.entries(meta.sections), f.section, 'القسمان')}</select>` : ''}
    <select id="f-category" aria-label="الفئة">${opts(pub.categories.map((c) => [c.id, c.name]), f.category, 'كل الفئات')}</select>
    <select id="f-branch" aria-label="الفرع">${opts(trackOpts, f.branch, 'كل الفروع')}</select>
    <select id="f-status" aria-label="الحالة">${opts(Object.entries(meta.regStatuses), f.status, 'كل الحالات')}</select>
    <button class="btn pri" type="submit">بحث</button></form>
  <p class="note">${d.total} تسجيلًا</p>
  ${d.rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>الاسم</th>${chief ? '' : '<th>الهوية</th><th>الهاتف</th>'}${me.role === 'top' ? '<th>القسم</th>' : ''}<th>الفئة</th><th>المشاركات</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
  ${d.rows.map((r) => `<tr class="click" data-act="reg" data-id="${r.id}" tabindex="0"><td><b>${esc(r.fullName)}</b></td>${chief ? '' : `<td class="ltr">${esc(r.nationalId)}</td><td class="ltr">${esc(r.phone)}</td>`}${me.role === 'top' ? `<td>${esc(r.sectionName)}</td>` : ''}<td>${esc(r.categoryName)}</td><td>${entryChips(r.entries)}</td><td>${stTag(r.status, r.statusName)}</td><td class="n">${esc(fmtD(r.createdAt))}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="pager"><span class="note">صفحة ${d.page} من ${pages}</span><div class="acts"><button class="btn sm" data-act="page" data-p="${d.page - 1}" ${d.page > 1 ? '' : 'disabled'}>السابق</button><button class="btn sm" data-act="page" data-p="${d.page + 1}" ${d.page < pages ? '' : 'disabled'}>التالي</button></div></div>`
    : '<div class="empty"><p>لا توجد تسجيلات مطابقة.</p></div>'}</div>`;
}

const ACT = { signup: 'إنشاء الحساب', register: 'تأكيد الطلب', edit: 'تعديل من المتسابق', withdraw: 'انسحاب', status: 'تغيير الحالة', correct: 'تصحيح إداري', reset: 'إعادة تعيين كلمة المرور', profile: 'تحديث التواصل', export: 'تصدير', settings: 'إعداد', create: 'إنشاء', update: 'تعديل', activate: 'تفعيل', deactivate: 'إيقاف', seed: 'تهيئة' };
async function openReg(id) {
  const { registration: r, history } = await api('/registrations/' + id);
  const chief = me.role === 'chief';
  const act = canManage() && r.status !== 'withdrawn';
  modal(r.fullName, `<p class="err" hidden></p>
  <div class="status"><span class="big">${esc(r.statusName)}</span>${stTag(r.status)}<span class="note">${esc(r.sectionName)} · ${esc(r.categoryName)}</span></div>
  ${r.staffNote ? `<p class="banner">${esc(r.staffNote)}</p>` : ''}
  <dl class="kv">${chief ? '' : `<dt>رقم الهوية</dt><dd class="ltr">${esc(r.nationalId)}</dd><dt>الهاتف</dt><dd class="ltr">${esc(r.phone)}${r.phone2 ? ' · ' + esc(r.phone2) : ''}</dd>`}<dt>سنة الميلاد</dt><dd>${esc(r.birthYear)}</dd><dt>الجنس</dt><dd>${r.gender === 'F' ? 'أنثى' : 'ذكر'}</dd><dt>تاريخ الطلب</dt><dd>${esc(fmt(r.createdAt))}</dd>${r.reviewer ? `<dt>آخر مراجعة</dt><dd>${esc(r.reviewer)} · ${esc(fmt(r.reviewedAt))}</dd>` : ''}</dl>
  <h3>المشاركات</h3>${r.entries.map((e) => `<div class="entry ${e.status === 'active' ? '' : 'off'}"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b>${e.status === 'active' ? '' : '<span class="tag">ملغاة</span>'}<span class="cur">${esc(e.curriculum)}</span></div>`).join('')}
  ${act ? `<h3>المراجعة</h3><div class="field"><label for="r-note">ملاحظة للمتسابق</label><textarea id="r-note" placeholder="مطلوبة عند طلب الاستكمال أو عدم القبول">${esc(r.staffNote)}</textarea></div>
  <div class="acts"><button class="btn okb" data-act="rst" data-id="${r.id}" data-s="accepted">قبول</button><button class="btn" data-act="rst" data-id="${r.id}" data-s="returned">طلب استكمال</button><button class="btn badb" data-act="rst" data-id="${r.id}" data-s="rejected">عدم قبول</button>${r.status !== 'submitted' ? `<button class="btn" data-act="rst" data-id="${r.id}" data-s="submitted">إعادة إلى المراجعة</button>` : ''}</div>
  <h3>إجراءات إدارية</h3><div class="acts"><button class="btn" data-act="correct" data-id="${r.id}">تصحيح البيانات</button><button class="btn" data-act="reset-c" data-id="${r.id}">إعادة تعيين كلمة مرور المتسابق</button></div>` : ''}
  <h3>السجل</h3><ul class="log">${history.map((h) => `<li><b>${esc(ACT[h.action] || h.action)}</b> — ${esc(h.summary)}${h.reason ? `<br><span>السبب: ${esc(h.reason)}</span>` : ''}<div class="meta">${esc(h.actor || 'المتسابق')} · ${esc(fmt(h.at))}</div></li>`).join('') || '<li class="note">لا يوجد</li>'}</ul>`);
  dlg.dataset.reg = r.id; S.cur = r;
}
function correctForm(r) {
  modal('تصحيح بيانات ' + r.fullName, `<p class="note">التصحيح إجراء موثق: يُحفظ السبب والقيم السابقة. يعرض النظام أثر التغيير على الفئة والمشاركات قبل التطبيق.</p><p class="err" hidden></p>
  <form data-form="correct" data-id="${r.id}"><div class="field"><label for="c-name">الاسم الرباعي</label><input id="c-name" value="${esc(r.fullName)}"></div>
  <div class="row2"><div class="field"><label for="c-id">رقم الهوية</label><input id="c-id" class="ltr" value="${esc(r.nationalId)}"></div><div class="field"><label for="c-year">سنة الميلاد</label><input id="c-year" inputmode="numeric" value="${esc(r.birthYear)}"></div></div>
  <div class="row2"><div class="field"><label for="c-phone">الهاتف الأساسي</label><input id="c-phone" class="ltr" value="${esc(r.phone)}"></div><div class="field"><label for="c-phone2">هاتف آخر</label><input id="c-phone2" class="ltr" value="${esc(r.phone2)}"></div></div>
  ${me.role === 'top' ? `<div class="field"><label for="c-gender">الجنس (يحدد القسم)</label><select id="c-gender">${opts([['M', 'ذكر — قسم الرجال'], ['F', 'أنثى — قسم النساء']], r.gender)}</select></div>` : ''}
  <div id="c-impact"></div>
  <div class="acts"><button class="btn pri" type="submit">معاينة الأثر</button><button class="btn" type="button" data-act="reg" data-id="${r.id}">رجوع</button></div></form>`);
}

// ---------- لوحة المتابعة ----------
async function vDash() {
  const top = me.role === 'top';
  const s = await api('/stats' + (top && S.dash.section ? '?section=' + S.dash.section : ''));
  const f = (await api('/reception?page=1' + (top && S.dash.section ? '&section=' + S.dash.section : '')).catch(() => ({}))).counts;
  const by = (arr, k) => (arr.find((x) => x.k === k) || {}).n || 0;
  const max = (arr) => Math.max(1, ...arr.map((x) => x.n));
  const bars = (arr, g) => arr.length ? `<div class="meters">${arr.map((x) => `<div class="meter"><span>${esc(x.k)}</span><span class="t"><i class="${g ? 'g' : ''}" data-w="${(x.n / max(arr)) * 100}"></i></span><b>${x.n}</b></div>`).join('')}</div>` : '<p class="note">لا توجد بيانات بعد.</p>';
  const c = pub.competition;
  return `<div class="head"><div><h1>${top ? 'لوحة المتابعة' : 'لوحة القسم'}</h1><p>${esc(c ? c.name + ' · الدورة ' + c.number : '')} · ${top ? (S.dash.section ? esc(meta.sections[S.dash.section]) : 'القسمان') : esc(me.sectionName)} · ${esc(c ? c.state.label : '')}</p></div>
    ${top ? `<div class="acts" role="group" aria-label="القسم">${[['', 'القسمان'], ['M', 'الرجال'], ['F', 'النساء']].map(([k, n]) => `<button class="btn sm ${S.dash.section === k ? 'pri' : ''}" data-act="dsec" data-s="${k}">${n}</button>`).join('')}</div>` : ''}</div>
  ${f ? `<h2>التصفيات الأولية: اليوم</h2><div class="kpis"><div class="kpi main"><b>${f.persons || 0}</b><span>حاضرون</span></div><div class="kpi"><b>${f.waiting || 0}</b><span>في الانتظار</span></div><div class="kpi"><b>${f.active || 0}</b><span>نودوا أو جارٍ اختبارهم</span></div><div class="kpi"><b>${f.done || 0}</b><span>انتهى اختبارهم</span></div><div class="kpi"><b>${f.needs || 0}</b><span>بانتظار تحديد اللجنة</span></div></div><h2>التسجيل</h2>` : ''}
  <div class="kpis"><div class="kpi main"><b>${s.total}</b><span>إجمالي التسجيلات</span></div>
    <div class="kpi"><b>${by(s.byStatus, 'submitted')}</b><span>بانتظار المراجعة</span></div><div class="kpi"><b>${by(s.byStatus, 'returned')}</b><span>مطلوب استكمال</span></div>
    <div class="kpi"><b>${by(s.byStatus, 'accepted')}</b><span>مقبول</span></div><div class="kpi"><b>${by(s.byStatus, 'rejected') + by(s.byStatus, 'withdrawn')}</b><span>غير مقبول أو منسحب</span></div></div>
  ${top && !S.dash.section ? `<div class="card"><h2>حسب القسم</h2>${bars(s.bySection.map((x) => ({ k: meta.sections[x.k], n: x.n })), true)}${s.accounts != null ? `<p class="note">حسابات المتسابقين المنشأة: ${s.accounts}</p>` : ''}</div>` : ''}
  <div class="grid2"><div class="card"><h2>المشاركات حسب الفرع والمسار</h2>${bars(s.byTrack)}</div><div class="card"><h2>التسجيلات حسب الفئة</h2>${bars(s.byCategory, true)}</div></div>
  <div class="card"><div class="acts"><a class="btn pri" href="#regs">مراجعة التسجيلات</a>${by(s.byStatus, 'submitted') ? `<button class="btn" data-act="pending">عرض ${by(s.byStatus, 'submitted')} بانتظار المراجعة</button>` : ''}</div></div>`;
}

// ---------- إعداد الدورة (الإدارة العليا) ----------
async function vSettings() {
  S.adm = await api('/admin/competition');
  const a = S.adm, c = a.competition, codes = a.branches;
  const catOpts = [['', 'لكل الأعمار'], ...a.categories.map((x) => [x.id, x.name])];
  return `<div class="head"><div><h1>إعداد الدورة</h1><p>${esc(c.name)} · الدورة ${esc(c.number)} · ${a.registrations} تسجيلًا</p></div></div>
  <div class="banner info">تعديل الفئات والمقررات لا يغيّر المقررات المحفوظة في المشاركات السابقة؛ كل مشاركة تحتفظ بنسخة الفئة والمقرر وقت تسجيلها.</div>
  <details class="blk" open><summary>بيانات الدورة ومواعيد التسجيل</summary><form data-form="comp"><p class="err" hidden></p>
    <div class="row3"><div class="field"><label for="k-name">اسم المسابقة</label><input id="k-name" value="${esc(c.name)}" required></div><div class="field"><label for="k-number">رقم الدورة</label><input id="k-number" inputmode="numeric" value="${esc(c.number)}"></div><div class="field"><label for="k-year">سنة الدورة</label><input id="k-year" inputmode="numeric" value="${esc(c.year)}"></div></div>
    <div class="row3"><div class="field"><label for="k-open">فتح التسجيل</label><input id="k-open" type="date" value="${esc(c.regOpen || '')}"><small>فارغ: يُعرض «بانتظار الإعلان».</small></div><div class="field"><label for="k-close">إغلاق التسجيل</label><input id="k-close" type="date" value="${esc(c.regClose || '')}"></div><div class="field"><label for="k-edit">آخر موعد لتعديل الفروع</label><input id="k-edit" type="date" value="${esc(c.editClose || '')}"></div></div>
    <div class="row3"><div class="field"><label for="k-status">حالة الدورة</label><select id="k-status">${opts(Object.entries(meta.compStatuses), c.status)}</select><small>«مفتوحة» مع المواعيد تتيح التسجيل.</small></div><div class="field"><label for="k-min">أدنى سنة ميلاد تقنيًا</label><input id="k-min" inputmode="numeric" value="${esc(c.minBirthYear)}"></div><div class="field"><label>الحالة الآن</label><input value="${esc(c.state.label)}" readonly></div></div>
    <div class="field"><label for="k-notes">ملاحظات داخلية</label><textarea id="k-notes">${esc(c.notes)}</textarea></div>
    <button class="btn pri" type="submit">حفظ بيانات الدورة</button></form></details>
  <details class="blk"><summary>الفئات العمرية (تُحسب من سنة الميلاد)</summary><form data-form="cats"><p class="err" hidden></p><div class="scroll"><table class="edit-table"><thead><tr><th>الفئة</th><th>من سنة</th><th>إلى سنة</th><th>الفروع المسموحة</th><th></th></tr></thead><tbody id="cat-rows">
    ${a.categories.map((x) => catRow(x, codes)).join('')}</tbody></table></div><p class="note">اترك «من سنة» فارغًا للفئة المفتوحة من الأقدم (مثل: 2008 فما قبل). يرفض الخادم الحدود المتداخلة.</p>
    <div class="acts"><button class="btn" type="button" data-act="add-cat">إضافة فئة</button><button class="btn pri" type="submit">حفظ الفئات</button></div></form></details>
  <details class="blk"><summary>المقررات والمسارات</summary><form data-form="curr"><p class="err" hidden></p><div class="scroll"><table class="edit-table"><thead><tr><th>الفرع</th><th>رمز المسار</th><th>اسم المسار</th><th>الفئة</th><th>المقرر</th><th></th></tr></thead><tbody id="curr-rows">
    ${a.curricula.map((x) => currRow(x, codes, catOpts)).join('')}</tbody></table></div><p class="note">رمز المسار بالإنجليزية (مثل cat، j5، tartil، tadweer، main). في الحفظ يختار المتسابق مسارًا واحدًا، وفي التلاوة ترتيل أو تدوير.</p>
    <div class="acts"><button class="btn" type="button" data-act="add-curr">إضافة مقرر</button><button class="btn pri" type="submit">حفظ المقررات</button></div></form></details>
  <details class="blk"><summary>الفروع: التعريف والشروط</summary>${a.branches.map((b) => `<form data-form="branch" data-id="${b.id}" class="card"><p class="err" hidden></p><div class="row2"><div class="field"><label>اسم الفرع</label><input name="name" value="${esc(b.name)}"></div><div class="field"><label>المراحل</label><input name="stages" value="${esc(b.stages)}"></div></div>
    <div class="field"><label>التعريف المختصر</label><textarea name="intro">${esc(b.intro)}</textarea></div><div class="field"><label>الشروط والمتطلبات (تظهر في «المزيد»)</label><textarea name="conditions">${esc(b.conditions)}</textarea></div>
    <label class="check"><input type="checkbox" name="registrable" ${b.registrable ? 'checked' : ''}>متاح للتسجيل (بدون تحديد يظهر للتعريف فقط)</label><button class="btn pri" type="submit">حفظ الفرع</button></form>`).join('')}</details>
  <details class="blk"><summary>دورة جديدة</summary><form data-form="newcomp"><p class="err" hidden></p><p>تُنشأ دورة جديدة بنسخ الفروع والفئات والمقررات من الدورة الحالية، بحالة «مسودة»، وتصبح الدورة الحالية. راجع السنوات والمقررات قبل فتح التسجيل. تبقى تسجيلات الدورات السابقة محفوظة.</p>
    <div class="row3"><div class="field"><label for="n-name">اسم المسابقة</label><input id="n-name" value="${esc(c.name)}"></div><div class="field"><label for="n-number">رقم الدورة</label><input id="n-number" inputmode="numeric" value="${esc(c.number + 1)}"></div><div class="field"><label for="n-year">السنة</label><input id="n-year" inputmode="numeric" value="${esc(c.year + 1)}"></div></div>
    <button class="btn" type="submit">إنشاء الدورة الجديدة</button></form>
    <p class="note">الدورات: ${a.all.map((x) => `${esc(x.number)} (${esc(x.year)}) ${x.current ? '— الحالية' : ''}`).join(' · ')}</p></details>`;
}
const catRow = (x, codes) => `<tr data-id="${esc(x.id || '')}"><td><input name="name" value="${esc(x.name || '')}" aria-label="اسم الفئة"></td><td><input class="yr" name="from" inputmode="numeric" value="${esc(x.fromYear ?? '')}" aria-label="من سنة"></td><td><input class="yr" name="to" inputmode="numeric" value="${esc(x.toYear ?? '')}" aria-label="إلى سنة"></td>
  <td><div class="boxes">${codes.filter((b) => b.registrable).map((b) => `<label><input type="checkbox" name="br" value="${esc(b.code)}" ${(x.branches || []).includes(b.code) ? 'checked' : ''}>${esc(b.name)}</label>`).join('')}</div></td><td>${x.used ? '<span class="tag">عليها تسجيلات</span>' : '<button class="btn sm badb" type="button" data-act="del-row">حذف</button>'}</td></tr>`;
const currRow = (x, codes, catOpts) => `<tr data-id="${esc(x.id || '')}"><td><select name="branch" aria-label="الفرع">${opts(codes.map((b) => [b.code, b.name]), x.branch)}</select></td><td><input name="track" class="ltr" value="${esc(x.track || '')}" aria-label="رمز المسار"></td><td><input name="trackName" value="${esc(x.trackName || '')}" aria-label="اسم المسار"></td>
  <td><select name="cat" aria-label="الفئة">${opts(catOpts, x.categoryId ?? '')}</select></td><td><input name="content" value="${esc(x.content || '')}" aria-label="المقرر"></td><td>${x.used ? '<span class="tag">عليه مشاركات</span>' : '<button class="btn sm badb" type="button" data-act="del-row">حذف</button>'}</td></tr>`;

// ---------- الحسابات (الإدارة العليا) ----------
async function vUsers() {
  S.users = (await api('/users' + (S.usersRole ? '?role=' + S.usersRole : ''))).users;
  const rows = S.users;
  return `<div class="head"><div><h1>الحسابات</h1><p>الإدارة العليا تنشئ حسابات الموظفين والمحكمين وتحدد الدور والقسم. المتسابقون ينشئون حساباتهم بأنفسهم.</p></div><div class="acts"><button class="btn pri" data-act="new-user">إضافة حساب</button></div></div>
  <div class="card"><div class="filters"><select id="u-role" aria-label="الدور">${opts(Object.entries(meta.roles).filter(([k]) => k !== 'contestant'), S.usersRole, 'كل حسابات الموظفين')}<option value="contestant" ${S.usersRole === 'contestant' ? 'selected' : ''}>حسابات المتسابقين</option></select></div>
  ${rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>الاسم</th><th>الدخول</th><th>الدور</th><th>القسم</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${rows.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.specialty ? `<br><small class="note">${esc(u.specialty)}</small>` : ''}</td><td class="ltr">${esc(u.login)}</td><td>${esc(u.roleName)}</td><td>${esc(u.role === 'contestant' ? '—' : u.sectionName)}</td><td class="n">${esc(fmt(u.lastLogin) || '—')}</td><td>${u.active ? (u.mustChange ? '<span class="tag warn">لم يغيّر كلمة المرور</span>' : '<span class="tag ok">نشط</span>') : '<span class="tag bad">موقوف</span>'}</td>
  <td><div class="acts">${u.role !== 'contestant' ? `<button class="btn sm" data-act="edit-user" data-id="${u.id}">تعديل</button><button class="btn sm" data-act="reset-u" data-id="${u.id}">كلمة مرور مؤقتة</button>` : ''}${u.id !== me.id ? `<button class="btn sm ${u.active ? 'badb' : 'okb'}" data-act="toggle-u" data-id="${u.id}">${u.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}</div></td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty"><p>لا توجد حسابات.</p></div>'}</div>`;
}
function userForm(u) {
  const roles = Object.entries(meta.roles).filter(([k]) => k !== 'contestant');
  modal(u ? 'تعديل حساب ' + u.name : 'إضافة حساب', `<form data-form="user" data-id="${u ? u.id : ''}"><p class="err" hidden></p>
  <div class="row2"><div class="field"><label for="u-login">اسم المستخدم <span class="req">*</span></label><input id="u-login" class="ltr" value="${esc(u ? u.login : '')}" ${u ? 'readonly' : 'required'}><small>بالإنجليزية، يبدأ بحرف، مثل exec.m أو judge.ahmed</small></div>
  <div class="field"><label for="u-name">الاسم <span class="req">*</span></label><input id="u-name" value="${esc(u ? u.name : '')}" required></div></div>
  <div class="row2"><div class="field"><label for="u-r">الدور <span class="req">*</span></label><select id="u-r" required>${opts(roles, u ? u.role : '', 'اختر الدور…')}</select></div>
  <div class="field"><label for="u-section">القسم <span class="req">*</span></label><select id="u-section">${opts(Object.entries(meta.sections), u ? u.section : '', 'القسمان (للإدارة العليا فقط)')}</select></div></div>
  <div class="field" id="u-spec-f"><label for="u-spec">التخصص (للمحكم)</label><select id="u-spec">${opts(meta.specialties.map((s) => [s, s]), u ? u.specialty : '', 'اختر التخصص…')}</select></div>
  <div class="row2"><div class="field"><label for="u-phone">الهاتف</label><input id="u-phone" class="ltr" value="${esc(u ? u.phone : '')}"></div><div class="field"><label for="u-email">البريد</label><input id="u-email" class="ltr" type="email" value="${esc(u ? u.email : '')}"></div></div>
  <p class="note">الإدارة التنفيذية ورئيس التحكيم والمحكمون يرون قسمهم فقط. الإدارة العليا ترى القسمين.</p>
  <div class="acts"><button class="btn pri" type="submit">${u ? 'حفظ' : 'إنشاء الحساب'}</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`);
}

// ---------- سجل التدقيق ----------
async function vAudit() {
  const a = S.audit;
  a.data = await api(`/audit?page=${a.page}${a.section ? '&section=' + a.section : ''}`);
  const d = a.data, pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  return `<div class="head"><div><h1>سجل التدقيق</h1><p>كل تغيير بالفاعل والوقت والسبب والقيم السابقة واللاحقة. السجل للإضافة فقط ولا يُعدَّل.</p></div>
    <div class="acts" role="group" aria-label="القسم">${[['', 'الكل'], ['M', 'الرجال'], ['F', 'النساء']].map(([k, n]) => `<button class="btn sm ${a.section === k ? 'pri' : ''}" data-act="asec" data-s="${k}">${n}</button>`).join('')}</div></div>
  <div class="card"><ul class="log">${d.rows.map((x) => `<li><b>${esc(ACT[x.action] || x.action)}</b> — ${esc(x.summary)}${x.reason ? `<br>السبب: ${esc(x.reason)}` : ''}
    <div class="meta">${esc(x.actor)}${x.actorRole ? ' (' + esc(x.actorRole) + ')' : ''} · ${esc(fmt(x.at))}${x.section ? ' · ' + esc(meta.sections[x.section]) : ''}</div>
    ${x.before || x.after ? `<details><summary class="note">التفاصيل</summary>${x.before ? `<pre>${esc(JSON.stringify(x.before, null, 1))}</pre>` : ''}${x.after ? `<pre>${esc(JSON.stringify(x.after, null, 1))}</pre>` : ''}</details>` : ''}</li>`).join('') || '<li class="empty">لا يوجد</li>'}</ul>
  <div class="pager"><span class="note">صفحة ${d.page} من ${pages} · ${d.total} حدثًا</span><div class="acts"><button class="btn sm" data-act="apage" data-p="${d.page - 1}" ${d.page > 1 ? '' : 'disabled'}>الأحدث</button><button class="btn sm" data-act="apage" data-p="${d.page + 1}" ${d.page < pages ? '' : 'disabled'}>الأقدم</button></div></div></div>`;
}

// ---------- الاستقبال وتسجيل الحضور ----------
const TK = { waiting: 'info', needs_committee: 'warn', called: 'warn', testing: 'plum', done: 'ok', no_show: 'bad', cancelled: '' };
const tTag = (t) => `<span class="tag ${TK[t.status] || ''}">${t.seq ? '#' + t.seq + ' · ' : ''}${esc(t.statusName)}${t.committee ? ' · ' + esc(t.committee) : ''}</span>`;
async function vReception() {
  const f = S.rec = S.rec || { q: '', section: '', category: '', state: '', page: 1 };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const d = S.recData = await api('/reception?' + qs);
  const c = d.counts, pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const row = (r) => {
    const el = r.entries.filter((e) => e.needsCommittee && (!e.ticket || e.ticket.status === 'cancelled'));
    const quick = el.length && el.every((e) => e.candidates.length === 1);
    return `<tr><td><b>${esc(r.name)}</b>${me.role === 'top' ? `<br><small class="note">${esc(r.sectionName)}</small>` : ''}</td><td>${esc(r.category)}</td>
    <td><div class="chips">${r.entries.map((e) => `<span class="ent"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b> ${!e.needsCommittee ? '<span class="tag">اختبار إلكتروني</span>' : e.ticket && e.ticket.status !== 'cancelled' ? tTag(e.ticket) + (['waiting', 'needs_committee', 'no_show'].includes(e.ticket.status) ? ` <button class="btn link" data-act="tk-cancel" data-id="${e.ticket.id}">إلغاء</button>` : '') : '<span class="tag">لم يحضر</span>'}</span>`).join('')}</div></td>
    <td>${el.length ? `<button class="btn ${quick ? 'pri' : ''} sm" data-act="${quick ? 'ci-quick' : 'ci-open'}" data-id="${r.id}">${quick ? 'تثبيت الحضور' : 'تسجيل الحضور…'}</button>${quick && el.length > 1 ? ` <button class="btn link" data-act="ci-open" data-id="${r.id}">اختيار</button>` : ''}` : '<span class="tag ok">حاضر</span>'}</td></tr>`;
  };
  return `<div class="head"><div><h1>الاستقبال وتسجيل الحضور</h1><p>${esc(d.stageName)} · ${me.role === 'top' ? (f.section ? esc(meta.sections[f.section]) : 'القسمان') : esc(me.sectionName)} · الأسماء مرتبة أبجديًا، والدور في الطابور بحسب وقت تثبيت الحضور</p></div><div class="acts"><a class="btn" href="#queues">الطوابير</a></div></div>
  <div class="kpis"><div class="kpi main"><b>${c.persons || 0}</b><span>حاضرون</span></div><div class="kpi"><b>${c.waiting || 0}</b><span>في الانتظار</span></div><div class="kpi"><b>${c.active || 0}</b><span>نودوا أو جارٍ اختبارهم</span></div><div class="kpi"><b>${c.done || 0}</b><span>انتهى اختبارهم</span></div><div class="kpi"><b>${c.needs || 0}</b><span>بانتظار تحديد اللجنة</span></div></div>
  <div class="card"><form class="filters" data-form="recf" role="search"><input type="search" id="rf-q" value="${esc(f.q)}" placeholder="ابحث بالاسم أو الهوية أو الهاتف" aria-label="بحث" autofocus>
    ${me.role === 'top' ? `<select id="rf-section" aria-label="القسم">${opts(Object.entries(meta.sections), f.section, 'القسمان')}</select>` : ''}
    <select id="rf-category" aria-label="الفئة">${opts(pub.categories.map((x) => [x.id, x.name]), f.category, 'كل الفئات')}</select>
    <select id="rf-state" aria-label="الحضور">${opts([['absent', 'لم يحضروا'], ['present', 'حاضرون']], f.state, 'الجميع')}</select><button class="btn pri" type="submit">بحث</button></form>
  <p class="note">${d.total} متسابقًا مقبولًا</p>
  ${d.rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>الاسم</th><th>الفئة</th><th>المشاركات والحضور</th><th></th></tr></thead><tbody>${d.rows.map(row).join('')}</tbody></table></div>
  <div class="pager"><span class="note">صفحة ${d.page} من ${pages}</span><div class="acts"><button class="btn sm" data-act="rpage" data-p="${d.page - 1}" ${d.page > 1 ? '' : 'disabled'}>السابق</button><button class="btn sm" data-act="rpage" data-p="${d.page + 1}" ${d.page < pages ? '' : 'disabled'}>التالي</button></div></div>`
    : '<div class="empty"><p>لا يوجد متسابقون مطابقون. يظهر هنا المقبولون فقط.</p></div>'}</div>`;
}
function checkinForm(r) {
  const el = r.entries.filter((e) => e.needsCommittee && (!e.ticket || e.ticket.status === 'cancelled'));
  modal('تسجيل حضور ' + r.name, `<p class="note">اختر المشاركات التي يحضرها اليوم. حضور الحفظ لا يعني حضور التلاوة تلقائيًا.</p><form data-form="checkin" data-id="${r.id}"><p class="err" hidden></p>
  ${el.map((e) => `<div class="pick on"><label class="check"><input type="checkbox" name="e" value="${e.id}" checked>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</label>
    ${e.candidates.length > 1 ? `<div class="field"><label>اللجنة</label><select name="c-${e.id}">${opts(e.candidates.map((x) => [x.id, x.name + (x.hall ? ' — ' + x.hall : '')]), '', 'اختر اللجنة…')}</select></div>`
      : e.candidates.length ? `<p class="note">اللجنة: ${esc(e.candidates[0].name)}${e.candidates[0].hall ? ' — ' + esc(e.candidates[0].hall) : ''}</p>` : '<p class="err">لا توجد لجنة مطابقة؛ يُسجَّل حضوره «بانتظار تحديد اللجنة».</p>'}</div>`).join('')}
  <div class="acts"><button class="btn pri" type="submit">تثبيت الحضور</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`);
}
async function doCheckin(regId, items) {
  const r = await api('/checkin', { method: 'POST', body: { registrationId: regId, items } });
  toast(r.tickets.map((t) => `رقم ${t.seq}: ${t.committee || 'بانتظار تحديد اللجنة'}`).join(' · '));
}

// ---------- الطوابير والنداء ----------
const since = (t) => { if (!t) return ''; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m < 1 ? 'الآن' : `منذ ${m} د`; };
async function vQueues() {
  const q = S.q = S.q || { section: '' };
  const d = await api('/queues' + (me.role === 'top' && q.section ? '?section=' + q.section : ''));
  startPoll(3000, repaint);
  const card = (c) => {
    const cur = c.current, w = c.waiting;
    let act = '';
    if (c.canOperate) {
      if (!cur) act = `<button class="btn pri big-btn" data-act="q-next" data-id="${c.id}" ${w.some((x) => !x.busy) ? '' : 'disabled'}>نداء التالي</button>`;
      else if (cur.status === 'called') act = `<button class="btn pri" data-act="q-act" data-a="start" data-id="${cur.id}">بدء الاختبار</button><button class="btn" data-act="q-act" data-a="recall" data-id="${cur.id}">إعادة النداء</button><button class="btn badb" data-act="q-act" data-a="noshow" data-id="${cur.id}">لم يستجب</button>`;
      else act = `<button class="btn pri big-btn" data-act="q-act" data-a="finish" data-id="${cur.id}">إنهاء الاختبار</button>`;
    }
    return `<article class="card qcard ${cur ? 'q-' + cur.status : ''}"><div class="qh"><div><h3>${esc(c.name)}</h3><span class="note">${esc(c.hall || '—')}${me.role === 'top' ? ' · ' + esc(c.sectionName) : ''}</span></div><span class="note">منتظر ${w.length} · انتهى ${c.done}</span></div>
      <div class="qcur">${cur ? `<span class="tag ${TK[cur.status]}">${esc(cur.statusName)}${cur.calls > 1 ? ' · نداء ' + cur.calls : ''}</span><b>${esc(cur.name)}</b><small>${esc(cur.category)}${cur.trackName ? ' · ' + esc(cur.trackName) : ''} · ${since(cur.status === 'testing' ? cur.startedAt : cur.calledAt)}</small>` : '<span class="note">لا يوجد متسابق حالي</span>'}</div>
      ${act ? `<div class="acts">${act}</div>` : ''}
      <ol class="qlist">${w.slice(0, 6).map((t) => `<li><span class="seq">${t.seq}</span><span>${esc(t.name)}</span>${t.busy ? '<span class="tag warn">في لجنة أخرى</span>' : ''}</li>`).join('') || '<li class="note">لا منتظرين</li>'}${w.length > 6 ? `<li class="note">و${w.length - 6} آخرون</li>` : ''}</ol></article>`;
  };
  return `<div class="head"><div><h1>${me.role === 'judge' ? 'طابور لجنتي' : 'الطوابير والنداء'}</h1><p>${esc(d.stageName)} · يتحدث تلقائيًا كل 3 ثوانٍ</p></div>
    <div class="acts">${me.role === 'top' ? [['', 'القسمان'], ['M', 'الرجال'], ['F', 'النساء']].map(([k, n]) => `<button class="btn sm ${q.section === k ? 'pri' : ''}" data-act="qsec" data-s="${k}">${n}</button>`).join('') : ''}${['exec', 'chief', 'top'].includes(me.role) ? '<a class="btn sm" href="#screen">شاشة الانتظار</a>' : ''}</div></div>
  ${d.needsCommittee.length ? `<div class="card warnbox"><h3>بانتظار تحديد اللجنة (${d.needsCommittee.length})</h3>${d.needsCommittee.map((t) => `<div class="acts needs"><span><b>${esc(t.name)}</b> · ${esc(t.branchName)}${t.trackName ? ' · ' + esc(t.trackName) : ''} · ${esc(t.category)} · #${t.seq}</span>
    ${t.candidates.length ? `<select id="as-${t.id}" aria-label="اللجنة">${opts(t.candidates.map((x) => [x.id, x.name]), '', 'اختر اللجنة…')}</select><button class="btn sm pri" data-act="tk-assign" data-id="${t.id}">إسناد</button>` : '<span class="tag bad">لا توجد لجنة مطابقة: أنشئ لجنة من «اللجان»</span>'}</div>`).join('')}</div>` : ''}
  ${d.committees.length ? `<div class="qgrid">${d.committees.map(card).join('')}</div>` : `<div class="card empty"><p>${['judge', 'coordinator'].includes(me.role) ? 'لم تُكلَّف بلجنة بعد.' : 'لا توجد لجان نشطة.'}</p></div>`}`;
}

// ---------- اللجان والتكليفات ----------
async function vCommittees() {
  const q = S.cm = S.cm || { section: '' };
  const [{ committees }, staff] = await Promise.all([api('/committees' + (me.role === 'top' && q.section ? '?section=' + q.section : '')), ['exec', 'top'].includes(me.role) ? api('/staff').then((x) => x.staff) : Promise.resolve([])]);
  S.committees = committees; S.staff = staff;
  const admin = ['exec', 'top'].includes(me.role);
  const card = (c) => {
    const pool = staff.filter((u) => u.section === c.section && !c.members.some((m) => m.userId === u.id));
    return `<article class="card"><div class="qh"><div><h3>${esc(c.name)} ${c.active ? '' : '<span class="tag bad">موقوفة</span>'}</h3><span class="note">${esc(c.hall || 'بدون قاعة')} · ${esc(c.stageName)}${me.role === 'top' ? ' · ' + esc(c.sectionName) : ''}</span></div>
      ${c.canAdmin ? `<div class="acts"><button class="btn sm" data-act="cm-edit" data-id="${c.id}">تعديل</button></div>` : ''}</div>
      <p class="note">${esc(c.branchName)}${c.trackNames.length ? ' · ' + c.trackNames.map(esc).join('، ') : ' · كل المسارات'} · ${c.categoryNames.length ? c.categoryNames.map(esc).join('، ') : 'كل الفئات'}</p>
      <ul class="members">${c.members.map((m) => `<li><span>${esc(m.name)} <small class="note">${m.kind === 'judge' ? esc(m.specialty || 'محكم') : 'منسق النداء'}</small></span>${c.canAdmin ? `<button class="btn link" data-act="cm-unassign" data-id="${c.id}" data-u="${m.userId}" aria-label="إلغاء تكليف ${esc(m.name)}">إلغاء</button>` : ''}</li>`).join('') || '<li class="note">لا تكليفات بعد</li>'}</ul>
      ${c.canAdmin && pool.length ? `<div class="acts"><select id="cm-u-${c.id}" aria-label="المستخدم">${opts(pool.map((u) => [u.id, u.name + ' — ' + (u.specialty || u.roleName)]), '', 'تكليف مستخدم…')}</select><select id="cm-k-${c.id}" aria-label="نوع التكليف">${opts([['judge', 'محكم'], ['coordinator', 'منسق النداء']], 'judge')}</select><button class="btn sm pri" data-act="cm-assign" data-id="${c.id}">تكليف</button></div>` : ''}</article>`;
  };
  return `<div class="head"><div><h1>لجان التحكيم</h1><p>كل لجنة لفرع ومسار وفئات محددة في قسم واحد. يُسند الحاضر تلقائيًا إلى اللجنة المطابقة، وتظهر قاعتها على شاشة الانتظار.</p></div>
    <div class="acts">${me.role === 'top' ? [['', 'القسمان'], ['M', 'الرجال'], ['F', 'النساء']].map(([k, n]) => `<button class="btn sm ${q.section === k ? 'pri' : ''}" data-act="cmsec" data-s="${k}">${n}</button>`).join('') : ''}${admin ? '<button class="btn pri" data-act="cm-new">إضافة لجنة</button>' : ''}</div></div>
  ${admin && !staff.some((u) => u.role === 'judge') ? '<div class="banner info">لا توجد حسابات محكمين في القسم بعد. تنشئها الإدارة العليا من «الحسابات».</div>' : ''}
  <div class="qgrid">${committees.map(card).join('')}</div>`;
}
function committeeForm(c) {
  const branches = pub.branches.filter((b) => b.registrable && pub.curricula.some((x) => x.branch === b.code));
  const br = c ? c.branch : branches[0].code;
  modal(c ? 'تعديل ' + c.name : 'إضافة لجنة', `<form data-form="committee" data-id="${c ? c.id : ''}"><p class="err" hidden></p>
  <div class="row2"><div class="field"><label for="k-n">اسم اللجنة</label><input id="k-n" value="${esc(c ? c.name : '')}" required></div><div class="field"><label for="k-h">القاعة أو الموقع (يظهر على الشاشة)</label><input id="k-h" value="${esc(c ? c.hall : '')}"></div></div>
  ${!c && me.role === 'top' ? `<div class="field"><label for="k-s">القسم</label><select id="k-s">${opts(Object.entries(meta.sections), S.cm.section || 'M')}</select></div>` : ''}
  <div class="field"><label for="k-b">الفرع</label><select id="k-b" data-act-change="kb">${opts(branches.map((b) => [b.code, b.name]), br)}</select></div>
  <div id="k-scope">${scopeBoxes(br, c)}</div>
  ${c ? `<label class="check"><input type="checkbox" id="k-a" ${c.active ? 'checked' : ''}>اللجنة نشطة</label>` : ''}
  <div class="acts"><button class="btn pri" type="submit">حفظ</button>${c ? `<button class="btn badb" type="button" data-act="cm-del" data-id="${c.id}">حذف</button>` : ''}<button class="btn" type="button" data-act="close">إلغاء</button></div></form>`);
}
function scopeBoxes(br, c) {
  const tracks = [...new Map(pub.curricula.filter((x) => x.branch === br && x.trackName).map((x) => [x.track, x.trackName])).entries()];
  const cats = pub.categories.filter((x) => x.branches.includes(br));
  return `${tracks.length > 1 ? `<div class="field"><span class="lab">المسارات (بدون تحديد = كلها)</span><div class="boxes">${tracks.map(([t, n]) => `<label><input type="checkbox" name="kt" value="${esc(t)}" ${c && c.tracks.includes(t) ? 'checked' : ''}>${esc(n)}</label>`).join('')}</div></div>` : ''}
  <div class="field"><span class="lab">الفئات (بدون تحديد = كلها)</span><div class="boxes">${cats.map((x) => `<label><input type="checkbox" name="kc" value="${x.id}" ${c && c.categories.includes(x.id) ? 'checked' : ''}>${esc(x.name)}</label>`).join('')}</div><small>اسم اللجنة قد يجمع أكثر من فئة للتشغيل، ولا يعني ذلك دمجها في الترتيب.</small></div>`;
}

// ---------- شاشة قاعة الانتظار ----------
const SCR = { last: 0, first: true, sound: false, section: 'M' };
async function vScreen() {
  const d = await api('/screen?since=' + SCR.last + (me.role === 'top' ? '&section=' + SCR.section : ''));
  const fresh = SCR.first ? [] : d.calls.filter((c) => c.fresh).reverse();
  SCR.first = false; SCR.last = d.lastId;
  if (fresh.length) announce(fresh);
  startPoll(2000, repaint);
  const top = d.calls[0];
  return `<div class="scr"><header class="scr-top"><div><b>اقرأ<i>.</i></b> <span>${esc(d.competition)} · ${esc(d.stageName)} · ${esc(d.sectionName)}</span></div>
    <div class="acts"><span class="clock">${new Date().toLocaleTimeString('ar-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}</span>
    ${me.role === 'top' ? `<button class="btn sm ghost" data-act="ssec">${SCR.section === 'M' ? 'عرض قسم النساء' : 'عرض قسم الرجال'}</button>` : ''}
    <button class="btn sm ${SCR.sound ? 'gold' : 'ghost'}" data-act="sound">${SCR.sound ? 'الصوت مفعّل' : 'تفعيل الصوت'}</button><button class="btn sm ghost" data-act="fs">ملء الشاشة</button>${me.role !== 'screen' ? `<a class="btn sm ghost" href="#${homeOf()}">خروج من الشاشة</a>` : ''}</div></header>
  <section class="scr-now ${top && top.fresh ? 'flash' : ''}">${top ? `<p class="lbl">${top.kind === 'recall' ? 'نداء متكرر' : 'النداء الحالي'}</p><h1>${esc(top.name)}</h1><p class="to">يتوجه إلى <b>${esc(top.committee)}</b>${top.hall ? ` · <b>${esc(top.hall)}</b>` : ''}</p>` : '<p class="lbl">قاعة الانتظار</p><h1>أهلًا بكم</h1><p class="to">ستظهر هنا أسماء المتسابقين عند نداء لجانهم</p>'}</section>
  <div class="scr-body"><div class="scr-grid">${d.committees.map((k) => `<div class="scr-c ${k.current ? 's-' + k.current.status : ''}"><span class="scr-h">${esc(k.name)}<small>${esc(k.hall)}</small></span><b>${k.current ? esc(k.current.name) : '—'}</b><span class="scr-st">${k.current ? esc(k.current.statusName) : 'بانتظار النداء'} · منتظر ${k.waiting}</span></div>`).join('')}</div>
  <aside class="scr-log"><h2>آخر النداءات</h2><ol>${d.calls.slice(0, 8).map((c) => `<li><b>${esc(c.name)}</b><span>${esc(c.committee)}${c.hall ? ' · ' + esc(c.hall) : ''}</span></li>`).join('') || '<li>لا نداءات بعد</li>'}</ol></aside></div></div>`;
}
function chime() { try { const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.2, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.9); o.start(); o.stop(a.currentTime + 0.9); } catch (e) {} }
function announce(list) {
  if (!SCR.sound) return;
  chime();
  if (!('speechSynthesis' in window)) return;
  const voice = speechSynthesis.getVoices().find((v) => /^ar/i.test(v.lang));
  for (const c of list) {
    const u = new SpeechSynthesisUtterance(`${c.kind === 'recall' ? 'نداء متكرر. ' : ''}المتسابق ${c.name}، يرجى التوجه إلى ${c.committee}${c.hall ? '، ' + c.hall : ''}`);
    u.lang = 'ar'; if (voice) u.voice = voice; u.rate = 0.9; speechSynthesis.speak(u);
  }
}

const VIEWS = { home: vHome, login: vLogin, signup: vSignup, account: vAccount, space: vSpace, my: vMy, regs: vRegs, dash: vDash, setup: vSettings, users: vUsers, audit: vAudit, reception: vReception, queues: vQueues, committees: vCommittees, screen: vScreen };

// ---------- الأحداث ----------
const val = (id) => (document.getElementById(id) || {}).value || '';
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  if (b.tagName === 'A') return;
  e.preventDefault();
  try {
    if (a === 'close') closeModal();
    else if (a === 'logout') { await api('/logout', { method: 'POST' }).catch(() => {}); me = null; S.wz = null; go('home'); }
    else if (a === 'copy') { try { await navigator.clipboard.writeText(b.dataset.v); toast('نُسخت'); } catch { toast('انسخها يدويًا'); } }
    else if (a === 'more') { const br = pub.branches.find((x) => x.code === b.dataset.code); modal(br.name + ': الشروط والمتطلبات', `${br.conditions.split('\n').filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('')}${br.stages ? `<p class="note">المراحل: ${esc(br.stages)}</p>` : ''}<div class="acts"><button class="btn" data-act="close">إغلاق</button></div>`); }
    // المعالج
    else if (a === 'wz-start') wzInit(false);
    else if (a === 'wz-edit') wzInit(true);
    else if (a === 'wz-cancel') { S.wz = null; render(); }
    else if (a === 'wz-next') { S.wz.step++; paintWz(); }
    else if (a === 'wz-back') { S.wz.step--; paintWz(); }
    else if (a === 'wz-submit') {
      if (busy) return; busy = true; b.disabled = true;
      const w = S.wz;
      try {
        await api('/my/registration', { method: 'POST', body: { birthYear: w.year, gender: w.gender, phone2: w.phone2, entries: Object.entries(w.picks).map(([branch, track]) => ({ branch, track })) } });
        S.wz = null; toast(w.edit ? 'حُفظ التعديل' : 'تم استلام طلبك بنجاح'); render();
      } catch (err) { b.disabled = false; showErr($('#view .err'), err); } finally { busy = false; }
    }
    else if (a === 'withdraw') modal('الانسحاب من المسابقة', `<p>يُسجَّل انسحابك من جميع مشاركاتك في هذه الدورة، ويبقى طلبك محفوظًا في السجل. لا يمكنك التراجع عنه من حسابك.</p><form data-form="withdraw"><p class="err" hidden></p><div class="field"><label for="wd-r">السبب (اختياري)</label><textarea id="wd-r"></textarea></div><div class="acts"><button class="btn badb" type="submit">تأكيد الانسحاب</button><button class="btn" type="button" data-act="close">تراجع</button></div></form>`);
    else if (a === 'phones') modal('تحديث أرقام التواصل', `<form data-form="phones"><p class="err" hidden></p><div class="field"><label for="ph-1">الهاتف الأساسي</label><input id="ph-1" class="ltr" type="tel" value="${esc(S.my.person.phone)}" required></div><div class="field"><label for="ph-2">هاتف آخر</label><input id="ph-2" class="ltr" type="tel" value="${esc(S.my.person.phone2)}"></div><div class="acts"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`);
    // التسجيلات
    else if (a === 'csv') {
      if (!window.__iqraDemo) { location.href = b.dataset.href; return; }
      const t = (await (await fetch(b.dataset.href, { headers: { 'X-Iqra': '1' } })).text()).replace(/^\ufeff/, '');
      modal('تصدير التسجيلات', `<p class="note">في النسخة التجريبية لا يُنزَّل الملف. في النسخة المنشورة يُنزَّل ملف CSV يفتح في Excel مباشرة.</p><textarea class="ltr" rows="12" readonly>${esc(t)}</textarea><div class="acts"><button class="btn pri" data-act="copy" data-v="${esc(t)}">نسخ</button></div>`);
    }
    else if (a === 'reg') await openReg(+id);
    else if (a === 'page') { S.regs.page = +b.dataset.p; render(); }
    else if (a === 'pending') { Object.assign(S.regs, { status: 'submitted', page: 1 }); go('regs'); }
    else if (a === 'rst') {
      const r = await api(`/registrations/${id}/status`, { method: 'POST', body: { status: b.dataset.s, note: val('r-note') } });
      toast('الحالة: ' + r.registration.statusName); await openReg(+id); if (view === 'regs' || view === 'dash') render();
    }
    else if (a === 'correct') correctForm(S.cur);
    else if (a === 'reset-c') { const r = await api(`/registrations/${id}/reset-password`, { method: 'POST' }); pwBox('كلمة مرور مؤقتة للمتسابق', r.login, r.tempPassword); }
    else if (a === 'dsec') { S.dash.section = b.dataset.s; render(); }
    // الإعداد
    else if (a === 'add-cat') $('#cat-rows').insertAdjacentHTML('beforeend', catRow({}, S.adm.branches));
    else if (a === 'add-curr') $('#curr-rows').insertAdjacentHTML('beforeend', currRow({ branch: 'hifz' }, S.adm.branches, [['', 'لكل الأعمار'], ...S.adm.categories.map((x) => [x.id, x.name])]));
    else if (a === 'del-row') b.closest('tr').remove();
    // الحسابات
    else if (a === 'new-user') { userForm(null); specToggle(); }
    else if (a === 'edit-user') { userForm(S.users.find((u) => u.id === +id)); specToggle(); }
    else if (a === 'reset-u') { const u = S.users.find((x) => x.id === +id); const r = await api(`/users/${id}/reset`, { method: 'POST' }); pwBox('كلمة مرور مؤقتة', u.login, r.tempPassword); }
    else if (a === 'toggle-u') { const u = S.users.find((x) => x.id === +id); await api('/users/' + id, { method: 'PATCH', body: { active: !u.active } }); toast(u.active ? 'أُوقف الحساب' : 'فُعّل الحساب'); render(); }
    // الاستقبال
    else if (a === 'rpage') { S.rec.page = +b.dataset.p; render(); }
    else if (a === 'ci-open') checkinForm(S.recData.rows.find((r) => r.id === +id));
    else if (a === 'ci-quick') {
      if (busy) return; busy = true; b.disabled = true;
      try { const r = S.recData.rows.find((x) => x.id === +id); await doCheckin(r.id, r.entries.filter((e) => e.needsCommittee && (!e.ticket || e.ticket.status === 'cancelled')).map((e) => ({ entryId: e.id, committeeId: e.candidates[0].id }))); render(); }
      finally { busy = false; }
    }
    else if (a === 'tk-cancel') modal('إلغاء الحضور', `<p>يُلغى تثبيت حضور هذه المشاركة ويخرج من الطابور. يُحفظ الإجراء في السجل.</p><form data-form="tkcancel" data-id="${id}"><p class="err" hidden></p><div class="field"><label for="tc-r">السبب <span class="req">*</span></label><textarea id="tc-r" required></textarea></div><div class="acts"><button class="btn badb" type="submit">إلغاء الحضور</button><button class="btn" type="button" data-act="close">تراجع</button></div></form>`);
    // الطوابير
    else if (a === 'qsec') { S.q.section = b.dataset.s; render(); }
    else if (a === 'q-next' || a === 'q-act') {
      if (busy) return; busy = true; b.disabled = true;
      try {
        const r = a === 'q-next' ? await api(`/committees/${id}/next`, { method: 'POST' }) : await api(`/tickets/${id}/action`, { method: 'POST', body: { action: b.dataset.a } });
        toast(a === 'q-next' ? 'نودي: ' + r.ticket.name : r.ticket.name + ': ' + r.ticket.statusName); await repaint();
      } catch (err) { toast(err.message); await repaint(); } finally { busy = false; }
    }
    else if (a === 'tk-assign') { const v = val('as-' + id); if (!v) return toast('اختر اللجنة'); await api(`/tickets/${id}/assign`, { method: 'POST', body: { committeeId: v } }); toast('أُسند إلى اللجنة'); repaint(); }
    // اللجان
    else if (a === 'cmsec') { S.cm.section = b.dataset.s; render(); }
    else if (a === 'cm-new') committeeForm(null);
    else if (a === 'cm-edit') committeeForm(S.committees.find((c) => c.id === +id));
    else if (a === 'cm-assign') { const u = val('cm-u-' + id); if (!u) return toast('اختر المستخدم'); await api(`/committees/${id}/members`, { method: 'POST', body: { userId: u, kind: val('cm-k-' + id) } }); toast('تم التكليف'); render(); }
    else if (a === 'cm-unassign') { await api(`/committees/${id}/members/${b.dataset.u}`, { method: 'DELETE' }); toast('أُلغي التكليف'); render(); }
    else if (a === 'cm-del') { await api('/committees/' + id, { method: 'DELETE' }); closeModal(); toast('حُذفت اللجنة'); render(); }
    // الشاشة
    else if (a === 'sound') { SCR.sound = !SCR.sound; if (SCR.sound) { chime(); try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) {} } repaint(); }
    else if (a === 'fs') { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (e) { toast('ملء الشاشة غير متاح هنا؛ استخدم F11'); } }
    else if (a === 'ssec') { SCR.section = SCR.section === 'M' ? 'F' : 'M'; SCR.first = true; SCR.last = 0; repaint(); }
    else if (a === 'asec') { Object.assign(S.audit, { section: b.dataset.s, page: 1 }); render(); }
    else if (a === 'apage') { S.audit.page = +b.dataset.p; render(); }
  } catch (err) { showErr(dlg.open ? $('#dlg-b .err') : null, err); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('tr.click')) e.target.click(); });
function specToggle() { const r = $('#u-r'); if (!r) return; $('#u-spec-f').hidden = r.value !== 'judge'; }
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'u-r') specToggle();
  if (t.id === 'u-role') { S.usersRole = t.value; render(); }
  if (['rf-section', 'rf-category', 'rf-state'].includes(t.id)) { S.rec[t.id.slice(3)] = t.value; S.rec.page = 1; render(); }
  if (t.id === 'k-b') $('#k-scope').innerHTML = scopeBoxes(t.value, null);
  if (['f-section', 'f-category', 'f-branch', 'f-status'].includes(t.id)) { S.regs[t.id.slice(2)] = t.value; S.regs.page = 1; render(); }
  const k = t.dataset.wz; if (!k || !S.wz) return;
  const w = S.wz;
  if (k === 'gender') { w.gender = t.value; paintWz(); }
  if (k === 'branch') { if (t.checked) { const br = w.elig.branches.find((x) => x.code === t.value); w.picks[t.value] = br.tracks.length === 1 ? br.tracks[0].track : ''; } else delete w.picks[t.value]; paintWz(); }
  if (k === 'track') { w.picks[t.dataset.branch] = t.value; paintWz(); }
  if (k === 'agree') { w.agree = t.checked; paintWz(); }
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset.wz; if (!k || !S.wz) return;
  if (k === 'year') { S.wz.year = e.target.value; checkYear(false); }
  if (k === 'phone2') S.wz.phone2 = e.target.value;
});

document.addEventListener('submit', async (e) => {
  const f = e.target, k = f.dataset.form; if (!k) return;
  e.preventDefault();
  const box = f.querySelector('.err') || (dlg.open ? $('#dlg-b .err') : null); if (box) box.hidden = true;
  const btn = f.querySelector('[type=submit]'); if (busy) return; busy = true; if (btn) btn.disabled = true;
  try {
    if (k === 'login') { const r = await api('/login', { method: 'POST', body: { login: val('l-login'), password: val('l-pass') } }); me = r.user; go(homeOf()); }
    else if (k === 'signup') {
      if (val('s-pass') !== val('s-pass2')) throw new Error('كلمتا المرور غير متطابقتين');
      const r = await api('/signup', { method: 'POST', body: { nationalId: val('s-id'), fullName: val('s-name'), phone: val('s-phone'), password: val('s-pass') } });
      me = r.user; toast('أُنشئ حسابك'); S.wz = null; go('my');
    }
    else if (k === 'password') {
      if (val('p-new') !== val('p-new2')) throw new Error('كلمتا المرور الجديدتان غير متطابقتين');
      await api('/password', { method: 'POST', body: { current: val('p-cur'), next: val('p-new') } });
      me = (await api('/me')).user; toast('غُيّرت كلمة المرور'); route();
    }
    else if (k === 'withdraw') { await api('/my/withdraw', { method: 'POST', body: { reason: val('wd-r') } }); closeModal(); toast('سُجّل انسحابك'); render(); }
    else if (k === 'phones') { await api('/my/profile', { method: 'PATCH', body: { phone: val('ph-1'), phone2: val('ph-2') } }); closeModal(); toast('حُفظت أرقام التواصل'); render(); }
    else if (k === 'recf') { S.rec.q = val('rf-q'); S.rec.page = 1; await render(); const i = $('#rf-q'); if (i) { i.focus(); i.select(); } }
    else if (k === 'checkin') {
      const items = $$('input[name=e]:checked', f).map((x) => { const sel = f.elements['c-' + x.value]; return { entryId: +x.value, committeeId: sel ? sel.value || null : undefined }; });
      if (items.some((x) => x.committeeId === null)) throw new Error('اختر اللجنة لكل مشاركة');
      await doCheckin(+f.dataset.id, items); closeModal(); render();
    }
    else if (k === 'tkcancel') { await api(`/tickets/${f.dataset.id}/cancel`, { method: 'POST', body: { reason: val('tc-r') } }); closeModal(); toast('أُلغي الحضور'); render(); }
    else if (k === 'committee') {
      const id = f.dataset.id;
      const body = { name: val('k-n'), hall: val('k-h'), branch: val('k-b'), tracks: $$('[name=kt]:checked', f).map((x) => x.value), categories: $$('[name=kc]:checked', f).map((x) => +x.value) };
      if ($('#k-s')) body.section = val('k-s');
      if (id) { body.active = $('#k-a').checked; await api('/committees/' + id, { method: 'PUT', body }); } else await api('/committees', { method: 'POST', body });
      closeModal(); toast('حُفظت اللجنة'); render();
    }
    else if (k === 'regf') { S.regs.q = val('f-q'); S.regs.page = 1; render(); }
    else if (k === 'correct') {
      const id = f.dataset.id;
      const body = { fullName: val('c-name'), nationalId: val('c-id'), phone: val('c-phone'), phone2: val('c-phone2'), birthYear: val('c-year') };
      if ($('#c-gender')) body.gender = val('c-gender');
      if (f.dataset.ready) {
        body.confirm = true; body.reason = val('c-reason');
        await api(`/registrations/${id}/correct`, { method: 'POST', body }); toast('طُبّق التصحيح ووُثّق'); await openReg(+id); if (view === 'regs') render();
      } else {
        const { preview: p } = await api(`/registrations/${id}/correct`, { method: 'POST', body });
        $('#c-impact').innerHTML = `<div class="card"><h3>أثر التصحيح</h3><ul>${p.changes.map((c) => `<li>${esc(c.field)}: ${esc(c.from || '—')} ← <b>${esc(c.to || '—')}</b></li>`).join('')}</ul>
          ${p.category.from !== p.category.to ? `<p class="banner">تتغير الفئة من «${esc(p.category.from)}» إلى «${esc(p.category.to)}».</p>` : ''}
          ${p.dropped.length ? `<p class="err">تُلغى هذه المشاركات لأنها غير متاحة للفئة الجديدة: ${p.dropped.map((d) => esc(d.branchName + (d.trackName ? ' · ' + d.trackName : ''))).join('، ')}</p>` : ''}
          ${p.recurr.length ? `<p>يتغير المقرر: ${p.recurr.map((d) => `${esc(d.branchName)}: ${esc(d.from)} ← <b>${esc(d.to)}</b>`).join('؛ ')}</p>` : ''}
          <div class="field"><label for="c-reason">سبب التصحيح <span class="req">*</span></label><textarea id="c-reason" required></textarea></div></div>`;
        f.dataset.ready = '1'; btn.textContent = 'تطبيق التصحيح';
        $$('#c-name,#c-id,#c-phone,#c-phone2,#c-year,#c-gender', f).forEach((x) => { x.readOnly = true; if (x.tagName === 'SELECT') x.disabled = true; });
      }
    }
    else if (k === 'comp') {
      await api('/admin/competition', { method: 'PUT', body: { name: val('k-name'), number: val('k-number'), year: val('k-year'), regOpen: val('k-open'), regClose: val('k-close'), editClose: val('k-edit'), status: val('k-status'), minBirthYear: val('k-min'), notes: val('k-notes') } });
      await refreshPublic(); toast('حُفظت بيانات الدورة'); render();
    }
    else if (k === 'cats') {
      const categories = $$('#cat-rows tr').map((tr) => ({ id: tr.dataset.id || null, name: $('[name=name]', tr).value, fromYear: $('[name=from]', tr).value, toYear: $('[name=to]', tr).value, branches: $$('[name=br]:checked', tr).map((x) => x.value) }));
      await api('/admin/categories', { method: 'PUT', body: { categories } }); await refreshPublic(); toast('حُفظت الفئات'); render();
    }
    else if (k === 'curr') {
      const curricula = $$('#curr-rows tr').map((tr) => ({ id: tr.dataset.id || null, branch: $('[name=branch]', tr).value, track: $('[name=track]', tr).value, trackName: $('[name=trackName]', tr).value, categoryId: $('[name=cat]', tr).value || null, content: $('[name=content]', tr).value }));
      await api('/admin/curricula', { method: 'PUT', body: { curricula } }); await refreshPublic(); toast('حُفظت المقررات'); render();
    }
    else if (k === 'branch') {
      const g = (n) => f.elements[n];
      await api('/admin/branches/' + f.dataset.id, { method: 'PUT', body: { name: g('name').value, stages: g('stages').value, intro: g('intro').value, conditions: g('conditions').value, registrable: g('registrable').checked } });
      await refreshPublic(); toast('حُفظ الفرع');
    }
    else if (k === 'newcomp') {
      await api('/admin/competitions', { method: 'POST', body: { name: val('n-name'), number: val('n-number'), year: val('n-year') } });
      await refreshPublic(); toast('أُنشئت الدورة الجديدة بحالة مسودة'); render();
    }
    else if (k === 'user') {
      const id = f.dataset.id;
      const body = { name: val('u-name'), role: val('u-r'), section: val('u-section'), specialty: val('u-spec'), phone: val('u-phone'), email: val('u-email') };
      if (id) { await api('/users/' + id, { method: 'PATCH', body }); closeModal(); toast('حُفظ الحساب'); render(); }
      else { const r = await api('/users', { method: 'POST', body: { ...body, login: val('u-login') } }); pwBox('أُنشئ الحساب', r.user.login, r.tempPassword); render(); }
    }
  } catch (err) { showErr(box, err); }
  finally { busy = false; if (btn) btn.disabled = false; }
});

// إعادة قراءة الحساب بعد الدخول من خارج الواجهة (تستخدمه النسخة التجريبية)
window.__iqraRefresh = async () => { closeModal(); S.wz = null; try { me = (await api('/me')).user; } catch { me = null; } pub = await api('/public'); if (location.hash.slice(1) === homeOf()) route(); else go(homeOf()); };

// ---------- البدء ----------
(async () => {
  try {
    [meta, pub] = await Promise.all([api('/meta'), api('/public')]);
    $('#org').textContent = meta.org;
    try { me = (await api('/me')).user; } catch { me = null; }
  } catch (e) { $('#view').innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  route();
})();
})();
