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
  if (res.status === 403 && data.mustChange) { if (me && !me.mustChange) { me.mustChange = true; render(); } throw new Error(data.error); }
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
  contestant: [['my', 'مشاركتي'], ['tests', 'اختبار التفسير'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  judge: [['grade', 'الرصد'], ['queues', 'طابور لجنتي'], ['space', 'مساحتي'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  coordinator: [['queues', 'النداء'], ['space', 'مساحتي'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  chief: [['queues', 'الطوابير والنداء'], ['results', 'النتائج'], ['tests', 'اختبارات التفسير'], ['committees', 'اللجان'], ['regs', 'المسجلون (اطلاع)'], ['screen', 'شاشة الانتظار'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  exec: [['dash', 'لوحة القسم'], ['schedule', 'المواعيد'], ['days', 'توزيع الأيام'], ['reception', 'الاستقبال والحضور'], ['queues', 'الطوابير والنداء'], ['committees', 'اللجان'], ['regs', 'المسجلون'], ['tests', 'اختبارات التفسير'], ['draws', 'قرعة المقاطع'], ['materials', 'المذكرات'], ['screen', 'شاشة الانتظار'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  top: [['dash', 'لوحة المتابعة'], ['regs', 'المسجلون'], ['reception', 'الاستقبال والحضور'], ['queues', 'الطوابير والنداء'], ['results', 'النتائج'], ['tests', 'اختبارات التفسير'], ['draws', 'قرعة المقاطع'], ['committees', 'اللجان'], ['screen', 'شاشة الانتظار'], ['schedule', 'المواعيد'], ['days', 'توزيع الأيام'], ['materials', 'المذكرات'], ['notices', 'الإشعارات'], ['setup', 'إعداد الدورة'], ['users', 'حسابات الكادر'], ['audit', 'سجل التدقيق'], ['home', 'تعريف المسابقة'], ['account', 'حسابي']],
  screen: [['screen', 'شاشة الانتظار']],
};
const navFor = () => NAV[me ? me.role : 'public'];
const homeOf = () => navFor()[0][0];
function go(v) { if (location.hash !== '#' + v) location.hash = v; else route(); }
function route() {
  const h = location.hash.slice(1);
  if (h === 'view') { $('#view').focus(); history.replaceState(null, '', '#' + view); return; }
  const allowed = navFor().map((x) => x[0]).concat(me && me.role !== 'screen' ? ['inbox'] : []);
  view = allowed.includes(h) ? h : homeOf();
  stopPoll(); document.body.classList.toggle('screen-mode', view === 'screen');
  if (view === 'screen') { SCR.first = true; SCR.last = 0; fitScreen(); }
  if (view !== 'grade') S.fm = null;
  if (view !== 'tests') { S.exam = null; S.testId = null; clearInterval(EX.tick); }
  render(); scrollTo(0, 0);
}
addEventListener('hashchange', route);

// شعار المسابقة من ملف الشعار الأصلي (فاتح للخلفية الداكنة، وملوّن للفاتحة) وعلامتها: مسابقة اقرأ القرآنية [رقم الدورة] والسنة
const LOGO = '<img src="/emblem-light.png" alt="">', LOGO_C = '<img src="/emblem-color.png" alt="">';
function wordmark(c, big) {
  const n = c ? c.number : '', y = c ? String(c.year || '') : '';
  return `<span class="wm${big ? ' big' : ''}"><span class="wm-t"><small>مسابقة</small><b>اقرأ القرآنية</b></span>${n ? `<span class="wm-n">${esc(n)}</span>` : ''}${y ? `<span class="wm-y">${esc(y)}</span>` : ''}</span>`;
}
function shell() {
  const br = $('#brand'); if (br && !br.dataset.done && pub) { br.innerHTML = `<span class="emb">${LOGO}</span>${wordmark(pub.competition)}`; br.dataset.done = '1'; }
  $('#nav').innerHTML = navFor().map(([k, n]) => `<a href="#${k}" ${k === view ? 'aria-current="page"' : ''}>${n}</a>`).join('');
  $('#who').innerHTML = me ? `${me.role !== 'screen' ? `<a class="bell" href="#inbox" aria-label="الإشعارات${S.unread ? ': ' + S.unread + ' غير مقروءة' : ''}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>${S.unread ? `<b>${S.unread > 99 ? '99+' : S.unread}</b>` : ''}</a>` : ''}<span class="chip">${esc(me.name)} · <b>${esc(me.roleName)}</b>${me.sectionName && me.role !== 'contestant' ? ' · ' + esc(me.sectionName) : ''}</span><button class="btn sm ghost" data-act="logout">خروج</button>`
    : `<a class="btn sm gold" href="#login">تسجيل الدخول</a>`;
}
// عدد الإشعارات غير المقروءة، كل 30 ثانية
S.unread = 0;
async function pollUnread() { if (!me || me.mustChange || me.role === 'screen' || document.hidden) return; try { const n = (await api('/notifications/unread')).unread; if (n !== S.unread) { S.unread = n; shell(); } } catch (e) {} }
setInterval(pollUnread, 30000);
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
  try { document.documentElement.style.setProperty('--hh', $('header.top').offsetHeight + 'px'); } catch (e) {}
  $$('[data-w]', root).forEach((e) => { e.style.width = Math.max(0, Math.min(100, +e.dataset.w)) + '%'; });
  $$('table.stack', root).forEach((t) => { const hs = [...t.querySelectorAll('thead th')].map((th) => th.textContent); t.querySelectorAll('tbody tr').forEach((tr) => [...tr.children].forEach((td, i) => { td.dataset.l = hs[i] || ''; })); });
}

// ---------- عناصر مشتركة ----------
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
  return `<section class="hero"><div class="hero-in"><div>
    <div class="hero-brand"><span class="emb">${LOGO}</span>${wordmark(c, true)}</div>
    <h1 class="sr">${esc(c.name)}، الدورة ${esc(c.number)} · ${esc(c.year)}</h1>
    <div class="facts"><span><b>حالة التسجيل</b>${esc(c.state.label)}</span><span><b>فتح التسجيل</b>${esc(dateLabel(c.regOpen))}</span><span><b>إغلاق التسجيل</b>${esc(dateLabel(c.regClose))}</span></div>
    <div class="acts">${!me ? `${c.state.open ? '<a class="btn gold" href="#signup">بدء التسجيل</a>' : ''}<a class="btn ghost" href="#login">تسجيل الدخول</a>` : `<a class="btn gold" href="#${homeOf()}">مساحة العمل</a>`}</div></div>
    <figure class="quote"><blockquote>«خيركم من تعلّم القرآن وعلّمه»</blockquote><p class="motto">علمٌ يُتقن… وأثرٌ يمتد</p></figure></div></section>
  <h2 class="sec-title">الفئات العمرية</h2>
  <p class="note">تُحدَّد الفئة تلقائيًا من سنة الميلاد، ولا يختارها المتسابق.</p>
  <div class="cats">${cats.map((x) => `<div class="cat"><b>${esc(x.name)}</b><span class="yrs">${esc(yrs(x))}</span><span class="br">${x.branches.map((k) => esc((pub.branches.find((b) => b.code === k) || {}).name || k)).join('، ')}</span></div>`).join('')}</div>
  <h2 class="sec-title">فروع المسابقة ومقرراتها</h2>
  <div class="branches">${pub.branches.map(card).join('')}</div>
  <section class="assoc"><h2>${esc(meta.org)}</h2><p>عشرون عامًا… والأثر يمتد</p></section>`;
}

// ---------- الدخول وإنشاء الحساب ----------
const vLogin = () => `<div class="auth card"><span class="emb">${LOGO_C}</span><h1>تسجيل الدخول</h1><p class="note">المتسابق يدخل برقم هويته، والموظفون والمحكمون باسم المستخدم الذي سلّمته الإدارة.</p>
  <form data-form="login"><p class="err" hidden></p>
  <div class="field"><label for="l-login">رقم الهوية أو اسم المستخدم</label><input id="l-login" class="ltr" autocomplete="username" required></div>
  <div class="field"><label for="l-pass">كلمة المرور</label><input id="l-pass" type="password" autocomplete="current-password" required></div>
  <button class="btn pri" type="submit">دخول</button></form>
  ${meta.allowSignup ? '<p class="switch">ليس لديك حساب متسابق؟ <a href="#signup">أنشئ حسابًا</a></p>' : ''}
  <p class="switch note">نسيت كلمة المرور؟ تواصل مع الإدارة التنفيذية لقسمك لإعادة تعيينها.</p></div>`;
const vSignup = () => !meta.allowSignup ? `<div class="auth card"><h1>إنشاء حساب</h1><p>إنشاء الحسابات من الموقع متوقف حاليًا. تواصل مع إدارة المسابقة.</p></div>` :
  `<div class="auth card"><span class="emb">${LOGO_C}</span><h1>إنشاء حساب متسابق</h1><p class="note">حساب واحد لكل متسابق، ومنه يسجّل في الفروع ويتابع مشاركاته.${pub.competition && !pub.competition.state.open ? ' التسجيل في الدورة الحالية غير متاح الآن، ويمكنك إنشاء الحساب مسبقًا.' : ''}</p>
  <form data-form="signup"><p class="err" hidden></p>
  <div class="field"><label for="s-id">رقم الهوية أو الرقم الشخصي <span class="req">*</span></label><input id="s-id" class="ltr" inputmode="numeric" autocomplete="off" required><small>من 6 إلى 20 رقمًا، وهو رقم الدخول إلى حسابك.</small></div>
  <div class="field"><label for="s-name">الاسم الرباعي <span class="req">*</span></label><input id="s-name" autocomplete="name" required></div>
  <div class="field"><label for="s-phone">الهاتف الأساسي <span class="req">*</span></label><input id="s-phone" class="ltr" type="tel" inputmode="tel" autocomplete="tel" required><small>مع رمز الدولة إن كان خارج الدولة، مثل ‎+973‎.</small></div>
  <div class="field"><label for="s-email">البريد الإلكتروني</label><input id="s-email" class="ltr" type="email" autocomplete="email"><small>اختياري، لتصلك الإشعارات بالبريد إن فعّلته الجمعية.</small></div>
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
  ${me.role === 'judge' ? '<div class="card"><h2>رصد الدرجات</h2><p>تظهر لك في «الرصد» استمارة تخصصك لكل متسابق بدأ اختباره في لجنتك. تحفظ مسودة ثم ترسلها فتُقفل.</p><a class="btn pri" href="#grade">الرصد</a></div>' : ''}`;
}

// ---------- المتسابق: مشاركتي ومعالج التسجيل ----------
async function vMy() {
  S.my = await api('/my');
  S.myQ = S.my.registration ? (await api('/my/queue')).tickets : [];
  S.myR = S.my.registration ? (await api('/my/results')).results : [];
  S.mySch = S.my.registration ? (await api('/my/schedule')).rows : [];
  S.myM = S.my.registration ? (await api('/my/materials')).rows : [];
  S.myD = S.my.registration ? (await api('/my/draws')).rows : [];
  S.myDay = S.my.registration ? (await api('/my/day')).days : [];
  if (S.myQ.some((t) => ['waiting', 'called', 'testing', 'needs_committee'].includes(t.status))) startPoll(10000, repaint); else stopPoll();
  const m = S.my, c = m.competition;
  if (!c) return `<div class="card empty"><h2>لا توجد دورة حالية</h2></div>`;
  if (S.wz) return wizard();
  if (!m.registration) {
    return `<div class="head"><div><h1>مرحبًا ${esc(m.person.fullName.split(' ')[0])}</h1><p>${esc(c.name)} · الدورة ${esc(c.number)}</p></div></div>
    <div class="card"><h2>لم تسجّل في هذه الدورة بعد</h2><p>${esc(c.state.label)}.</p>
    ${m.canRegister ? '<p>أدخل سنة ميلادك فتظهر فئتك والفروع المتاحة لها، ثم اختر فروعك وراجع بياناتك قبل تأكيد التسجيل.</p><button class="btn pri" data-act="wz-start">ابدأ التسجيل</button>' : ''}</div>`;
  }
  const r = m.registration;
  const active = r.entries.filter((e) => e.status === 'active'), old = r.entries.filter((e) => e.status !== 'active');
  return `<div class="head"><div><h1>مشاركتي</h1><p>${esc(c.name)} · الدورة ${esc(c.number)}</p></div>
    <div class="acts">${m.canEdit ? '<button class="btn pri" data-act="wz-edit">تعديل التسجيل</button>' : ''}${m.canWithdraw ? '<button class="btn badb" data-act="withdraw">الانسحاب من المسابقة</button>' : ''}</div></div>
  <div class="grid2"><div class="card"><div class="status"><span class="big">${esc(r.statusName)}</span></div>
    <p class="note">سُجّلت ${esc(fmt(r.createdAt))}${r.updatedAt !== r.createdAt ? ' · آخر تحديث ' + esc(fmt(r.updatedAt)) : ''}</p>
    <h3>مشاركاتي (${active.length})</h3>
    ${active.map((e) => { const t = (S.myQ || []).find((x) => x.entryId === e.id); return `<div class="entry"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b>${myTag(t, e.id)}<span class="cur">المقرر: ${esc(e.curriculum)}</span>${t && t.status === 'called' ? `<p class="callnow">تم نداؤك: توجّه الآن إلى ${esc(t.committee)}${t.hall ? ' — ' + esc(t.hall) : ''}</p>` : ''}${myDraws(e.id)}${myMaterials(e.id)}${(S.myR || []).filter((x) => x.entryId === e.id).map((x) => `<p class="myres">${esc(x.stageName)}: <b>${n2(x.total)}</b> من ${n2(x.max)} · الترتيب ${x.rank} من ${x.count}${x.nextStageName && x.qualified != null ? ` · ${x.qualified ? `<span class="tag ok">متأهل إلى ${esc(x.nextStageName)}</span>` : `<span class="tag">لم يتأهل إلى ${esc(x.nextStageName)}</span>`}` : ''}</p>`).join('')}</div>`; }).join('') || '<p class="note">لا توجد مشاركات قائمة.</p>'}
    ${old.length ? `<details><summary class="note">مشاركات ملغاة (${old.length})</summary>${old.map((e) => `<div class="entry off"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b><span class="tag">ملغاة</span><span class="cur">${esc(e.curriculum)}</span></div>`).join('')}</details>` : ''}</div>
  <div class="card"><h3>ملفي</h3><dl class="kv"><dt>الاسم</dt><dd>${esc(m.person.fullName)}</dd><dt>رقم الهوية</dt><dd class="ltr">${esc(m.person.nationalId)}</dd><dt>سنة الميلاد</dt><dd>${esc(r.birthYear)}</dd><dt>الفئة</dt><dd>${esc(r.categoryName)}</dd><dt>القسم</dt><dd>${esc(r.sectionName)}</dd><dt>الهاتف</dt><dd class="ltr">${esc(m.person.phone)}</dd><dt>هاتف آخر</dt><dd class="ltr">${esc(m.person.phone2 || '—')}</dd></dl>
    <div class="acts"><button class="btn sm" data-act="phones">تحديث أرقام التواصل</button></div>
    <p class="note">لتصحيح الاسم أو رقم الهوية أو سنة الميلاد بعد المراجعة، تواصل مع الإدارة التنفيذية لقسمك.</p></div></div>`;
}

// قرعة مقطع التلاوة تحت مشاركة التلاوة
const ayatHtml = (P) => `<div class="quran ayat">${P.bismillah ? `<p class="bsm">${esc(P.bismillah)}</p>` : ''}${P.ayat.map((a) => `${esc(a.text)} <span class="ayn">﴿${a.n}﴾</span>`).join(' ')}</div>`;
function myDraws(entryId) {
  return (S.myD || []).filter((d) => d.entryId === entryId).map((d) => {
    const cur = d.current, last = d.attempts >= d.max || !d.canDraw;
    let body;
    const dl = d.closes ? `<p class="note">آخر موعد للقرعة: <b>${esc(d.closes)}</b>. إن لم تعتمد قبله يُعتمد آخر مقطع ظهر لك.</p>` : '';
    if (d.status === 'approved') body = `<p><span class="tag ok">مقطعك المعتمد</span> <b>${esc(cur.label)}</b></p>`;
    else if (d.expired && !d.attempts) body = `<p class="note">انتهت مهلة القرعة (${esc(d.closes)}) ولم تختر مقطعًا. تواصل مع إدارة المسابقة.</p>`;
    else if (d.expired) body = `<p><span class="tag ok">مقطعك النافذ</span> <b>${esc(cur.label)}</b></p><p class="note">انتهت مهلة القرعة (${esc(d.closes)})، فاعتُمد آخر مقطع ظهر لك.</p>`;
    else if (!d.attempts) body = d.locked ? '<p class="note">أُقفلت القرعة بعد تسجيل حضورك.</p>' : `${dl}<p>يختار النظام مقطعك عشوائيًا من بنك مقاطع مسارك وفئتك، ولا يظهر المقطع نفسه لمتسابق آخر. لديك ${d.max} محاولات: بعد المقطع الأول والثاني تعتمده أو تختار مقطعًا آخر، والمقطع الثالث لا خيار بعده إلا اعتماده. لا يمكن الرجوع إلى مقطع سابق.</p>
      <div class="acts"><button class="btn pri" data-act="dr-draw" data-e="${entryId}" data-st="${d.stage}" data-x="1">اختيار المقطع</button></div>`;
    else body = `<p><span class="tag ${last ? 'warn' : 'info'}">المحاولة ${cur.attempt} من ${d.max}</span> <b>${esc(cur.label)}</b></p>
      ${d.locked ? '<p class="note">أُقفلت القرعة بعد تسجيل حضورك، ويُعتمد هذا المقطع.</p>' : `${dl}<div class="acts"><button class="btn pri" data-act="dr-ok" data-e="${entryId}" data-st="${d.stage}">اعتماد هذا المقطع</button>${d.canDraw ? `<button class="btn" data-act="dr-draw" data-e="${entryId}" data-st="${d.stage}" data-x="${d.attempts + 1}">اختيار مقطع آخر (${d.max - d.attempts === 1 ? 'المحاولة الأخيرة' : 'بقيت ' + (d.max - d.attempts)})</button>` : ''}</div>
      <p class="note">${d.canDraw ? 'إن اخترت مقطعًا آخر فلا رجوع إلى هذا المقطع.' : d.attempts >= d.max ? 'هذه المحاولة الأخيرة؛ لا خيار إلا اعتماد المقطع.' : 'لا توجد مقاطع أخرى في البنك؛ اعتمد هذا المقطع.'}</p>`}`;
    const prev = d.draws.filter((x) => !x.approved && (!cur || x.attempt !== cur.attempt));
    return `<div class="mats draw"><span class="subhead">قرعة مقطع ${esc(d.stageName)}</span>${body}
      ${prev.length ? `<p class="note">مقاطع ظهرت سابقًا: ${prev.map((x) => esc(x.label)).join('؛ ')}</p>` : ''}
      ${d.passage ? `<details${d.status === 'approved' ? ' open' : ''}><summary>نص المقطع</summary>${ayatHtml(d.passage)}</details>` : ''}</div>`;
  }).join('');
}

// مذكرات المقرر تحت كل مشاركة
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');
function myMaterials(entryId) {
  const ms = (S.myM || []).filter((m) => m.entryId === entryId);
  if (!ms.length) return '';
  return `<div class="mats"><span class="subhead">مذكرات المقرر</span><ul>${ms.map((m) => `<li><div><b>${esc(m.title)}</b>${m.stage ? ` <span class="tag plum">${esc(m.stageName)}</span>` : ''}${m.updatedSince ? ' <span class="tag warn">نسخة محدّثة</span>' : !m.downloaded ? ' <span class="tag info">جديدة</span>' : ''}${m.note ? `<small class="note">${esc(m.note)}</small>` : ''}</div>
    <button class="btn sm pri" data-act="mdl" data-id="${m.id}" data-n="${esc(m.fileName)}">تنزيل ${esc(m.fileType)} · <bdi>${kb(m.size)}</bdi></button></li>`).join('')}</ul></div>`;
}
const download = (id, name) => fetchFile('/api/materials/' + id + '/file', name);
async function fetchFile(url, name) {
  let res;
  try { res = await fetch(url, { headers: { 'X-Iqra': '1' }, credentials: 'same-origin' }); } catch (e) { throw new Error('تعذّر الاتصال بالخادم. تحقق من الشبكة.'); }
  if (!res.ok) { let d = {}; try { d = await res.json(); } catch (e) {} throw new Error(d.error || 'تعذّر التنزيل'); }
  const blob = await res.blob();
  // داخل عارض Claude (النسخة التجريبية المنشورة) يمر التنزيل عبر نافذة تأكيد العارض
  const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); return; }
    catch (e) { if (e && e.code === 'declined') return; if (e && e.code === 'rejected_extension') throw new Error('هذا النوع من الملفات لا يُنزَّل داخل العارض التجريبي'); if (!e || !['unavailable', 'not_granted', 'capability_disabled', 'capability_removed'].includes(e.code)) throw new Error('تعذّر التنزيل'); }
  }
  const href = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30000);
}
const readB64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('تعذّرت قراءة الملف')); r.readAsDataURL(file); });
async function pickedFile(input) {
  const f = input && input.files && input.files[0];
  if (!f) throw new Error('اختر الملف');
  if (f.size > S.mat.maxMB * 1048576) throw new Error(`حجم الملف ${kb(f.size)}، والحد المسموح ${S.mat.maxMB} ميغابايت`);
  return { name: f.name, data: await readB64(f) };
}

function myTag(t, entryId) {
  if (!t) {
    const rows = (S.mySch || []).filter((x) => x.entryId === entryId), r = rows[rows.length - 1];
    // يوم الحضور المحدد للتصفيات الأولية بعد نشر التوزيع
    const dy = (S.myDay || []).find((x) => x.entryIds.includes(entryId));
    if (dy && (!r || r.stage === 'prelim' || r.stageName === 'التصفيات الأولية')) return `<span class="tag info">التصفيات الأولية — يوم حضورك: ${esc(dy.name)}، ${esc(dy.label)}${dy.time ? '، ' + esc(dy.time) : ''}${dy.location ? ' — ' + esc(dy.location) : ''}</span>`;
    if (r && r.session) return `<span class="tag info">${esc(r.stageName)}: ${esc(r.session.when)} — ${esc(r.session.location)}</span>`;
    return `<span class="tag">موعد ${r ? esc(r.stageName) : 'المرحلة'}: بانتظار الإعلان</span>`;
  }
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
      <div class="acts"><button class="btn pri" data-act="wz-submit" ${w.agree ? '' : 'disabled'}>${w.edit ? 'حفظ التعديل' : 'تأكيد التسجيل'}</button><button class="btn" data-act="wz-back">السابق</button></div>`;
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
  return `<div class="head"><div><h1>المسجلون</h1><p>${me.role === 'top' ? 'القسمان' : esc(me.sectionName)} · مرتبة أبجديًا${chief ? ' · اطلاع دون بيانات الاتصال' : ''}</p></div>
    ${canManage() ? `<div class="acts"><button class="btn" data-act="xl" data-href="/api/registrations.xlsx?${esc(regParams({ page: '' }))}" data-n="المسجلون.xlsx">تنزيل القائمة (Excel)</button></div>` : ''}</div>
  <div class="card"><form class="filters" data-form="regf" role="search">
    <input type="search" id="f-q" value="${esc(f.q)}" placeholder="${chief ? 'بحث بالاسم' : 'بحث بالاسم أو الهوية أو الهاتف'}" aria-label="بحث">
    ${me.role === 'top' ? `<select id="f-section" aria-label="القسم">${opts(Object.entries(meta.sections), f.section, 'القسمان')}</select>` : ''}
    <select id="f-category" aria-label="الفئة">${opts(pub.categories.map((c) => [c.id, c.name]), f.category, 'كل الفئات')}</select>
    <select id="f-branch" aria-label="الفرع">${opts(trackOpts, f.branch, 'كل الفروع')}</select>
    <select id="f-status" aria-label="الحالة">${opts([['accepted', 'مسجّل'], ['withdrawn', 'منسحب']], f.status, 'كل الحالات')}</select>
    <button class="btn pri" type="submit">بحث</button></form>
  <p class="note">${d.total} مسجّلًا</p>
  ${d.rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>الاسم</th>${chief ? '' : '<th>الهوية</th><th>الهاتف</th>'}${me.role === 'top' ? '<th>القسم</th>' : ''}<th>الفئة</th><th>المشاركات</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
  ${d.rows.map((r) => `<tr class="click" data-act="reg" data-id="${r.id}" tabindex="0"><td><b>${esc(r.fullName)}</b></td>${chief ? '' : `<td class="ltr">${esc(r.nationalId)}</td><td class="ltr">${esc(r.phone)}</td>`}${me.role === 'top' ? `<td>${esc(r.sectionName)}</td>` : ''}<td>${esc(r.categoryName)}</td><td>${entryChips(r.entries)}</td><td>${stTag(r.status, r.statusName)}</td><td class="n">${esc(fmtD(r.createdAt))}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="pager"><span class="note">صفحة ${d.page} من ${pages}</span><div class="acts"><button class="btn sm" data-act="page" data-p="${d.page - 1}" ${d.page > 1 ? '' : 'disabled'}>السابق</button><button class="btn sm" data-act="page" data-p="${d.page + 1}" ${d.page < pages ? '' : 'disabled'}>التالي</button></div></div>`
    : '<div class="empty"><p>لا توجد تسجيلات مطابقة.</p></div>'}</div>`;
}

const ACT = { signup: 'إنشاء الحساب', register: 'التسجيل', edit: 'تعديل من المتسابق', withdraw: 'انسحاب', status: 'تغيير الحالة', correct: 'تصحيح إداري', reset: 'إعادة تعيين كلمة المرور', profile: 'تحديث التواصل', export: 'تصدير', settings: 'إعداد', create: 'إنشاء', update: 'تعديل', activate: 'تفعيل', deactivate: 'إيقاف', seed: 'تهيئة' };
async function openReg(id) {
  const { registration: r, history } = await api('/registrations/' + id);
  const chief = me.role === 'chief';
  const act = canManage() && r.status !== 'withdrawn';
  modal(r.fullName, `<p class="err" hidden></p>
  <div class="status"><span class="big">${esc(r.statusName)}</span>${stTag(r.status)}<span class="note">${esc(r.sectionName)} · ${esc(r.categoryName)}</span></div>
  ${r.staffNote ? `<p class="banner">${esc(r.staffNote)}</p>` : ''}
  <dl class="kv">${chief ? '' : `<dt>رقم الهوية</dt><dd class="ltr">${esc(r.nationalId)}</dd><dt>الهاتف</dt><dd class="ltr">${esc(r.phone)}${r.phone2 ? ' · ' + esc(r.phone2) : ''}</dd>`}<dt>سنة الميلاد</dt><dd>${esc(r.birthYear)}</dd><dt>الجنس</dt><dd>${r.gender === 'F' ? 'أنثى' : 'ذكر'}</dd><dt>تاريخ التسجيل</dt><dd>${esc(fmt(r.createdAt))}</dd>${r.reviewer ? `<dt>آخر مراجعة</dt><dd>${esc(r.reviewer)} · ${esc(fmt(r.reviewedAt))}</dd>` : ''}</dl>
  <h3>المشاركات</h3>${r.entries.map((e) => `<div class="entry ${e.status === 'active' ? '' : 'off'}"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b>${e.status === 'active' ? '' : '<span class="tag">ملغاة</span>'}<span class="cur">${esc(e.curriculum)}</span></div>`).join('')}
  ${act ? `<h3>إجراءات إدارية</h3><div class="acts"><button class="btn" data-act="correct" data-id="${r.id}">تصحيح البيانات</button><button class="btn" data-act="reset-c" data-id="${r.id}">إعادة تعيين كلمة مرور المتسابق</button></div>` : ''}
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
  <div class="kpis"><div class="kpi main"><b>${s.total}</b><span>إجمالي المسجلين</span></div>
    <div class="kpi"><b>${by(s.byBranch, 'hifz')}</b><span>في الحفظ</span></div><div class="kpi"><b>${by(s.byBranch, 'tilawa')}</b><span>في التلاوة</span></div>
    <div class="kpi"><b>${by(s.byBranch, 'tafsir')}</b><span>في التفسير</span></div><div class="kpi"><b>${by(s.byStatus, 'withdrawn')}</b><span>منسحبون</span></div></div>
  ${top && !S.dash.section ? `<div class="card"><h2>حسب القسم</h2>${bars(s.bySection.map((x) => ({ k: meta.sections[x.k], n: x.n })), true)}${s.accounts != null ? `<p class="note">حسابات المتسابقين المنشأة: ${s.accounts}</p>` : ''}</div>` : ''}
  <div class="grid2"><div class="card"><h2>المشاركات حسب الفرع والمسار</h2>${bars(s.byTrack)}</div><div class="card"><h2>المسجلون حسب الفئة</h2>${bars(s.byCategory, true)}</div></div>
  <div class="card"><div class="acts"><a class="btn pri" href="#regs">قائمة المسجلين</a></div></div>`;
}

// ---------- إعداد الدورة (الإدارة العليا) ----------
async function vSettings() {
  S.adm = await api('/admin/competition');
  S.sp = (await api('/admin/stage-passages')).rows;
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
    ${a.categories.map((x) => catRow(x, codes)).join('')}</tbody></table></div><p class="note">اترك «من سنة» فارغًا للفئة المفتوحة من الأقدم (مثل: 2009 فما قبل). يرفض الخادم الحدود المتداخلة.</p>
    <div class="acts"><button class="btn" type="button" data-act="add-cat">إضافة فئة</button><button class="btn pri" type="submit">حفظ الفئات</button></div></form></details>
  <details class="blk"><summary>المقررات والمسارات</summary><form data-form="curr"><p class="err" hidden></p><div class="scroll"><table class="edit-table"><thead><tr><th>الفرع</th><th>رمز المسار</th><th>اسم المسار</th><th>الفئة</th><th>المقرر</th><th>المقطع: سورة (رقم)</th><th>من آية</th><th>إلى آية</th><th></th></tr></thead><tbody id="curr-rows">
    ${a.curricula.map((x) => currRow(x, codes, catOpts)).join('')}</tbody></table></div><p class="note">رمز المسار بالإنجليزية (مثل cat، j5، tartil، tadweer، main). في الحفظ يختار المتسابق مسارًا واحدًا، وفي التلاوة ترتيل أو تدوير. «المقطع» لمقررات التلاوة: رقم السورة ونطاق الآيات، ومنه تُعرض الآيات في مصفوفة التجويد للمحكم.</p>
    <div class="acts"><button class="btn" type="button" data-act="add-curr">إضافة مقرر</button><button class="btn pri" type="submit">حفظ المقررات</button></div></form></details>
  <details class="blk"><summary>مقاطع التلاوة في قبل النهائي والنهائي</summary><p class="note">لكل مقرر تلاوة مقطع خاص بكل مرحلة لاحقة (رقم السورة ونطاق الآيات). تظهر آياته للمحكم في مصفوفة التجويد. اترك الحقول فارغة إن لم يُعلن المقطع بعد.</p>
    <div class="scroll"><table class="edit-table"><thead><tr><th>المقرر</th><th>التصفيات</th><th>قبل النهائي: سورة</th><th>من</th><th>إلى</th><th>النهائي: سورة</th><th>من</th><th>إلى</th></tr></thead><tbody id="sp-rows">
    ${S.sp.map((x) => `<tr data-id="${x.id}"><td>${esc(x.name)}</td><td class="note">${esc(x.prelim)}</td>${['semi', 'final'].map((st) => { const v = x[st] || {}, p = st[0]; return `<td><input class="yr" name="${p}s" inputmode="numeric" value="${esc(v.surah ?? '')}" aria-label="السورة"></td><td><input class="yr" name="${p}f" inputmode="numeric" value="${esc(v.ayahFrom ?? '')}" aria-label="من آية"></td><td><input class="yr" name="${p}t" inputmode="numeric" value="${esc(v.ayahTo ?? '')}" aria-label="إلى آية"></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    <button class="btn pri" data-act="sp-save">حفظ المقاطع</button></details>
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
  <td><select name="cat" aria-label="الفئة">${opts(catOpts, x.categoryId ?? '')}</select></td><td><input name="content" value="${esc(x.content || '')}" aria-label="المقرر"></td><td><input class="yr" name="surah" inputmode="numeric" value="${esc(x.surah ?? '')}" aria-label="رقم السورة"></td><td><input class="yr" name="af" inputmode="numeric" value="${esc(x.ayahFrom ?? '')}" aria-label="من آية"></td><td><input class="yr" name="at" inputmode="numeric" value="${esc(x.ayahTo ?? '')}" aria-label="إلى آية"></td><td>${x.used ? '<span class="tag">عليه مشاركات</span>' : '<button class="btn sm badb" type="button" data-act="del-row">حذف</button>'}</td></tr>`;

// ---------- الحسابات (الإدارة العليا) ----------
async function vUsers() {
  S.users = (await api('/users' + (S.usersRole ? '?role=' + S.usersRole : ''))).users;
  const rows = S.users;
  return `<div class="head"><div><h1>حسابات كادر التنظيم والتحكيم</h1><p>الإدارة العليا تنشئ حسابات الإدارة التنفيذية ورؤساء لجان التحكيم والمحكمين ومنسقي النداء وشاشات الانتظار، وتحدد لكل حساب دوره وقسمه وتخصصه. المتسابقون ينشئون حساباتهم بأنفسهم.</p></div><div class="acts"><button class="btn pri" data-act="new-user">إضافة حساب</button></div></div>
  <div class="card"><div class="filters"><select id="u-role" aria-label="الدور">${opts(Object.entries(meta.roles).filter(([k]) => k !== 'contestant'), S.usersRole, 'كل حسابات الكادر')}<option value="contestant" ${S.usersRole === 'contestant' ? 'selected' : ''}>حسابات المتسابقين</option></select></div>
  ${rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>الاسم</th><th>الدخول</th><th>الدور</th><th>القسم</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead><tbody>
  ${rows.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.specialty ? `<br><small class="note">${esc(u.specialty)}</small>` : ''}</td><td class="ltr">${esc(u.login)}</td><td>${esc(u.roleName)}</td><td>${esc(u.role === 'contestant' ? '—' : u.sectionName)}</td><td class="n">${esc(fmt(u.lastLogin) || '—')}</td><td>${u.active ? (u.mustChange ? '<span class="tag warn">لم يغيّر كلمة المرور</span>' : '<span class="tag ok">نشط</span>') : '<span class="tag bad">موقوف</span>'}</td>
  <td><div class="acts">${u.role !== 'contestant' ? `<button class="btn sm" data-act="edit-user" data-id="${u.id}">تعديل</button><button class="btn sm" data-act="reset-u" data-id="${u.id}">كلمة مرور مؤقتة</button>` : ''}${u.id !== me.id ? `<button class="btn sm ${u.active ? 'badb' : 'okb'}" data-act="toggle-u" data-id="${u.id}">${u.active ? 'إيقاف' : 'تفعيل'}</button>` : ''}</div></td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty"><p>لا توجد حسابات.</p></div>'}</div>`;
}
function userForm(u) {
  const roles = Object.entries(meta.roles).filter(([k]) => k !== 'contestant');
  modal(u ? 'تعديل حساب ' + u.name : 'إضافة حساب', `<form data-form="user" data-id="${u ? u.id : ''}"><p class="err" hidden></p>
  <div class="row2"><div class="field"><label for="u-login">اسم المستخدم <span class="req">*</span></label><input id="u-login" class="ltr" value="${esc(u ? u.login : '')}" ${u ? 'readonly' : 'required'}><small>الرقم الشخصي، أو اسم بالإنجليزية مثل judge.ahmed</small></div>
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

// ---------- المرحلة ----------
const STG = [['prelim', 'التصفيات الأولية'], ['semi', 'قبل النهائي'], ['final', 'النهائي']];
S.stage = 'prelim';
const stageBar = () => `<div class="stagebar" role="group" aria-label="المرحلة">${STG.map(([k, n]) => `<button class="btn sm ${S.stage === k ? 'pri' : ''}" data-act="stage" data-s="${k}" aria-pressed="${S.stage === k}">${n}</button>`).join('')}</div>`;

// ---------- الاستقبال وتسجيل الحضور ----------
const TK = { waiting: 'info', needs_committee: 'warn', called: 'warn', testing: 'plum', done: 'ok', no_show: 'bad', cancelled: '' };
const tTag = (t) => `<span class="tag ${TK[t.status] || ''}">${t.seq ? '#' + t.seq + ' · ' : ''}${esc(t.statusName)}${t.committee ? ' · ' + esc(t.committee) : ''}</span>`;
async function vReception() {
  const f = S.rec = S.rec || { q: '', section: '', category: '', state: '', page: 1 };
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const d = S.recData = await api('/reception?' + qs + '&stage=' + S.stage);
  const c = d.counts, pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  const row = (r) => {
    const el = r.entries.filter((e) => e.needsCommittee && (!e.ticket || e.ticket.status === 'cancelled'));
    const quick = el.length && el.every((e) => e.candidates.length === 1);
    return `<tr><td><b>${esc(r.name)}</b>${me.role === 'top' ? `<br><small class="note">${esc(r.sectionName)}</small>` : ''}</td><td>${esc(r.category)}</td>
    <td><div class="chips">${r.entries.map((e) => `<span class="ent"><b>${esc(e.branchName)}${e.trackName ? ' · ' + esc(e.trackName) : ''}</b>${e.day ? ` <span class="tag ${e.day.today ? 'ok' : 'warn'} day">${esc(e.day.name)} · ${esc(e.day.label)}${e.day.today ? '' : ' (ليس اليوم)'}</span>` : ''} ${!e.needsCommittee ? '<span class="tag">اختبار إلكتروني</span>' : e.ticket && e.ticket.status !== 'cancelled' ? tTag(e.ticket) + (['waiting', 'needs_committee', 'no_show'].includes(e.ticket.status) ? ` <button class="btn link" data-act="tk-cancel" data-id="${e.ticket.id}">إلغاء</button>` : '') : '<span class="tag">لم يحضر</span>'}</span>`).join('')}</div></td>
    <td>${el.length ? `<button class="btn ${quick ? 'pri' : ''} sm" data-act="${quick ? 'ci-quick' : 'ci-open'}" data-id="${r.id}">${quick ? 'تثبيت الحضور' : 'تسجيل الحضور…'}</button>${quick && el.length > 1 ? ` <button class="btn link" data-act="ci-open" data-id="${r.id}">اختيار</button>` : ''}` : '<span class="tag ok">حاضر</span>'}</td></tr>`;
  };
  return `<div class="head"><div><h1>الاستقبال وتسجيل الحضور</h1><p>${esc(d.stageName)} · ${me.role === 'top' ? (f.section ? esc(meta.sections[f.section]) : 'القسمان') : esc(me.sectionName)} · الأسماء مرتبة أبجديًا، والدور في الطابور بحسب وقت تثبيت الحضور</p></div><div class="acts"><a class="btn" href="#queues">الطوابير</a></div></div>
  ${stageBar()}${S.stage !== 'prelim' ? `<div class="banner info">يظهر في ${esc(d.stageName)} المتأهلون بقرار معتمد فقط.</div>` : ''}
  <div class="kpis"><div class="kpi main"><b>${c.persons || 0}</b><span>حاضرون</span></div><div class="kpi"><b>${c.waiting || 0}</b><span>في الانتظار</span></div><div class="kpi"><b>${c.active || 0}</b><span>نودوا أو جارٍ اختبارهم</span></div><div class="kpi"><b>${c.done || 0}</b><span>انتهى اختبارهم</span></div><div class="kpi"><b>${c.needs || 0}</b><span>بانتظار تحديد اللجنة</span></div></div>
  <div class="card"><form class="filters" data-form="recf" role="search"><input type="search" id="rf-q" value="${esc(f.q)}" placeholder="ابحث بالاسم أو الهوية أو الهاتف" aria-label="بحث" autofocus>
    ${me.role === 'top' ? `<select id="rf-section" aria-label="القسم">${opts(Object.entries(meta.sections), f.section, 'القسمان')}</select>` : ''}
    <select id="rf-category" aria-label="الفئة">${opts(pub.categories.map((x) => [x.id, x.name]), f.category, 'كل الفئات')}</select>
    <select id="rf-state" aria-label="الحضور">${opts([...(S.stage === 'prelim' ? [['today', 'موزّعون على اليوم']] : []), ['absent', 'لم يحضروا'], ['present', 'حاضرون']], f.state, 'الجميع')}</select><button class="btn pri" type="submit">بحث</button></form>
  <p class="note">${d.total} مسجّلًا</p>
  ${d.rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>الاسم</th><th>الفئة</th><th>المشاركات والحضور</th><th></th></tr></thead><tbody>${d.rows.map(row).join('')}</tbody></table></div>
  <div class="pager"><span class="note">صفحة ${d.page} من ${pages}</span><div class="acts"><button class="btn sm" data-act="rpage" data-p="${d.page - 1}" ${d.page > 1 ? '' : 'disabled'}>السابق</button><button class="btn sm" data-act="rpage" data-p="${d.page + 1}" ${d.page < pages ? '' : 'disabled'}>التالي</button></div></div>`
    : `<div class="empty"><p>${S.stage === 'prelim' ? 'لا يوجد متسابقون مطابقون.' : 'لا يوجد متأهلون إلى هذه المرحلة بعد.'}</p></div>`}</div>`;
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
  const d = await api('/queues?stage=' + S.stage + (me.role === 'top' && q.section ? '&section=' + q.section : ''));
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
  ${stageBar()}
  ${d.needsCommittee.length ? `<div class="card warnbox"><h3>بانتظار تحديد اللجنة (${d.needsCommittee.length})</h3>${d.needsCommittee.map((t) => `<div class="acts needs"><span><b>${esc(t.name)}</b> · ${esc(t.branchName)}${t.trackName ? ' · ' + esc(t.trackName) : ''} · ${esc(t.category)} · #${t.seq}</span>
    ${t.candidates.length ? `<select id="as-${t.id}" aria-label="اللجنة">${opts(t.candidates.map((x) => [x.id, x.name]), '', 'اختر اللجنة…')}</select><button class="btn sm pri" data-act="tk-assign" data-id="${t.id}">إسناد</button>` : '<span class="tag bad">لا توجد لجنة مطابقة: أنشئ لجنة من «اللجان»</span>'}</div>`).join('')}</div>` : ''}
  ${d.committees.length ? `<div class="qgrid">${d.committees.map(card).join('')}</div>` : `<div class="card empty"><p>${['judge', 'coordinator'].includes(me.role) ? 'لم تُكلَّف بلجنة بعد.' : 'لا توجد لجان نشطة.'}</p></div>`}`;
}

// ---------- اللجان والتكليفات ----------
async function vCommittees() {
  const q = S.cm = S.cm || { section: '' };
  const [{ committees }, staff] = await Promise.all([api('/committees?stage=' + S.stage + (me.role === 'top' && q.section ? '&section=' + q.section : '')), ['exec', 'top'].includes(me.role) ? api('/staff').then((x) => x.staff) : Promise.resolve([])]);
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
  ${stageBar()}
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
  const d = await api('/screen?since=' + SCR.last + '&stage=' + S.stage + (me.role === 'top' ? '&section=' + SCR.section : ''));
  const fresh = SCR.first ? [] : d.calls.filter((c) => c.fresh).reverse();
  SCR.first = false; SCR.last = d.lastId;
  if (fresh.length) announce(fresh);
  startPoll(2000, repaint);
  const top = d.calls[0];
  const nk = d.committees.length, kc = nk <= 3 ? 'k3' : nk <= 6 ? 'k6' : nk <= 8 ? 'k8' : nk <= 12 ? 'k12' : 'k16';
  const ln = top ? (top.name.length > 34 ? ' long2' : top.name.length > 24 ? ' long' : '') : '';
  return `<div class="scr-wrap"><div class="scr"><header class="scr-top"><div class="brandline"><span class="emb">${LOGO}</span>${wordmark(pub && pub.competition)}<span class="ctx">${esc(d.stageName)} · ${esc(d.sectionName)}</span></div>
    <div class="acts"><span class="clock">${new Date().toLocaleTimeString('ar-u-nu-latn', { hour: 'numeric', minute: '2-digit' })}</span>
    ${me.role === 'top' ? `<button class="btn sm ghost" data-act="ssec">${SCR.section === 'M' ? 'عرض قسم النساء' : 'عرض قسم الرجال'}</button>` : ''}
    <select class="scr-stage" id="scr-stage" aria-label="المرحلة">${opts(STG, S.stage)}</select><button class="btn sm ${SCR.sound ? 'gold' : 'ghost'}" data-act="sound">${SCR.sound ? 'الصوت مفعّل' : 'تفعيل الصوت'}</button><button class="btn sm ghost" data-act="fs">ملء الشاشة</button>${me.role !== 'screen' ? `<a class="btn sm ghost" href="#${homeOf()}">خروج من الشاشة</a>` : ''}</div></header>
  <section class="scr-now${ln} ${top && top.fresh ? 'flash' : ''}">${top ? `<p class="lbl">${top.kind === 'recall' ? 'نداء متكرر' : 'النداء الحالي'}</p><h1>${esc(top.name)}</h1><p class="to">يتوجه إلى <b>${esc(top.committee)}</b>${top.hall ? ` · <b>${esc(top.hall)}</b>` : ''}</p>` : '<p class="lbl">قاعة الانتظار</p><h1>أهلًا بكم</h1><p class="to">ستظهر هنا أسماء المتسابقين عند نداء لجانهم</p>'}</section>
  <div class="scr-body"><div class="scr-grid ${kc}">${d.committees.map((k) => `<div class="scr-c ${k.current ? 's-' + k.current.status : ''}"><span class="scr-h">${esc(k.name)}<small>${esc(k.hall)}</small></span><b>${k.current ? esc(k.current.name) : '—'}</b><span class="scr-st">${k.current ? esc(k.current.statusName) : 'بانتظار النداء'} · منتظر ${k.waiting}</span></div>`).join('')}</div>
  <aside class="scr-log"><h2>آخر النداءات</h2><ol>${d.calls.slice(0, 5).map((c) => `<li><b>${esc(c.name)}</b><span>${esc(c.committee)}${c.hall ? ' · ' + esc(c.hall) : ''}</span></li>`).join('') || '<li>لا نداءات بعد</li>'}</ol></aside></div></div></div>`;
}
// شاشة العرض لوحة ثابتة 16:9 (1920×1080) تُكبَّر أو تُصغَّر لتملأ النافذة كاملة دون تمرير
function fitScreen() { document.documentElement.style.setProperty('--scr-s', String(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))); }
window.addEventListener('resize', fitScreen); document.addEventListener('fullscreenchange', () => setTimeout(fitScreen, 60));
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

// ---------- الرصد (المحكم) ----------
const n2 = (x) => (x == null ? '—' : (Math.round(x * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const EV = { none: ['', 'لم يبدأ'], draft: ['warn', 'مسودة'], submitted: ['ok', 'أُرسل'] };
async function vGrade() {
  if (S.fm) return gradeForm();
  const d = await api('/judge/work?stage=' + S.stage);
  startPoll(8000, () => { if (!S.fm) repaint(); });
  return `<div class="head"><div><h1>الرصد</h1><p>${esc(me.specialty)} · ${esc(d.stageName)} · يظهر المتسابق هنا بعد بدء اختباره في لجنتك</p></div></div>${stageBar()}
  ${d.committees.length ? d.committees.map((k) => `<div class="card"><div class="qh"><div><h2>${esc(k.name)}</h2><span class="note">${esc(k.hall || '')} · ${k.rubric ? esc(k.rubricTitle) : 'تخصصك لا يقابل استمارة في هذه اللجنة'}</span></div></div>
    ${k.rows.length ? `<table class="list stack"><thead><tr><th>المتسابق</th><th>الفئة</th><th>الاختبار</th><th>استمارتي</th><th></th></tr></thead><tbody>${k.rows.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.category)}${r.trackName ? ' · ' + esc(r.trackName) : ''}</td><td><span class="tag ${r.status === 'testing' ? 'plum' : ''}">${r.status === 'testing' ? 'قيد الاختبار' : 'انتهى'}</span></td>
      <td><span class="tag ${EV[r.evalStatus][0]}">${EV[r.evalStatus][1]}${r.raw != null ? ' · ' + n2(r.raw) + ' من ' + n2(r.base) : ''}</span></td><td>${k.rubric ? `<button class="btn sm ${r.evalStatus === 'submitted' ? '' : 'pri'}" data-act="fm-open" data-id="${r.ticketId}">${r.evalStatus === 'submitted' ? 'عرض' : r.evalStatus === 'draft' ? 'متابعة الرصد' : 'رصد'}</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">لا يوجد متسابق بدأ اختباره بعد.</p>'}</div>`).join('') : '<div class="card empty"><p>لم تُكلَّف بالتحكيم في لجنة بعد.</p></div>'}`;
}
async function openForm(ticketId) {
  const d = await api('/judge/form/' + ticketId);
  const data = d.evaluation ? JSON.parse(JSON.stringify(d.evaluation.data)) : {};
  if (d.rubric.kind === 'segments' && !Array.isArray(data.segments)) data.segments = [{}, {}, {}];
  if (d.rubric.kind === 'criteria') data.deductions = data.deductions || {};
  if (d.rubric.kind === 'matrix') data.rows = data.rows || {};
  S.fm = { ticketId, ...d, data, version: d.evaluation ? d.evaluation.version : null, locked: d.evaluation && d.evaluation.status === 'submitted', dirty: false, big: false };
  stopPoll(); render();
}
// حساب مباشر للعرض فقط؛ الخادم هو المرجع
function fmCalc() {
  const f = S.fm, R = f.rubric, d = f.data, num = (v) => Math.max(0, parseInt(v, 10) || 0);
  if (R.kind === 'segments') {
    let raw = 0; const g = R.groups.map((gr) => { let ded = 0; for (let i = 0; i < R.segments; i++) for (const it of gr.items) ded += num((d.segments[i] || {})[it.k]) * it.d; const min = (gr.floor || 0) * gr.base, net = Math.max(min, gr.base - ded); raw += net; return { n: gr.n || '', base: gr.base, ded, net, min, floored: gr.base - ded < min }; });
    return { raw, base: R.base, groups: g };
  }
  if (R.kind === 'criteria') { let sum = 0, miss = 0; for (const c of R.criteria) { if (d[c.k] == null || d[c.k] === '') miss++; else sum += +d[c.k]; } const ded = R.deductions.reduce((a, x) => a + num(d.deductions[x.k]), 0); const min = (R.floor || 0) * R.base; return { raw: Math.max(min, sum - ded), base: R.base, sum, ded, miss, min, floored: !miss && sum - ded < min }; }
  const base = ((R.baseByStage || {})[f.stage] || R.base)[f.track]; let ded = 0;
  for (const a of f.passage.ayat) for (const c of R.cols) ded += num((d.rows[a.n] || {})[c.k]) * c.d;
  const min = (R.floor || 0) * base;
  return { raw: Math.max(min, base - ded), base, ded, min, floored: base - ded < min };
}
const ctr = (path, v, lock) => `<span class="ctr">${lock ? '' : `<button type="button" class="cbtn" data-act="ctr" data-p="${path}" data-d="-1" aria-label="إنقاص">−</button>`}<input class="cin" inputmode="numeric" data-ctr="${path}" value="${esc(v || 0)}" ${lock ? 'readonly' : ''} aria-label="العدد">${lock ? '' : `<button type="button" class="cbtn" data-act="ctr" data-p="${path}" data-d="1" aria-label="زيادة">+</button>`}</span>`;
function gradeForm() {
  const f = S.fm, R = f.rubric, d = f.data, c = f.contestant, lock = f.locked, k = fmCalc();
  let body = '';
  if (R.kind === 'segments') {
    const items = R.groups.flatMap((g) => g.items.map((it) => ({ ...it, g: g.n })));
    const heads = []; for (const it of items) { const last = heads[heads.length - 1]; if (last && last.n === it.n) last.span++; else heads.push({ n: it.n, span: 1, col: it.col }); }
    body = `<div class="scroll"><table class="grid-form"><thead><tr><th rowspan="2">${esc(R.segLabel || 'المقطع')}</th>${heads.map((h) => `<th colspan="${h.span}">${esc(h.n)}</th>`).join('')}</tr>
      <tr>${items.map((it) => `<th>${esc(it.col || '—')}<small>−${it.d}</small></th>`).join('')}</tr></thead><tbody>
      ${[...Array(R.segments).keys()].map((i) => `<tr><th>${i + 1}</th>${items.map((it) => `<td>${ctr(`s.${i}.${it.k}`, (d.segments[i] || {})[it.k], lock)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="calc">${k.groups.map((g) => `<span>${g.n ? esc(g.n) + ': ' : ''}الخصم ${n2(g.ded)} · الصافي <b>${n2(g.net)}</b> من ${g.base}${g.min ? ` · الحد الأدنى ${n2(g.min)}${g.floored ? ' (طُبِّق)' : ''}` : ''}</span>`).join('')}</div>
    ${R.extra ? `<div class="field"><span class="lab">${esc(R.extra.n)} <span class="req">*</span></span><div class="acts" role="radiogroup">${R.extra.options.map((o) => `<label class="check opt"><input type="radio" name="fx" data-fx="${R.extra.k}" value="${o}" ${d[R.extra.k] != null && d[R.extra.k] !== '' && +d[R.extra.k] === o ? 'checked' : ''} ${lock ? 'disabled' : ''}>${o}</label>`).join('')}</div><small>تُضاف فوق المجموع.</small></div>` : ''}`;
  } else if (R.kind === 'criteria') {
    body = `<div class="scroll"><table class="list crit"><thead><tr><th>المعيار</th><th class="n">الدرجة المقررة</th><th>الدرجة المستحقة</th><th>المقياس</th></tr></thead><tbody>
      ${R.criteria.map((cr) => `<tr><td><b>${esc(cr.n)}</b>${cr.group ? `<br><small class="note">${esc(cr.group)}</small>` : ''}</td><td class="n">${cr.max}</td><td><select data-fc="${cr.k}" ${lock ? 'disabled' : ''} aria-label="${esc(cr.n)}">${opts(cr.options.map((o) => [o, o]), d[cr.k] ?? '', 'اختر الدرجة')}</select></td><td class="desc">${esc(cr.desc)}</td></tr>`).join('')}</tbody></table></div>
    <h3>موارد خصم الدرجات (درجة لكل مورد)</h3><div class="acts">${R.deductions.map((x) => `<label class="dedl">${esc(x.n)} ${ctr('d.' + x.k, d.deductions[x.k], lock)}</label>`).join('')}</div>
    <div class="calc"><span>مجموع المعايير ${n2(k.sum)}${k.miss ? ` (${k.miss} بلا اختيار)` : ''}</span><span>الخصم ${k.ded}</span>${k.min ? `<span>الحد الأدنى ${n2(k.min)}${k.floored ? ' (طُبِّق)' : ''}</span>` : ''}</div>`;
  } else {
    const P = f.passage;
    body = `<div class="acts"><button type="button" class="btn sm" data-act="fm-big">${f.big ? 'تصغير الخط' : 'تكبير الخط'}</button><label class="note">انتقال إلى آية <select data-act-jump aria-label="انتقال إلى آية">${P.ayat.map((a) => `<option value="${a.n}">${a.n}</option>`).join('')}</select></label></div>
    <div class="scroll mx ${f.big ? 'big' : ''}"><table class="grid-form matrix"><thead><tr><th rowspan="2" class="txt">الآية — سورة ${esc(P.name)}</th>${(() => { const h = []; for (const c2 of R.cols) { const l = h[h.length - 1]; if (l && l.n === c2.n) l.s++; else h.push({ n: c2.n, s: 1 }); } return h.map((x) => `<th colspan="${x.s}">${esc(x.n)}</th>`).join(''); })()}<th rowspan="2">ملاحظات الوقف والابتداء</th></tr>
      <tr>${R.cols.map((c2) => `<th>${esc(c2.col || '—')}<small>−${c2.d}</small></th>`).join('')}</tr></thead><tbody>
      ${P.bismillah ? `<tr class="bsm"><td class="txt quran" colspan="${R.cols.length + 2}">${esc(P.bismillah)}</td></tr>` : ''}
      ${P.ayat.map((a) => `<tr id="ay-${a.n}"><td class="txt quran">${esc(a.text)} <span class="ayn">﴿${a.n}﴾</span></td>${R.cols.map((c2) => `<td>${ctr(`r.${a.n}.${c2.k}`, (d.rows[a.n] || {})[c2.k], lock)}</td>`).join('')}<td><input class="note-in" data-fn="${a.n}" value="${esc((d.rows[a.n] || {}).note || '')}" ${lock ? 'readonly' : ''} aria-label="ملاحظة الآية ${a.n}"></td></tr>`).join('')}</tbody></table></div>
    <p class="note">النص بالرسم العثماني من مشروع تنزيل (tanzil.net).</p>
    <div class="calc"><span>مجموع الخصم ${n2(k.ded)}</span>${k.min ? `<span>الحد الأدنى ${n2(k.min)}${k.floored ? ' (طُبِّق)' : ''}</span>` : ''}</div>`;
  }
  return `<div class="head"><div><h1>${esc(R.title)}</h1><p>${esc(c.name)} · ${esc(c.category)} · ${esc(c.branchName)}${c.trackName ? ' · ' + esc(c.trackName) : ''} · ${esc(c.stageName)} · ${esc(c.committee)}${f.slot > 1 ? ' · المحكم ' + f.slot : ''}</p></div><div class="acts"><button class="btn" data-act="fm-back">رجوع إلى القائمة</button></div></div>
  <div class="card"><p class="note">المقرر: ${esc(c.curriculum)} — ${esc(R.note)}</p>${!f.mine ? '<div class="banner">هذه الخانة يرصدها محكم آخر في اللجنة.</div>' : ''}${lock ? '<div class="banner info">أُرسل التقييم وأُقفل. لإعادة فتحه تواصل مع رئيس لجنة التحكيم.</div>' : ''}
  <p class="err" hidden></p>${body}
  <div class="field"><label for="fm-note">${R.key === 'tilawa_waqf' ? 'التقرير والملاحظات (مواضع الموارد)' : 'ملاحظات المحكم'}</label><textarea id="fm-note" data-fgn maxlength="2000" ${lock ? 'readonly' : ''}>${esc(d.note || '')}</textarea></div>
  <div class="total-bar"><span>درجتك في هذه الاستمارة</span><b>${n2(k.raw)}</b><span>من ${k.base}</span>${R.extra && d[R.extra.k] != null && d[R.extra.k] !== '' ? `<span>· ${esc(R.extra.n)} ${d[R.extra.k]}</span>` : ''}</div>
  ${lock || !f.mine ? '' : `<label class="check"><input type="checkbox" id="fm-ok">راجعت الاستمارة، وأرغب في إرسالها (لا تُعدَّل بعد الإرسال)</label>
  <div class="acts"><button class="btn" data-act="fm-save">حفظ مسودة</button><button class="btn pri" data-act="fm-submit">إرسال التقييم</button>${f.dirty ? '<span class="tag warn">تعديلات غير محفوظة</span>' : f.version ? '<span class="tag ok">محفوظ على الخادم</span>' : ''}</div>`}</div>`;
}
function fmSet(path, v) {
  const f = S.fm, [t, a, b2] = path.split('.');
  if (t === 's') { f.data.segments[+a] = f.data.segments[+a] || {}; f.data.segments[+a][b2] = v; }
  else if (t === 'd') f.data.deductions[a] = v;
  else if (t === 'r') { f.data.rows[a] = f.data.rows[a] || {}; f.data.rows[a][b2] = v; }
  f.dirty = true;
}
function fmGet(path) { const d = S.fm.data, [t, a, b2] = path.split('.'); return +((t === 's' ? (d.segments[+a] || {})[b2] : t === 'd' ? d.deductions[a] : (d.rows[a] || {})[b2]) || 0); }
function fmPaint() { const v = $('#view'), y = scrollY, a = document.activeElement && document.activeElement.dataset.ctr; v.innerHTML = gradeForm(); afterRender(v); scrollTo(0, y); if (a) { const e = v.querySelector(`[data-ctr="${a}"]`); if (e) { e.focus(); e.select(); } } }
async function fmSave(submit) {
  const f = S.fm;
  const r = await api('/judge/form/' + f.ticketId, { method: 'PUT', body: { data: f.data, version: f.version, submit } });
  f.version = r.evaluation.version; f.dirty = false; f.locked = r.evaluation.status === 'submitted';
  toast(submit ? 'أُرسل التقييم: ' + n2(r.evaluation.raw) + ' من ' + n2(r.evaluation.base) : 'حُفظت المسودة على الخادم');
  fmPaint();
}

// ---------- النتائج وكشف الترتيب ----------
async function vResults() {
  const q = S.res = S.res || { section: '', branch: '' };
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  const d = S.resData = await api('/results?' + qs + '&stage=' + S.stage);
  return `<div class="head"><div><h1>النتائج وكشف الترتيب</h1><p>${esc(d.stageName)} · تُحسب تلقائيًا من الاستمارات المرسلة، والمتعادلون يأخذون الترتيب نفسه. يظهر هنا من بدأ اختباره أو أنهاه.</p></div>
    <div class="acts"><button class="btn" data-act="xl" data-href="/api/results.xlsx?${esc(qs)}&stage=${S.stage}" data-n="كشف ${esc(STG.find((x) => x[0] === S.stage)[1])}.xlsx">تنزيل الكشف (Excel)</button></div></div>${stageBar()}
  <div class="filters">${me.role === 'top' ? `<select id="rs-section" aria-label="القسم">${opts(Object.entries(meta.sections), q.section, 'القسمان')}</select>` : ''}<select id="rs-branch" aria-label="الفرع">${opts([['hifz', 'الحفظ'], ['tilawa', 'التلاوة']], q.branch, 'كل الفروع')}</select></div>
  ${d.groups.length ? d.groups.map((g, gi) => { const first = g.ranked[0] || g.pending[0]; const parts = first ? first.parts : []; const sh = g.sheet;
    const st = !sh ? '<span class="tag">محسوبة، لم تُعتمد</span>' : sh.stale ? '<span class="tag bad">تحتاج إعادة اعتماد</span>' : sh.status === 'published' ? `<span class="tag ok">منشورة · نسخة ${sh.version}</span>` : `<span class="tag info">معتمدة · نسخة ${sh.version}</span>`;
    const acts = [
      g.canApprove && (!sh || sh.stale) ? `<button class="btn sm pri" data-act="approve" data-g="${gi}">${sh ? 'إعادة اعتماد الكشف' : 'اعتماد الكشف'}</button>` : '',
      me.role === 'top' && sh && !sh.stale ? `<button class="btn sm" data-act="publish" data-id="${sh.id}" data-p="${sh.status === 'published' ? 0 : 1}">${sh.status === 'published' ? 'إيقاف النشر' : 'نشر للمتسابقين'}</button>` : '',
      g.nextStage && sh && !sh.stale ? `<button class="btn sm" data-act="qualify" data-g="${gi}">التأهل إلى ${esc(g.nextStageName)}…</button>` : '',
    ].join('');
    return `<div class="card"><div class="qh"><div><h2>${esc(g.name)}</h2><p class="note">${esc(g.sectionName)} · المكتمل ${g.ranked.length} · غير المكتمل ${g.pending.length}${g.untested ? ` · لم يُختبر بعد ${g.untested}` : ''}${g.nextStage && g.qualifiedCount ? ` · المتأهلون إلى ${esc(g.nextStageName)}: ${g.qualifiedCount}` : ''}</p></div><div class="acts">${st}${acts}</div></div>
    ${g.untested && !g.ranked.length && !g.pending.length ? '<p class="note">لم يبدأ اختبار أحد في هذه المجموعة بعد.</p>' : ''}
    <div class="scroll"><table class="list stack"><thead><tr><th class="n">الترتيب</th><th>المتسابق</th>${g.allAges ? '<th>الفئة</th>' : ''}${parts.map((p) => `<th class="n">${esc(p.n)} (${p.weight})</th>`).join('')}<th class="n">المجموع (${g.max})</th></tr></thead><tbody>
    ${g.ranked.map((r) => `<tr class="click" data-act="res" data-id="${r.entryId}" tabindex="0"><td class="n"><b>${r.rank}</b>${r.tie ? ' <span class="tag warn">تعادل</span>' : ''}</td><td><b>${esc(r.name)}</b>${r.tafsir ? (r.tafsir === 'done' ? ' <span class="tag ok">قدّم اختبار التفسير</span>' : ' <span class="tag bad">لم يقدّم اختبار التفسير</span>') : ''}${r.qualified === 'qualified' ? ` <span class="tag ok">متأهل${r.exceptional ? ' (استثناء)' : ''}</span>` : r.qualified === 'excluded' ? ' <span class="tag">غير متأهل</span>' : ''}</td>${g.allAges ? `<td>${esc(r.category)}</td>` : ''}${r.parts.map((p) => `<td class="n">${n2(p.value)}</td>`).join('')}<td class="n"><b>${n2(r.total)}</b></td></tr>`).join('')}
    ${g.pending.map((r) => `<tr class="click pend" data-act="res" data-id="${r.entryId}" tabindex="0"><td class="n">—</td><td><b>${esc(r.name)}</b><br><small class="note">بانتظار: ${r.missing.map((m) => esc(m.n)).join('، ')}</small></td>${g.allAges ? `<td>${esc(r.category)}</td>` : ''}${r.parts.map((p) => `<td class="n">${n2(p.value)}</td>`).join('')}<td class="n"><span class="tag warn">غير مكتملة</span></td></tr>`).join('')}
    </tbody></table></div></div>`; }).join('') : '<div class="card empty"><p>لا توجد نتائج بعد. تظهر هنا بعد حضور المتسابقين وبدء الرصد.</p></div>'}`;
}
function qualifyForm(g) {
  modal('التأهل إلى ' + g.nextStageName + ': ' + g.name, `<p class="note">يقترح النظام القائمة من الكشف المعتمد. التعادل على المقعد الأخير لا يُفصل آليًا، ويحتاج قرارًا صريحًا بسببه. أي قرار يخالف المقترح يُسجَّل استثناءً بسببه.</p>
  <form data-form="qprev" data-g="${S.resData.groups.indexOf(g)}"><p class="err" hidden></p><div class="row3"><div class="field"><label for="q-mode">القاعدة</label><select id="q-mode">${opts([['count', 'عدد المتأهلين'], ['score', 'حد الدرجة']], 'count')}</select></div>
  <div class="field"><label for="q-val">القيمة</label><input id="q-val" inputmode="decimal" required></div><div class="field"><label>&nbsp;</label><button class="btn" type="submit">معاينة القائمة</button></div></div><div id="q-list"></div></form>`);
}
async function openResult(entryId) {
  const d = await api('/results/entry/' + entryId + '?stage=' + S.stage), c = d.contestant, r = d.result;
  modal(c.name, `<p class="note">${esc(c.category)} · ${esc(c.branchName)}${c.trackName ? ' · ' + esc(c.trackName) : ''} · ${esc(c.committee)} · ${esc(c.stageName)}</p><p class="err" hidden></p>
  <table class="review"><tbody>${r.parts.map((p) => `<tr><th>${esc(p.n)} (من ${p.weight})</th><td><b>${n2(p.value)}</b>${p.judges.length > 1 && p.judges.some((x) => x != null) ? ` <span class="note">المحكمون: ${p.judges.map(n2).join(' و')}${p.bases ? ' من ' + n2(p.bases[0]) : ''}</span>` : p.judges[0] != null && p.bases ? ` <span class="note">الخام ${n2(p.judges[0])} من ${n2(p.bases[0])}</span>` : ''}</td></tr>`).join('')}
  <tr><th>المجموع (من ${r.max})</th><td><b>${r.complete ? n2(r.total) : 'غير مكتمل'}</b></td></tr></tbody></table>
  <h3>الاستمارات</h3>${d.evaluations.map((e) => `<div class="entry"><b>${esc(e.title)}${e.slot > 1 ? ' · المحكم ' + e.slot : ''}</b><span class="tag ${EV[e.status][0]}">${EV[e.status][1]}</span>
    <span class="cur">${esc(e.judge)} · الخام ${n2(e.raw)} من ${n2(e.base)}${e.extra != null ? ' · المفردات ' + e.extra : ''}${e.submittedAt ? ' · ' + esc(fmt(e.submittedAt)) : ''}${e.revisions.length ? `<br>${e.revisions.map((v) => `أُعيد فتحه (${esc(v.actor)} · ${esc(fmt(v.at))}): كان ${n2(v.raw)}${v.extra != null ? ' / المفردات ' + v.extra : ''} — ${esc(v.reason)}`).join('<br>')}` : ''}</span>
    ${e.status === 'submitted' ? `<div class="acts"><input id="ro-${e.id}" placeholder="سبب إعادة الفتح" aria-label="سبب إعادة الفتح"><button class="btn sm" data-act="reopen" data-id="${e.id}" data-e="${entryId}">إعادة فتح للمحكم</button></div>` : ''}</div>`).join('') || '<p class="note">لا توجد استمارات بعد.</p>'}`);
}

// ---------- اختبار التفسير: المتسابق ----------
const EX = { tick: null, skew: 0 };
const dt = (t) => (t ? new Date(t).toLocaleString('ar-u-nu-latn-ca-gregory', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const mmss = (sec) => { sec = Math.max(0, Math.round(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; };
async function vTests() { return me.role === 'contestant' ? (S.exam ? examView() : myTestsView()) : (S.testId ? testAdmin() : testsAdmin()); }
async function myTestsView() {
  const d = await api('/my/tests');
  return `<div class="head"><div><h1>اختبار التفسير</h1><p>الاختبارات الإلكترونية المرتبطة بمشاركاتك. محاولة واحدة لكل اختبار، ويُحسب الوقت من الخادم.</p></div></div>
  ${d.tests.length ? d.tests.map((t) => `<div class="card"><div class="qh"><div><h2>${esc(t.title)}</h2><span class="note">${esc(t.kindName)}${t.reference ? ' · المرجع: ' + esc(t.reference) : ''}</span></div>
    <span class="tag ${t.attempt ? (t.attempt.status === 'submitted' ? 'ok' : 'warn') : t.window.open ? 'info' : ''}">${t.attempt ? (t.attempt.status === 'submitted' ? 'أُرسل' : 'قيد الحل') : esc(t.window.label)}</span></div>
    <dl class="kv"><dt>عدد الأسئلة</dt><dd>${t.questionCount}</dd><dt>المدة</dt><dd>${t.durationMin} دقيقة</dd>${t.opensAt ? `<dt>يبدأ</dt><dd>${esc(dt(t.opensAt))}</dd>` : ''}${t.closesAt ? `<dt>ينتهي</dt><dd>${esc(dt(t.closesAt))}</dd>` : ''}</dl>
    ${t.result ? `<p class="myres">النتيجة: <b>${n2(t.result.score)}</b> من ${n2(t.result.max)}${t.result.passed != null ? (t.result.passed ? ' · <span class="tag ok">ناجح</span>' : ' · <span class="tag">لم يبلغ حد النجاح</span>') : ''}</p>` : t.attempt && t.attempt.status === 'submitted' ? '<p class="note">تظهر النتيجة بعد نشرها.</p>' : ''}
    <div class="acts">${t.attempt && t.attempt.status === 'in_progress' ? `<button class="btn pri" data-act="ex-open" data-id="${t.id}">متابعة الاختبار</button>` : !t.attempt && t.window.open ? `<button class="btn pri" data-act="ex-start" data-id="${t.id}" data-n="${t.durationMin}">ابدأ الاختبار</button>` : ''}</div></div>`).join('')
    : '<div class="card empty"><p>لا توجد اختبارات متاحة لمشاركاتك الآن. اختبار فرع التفسير لمسجلي الفرع، واختبار تفسير المقطع لمسجلي التلاوة.</p></div>'}`;
}
async function openExam(id) { S.exam = await api(`/my/tests/${id}/attempt`); S.exam.id = id; EX.skew = S.exam.now - Date.now(); S.exam.saved = {}; render(); }
function examView() {
  const e = S.exam, done = e.status === 'submitted', left = (e.deadline - (Date.now() + EX.skew)) / 1000;
  clearInterval(EX.tick);
  if (!done) EX.tick = setInterval(async () => {
    const l = (S.exam.deadline - (Date.now() + EX.skew)) / 1000, el = $('#ex-timer');
    if (el) { el.textContent = mmss(l); el.classList.toggle('low', l < 60); }
    if (l <= 0) { clearInterval(EX.tick); try { await openExam(S.exam.id); toast('انتهى الوقت وأُرسلت إجاباتك المحفوظة'); } catch (x) {} }
  }, 1000);
  const answered = e.questions.filter((q) => q.answer != null).length;
  return `<div class="exam-top"><div><b>${esc(e.title)}</b><span class="note">${esc(e.kindName)}</span></div>${done ? `<span class="tag ok">أُرسل${e.auto ? ' آليًا عند انتهاء الوقت' : ''}</span>` : `<span class="timer" id="ex-timer" aria-live="off">${mmss(left)}</span>`}<span class="note">أُجيب ${answered} من ${e.questions.length}</span></div>
  ${done ? `<div class="card"><h2>أُرسل الاختبار</h2>${e.result ? `<p class="myres">النتيجة: <b>${n2(e.result.score)}</b> من ${n2(e.result.max)}</p>` : '<p>تظهر النتيجة بعد نشرها من إدارة المسابقة.</p>'}<button class="btn" data-act="ex-back">رجوع</button></div>` : ''}
  <ol class="qs">${e.questions.map((q, i) => `<li class="card q"><p class="qt"><b>${i + 1}.</b> ${esc(q.text)} <span class="note">(${n2(q.points)} ${q.points === 1 ? 'درجة' : 'درجات'})</span></p>
    <div class="qo" role="radiogroup" aria-label="السؤال ${i + 1}">${q.options.map((o, k) => `<label class="opt-row"><input type="radio" name="q${q.id}" data-ex="${q.id}" value="${k}" ${q.answer === k ? 'checked' : ''} ${done ? 'disabled' : ''}>${esc(o)}</label>`).join('')}</div>
    ${done ? '' : `<span class="note" id="sv-${q.id}">${q.answer != null ? 'محفوظ على الخادم' : ''}</span>`}</li>`).join('')}</ol>
  ${done ? '' : `<div class="card"><p class="err" hidden></p><label class="check"><input type="checkbox" id="ex-ok">راجعت إجاباتي وأرغب في إرسال الاختبار (لا يمكن التعديل بعده)</label><div class="acts"><button class="btn pri" data-act="ex-submit">إرسال الاختبار</button><span class="note">تُحفظ كل إجابة فور اختيارها، ويمكنك إغلاق الصفحة والعودة قبل انتهاء الوقت.</span></div></div>`}`;
}

// ---------- اختبارات التفسير: الإدارة ----------
async function testsAdmin() {
  const d = S.testsData = await api('/tests');
  const free = d.curricula.filter((c) => !d.tests.some((t) => t.curriculumId === c.id));
  return `<div class="head"><div><h1>اختبارات التفسير</h1><p>اختبار فرع التفسير لكل فئة، واختبار تفسير المقطع لمتسابقي التلاوة، منفصلان. الأسئلة تُراجع وتُعتمد قبل فتح الاختبار.</p></div>
    ${me.role === 'top' && free.length ? '<div class="acts"><button class="btn pri" data-act="t-new">إنشاء اختبار</button></div>' : ''}</div>
  ${d.tests.length ? `<div class="qgrid">${d.tests.map((t) => `<article class="card"><h3>${esc(t.title)}</h3><p class="note">${esc(t.kindName)}<br>${esc(t.curriculum)}</p>
    <div class="chips"><span class="tag ${t.status === 'open' ? 'ok' : t.status === 'closed' ? '' : 'warn'}">${esc(t.statusName)}</span><span class="tag">الأسئلة المعتمدة ${t.approved} من ${t.questions}</span><span class="tag">المحاولات ${t.attempts}</span>${t.resultsPublished ? '<span class="tag ok">النتائج منشورة</span>' : ''}</div>
    <div class="acts"><button class="btn sm pri" data-act="t-open" data-id="${t.id}">${me.role === 'exec' ? 'الإنجاز' : me.role === 'top' ? 'إدارة' : 'المراجعة والنتائج'}</button></div></article>`).join('')}</div>` : '<div class="card empty"><p>لا توجد اختبارات بعد.</p></div>'}`;
}
const toLocal = (t) => { if (!t) return ''; const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
async function testAdmin() {
  const top = me.role === 'top', review = ['top', 'chief'].includes(me.role);
  const [det, res] = await Promise.all([review ? api('/tests/' + S.testId) : Promise.resolve(null), api(`/tests/${S.testId}/results`)]);
  const t = res.test;
  const qs = det ? det.questions : [];
  return `<div class="head"><div><h1>${esc(t.title)}</h1><p>${esc(t.kindName)} · ${esc(t.curriculum)}</p></div><div class="acts"><button class="btn" data-act="t-back">كل الاختبارات</button></div></div>
  ${top ? `<details class="blk" ${t.status === 'draft' ? 'open' : ''}><summary>إعداد الاختبار</summary><form data-form="test" data-id="${t.id}"><p class="err" hidden></p>
    <div class="row2"><div class="field"><label for="t-title">العنوان</label><input id="t-title" value="${esc(t.title)}" required></div><div class="field"><label for="t-ref">الكتاب المرجعي ونسخته</label><input id="t-ref" value="${esc(t.reference)}"></div></div>
    <div class="row3"><div class="field"><label for="t-n">عدد الأسئلة لكل متسابق</label><input id="t-n" inputmode="numeric" value="${t.questionCount}"><small>تُسحب عشوائيًا من الأسئلة المعتمدة.</small></div><div class="field"><label for="t-d">المدة (دقيقة)</label><input id="t-d" inputmode="numeric" value="${t.durationMin}"></div><div class="field"><label for="t-p">حد النجاح (اختياري)</label><input id="t-p" inputmode="decimal" value="${esc(t.passMark ?? '')}"><small>لم يُحسم في اللائحة (D05).</small></div></div>
    <div class="row3"><div class="field"><label for="t-o">يبدأ</label><input id="t-o" type="datetime-local" value="${toLocal(t.opensAt)}"></div><div class="field"><label for="t-c">ينتهي</label><input id="t-c" type="datetime-local" value="${toLocal(t.closesAt)}"></div><div class="field"><label for="t-s">الحالة</label><select id="t-s">${opts([['draft', 'مسودة'], ['open', 'مفتوح'], ['closed', 'مغلق']], t.status)}</select></div></div>
    <button class="btn pri" type="submit">حفظ</button></form></details>` : ''}
  ${review ? `<div class="card"><div class="qh"><div><h2>بنك الأسئلة (${qs.length})</h2><p class="note">المعتمد ${t.approved}. السؤال الذي ظهر في محاولة لا يُعدَّل ولا يُحذف.</p></div></div>
    ${qs.length ? `<ol class="bank">${qs.map((q) => `<li><p><b>${esc(q.text)}</b> <span class="note">(${n2(q.points)})${q.source ? ' · ' + esc(q.source) : ''}</span></p><ul>${q.options.map((o, k) => `<li class="${k === q.correct ? 'right' : ''}">${esc(o)}${k === q.correct ? ' ✓' : ''}</li>`).join('')}</ul>
      <div class="acts"><span class="tag ${q.status === 'approved' ? 'ok' : 'warn'}">${q.status === 'approved' ? 'معتمد' : 'بانتظار المراجعة'}</span>${q.used ? '<span class="tag">ظهر في محاولة</span>' : `<button class="btn sm ${q.status === 'approved' ? '' : 'okb'}" data-act="q-review" data-id="${q.id}" data-v="${q.status === 'approved' ? 0 : 1}">${q.status === 'approved' ? 'سحب الاعتماد' : 'اعتماد'}</button>${top ? `<button class="btn sm badb" data-act="q-del" data-id="${q.id}">حذف</button>` : ''}`}</div></li>`).join('')}</ol>` : '<p class="note">لا توجد أسئلة بعد.</p>'}
    ${top ? `<details class="blk"><summary>إضافة سؤال</summary><form data-form="question" data-id="${t.id}"><p class="err" hidden></p>
      <div class="row3"><div class="field"><label for="qn-t">النوع</label><select id="qn-t">${opts([['mcq', 'اختيار من متعدد'], ['tf', 'صح أو خطأ']], 'mcq')}</select></div><div class="field"><label for="qn-p">الدرجة</label><input id="qn-p" inputmode="decimal" value="1"></div><div class="field"><label for="qn-c">رقم الإجابة الصحيحة</label><input id="qn-c" inputmode="numeric" value="1"><small>في صح أو خطأ: 1 = صح، 2 = خطأ.</small></div></div>
      <div class="field"><label for="qn-x">نص السؤال</label><textarea id="qn-x" required></textarea></div><div class="field"><label for="qn-o">الخيارات (خيار في كل سطر)</label><textarea id="qn-o"></textarea></div><div class="field"><label for="qn-s">المصدر العلمي</label><input id="qn-s"></div><button class="btn pri" type="submit">إضافة</button></form></details>
    <details class="blk"><summary>استيراد أسئلة من نص</summary><form data-form="import" data-id="${t.id}"><p class="err" hidden></p><p class="note">افصل بين الأسئلة بسطر فارغ. السطر الأول نص السؤال، ثم الخيارات سطرًا سطرًا، وضع علامة * بعد الإجابة الصحيحة. «صح» و«خطأ» وحدهما يجعلان السؤال صحًّا أو خطأً. سطر «المصدر: …» أو «الدرجة: …» اختياري.</p>
      <textarea id="im-x" rows="10" class="ltr-no" placeholder="كم عدد آيات سورة النبأ؟&#10;أ) 30&#10;ب) 40 *&#10;ج) 50&#10;&#10;سورة النبأ مكية&#10;صح *&#10;خطأ"></textarea><button class="btn pri" type="submit">استيراد</button></form></details>` : ''}</div>` : ''}
  <div class="card"><div class="qh"><div><h2>${review ? 'النتائج' : 'الإنجاز'}</h2><p class="note">${review ? 'الترتيب بالدرجة ثم بزمن الحل المحسوب من الخادم.' : 'حالة الإنجاز دون الدرجات.'}</p></div>
    ${top ? `<button class="btn sm" data-act="t-pub" data-id="${t.id}" data-p="${t.resultsPublished ? 0 : 1}" ${t.status === 'closed' ? '' : 'disabled title="أغلق الاختبار أولًا"'}>${t.resultsPublished ? 'إيقاف نشر النتائج' : 'نشر النتائج للمتسابقين'}</button>` : ''}</div>
    ${res.rows.length ? `<table class="list stack"><thead><tr>${review ? '<th class="n">الترتيب</th>' : ''}<th>المتسابق</th><th>القسم</th><th>الحالة</th>${review ? '<th class="n">الدرجة</th><th class="n">زمن الحل</th>' : ''}</tr></thead><tbody>
      ${res.rows.sort((a, b) => (a.rank || 999) - (b.rank || 999)).map((r) => `<tr>${review ? `<td class="n">${r.rank || '—'}</td>` : ''}<td>${esc(r.name)}</td><td>${esc(r.sectionName)}</td><td><span class="tag ${r.status === 'submitted' ? 'ok' : 'warn'}">${r.status === 'submitted' ? 'أُنجز' : 'قيد الحل'}</span>${r.auto ? ' <span class="tag">إرسال آلي</span>' : ''}</td>${review ? `<td class="n">${r.score != null ? `${n2(r.score)} / ${n2(r.max)}` : '—'}${r.passed === false ? ' <span class="tag">دون الحد</span>' : ''}</td><td class="n">${r.seconds != null ? mmss(r.seconds) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<p class="note">لم يبدأ أحد بعد.</p>'}
    ${res.notStarted.length ? `<details><summary class="note">لم يبدؤوا (${res.notStarted.length})</summary><p>${res.notStarted.map((x) => esc(x.name)).join('، ')}</p></details>` : ''}</div>`;
}

// ---------- الإشعارات ----------
async function vInbox() {
  const d = await api('/notifications');
  if (d.unread) { api('/notifications/read', { method: 'POST' }).catch(() => {}); S.unread = 0; setTimeout(shell, 0); }
  const LINK = { my: 'مشاركتي', tests: 'اختبار التفسير' };
  return `<div class="head"><div><h1>الإشعارات</h1><p>تصلك هنا إشعارات التسجيل والمواعيد والنداء والنتائج والإعلانات.</p></div></div>
  <div class="card">${d.rows.length ? `<ul class="inbox">${d.rows.map((n) => `<li class="${n.read ? '' : 'new'}"><div><b>${esc(n.title)}</b><span class="note"> · ${esc(fmt(n.at))}</span></div><p>${esc(n.body)}</p>${n.link && LINK[n.link] && navFor().some((x) => x[0] === n.link) ? `<a class="btn sm" href="#${n.link}">${LINK[n.link]}</a>` : ''}</li>`).join('')}</ul>` : '<p class="empty">لا توجد إشعارات بعد.</p>'}</div>`;
}

// ---------- مواعيد المراحل ----------
// حقول الموعد: اليوم الأول ووقت البدء، والمدة بالأيام، ووقت الانتهاء اليومي (اختياري)
const pad2 = (n) => String(n).padStart(2, '0');
function whenFields(pre, x) {
  const d = x ? new Date(x.startsAt) : null;
  const date = d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : '', time = d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '16:00';
  return `<div class="row2"><div class="field"><label for="${pre}-d">اليوم الأول</label><input id="${pre}-d" type="date" value="${date}" required></div>
    <div class="field"><label for="${pre}-n">المدة (أيام متتالية)</label><input id="${pre}-n" type="number" min="1" max="30" value="${x ? x.days : 1}" required></div></div>
    <div class="row2"><div class="field"><label for="${pre}-t">يبدأ يوميًا الساعة</label><input id="${pre}-t" type="time" value="${time}" required></div>
    <div class="field"><label for="${pre}-e">وينتهي الساعة (اختياري)</label><input id="${pre}-e" type="time" value="${x ? esc(x.endTime) : ''}"></div></div>`;
}
const whenBody = (pre) => { const at = new Date(`${val(pre + '-d')}T${val(pre + '-t') || '00:00'}`).getTime(); if (!Number.isFinite(at)) throw new Error('أدخل اليوم الأول ووقت البدء'); return { startsAt: at, days: val(pre + '-n'), endTime: val(pre + '-e') }; };
async function vSchedule() {
  const d = S.sch = await api('/sessions');
  const BR = [['', 'كل الفروع'], ...pub.branches.filter((b) => b.registrable).map((b) => [b.code, b.name])];
  return `<div class="head"><div><h1>مواعيد المراحل</h1><p>يظهر الموعد في حساب كل متسابق معني به: المسجلون في التصفيات، والمتأهلون في المراحل التالية. تحديد الموعد أو تغييره يرسل إشعارًا، ويصل تذكير قبله.</p></div></div>
  <div class="grid2"><div class="card"><h2>المواعيد</h2>${d.sessions.length ? `<table class="list stack"><thead><tr><th>المرحلة</th>${me.role === 'top' ? '<th>القسم</th>' : ''}<th>الفرع</th><th>الموعد والمدة</th><th>الموقع</th><th></th></tr></thead><tbody>
    ${d.sessions.map((x) => `<tr><td>${esc(x.stageName)}</td>${me.role === 'top' ? `<td>${esc(x.sectionName)}</td>` : ''}<td>${esc(x.branchName)}</td><td>${esc(x.when)}${x.version > 1 ? ' <span class="tag warn">معدّل</span>' : ''}</td><td>${esc(x.location)}${x.note ? `<br><small class="note">${esc(x.note)}</small>` : ''}</td><td><button class="btn sm" data-act="ss-edit" data-id="${x.id}">تعديل</button></td></tr>`).join('')}</tbody></table>` : '<p class="note">لم تُحدَّد مواعيد بعد؛ يرى المتسابقون «بانتظار الإعلان».</p>'}</div>
  <div class="card"><h2>موعد جديد</h2><form data-form="session"><p class="err" hidden></p>
    <div class="row2"><div class="field"><label for="ss-st">المرحلة</label><select id="ss-st">${opts(STG, 'prelim')}</select></div>${me.role === 'top' ? `<div class="field"><label for="ss-sec">القسم</label><select id="ss-sec">${opts(Object.entries(meta.sections), 'M')}</select></div>` : ''}</div>
    <div class="field"><label for="ss-br">الفرع</label><select id="ss-br">${opts(BR, '')}</select><small>موعد الفرع المحدد يتقدم على موعد «كل الفروع».</small></div>
    ${whenFields('ss', null)}
    <div class="field"><label for="ss-loc">الموقع</label><input id="ss-loc" required placeholder="مثل: مقر الجمعية — القاعة الكبرى"></div>
    <div class="field"><label for="ss-note">ملاحظة للمتسابقين</label><input id="ss-note"></div>
    <button class="btn pri" type="submit">حفظ وإشعار المعنيين</button></form></div></div>`;
}

// ---------- الإشعارات: الإدارة ----------
async function vNotices() {
  const q = S.nq = S.nq || { status: '', page: 1 };
  const d = await api(`/admin/notifications?page=${q.page}${q.status ? '&status=' + q.status : ''}`);
  const BR = [['', 'كل الفروع'], ...pub.branches.filter((b) => b.registrable).map((b) => [b.code, b.name])];
  return `<div class="head"><div><h1>الإشعارات</h1><p>كل إشعار يظهر داخل حساب المتسابق. القنوات الخارجية تعمل حين تُضبط مع مزودها، ولكل إرسال سجل بحالته.</p></div><div class="acts"><button class="btn" data-act="rem-run">إرسال التذكيرات المستحقة الآن</button></div></div>
  <div class="grid2"><div class="card"><h2>القنوات</h2><ul class="members"><li><span>داخل حساب المتسابق</span><span class="tag ok">مفعّلة دائمًا</span></li>${d.channels.map((c) => `<li><span>${esc(c.name)}</span><span class="tag ${c.on ? 'ok' : ''}">${c.on ? 'مفعّلة' : 'غير مفعّلة'}</span></li>`).join('')}</ul>
    <p class="note">تُفعَّل البريد والرسائل وواتساب من إعدادات الخادم بعد الاتفاق مع المزود وتكلفته (D10). «أُرسل إلى المزود» لا يعني بالضرورة وصول الرسالة.</p>
    <h3>الأحداث المرسلة</h3>${d.events.length ? `<ul class="members">${d.events.map((e) => `<li><span>${esc(e.name)}</span><span class="note">${e.n} · آخرها ${esc(fmt(e.last))}</span></li>`).join('')}</ul>` : '<p class="note">لا يوجد بعد.</p>'}</div>
  <div class="card"><h2>إعلان للمتسابقين</h2><form data-form="announce"><p class="err" hidden></p>
    <div class="row3"><div class="field"><label for="an-st">المرحلة</label><select id="an-st">${opts(STG, 'prelim')}</select><small>بعد التصفيات: المتأهلون فقط.</small></div><div class="field"><label for="an-sec">القسم</label><select id="an-sec">${opts(Object.entries(meta.sections), '', 'القسمان')}</select></div><div class="field"><label for="an-br">الفرع</label><select id="an-br">${opts(BR, '')}</select></div></div>
    <div class="field"><label for="an-t">العنوان</label><input id="an-t" required></div><div class="field"><label for="an-b">النص</label><textarea id="an-b" required></textarea></div>
    <button class="btn pri" type="submit">إرسال الإعلان</button></form></div></div>
  <div class="card"><div class="qh"><h2>سجل الإرسال الخارجي</h2><select id="nq-st" aria-label="الحالة">${opts([['queued', 'في الانتظار'], ['sent', 'أُرسل إلى المزود'], ['failed', 'تعذّر الإرسال'], ['skipped', 'تُخطّي']], q.status, 'كل الحالات')}</select></div>
    <p class="note">${Object.entries(d.counts).map(([k, n]) => `${{ queued: 'في الانتظار', sent: 'أُرسل', failed: 'تعذّر', skipped: 'تُخطّي' }[k] || k}: ${n}`).join(' · ') || 'لا يوجد إرسال خارجي بعد، لأن القنوات غير مفعّلة.'}</p>
    ${d.rows.length ? `<div class="scroll"><table class="list stack"><thead><tr><th>المستلم</th><th>الإشعار</th><th>القناة</th><th>الحالة</th><th>المحاولات</th><th></th></tr></thead><tbody>${d.rows.map((x) => `<tr><td>${esc(x.name)}<br><small class="note ltr">${esc(x.recipient)}</small></td><td>${esc(x.title)}<br><small class="note">${esc(x.eventName)}</small></td><td>${esc(x.channelName)}</td>
      <td><span class="tag ${x.status === 'sent' ? 'ok' : x.status === 'failed' ? 'bad' : 'warn'}">${esc(x.statusName)}</span>${x.error ? `<br><small class="note">${esc(x.error)}</small>` : ''}</td><td class="n">${x.attempts}</td><td>${x.status === 'failed' || x.status === 'skipped' ? `<button class="btn sm" data-act="resend" data-id="${x.id}">إعادة الإرسال</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
}

// ---------- توزيع المتسابقين على أيام التصفيات ----------
const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
function dplanFrom(d) {
  const dates = d.days.length ? d.days.map((x) => x.date) : d.suggest.length ? d.suggest : [''];
  const caps = {};
  d.days.forEach((x, i) => d.groups.forEach((g) => { if (g.caps[x.id]) caps[`${i + 1}|${g.key}`] = g.caps[x.id]; }));
  return { n: dates.length, dates, caps, section: d.section };
}
const capCell = (tot, reg) => `<b>${tot}</b> ${reg > tot ? `<span class="tag bad">ينقص ${reg - tot}</span>` : reg ? '<span class="tag ok">يكفي</span>' : ''}`;
// تحديث المجاميع في مكانها دون إعادة رسم (لا يضيع موضع الكتابة)
function capTotals() {
  const P = S.dplan, n = P.n;
  for (const g of S.dd.groups) { const el = document.querySelector(`[data-ctot="${CSS.escape(g.key)}"]`); let t = 0; for (let i = 1; i <= n; i++) t += P.caps[`${i}|${g.key}`] || 0; if (el) el.innerHTML = capCell(t, g.registered); }
  for (let i = 1; i <= n; i++) { const el = document.querySelector(`[data-dtot="${i}"]`); if (el) el.innerHTML = `<b>${S.dd.groups.reduce((m, g) => m + (P.caps[`${i}|${g.key}`] || 0), 0)}</b>`; }
}
async function vDays() {
  const sec = me.role === 'top' ? (S.dsec = S.dsec || 'M') : me.section;
  const d = S.dd = await api('/days?section=' + sec);
  if (!S.dplan || S.dplan.section !== d.section || !S.dplanDirty) { S.dplan = dplanFrom(d); S.dplanDirty = false; }
  const P = S.dplan, dayIx = Array.from({ length: P.n }, (_, i) => i + 1);
  const capOf = (no, k) => P.caps[`${no}|${k}`] || 0;
  const st = !d.days.length ? ['', 'لم تُحدَّد الأيام بعد'] : !d.published ? ['warn', 'مسودة لم تُنشر للمتسابقين'] : d.changed ? ['warn', 'تغيّر التوزيع بعد آخر نشر؛ أعد النشر ليصل المتسابقين'] : ['ok', 'منشور للمتسابقين'];
  S.dpeople = S.dpeople && S.dpeople.section === sec ? S.dpeople : { section: sec, day: '', rows: null };
  if (S.dpeople.day !== '' && !S.dpeople.rows) S.dpeople.rows = (await api(`/days/people?section=${sec}&day=${S.dpeople.day}`)).rows;
  const dayOpts = [...d.days.map((x) => [x.id, `${x.name} · ${x.label}`]), ['none', 'غير موزّعين']];
  return `<div class="head"><div><h1>توزيع المتسابقين على أيام التصفيات</h1><p>حدد أيام التصفيات الأولية وسعة كل يوم لكل فرع وفئة، ثم اطلب التوزيع وراجعه، ثم اعتمده وانشره فيصل كل متسابق يومه. يُجمع صاحب أكثر من مشاركة في يوم واحد ما أمكن.</p></div>
    ${me.role === 'top' ? `<div class="acts">${['M', 'F'].map((x) => `<button class="btn ${x === sec ? 'pri' : ''}" data-act="daysec" data-s="${x}">${esc(meta.sections[x])}</button>`).join('')}</div>` : ''}</div>
  <div class="banner ${st[0] === 'ok' ? 'info' : 'warn'}"><b>${esc(st[1])}</b>${d.publishedAt ? ` · آخر نشر ${esc(fmt(d.publishedAt))}` : ''}${d.regClose ? ` · إغلاق التسجيل ${esc(d.regClose)}` : ''}</div>
  <div class="kpis"><div class="kpi main"><b>${d.persons}</b><span>متسابقًا في الفروع الميدانية</span></div><div class="kpi"><b>${d.entries}</b><span>مشاركة</span></div><div class="kpi"><b>${d.unassigned}</b><span>غير موزّعة</span></div><div class="kpi"><b>${d.checkedIn}</b><span>حضرت</span></div></div>
  <div class="card"><h2>الأيام والسعة</h2><form data-form="dplan"><p class="err" hidden></p>
    <div class="row3"><div class="field"><label for="dp-n">عدد أيام التصفيات</label><input id="dp-n" type="number" min="1" max="14" value="${P.n}" data-dn></div>
    ${dayIx.map((no) => `<div class="field"><label for="dp-d${no}">${esc(['اليوم الأول', 'اليوم الثاني', 'اليوم الثالث', 'اليوم الرابع', 'اليوم الخامس', 'اليوم السادس', 'اليوم السابع'][no - 1] || 'اليوم ' + no)}</label><input id="dp-d${no}" type="date" value="${esc(P.dates[no - 1] || '')}" data-dd="${no}" required></div>`).join('')}</div>
    <div class="scroll"><table class="list caps"><thead><tr><th>الفرع والفئة</th><th>المسجلون</th>${dayIx.map((no) => `<th>يوم ${no}</th>`).join('')}<th>مجموع السعة</th></tr></thead><tbody>
    ${d.groups.map((g) => { const tot = dayIx.reduce((n, no) => n + capOf(no, g.key), 0); return `<tr><td><b>${esc(g.branchName)}</b> · ${esc(g.categoryName)}</td><td class="n">${g.registered}</td>
      ${dayIx.map((no) => `<td><input class="capin" type="number" min="0" max="5000" inputmode="numeric" value="${capOf(no, g.key) || ''}" placeholder="0" data-cap="${no}|${g.key}" aria-label="${esc(g.branchName + ' ' + g.categoryName)} يوم ${no}"></td>`).join('')}
      <td class="n" data-ctot="${esc(g.key)}">${capCell(tot, g.registered)}</td></tr>`; }).join('')}
    <tr class="sum"><td>المجموع</td><td class="n">${d.groups.reduce((n, g) => n + g.registered, 0)}</td>${dayIx.map((no) => `<td class="n" data-dtot="${no}"><b>${d.groups.reduce((n, g) => n + capOf(no, g.key), 0)}</b></td>`).join('')}<td></td></tr></tbody></table></div>
    <div class="acts"><button class="btn" type="button" data-act="dp-even">اقتراح سعة بالتساوي</button><button class="btn pri" type="submit">حفظ الأيام والسعة</button></div>
    <p class="note">السعة عدد المشاركات في اليوم لكل فرع وفئة. «اقتراح بالتساوي» يقسم المسجلين على الأيام، ويمكنك تعديله قبل الحفظ.</p></form></div>
  <div class="card"><div class="head sm"><h2>التوزيع</h2><div class="acts"><button class="btn" data-act="xl" data-href="/api/days.xlsx?section=${sec}" data-n="توزيع أيام التصفيات.xlsx">تنزيل التوزيع (Excel)</button></div></div>
    ${d.days.length ? `<div class="row3"><div class="field"><label for="dp-o">ترتيب التوزيع</label><select id="dp-o">${opts([['registration', 'بأسبقية التسجيل (الأسبق في الأيام الأولى)'], ['random', 'عشوائي'], ['name', 'أبجدي بالاسم']], S.dorder || 'registration')}</select></div></div>
    <div class="acts"><button class="btn pri" data-act="dp-run" data-m="all">${d.days.some((x) => x.entries) ? 'إعادة توزيع الجميع' : 'توزيع المتسابقين'}</button>${d.days.some((x) => x.entries) ? '<button class="btn" data-act="dp-run" data-m="fill">توزيع غير الموزعين فقط</button>' : ''}
      <button class="btn ${d.published && !d.changed ? '' : 'gold'}" data-act="dp-pub">اعتماد ونشر للمتسابقين</button></div>
    <table class="list"><thead><tr><th>اليوم</th><th>التاريخ</th><th>المتسابقون</th><th>المشاركات / السعة</th></tr></thead><tbody>${d.days.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(x.label)}</td><td class="n">${x.persons}</td><td class="n">${x.entries} / ${x.cap} ${x.entries > x.cap ? '<span class="tag warn">تجاوز</span>' : ''}</td></tr>`).join('')}
      ${d.unassigned ? `<tr><td><b>غير موزّعة</b></td><td></td><td></td><td class="n"><span class="tag bad">${d.unassigned}</span></td></tr>` : ''}</tbody></table>
    <p class="note">«إعادة توزيع الجميع» تعيد ترتيب كل من لم يحضر، عدا من نُقل يدويًا. «غير الموزعين فقط» تضيف المسجلين الجدد دون تحريك أحد. النشر يُشعر كل متسابق بيومه، ثم يُشعر من تغيّر يومه فقط عند إعادة النشر.</p>` : '<p class="empty">احفظ الأيام والسعة أولًا.</p>'}</div>
  ${d.days.length ? `<div class="card"><div class="head sm"><h2>قوائم الأيام</h2><div class="acts"><select id="dp-day" data-dpday aria-label="اليوم">${opts(dayOpts, S.dpeople.day, 'اختر اليوم')}</select></div></div>
    ${S.dpeople.rows ? (S.dpeople.rows.length ? `<table class="list stack"><thead><tr><th>المتسابق</th><th>الفئة</th><th>المشاركات</th><th>نقل إلى</th></tr></thead><tbody>${S.dpeople.rows.map((p) => `<tr><td><b>${esc(p.name)}</b><br><small class="note ltr">${esc(p.phone || '')}</small></td><td>${esc(p.category)}</td>
      <td>${p.entries.map((e) => `<span class="tag ${e.checked ? 'ok' : ''}">${esc(e.branch)}${e.dayId ? ` · ${esc((d.days.find((x) => x.id === e.dayId) || {}).name || '')}` : ' · غير موزّع'}${e.manual ? ' · يدوي' : ''}${e.checked ? ' · حضر' : ''}</span>`).join(' ')}</td>
      <td>${p.entries.every((e) => e.checked) ? '—' : `<select data-mv="${p.regId}" aria-label="نقل ${esc(p.name)}">${opts([...d.days.map((x) => [x.id, x.name]), ['', 'غير موزّع']], '', 'اختر')}</select>`}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">لا أحد في هذا اليوم.</p>') : '<p class="note">اختر يومًا لعرض قائمته ونقل من تريد.</p>'}</div>` : ''}`;
}

// ---------- قرعة المقاطع: البنك والمتابعة ----------
async function vDraws() {
  const st = S.dst = S.dst || 'semi';
  const [b, d] = await Promise.all([api('/admin/bank?stage=' + st), api('/admin/draws?stage=' + st)]);
  S.bank = b; S.drw = d;
  const stN = st === 'semi' ? 'قبل النهائي' : 'النهائي';
  const tags = { none: '', pending: 'warn', approved: 'ok' };
  const total = b.curricula.reduce((n, c) => n + c.items.length, 0);
  return `<div class="head"><div><h1>قرعة مقاطع التلاوة</h1><p>بعد نشر كشف التأهل يختار كل متأهل مقطعه عشوائيًا من بنك مساره وفئته، بثلاث محاولات خلال يومين. المقطع المعتمد يظهر للمحكمين في استمارة المرحلة.</p></div>
    <div class="acts">${['semi', 'final'].map((x) => `<button class="btn ${x === st ? 'pri' : ''}" data-act="dst" data-s="${x}">${x === 'semi' ? 'قبل النهائي' : 'النهائي'}</button>`).join('')}</div></div>
  <div class="card"><div class="head sm"><h2>بنك مقاطع ${stN} (${total})</h2><div class="acts"><button class="btn" data-act="xl" data-href="/api/admin/bank.xlsx?stage=${st}" data-n="بنك مقاطع ${stN}.xlsx">تنزيل البنك (Excel)</button></div></div>
    ${b.curricula.map((c) => { const short = c.capacity.filter((x) => x.qualified && x.items < x.need); return `<details class="bank"><summary><b>${esc(c.name)}</b> <span class="tag ${!c.items.length ? '' : short.length ? 'warn' : 'ok'}">${c.items.length} ${c.items.length === 1 ? 'مقطع' : 'مقاطع'}</span>
      ${c.capacity.filter((x) => x.qualified || x.taken).map((x) => `<small class="note">${esc(x.sectionName)}: ${x.qualified} متأهل يحتاجون ${x.need} · ظهر منها ${x.taken} · المتاح ${x.free}</small>`).join(' ')}
      ${short.length ? `<span class="tag bad">البنك لا يكفي ${short.map((x) => esc(x.sectionName)).join(' و')}</span>` : ''}</summary>
      ${c.items.length ? `<ul class="matlist">${c.items.map((i) => `<li><div><b>${esc(i.label)}</b>${i.note ? `<small class="note">${esc(i.note)}</small>` : ''}<small class="note">سُحب ${i.drawn} مرة</small></div>${b.canEdit ? `<div class="acts"><button class="btn sm badb" data-act="bk-del" data-id="${i.id}">حذف</button></div>` : ''}</li>`).join('')}</ul>` : '<p class="note">لا مقاطع بعد. من تأهل في هذا المقرر لا يرى القرعة حتى تُضاف مقاطع.</p>'}</details>`; }).join('')}
    <p class="note">المقطع الذي يظهر لمتسابق لا يظهر لغيره في القسم نفسه، فيلزم لكل مقرر ثلاثة مقاطع لكل متأهل على الأقل (مثلًا 5 متأهلين يحتاجون 15 مقطعًا). إعادة قرعة متسابق تعيد مقاطعه إلى البنك. حذف مقطع سبق سحبه لا يغيّره عند من سحبه.</p>
    ${b.canEdit ? `<div class="grid2"><form data-form="bank-add"><h3>إضافة مقطع</h3><p class="err" hidden></p>
      <div class="field"><label for="bk-c">المسار والفئة</label><select id="bk-c" required>${opts(b.curricula.map((c) => [c.id, c.name]), '', 'اختر')}</select></div>
      <div class="row3"><div class="field"><label for="bk-s">السورة</label><select id="bk-s" required>${opts(b.surahs.map((x) => [x.n, `${x.n}. ${x.name} (${x.ayat})`]), '', 'اختر')}</select></div>
      <div class="field"><label for="bk-f">من الآية</label><input id="bk-f" inputmode="numeric" required></div><div class="field"><label for="bk-t">إلى الآية</label><input id="bk-t" inputmode="numeric" required></div></div>
      <div class="field"><label for="bk-n">ملاحظة (اختياري)</label><input id="bk-n" maxlength="200"></div><button class="btn pri" type="submit">إضافة إلى البنك</button></form>
    <form data-form="bank-import"><h3>رفع البنك من Excel</h3><p class="err" hidden></p>
      <p class="note">نزّل البنك أولًا واستخدمه نموذجًا: الأعمدة المسار، الفئة، المرحلة، السورة (اسمها أو رقمها)، من الآية، إلى الآية، ملاحظة. الصفوف الخالية من السورة تُترك. يُفحص الملف كله، ولا يُحفظ شيء إن وُجد خطأ.</p>
      <div class="field"><label for="bi-f">الملف (xlsx)</label><input id="bi-f" type="file" accept=".xlsx" required></div>
      <div class="field"><label for="bi-m">طريقة الرفع</label><select id="bi-m">${opts([['append', 'إضافة إلى البنك الحالي'], ['replace', `استبدال بنك ${stN} كله`]], 'append')}</select></div>
      <button class="btn pri" type="submit">رفع الملف</button></form></div>` : ''}</div>
  <div class="card"><div class="head sm"><h2>متابعة القرعة: المتأهلون إلى ${stN} (${d.counts.total})</h2><div class="acts">${d.canAct ? '<button class="btn" data-act="dr-notify">إشعار من لم يسحب بعد</button>' : ''}<button class="btn" data-act="xl" data-href="/api/admin/draws.xlsx?stage=${st}" data-n="قرعة ${stN}.xlsx">تنزيل القائمة (Excel)</button></div></div>
    <p><span class="tag">لم يسحب ${d.counts.none}</span> <span class="tag warn">لم يعتمد ${d.counts.pending}</span> <span class="tag ok">معتمد ${d.counts.approved}</span></p>
    ${d.rows.length ? `<table class="list stack"><thead><tr><th>المتسابق</th>${me.role === 'top' ? '<th>القسم</th>' : ''}<th>المسار والفئة</th><th>الحالة</th><th>المقطع</th><th></th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr><td>${esc(r.name)}</td>${me.role === 'top' ? `<td>${esc(r.sectionName)}</td>` : ''}<td>${esc(r.group)}</td>
      <td><span class="tag ${tags[r.status]}">${esc(r.statusName)}</span>${r.attempts ? ` <small class="note">${r.attempts} من ${r.max}</small>` : ''}${!r.announced ? ' <small class="note">التأهل غير منشور</small>' : r.locked ? ' <small class="note">حضر</small>' : r.status !== 'approved' && r.closes ? `<br><small class="note">${r.expired ? 'انتهت المهلة' : 'المهلة حتى'} ${esc(r.closes)}</small>` : ''}</td>
      <td>${r.current ? esc(r.current.label) : '—'}</td>
      <td>${d.canAct && !r.locked && r.open ? `${r.adminCanDraw && r.status === 'none' ? `<button class="btn sm" data-act="ad-draw" data-e="${r.entryId}" data-x="${r.attempts + 1}">سحب نيابة عنه</button>` : ''}${r.adminCanApprove ? `<button class="btn sm" data-act="ad-ok" data-e="${r.entryId}">اعتماد نيابة عنه</button>` : ''}${r.attempts ? `<button class="btn sm badb" data-act="ad-reset" data-e="${r.entryId}">إعادة القرعة</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="note">لا يوجد متأهلون إلى ${stN} في مقررات التلاوة بعد.</p>`}
    <p class="note">مهلة القرعة يومان من نشر التأهل (أو من إعادة القرعة). من لم يعتمد مقطعه يُعتمد له آخر مقطع ظهر له، ومن لم يسحب تسحب له الإدارة. تُقفل القرعة عند تسجيل حضوره لهذه المرحلة. السحب نيابة عن المتسابق يتبع القواعد نفسها ويُسجَّل في سجل التدقيق.</p></div>`;
}

// ---------- مذكرات المقررات: الإدارة ----------
const MSTG = [['', 'كل المراحل'], ['semi', 'المتأهلون إلى قبل النهائي'], ['final', 'المتأهلون إلى النهائي']];
const currLabel = (x) => `${x.trackName ? x.trackName + ' · ' : ''}${x.categoryId ? catName(x.categoryId) + ' · ' : ''}${x.content}`;
function matFields(m, pre) {
  const brs = pub.branches.map((b) => [b.code, b.name]);
  const br = m ? m.branch : brs[0][0];
  const curr = pub.curricula.filter((x) => x.branch === br).map((x) => [x.id, currLabel(x)]);
  return `<div class="field"><label for="${pre}-t">عنوان المذكرة <span class="req">*</span></label><input id="${pre}-t" required maxlength="150" value="${esc(m ? m.title : '')}" placeholder="مثل: مذكرة تفسير جزء عمّ"></div>
    <div class="row2"><div class="field"><label for="${pre}-br">الفرع</label><select id="${pre}-br" data-mbr="${pre}">${opts(brs, br)}</select></div>
    <div class="field"><label for="${pre}-cu">المقرر</label><select id="${pre}-cu">${opts(curr, m ? m.curriculumId : '', 'كل مقررات الفرع')}</select></div></div>
    <div class="row3"><div class="field"><label for="${pre}-ca">الفئة</label><select id="${pre}-ca">${opts(pub.categories.map((c) => [c.id, c.name]), m ? m.categoryId : '', 'كل الفئات')}</select></div>
    ${me.role === 'top' ? `<div class="field"><label for="${pre}-se">القسم</label><select id="${pre}-se">${opts(Object.entries(meta.sections), m ? m.section : '', 'القسمان')}</select></div>` : ''}
    <div class="field"><label for="${pre}-st">لمن</label><select id="${pre}-st">${opts(MSTG, m ? m.stage : '')}</select></div></div>
    <div class="field"><label for="${pre}-no">وصف قصير للمتسابقين</label><input id="${pre}-no" maxlength="500" value="${esc(m ? m.note : '')}"></div>`;
}
const matBody = (pre) => ({ title: val(pre + '-t'), branch: val(pre + '-br'), curriculumId: val(pre + '-cu') || null, categoryId: val(pre + '-ca') || null, section: val(pre + '-se'), stage: val(pre + '-st'), note: val(pre + '-no') });
async function vMaterials() {
  const d = S.mat = await api('/admin/materials');
  const groups = pub.branches.map((b) => [b, d.materials.filter((m) => m.branch === b.code)]).filter(([, ms]) => ms.length);
  const accept = d.types.map((x) => '.' + x).join(',');
  return `<div class="head"><div><h1>مذكرات المقررات</h1><p>ارفع المذكرة متى جهزت، فتظهر لكل متسابق في «مشاركتي» تحت مشاركته، ويصله إشعار. المسودة لا يراها المتسابقون حتى تنشرها.</p></div></div>
  <div class="grid2"><div class="card"><h2>المذكرات (${d.materials.length})</h2>${groups.length ? groups.map(([b, ms]) => `<h3>${esc(b.name)}</h3><ul class="matlist">${ms.map((m) => `<li>
      <div><b>${esc(m.title)}</b> <span class="tag ${m.published ? 'ok' : 'warn'}">${m.published ? 'منشورة' : 'مسودة'}</span>${m.version > 1 ? ` <span class="tag">النسخة ${m.version}</span>` : ''}
      <small class="note">${esc(m.target)}${m.section ? '' : ' · القسمان'}</small>
      <small class="note"><bdi>${esc(m.fileName)}</bdi> · <bdi>${kb(m.size)}</bdi> · ${m.published ? `وصلت إلى ${m.audience} · نزّلها ${m.downloads}` : `ستصل عند النشر إلى ${m.wouldReach}`}</small></div>
      <div class="acts"><button class="btn sm" data-act="mdl" data-id="${m.id}" data-n="${esc(m.fileName)}">تنزيل</button>${m.canEdit && d.canManage ? `
        <button class="btn sm ${m.published ? '' : 'pri'}" data-act="m-pub" data-id="${m.id}" data-on="${m.published ? 0 : 1}">${m.published ? 'إيقاف النشر' : 'نشر وإشعار'}</button>
        <button class="btn sm" data-act="m-edit" data-id="${m.id}">تعديل</button><button class="btn sm" data-act="m-file" data-id="${m.id}">استبدال الملف</button>
        <button class="btn sm badb" data-act="m-del" data-id="${m.id}">حذف</button>` : ''}</div></li>`).join('')}</ul>`).join('') : '<p class="note">لم تُرفع مذكرات بعد. يمكن رفعها في أي وقت خلال الدورة.</p>'}</div>
  ${d.canManage ? `<div class="card"><h2>رفع مذكرة</h2><form data-form="material"><p class="err" hidden></p>${matFields(null, 'mt')}
    <div class="field"><label for="mt-f">الملف <span class="req">*</span></label><input id="mt-f" type="file" accept="${accept}" required><small>${d.types.map((x) => x.toUpperCase()).join('، ')} · حتى ${d.maxMB} ميغابايت${window.__iqraDemo ? ' (في النسخة التجريبية)' : ''}</small></div>
    <label class="check"><input type="checkbox" id="mt-p" checked> نشرها الآن وإشعار المعنيين</label>
    <div class="acts"><button class="btn pri" type="submit">رفع المذكرة</button></div></form>
    <p class="note">المذكرة لكل الفرع ما لم تخصصها بمقرر أو فئة. «المتأهلون إلى…» تجعلها لمن تأهل إلى تلك المرحلة فقط، مثل مقاطع النهائي.${me.role === 'exec' ? ' تُرفع لقسمك؛ المذكرة المشتركة للقسمين ترفعها الإدارة العليا.' : ''}</p></div>` : ''}</div>`;
}

const VIEWS = { home: vHome, login: vLogin, signup: vSignup, account: vAccount, space: vSpace, my: vMy, regs: vRegs, dash: vDash, setup: vSettings, users: vUsers, audit: vAudit, reception: vReception, queues: vQueues, committees: vCommittees, screen: vScreen, grade: vGrade, results: vResults, tests: vTests, inbox: vInbox, schedule: vSchedule, notices: vNotices, materials: vMaterials, draws: vDraws, days: vDays };

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
        S.wz = null; toast(w.edit ? 'حُفظ التعديل' : 'تم تسجيلك بنجاح'); render();
      } catch (err) { b.disabled = false; showErr($('#view .err'), err); } finally { busy = false; }
    }
    else if (a === 'withdraw') modal('الانسحاب من المسابقة', `<p>يُسجَّل انسحابك من جميع مشاركاتك في هذه الدورة، ويبقى طلبك محفوظًا في السجل. لا يمكنك التراجع عنه من حسابك.</p><form data-form="withdraw"><p class="err" hidden></p><div class="field"><label for="wd-r">السبب (اختياري)</label><textarea id="wd-r"></textarea></div><div class="acts"><button class="btn badb" type="submit">تأكيد الانسحاب</button><button class="btn" type="button" data-act="close">تراجع</button></div></form>`);
    else if (a === 'phones') modal('تحديث بيانات التواصل', `<form data-form="phones"><p class="err" hidden></p><div class="field"><label for="ph-1">الهاتف الأساسي</label><input id="ph-1" class="ltr" type="tel" value="${esc(S.my.person.phone)}" required></div><div class="field"><label for="ph-2">هاتف آخر</label><input id="ph-2" class="ltr" type="tel" value="${esc(S.my.person.phone2)}"></div><div class="field"><label for="ph-e">البريد الإلكتروني</label><input id="ph-e" class="ltr" type="email" value="${esc(S.my.person.email || '')}"></div><div class="acts"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`);
    // التسجيلات
    else if (a === 'csv') {
      if (!window.__iqraDemo) { location.href = b.dataset.href; return; }
      const t = (await (await fetch(b.dataset.href, { headers: { 'X-Iqra': '1' } })).text()).replace(/^\ufeff/, '');
      modal('تصدير التسجيلات', `<p class="note">في النسخة التجريبية لا يُنزَّل الملف. في النسخة المنشورة يُنزَّل ملف CSV يفتح في Excel مباشرة.</p><textarea class="ltr" rows="12" readonly>${esc(t)}</textarea><div class="acts"><button class="btn pri" data-act="copy" data-v="${esc(t)}">نسخ</button></div>`);
    }
    else if (a === 'reg') await openReg(+id);
    else if (a === 'page') { S.regs.page = +b.dataset.p; render(); }
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
    else if (a === 'ss-edit') { const x = S.sch.sessions.find((y) => y.id === +id);
      modal('تعديل موعد ' + x.stageName + ' — ' + x.branchName, `<p class="note">${esc(x.sectionName)}. يرسل التعديل إشعار «تغيير الموعد» للمعنيين.</p><form data-form="session-edit" data-id="${x.id}"><p class="err" hidden></p>
        ${whenFields('se', x)}<div class="field"><label for="se-loc">الموقع</label><input id="se-loc" value="${esc(x.location)}" required></div><div class="field"><label for="se-note">ملاحظة</label><input id="se-note" value="${esc(x.note)}"></div>
        <div class="acts"><button class="btn pri" type="submit">حفظ وإشعار المعنيين</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`); }
    else if (a === 'rem-run') { const r = await api('/admin/reminders', { method: 'POST' }); toast(r.sent ? `أُرسل ${r.sent} تذكيرًا` : 'لا توجد تذكيرات مستحقة الآن'); render(); }
    else if (a === 'xl') { b.disabled = true; try { await fetchFile(b.dataset.href, b.dataset.n); } finally { b.disabled = false; } }
    else if (a === 'dr-draw' || a === 'dr-ok') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.dataset.t = b.textContent; b.textContent = a === 'dr-ok' ? 'تأكيد الاعتماد النهائي' : 'تأكيد: اختر مقطعًا'; setTimeout(() => { if (b.isConnected && b.dataset.sure === '1') { b.dataset.sure = ''; b.textContent = b.dataset.t; } }, 5000); return; }
      b.disabled = true; b.textContent = a === 'dr-ok' ? 'جارٍ الاعتماد…' : 'جارٍ اختيار المقطع…';
      const r = await api(`/my/draws/${b.dataset.e}/${a === 'dr-ok' ? 'approve' : 'draw'}`, { method: 'POST', body: { stage: b.dataset.st, expect: +b.dataset.x || undefined } });
      if (a === 'dr-draw') await new Promise((ok) => setTimeout(ok, 600));
      toast(a === 'dr-ok' ? 'اعتُمد مقطعك' : `ظهر لك: ${r.state.current.label}`); render();
    }
    else if (a === 'daysec') { S.dsec = b.dataset.s; S.dplanDirty = false; S.dpeople = null; render(); }
    else if (a === 'dp-even') {
      const P = S.dplan;
      for (const g of S.dd.groups) { const per = Math.floor(g.registered / P.n), extra = g.registered % P.n; for (let i = 1; i <= P.n; i++) P.caps[`${i}|${g.key}`] = per + (i <= extra ? 1 : 0); }
      S.dplanDirty = true; render();
    }
    else if (a === 'dp-run') {
      if (b.dataset.m === 'all' && S.dd.published && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد: إعادة توزيع الجميع'; toast('التوزيع منشور؛ إعادة التوزيع قد تغيّر أيام بعض المتسابقين، ويلزم إعادة النشر بعدها'); return; }
      S.dorder = val('dp-o');
      const r = await api('/days/distribute', { method: 'POST', body: { section: S.dd.section, mode: b.dataset.m, order: S.dorder } });
      const x = r.result; toast(`وُزّعت ${x.assigned} مشاركة${x.split ? `، وقُسمت مشاركات ${x.split} على يومين` : ''}${x.unassigned ? `، ولم تتسع السعة لـ ${x.unassigned}` : ''}`);
      S.dpeople.rows = null; render();
    }
    else if (a === 'dp-pub') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد النشر وإرسال الإشعارات'; return; }
      const r = await api('/days/publish', { method: 'POST', body: { section: S.dd.section } });
      toast(r.notified ? `نُشر التوزيع وأُشعر ${r.notified} متسابقًا` : 'نُشر التوزيع؛ لا تغييرات تستدعي إشعارًا'); render();
    }
    else if (a === 'dst') { S.dst = b.dataset.s; render(); }
    else if (a === 'bk-del') { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد الحذف'; return; } await api('/admin/bank/' + id, { method: 'DELETE' }); toast('حُذف المقطع من البنك'); render(); }
    else if (a === 'dr-notify') { const r = await api('/admin/draws/notify', { method: 'POST', body: { stage: S.dst } }); toast(r.notified ? `أُشعر ${r.notified} متسابقًا` : 'لا يوجد من يحتاج إشعارًا جديدًا'); }
    else if (a === 'ad-draw') { const r = await api(`/admin/draws/${b.dataset.e}/draw`, { method: 'POST', body: { stage: S.dst, expect: +b.dataset.x } }); toast(`سُحب: ${r.state.current.label}`); render(); }
    else if (a === 'ad-ok') { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد الاعتماد'; return; } await api(`/admin/draws/${b.dataset.e}/approve`, { method: 'POST', body: { stage: S.dst } }); toast('اعتُمد المقطع'); render(); }
    else if (a === 'ad-reset') { const r0 = S.drw.rows.find((x) => x.entryId === +b.dataset.e); modal('إعادة قرعة ' + r0.name, `<p>تُلغى المحاولات (${r0.attempts}) ويحصل المتسابق على ثلاث محاولات جديدة، ويصله إشعار بذلك. يبقى أثر المحاولات الملغاة في سجل التدقيق.</p><form data-form="dr-reset" data-e="${r0.entryId}"><p class="err" hidden></p><div class="field"><label for="dr-r">السبب</label><input id="dr-r" required maxlength="300"></div><div class="acts"><button class="btn badb" type="submit">إعادة القرعة</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`); }
    else if (a === 'mdl') { b.disabled = true; try { await download(id, b.dataset.n); if (view === 'my') setTimeout(repaint, 400); } finally { b.disabled = false; } }
    else if (a === 'm-pub') { const m = S.mat.materials.find((x) => x.id === +id); const r = await api('/admin/materials/' + id, { method: 'PUT', body: { ...m, publish: b.dataset.on === '1' } }); toast(b.dataset.on === '1' ? `نُشرت المذكرة وأُشعر ${r.notified} متسابقًا` : 'أُوقف نشر المذكرة'); render(); }
    else if (a === 'm-edit') { const m = S.mat.materials.find((x) => x.id === +id); modal('تعديل ' + m.title, `<form data-form="matedit" data-id="${m.id}"><p class="err" hidden></p>${matFields(m, 'me')}<p class="note">${m.published ? 'المذكرة منشورة: إن وسّعت جمهورها يُشعر من أُضيفوا فقط.' : 'المذكرة مسودة.'}</p><div class="acts"><button class="btn pri" type="submit">حفظ</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`); }
    else if (a === 'm-file') { const m = S.mat.materials.find((x) => x.id === +id); modal('استبدال ملف ' + m.title, `<form data-form="matfile" data-id="${m.id}"><p class="err" hidden></p><p>الملف الحالي: ${esc(m.fileName)} (النسخة ${m.version}).</p><div class="field"><label for="mf-f">الملف الجديد</label><input id="mf-f" type="file" accept="${S.mat.types.map((x) => '.' + x).join(',')}" required></div><p class="note">${m.published ? 'يُشعر من وصلتهم المذكرة بأن نسخة محدّثة متاحة.' : ''}</p><div class="acts"><button class="btn pri" type="submit">رفع النسخة الجديدة</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`); }
    else if (a === 'm-del') { if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'تأكيد الحذف'; return; } await api('/admin/materials/' + id, { method: 'DELETE' }); toast('حُذفت المذكرة'); render(); }
    else if (a === 'resend') { await api(`/admin/deliveries/${id}/resend`, { method: 'POST' }); toast('أُعيد إلى طابور الإرسال'); render(); }
    // اختبار التفسير
    else if (a === 'ex-start') modal('بدء الاختبار', `<p>يبدأ احتساب الوقت (${esc(b.dataset.n)} دقيقة) فور البدء، ولا يتوقف إذا أغلقت الصفحة. تُحفظ كل إجابة فور اختيارها، وتُرسل إجاباتك المحفوظة آليًا عند انتهاء الوقت.</p><div class="acts"><button class="btn pri" data-act="ex-go" data-id="${id}">ابدأ الآن</button><button class="btn" data-act="close">ليس الآن</button></div>`);
    else if (a === 'ex-go') { await api(`/my/tests/${id}/start`, { method: 'POST' }); closeModal(); await openExam(+id); }
    else if (a === 'ex-open') await openExam(+id);
    else if (a === 'ex-back') { S.exam = null; clearInterval(EX.tick); render(); }
    else if (a === 'ex-submit') {
      if (!($('#ex-ok') || {}).checked) return showErr($('#view .err'), new Error('أكّد مراجعة إجاباتك قبل الإرسال'));
      await api(`/my/tests/${S.exam.id}/submit`, { method: 'POST' }); toast('أُرسل الاختبار'); await openExam(S.exam.id);
    }
    else if (a === 't-new') { const free = S.testsData.curricula.filter((c) => !S.testsData.tests.some((t) => t.curriculumId === c.id));
      modal('إنشاء اختبار', `<form data-form="testnew"><p class="err" hidden></p><div class="field"><label for="tn-c">المقرر</label><select id="tn-c">${opts(free.map((c) => [c.id, (c.kind === 'branch' ? 'فرع التفسير — ' : 'تفسير مقطع التلاوة — ') + c.name]), '')}</select></div>
        <div class="field"><label for="tn-t">العنوان</label><input id="tn-t" required></div><div class="row2"><div class="field"><label for="tn-n">عدد الأسئلة</label><input id="tn-n" inputmode="numeric" value="10"></div><div class="field"><label for="tn-d">المدة (دقيقة)</label><input id="tn-d" inputmode="numeric" value="20"></div></div>
        <div class="acts"><button class="btn pri" type="submit">إنشاء</button><button class="btn" type="button" data-act="close">إلغاء</button></div></form>`); }
    else if (a === 't-open') { S.testId = +id; render(); }
    else if (a === 't-back') { S.testId = null; render(); }
    else if (a === 'q-review') { await api(`/questions/${id}/review`, { method: 'POST', body: { approve: b.dataset.v === '1' } }); render(); }
    else if (a === 'q-del') { await api('/questions/' + id, { method: 'DELETE' }); toast('حُذف السؤال'); render(); }
    else if (a === 't-pub') { await api(`/tests/${id}/publish`, { method: 'POST', body: { publish: b.dataset.p === '1' } }); toast(b.dataset.p === '1' ? 'نُشرت النتائج' : 'أُوقف النشر'); render(); }
    else if (a === 'stage') { S.stage = b.dataset.s; S.fm = null; render(); }
    else if (a === 'approve') { const g = S.resData.groups[+b.dataset.g]; await api('/results/approve', { method: 'POST', body: { stage: S.stage, groupKey: g.key } }); toast('اعتُمد الكشف: ' + g.name); render(); }
    else if (a === 'publish') { await api('/results/publish', { method: 'POST', body: { sheetId: +id, publish: b.dataset.p === '1' } }); toast(b.dataset.p === '1' ? 'نُشر الكشف للمتسابقين' : 'أُوقف النشر'); render(); }
    else if (a === 'qualify') qualifyForm(S.resData.groups[+b.dataset.g]);
    else if (a === 'q-approve') {
      const f = $('#dlg form'), g = S.resData.groups[+f.dataset.g], rows = S.qprev.rows;
      const decisions = rows.map((r) => ({ entryId: r.entryId, qualified: $('#qd-' + r.entryId).checked, reason: val('qr-' + r.entryId) })).filter((d, i) => d.qualified !== rows[i].proposed || rows[i].tieAtCut);
      await api('/qualify/approve', { method: 'POST', body: { stage: S.stage, groupKey: g.key, mode: val('q-mode'), value: val('q-val'), decisions } });
      closeModal(); toast('اعتُمدت قائمة التأهل'); render();
    }
    else if (a === 'sp-save') {
      const rows = $$('#sp-rows tr').map((tr) => ({ id: +tr.dataset.id, semi: { surah: $('[name=ss]', tr).value, ayahFrom: $('[name=sf]', tr).value, ayahTo: $('[name=st]', tr).value }, final: { surah: $('[name=fs]', tr).value, ayahFrom: $('[name=ff]', tr).value, ayahTo: $('[name=ft]', tr).value } }));
      await api('/admin/stage-passages', { method: 'PUT', body: { rows } }); toast('حُفظت مقاطع المراحل');
    }
    // الرصد
    else if (a === 'fm-open') await openForm(+id);
    else if (a === 'fm-back') { if (S.fm && S.fm.dirty && b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'توجد تعديلات غير محفوظة. اضغط مرة أخرى للخروج'; return; } S.fm = null; render(); }
    else if (a === 'ctr') { const v = Math.max(0, Math.min(999, fmGet(b.dataset.p) + +b.dataset.d)); fmSet(b.dataset.p, v); fmPaint(); }
    else if (a === 'fm-big') { S.fm.big = !S.fm.big; fmPaint(); }
    else if (a === 'fm-save' || a === 'fm-submit') {
      if (busy) return;
      if (a === 'fm-submit' && !($('#fm-ok') || {}).checked) return showErr($('#view .err'), new Error('أكّد مراجعة الاستمارة قبل الإرسال'));
      busy = true; try { await fmSave(a === 'fm-submit'); } catch (err) { showErr($('#view .err'), err); } finally { busy = false; }
    }
    // النتائج
    else if (a === 'res') await openResult(+id);
    else if (a === 'reopen') { await api(`/evaluations/${id}/reopen`, { method: 'POST', body: { reason: val('ro-' + id) } }); toast('أُعيد فتح الاستمارة للمحكم'); await openResult(+b.dataset.e); }
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
  if (t.dataset.dn !== undefined && S.dplan) {
    const n = Math.min(14, Math.max(1, parseInt(t.value, 10) || 1)), P = S.dplan;
    for (let i = P.dates.length; i < n; i++) P.dates[i] = P.dates[i - 1] ? addDays(P.dates[i - 1], 1) : '';
    P.n = n; P.dates.length = n; S.dplanDirty = true; render();
  }
  if (t.dataset.dd && S.dplan) { S.dplan.dates[+t.dataset.dd - 1] = t.value; S.dplanDirty = true; }
  if (t.dataset.cap && S.dplan) { S.dplan.caps[t.dataset.cap] = Math.max(0, parseInt(t.value, 10) || 0); S.dplanDirty = true; capTotals(); }
  if (t.dataset.dpday !== undefined) { S.dpeople = { section: S.dd.section, day: t.value, rows: null }; render(); }
  if (t.dataset.mv) { (async () => { try { await api('/days/move', { method: 'POST', body: { registrationId: +t.dataset.mv, dayId: t.value ? +t.value : null } }); toast('نُقل المتسابق'); S.dpeople.rows = null; render(); } catch (e) { toast(e.message); } })(); }
  if (t.dataset.mbr) { const cu = document.getElementById(t.dataset.mbr + '-cu'); if (cu) cu.innerHTML = opts(pub.curricula.filter((x) => x.branch === t.value).map((x) => [x.id, currLabel(x)]), '', 'كل مقررات الفرع'); }
  if (t.id === 'u-role') { S.usersRole = t.value; render(); }
  if (t.dataset.ex && S.exam) {
    const qid = +t.dataset.ex, sv = $('#sv-' + qid); if (sv) sv.textContent = 'جارٍ الحفظ…';
    api(`/my/tests/${S.exam.id}/answer`, { method: 'PUT', body: { questionId: qid, choice: +t.value } })
      .then(() => { const q = S.exam.questions.find((x) => x.id === qid); q.answer = +t.value; if (sv) sv.textContent = 'محفوظ على الخادم'; const n = S.exam.questions.filter((x) => x.answer != null).length, el = $('.exam-top .note:last-child'); if (el) el.textContent = `أُجيب ${n} من ${S.exam.questions.length}`; })
      .catch((err) => { if (sv) { sv.textContent = 'لم يُحفظ: ' + err.message; sv.classList.add('bad'); } });
  }
  if (t.id === 'nq-st') { S.nq.status = t.value; S.nq.page = 1; render(); }
  if (t.id === 'scr-stage') { S.stage = t.value; SCR.first = true; SCR.last = 0; repaint(); }
  if (t.dataset.qd && S.qprev) { const r = S.qprev.rows.find((x) => x.entryId === +t.dataset.qd); const box = $('#qrw-' + t.dataset.qd); if (box) box.hidden = !(r.tieAtCut || t.checked !== r.proposed); }
  if (['rs-section', 'rs-branch'].includes(t.id)) { S.res[t.id.slice(3)] = t.value; render(); }
  if (t.dataset.fc && S.fm) { S.fm.data[t.dataset.fc] = t.value === '' ? null : +t.value; S.fm.dirty = true; fmPaint(); }
  if (t.dataset.fx && S.fm) { S.fm.data[t.dataset.fx] = +t.value; S.fm.dirty = true; fmPaint(); }
  if (t.dataset.fgn !== undefined && S.fm) { S.fm.data.note = t.value.slice(0, 2000); S.fm.dirty = true; }
  if (t.dataset.fn && S.fm) { S.fm.data.rows[t.dataset.fn] = S.fm.data.rows[t.dataset.fn] || {}; S.fm.data.rows[t.dataset.fn].note = t.value.slice(0, 300); S.fm.dirty = true; }
  if (t.hasAttribute('data-act-jump')) { const r = document.getElementById('ay-' + t.value); if (r) r.scrollIntoView({ block: 'center' }); }
  if (t.dataset.ctr && S.fm) { const v = Math.max(0, Math.min(999, parseInt(String(t.value).replace(/[٠-٩]/g, (x) => x.charCodeAt(0) - 1632), 10) || 0)); fmSet(t.dataset.ctr, v); fmPaint(); }
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
    if (k === 'login') { const r = await api('/login', { method: 'POST', body: { login: val('l-login'), password: val('l-pass') } }); me = r.user; go(homeOf()); pollUnread(); }
    else if (k === 'signup') {
      if (val('s-pass') !== val('s-pass2')) throw new Error('كلمتا المرور غير متطابقتين');
      const r = await api('/signup', { method: 'POST', body: { nationalId: val('s-id'), fullName: val('s-name'), phone: val('s-phone'), email: val('s-email'), password: val('s-pass') } });
      me = r.user; toast('أُنشئ حسابك'); S.wz = null; go('my');
    }
    else if (k === 'password') {
      if (val('p-new') !== val('p-new2')) throw new Error('كلمتا المرور الجديدتان غير متطابقتين');
      await api('/password', { method: 'POST', body: { current: val('p-cur'), next: val('p-new') } });
      me = (await api('/me')).user; toast('غُيّرت كلمة المرور'); route();
    }
    else if (k === 'withdraw') { await api('/my/withdraw', { method: 'POST', body: { reason: val('wd-r') } }); closeModal(); toast('سُجّل انسحابك'); render(); }
    else if (k === 'phones') { await api('/my/profile', { method: 'PATCH', body: { phone: val('ph-1'), phone2: val('ph-2'), email: val('ph-e') } }); closeModal(); toast('حُفظت أرقام التواصل'); render(); }
    else if (k === 'session') {
      const body = { stage: val('ss-st'), branch: val('ss-br'), ...whenBody('ss'), location: val('ss-loc'), note: val('ss-note') };
      if ($('#ss-sec')) body.section = val('ss-sec');
      const r = await api('/sessions', { method: 'POST', body }); toast(`حُفظ الموعد، وأُشعر ${r.notified} متسابقًا`); render();
    }
    else if (k === 'session-edit') { const r = await api('/sessions/' + f.dataset.id, { method: 'PUT', body: { ...whenBody('se'), location: val('se-loc'), note: val('se-note') } }); closeModal(); toast(r.notified ? `حُفظ التعديل، وأُشعر ${r.notified} متسابقًا` : 'لا تغيير'); render(); }
    else if (k === 'dplan') {
      const P = S.dplan, days = Array.from({ length: P.n }, (_, i) => ({ date: P.dates[i] || '' }));
      if (days.some((x) => !x.date)) throw new Error('أدخل تاريخ كل يوم');
      const caps = []; for (const g of S.dd.groups) for (let i = 1; i <= P.n; i++) { const v = P.caps[`${i}|${g.key}`] || 0; if (v) caps.push({ dayNo: i, branch: g.branch, categoryId: g.categoryId, cap: v }); }
      await api('/days', { method: 'PUT', body: { section: S.dd.section, days, caps } }); S.dplanDirty = false; toast('حُفظت الأيام والسعة'); render();
    }
    else if (k === 'bank-add') { await api('/admin/bank', { method: 'POST', body: { stage: S.dst, curriculumId: val('bk-c'), surah: val('bk-s'), ayahFrom: val('bk-f'), ayahTo: val('bk-t'), note: val('bk-n') } }); toast('أُضيف المقطع إلى البنك'); const keep = val('bk-c'); await render(); const sel = document.getElementById('bk-c'); if (sel) sel.value = keep; }
    else if (k === 'bank-import') {
      const fl = $('#bi-f').files[0]; if (!fl) throw new Error('اختر الملف');
      if (val('bi-m') === 'replace' && f.dataset.sure !== '1') { f.dataset.sure = '1'; throw new Error('الاستبدال يحذف مقاطع البنك الحالية لهذه المرحلة (ويبقى ما سُحب منها عند من سحبه). اضغط «رفع الملف» مرة أخرى للتأكيد.'); }
      const r = await api('/admin/bank/import', { method: 'POST', body: { stage: S.dst, mode: val('bi-m'), file: { name: fl.name, data: await readB64(fl) } } });
      toast(`أُضيف ${r.added} مقطعًا${r.skipped ? `، وتُرك ${r.skipped} لأنها موجودة مسبقًا` : ''}${r.removed ? `، وأُزيل ${r.removed}` : ''}`); render();
    }
    else if (k === 'dr-reset') { await api(`/admin/draws/${f.dataset.e}/reset`, { method: 'POST', body: { stage: S.dst, reason: val('dr-r') } }); closeModal(); toast('أُعيدت القرعة وأُشعر المتسابق'); render(); }
    else if (k === 'material') { const r = await api('/admin/materials', { method: 'POST', body: { ...matBody('mt'), publish: $('#mt-p').checked, file: await pickedFile($('#mt-f')) } }); toast(r.material.published ? `رُفعت المذكرة وأُشعر ${r.notified} متسابقًا` : 'رُفعت المذكرة مسودة'); render(); }
    else if (k === 'matedit') { const r = await api('/admin/materials/' + f.dataset.id, { method: 'PUT', body: matBody('me') }); closeModal(); toast(r.notified ? `حُفظت، وأُشعر ${r.notified} متسابقًا أُضيفوا` : 'حُفظت المذكرة'); render(); }
    else if (k === 'matfile') { const r = await api(`/admin/materials/${f.dataset.id}/file`, { method: 'PUT', body: { file: await pickedFile($('#mf-f')) } }); closeModal(); toast(`رُفعت النسخة ${r.material.version}${r.notified ? ` وأُشعر ${r.notified} متسابقًا` : ''}`); render(); }
    else if (k === 'announce') { const r = await api('/admin/announce', { method: 'POST', body: { stage: val('an-st'), section: val('an-sec'), branch: val('an-br'), title: val('an-t'), body: val('an-b') } }); toast(`أُرسل الإعلان إلى ${r.sent} متسابقًا`); render(); }
    else if (k === 'testnew') { const r = await api('/tests', { method: 'POST', body: { curriculumId: val('tn-c'), title: val('tn-t'), questionCount: val('tn-n'), durationMin: val('tn-d') } }); closeModal(); S.testId = r.test.id; render(); }
    else if (k === 'test') {
      const ts = (v) => (v ? new Date(v).getTime() : null);
      await api('/tests/' + f.dataset.id, { method: 'PUT', body: { title: val('t-title'), reference: val('t-ref'), questionCount: val('t-n'), durationMin: val('t-d'), passMark: val('t-p'), opensAt: ts(val('t-o')), closesAt: ts(val('t-c')), status: val('t-s') } });
      toast('حُفظ الاختبار'); render();
    }
    else if (k === 'question') {
      const type = val('qn-t'), c = (parseInt(val('qn-c'), 10) || 1) - 1;
      await api(`/tests/${f.dataset.id}/questions`, { method: 'POST', body: { type, text: val('qn-x'), options: val('qn-o').split('\n'), correct: c, points: val('qn-p'), source: val('qn-s') } });
      toast('أُضيف السؤال، وينتظر الاعتماد'); render();
    }
    else if (k === 'import') { const r = await api(`/tests/${f.dataset.id}/import`, { method: 'POST', body: { text: val('im-x') } }); toast(`استُورد ${r.imported} سؤالًا، وتنتظر الاعتماد`); render(); }
    else if (k === 'qprev') {
      const g = S.resData.groups[+f.dataset.g];
      const p = S.qprev = await api('/qualify/preview', { method: 'POST', body: { stage: S.stage, groupKey: g.key, mode: val('q-mode'), value: val('q-val') } });
      $('#q-list').innerHTML = `${p.tie ? '<p class="banner">تعادل على المقعد الأخير: حدّد قرار المتعادلين وسببه وفق اللائحة.</p>' : ''}<table class="list"><thead><tr><th class="n">الترتيب</th><th>المتسابق</th><th class="n">المجموع</th><th>متأهل إلى ${esc(p.nextStageName)}</th></tr></thead><tbody>
        ${p.rows.map((r) => `<tr class="${r.tieAtCut ? 'pend' : ''}"><td class="n">${r.rank}</td><td>${esc(r.name)}${r.tieAtCut ? ' <span class="tag warn">تعادل على المقعد الأخير</span>' : ''}</td><td class="n">${n2(r.total)}</td>
          <td><label class="check"><input type="checkbox" id="qd-${r.entryId}" data-qd="${r.entryId}" ${r.proposed ? 'checked' : ''}>${r.proposed ? 'مقترح' : ''}</label><div id="qrw-${r.entryId}" ${r.tieAtCut ? '' : 'hidden'}><input id="qr-${r.entryId}" placeholder="سبب القرار" aria-label="سبب القرار"></div></td></tr>`).join('')}</tbody></table>
        <div class="acts"><button class="btn pri" type="button" data-act="q-approve">اعتماد قائمة التأهل (${esc(p.rule)})</button></div>`;
    }
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
      body.stage = S.stage;
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
      const curricula = $$('#curr-rows tr').map((tr) => ({ id: tr.dataset.id || null, branch: $('[name=branch]', tr).value, track: $('[name=track]', tr).value, trackName: $('[name=trackName]', tr).value, categoryId: $('[name=cat]', tr).value || null, content: $('[name=content]', tr).value, surah: $('[name=surah]', tr).value || null, ayahFrom: $('[name=af]', tr).value || null, ayahTo: $('[name=at]', tr).value || null }));
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
window.__iqraRefresh = async () => { S.unread = 0; setTimeout(pollUnread, 500); closeModal(); S.wz = null; S.fm = null; stopPoll(); try { me = (await api('/me')).user; } catch { me = null; } pub = await api('/public'); if (location.hash.slice(1) === homeOf()) route(); else go(homeOf()); };

// ---------- البدء ----------
(async () => {
  try {
    [meta, pub] = await Promise.all([api('/meta'), api('/public')]);
    $('#org').textContent = meta.org;
    try { me = (await api('/me')).user; } catch { me = null; }
    pollUnread();
  } catch (e) { $('#view').innerHTML = `<div class="card empty"><p>${esc(e.message)}</p></div>`; return; }
  route();
})();
})();
