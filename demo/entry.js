'use strict';
// نقطة بدء النسخة التجريبية: تشغّل server.js الحقيقي داخل المتصفح، وتوجّه طلبات /api إليه بدل الشبكة.
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import wasmBinary from 'sql.js/dist/sql-wasm.wasm';
import seed from './dist/seed.db';

const JAR = 'iqra-demo-cookie-v1';
let jar = '';
try { jar = sessionStorage.getItem(JAR) || ''; } catch (e) {}
window.__iqraDemo = true;

const boot = (async () => {
  globalThis.__SQL = await initSqlJs({ wasmBinary });
  globalThis.__SEED = seed;
  return require('../server.js');
})();

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url.startsWith('/api')) return realFetch(input, init);
  const app = await boot;
  if (globalThis.__iqraDb) globalThis.__iqraDb.sync();
  const u = new URL(url, 'http://demo.local');
  const headers = {};
  for (const [k, v] of Object.entries(init.headers || {})) headers[k.toLowerCase()] = v;
  if (jar) headers.cookie = jar;
  let body = {};
  try { if (init.body) body = JSON.parse(init.body); } catch (e) {}
  const method = (init.method || 'GET').toUpperCase();
  const req = { method, url: u.pathname + u.search, path: u.pathname, originalUrl: url, query: Object.fromEntries(u.searchParams), params: {}, body, headers, ip: '127.0.0.1', get(h) { return headers[h.toLowerCase()]; }, on() {} };
  const res = {
    statusCode: 200, headers: {}, body: '', _sent: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    type() { return this; },
    json(o) { this.headers['content-type'] = 'application/json'; this.send(JSON.stringify(o)); },
    send(s) { if (this._sent) return; this._sent = true; this.body = s; this._done && this._done(); },
    sendFile() { this.send(''); }, end(s) { this.send(s || ''); },
  };
  await app.handle(req, res);
  const sc = res.headers['set-cookie'];
  if (sc) { const v = String(sc).split(';')[0]; jar = /Max-Age=0/.test(sc) ? '' : v; try { sessionStorage.setItem(JAR, jar); } catch (e) {} }
  if (method !== 'GET' && globalThis.__iqraDb) globalThis.__iqraDb.save();
  return new Response(res.body, { status: res.statusCode, headers: { 'content-type': res.headers['content-type'] || 'text/plain; charset=utf-8' } });
};

// لوحة حسابات التجربة
const ACCOUNTS = [
  ['admin', 'الإدارة العليا (القسمان)'], ['exec.m', 'الإدارة التنفيذية — رجال'], ['exec.f', 'الإدارة التنفيذية — نساء'],
  ['chief.m', 'رئيس لجنة التحكيم — رجال'], ['coord.m', 'منسق النداء — الحفظ: اليافعون والتدوير'], ['judge.m', 'محكم جودة الحفظ الأول — الحفظ: اليافعون'], ['judge.m2', 'محكم جودة الحفظ الثاني'], ['judge.m3', 'محكم التجويد — الحفظ'], ['judge.m4', 'محكم الصوت والنغم — الحفظ'], ['judge.t1', 'محكم التجويد الأول — التدوير (مصفوفة الآيات)'], ['judge.t3', 'محكم الصوت والنغم — التدوير'],
  ['screen.m', 'شاشة قاعة انتظار الرجال'], ['screen.f', 'شاشة قاعة انتظار النساء'], ['1100000002', 'متسابق حاضر في الطابور'], ['1000000001', 'متسابق طلبه قيد المراجعة'],
];
window.__iqraDemoLogin = async (login) => {
  await fetch('/api/logout', { method: 'POST', headers: { 'X-Iqra': '1' } });
  const r = await fetch('/api/login', { method: 'POST', headers: { 'X-Iqra': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password: 'Iqra-2026' }) });
  if (!r.ok) { alertBox((await r.json()).error); return; }
  if (window.__iqraRefresh) await window.__iqraRefresh();
};
function alertBox(t) { const el = document.getElementById('toast'); if (el) { el.textContent = t; el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 3500); } }
function panel() {
  const wrap = document.createElement('div');
  wrap.className = 'demo';
  wrap.innerHTML = `<details><summary>نسخة تجريبية · حسابات التجربة</summary><div class="demo-in">
    <p>البيانات هنا محفوظة في متصفحك فقط، والأسماء متخيَّلة. كلمة مرور كل الحسابات: <b dir="ltr">Iqra-2026</b></p>
    <p class="note">لتجربة النداء: افتح هذه الصفحة في تبويبين؛ ادخل في أحدهما بحساب «شاشة قاعة انتظار الرجال»، وفي الآخر بحساب «منسق النداء»، ثم اضغط «نداء التالي».</p>
    ${ACCOUNTS.map(([l, n]) => `<button type="button" class="btn sm" data-demo="${l}"><span>${n}</span><small dir="ltr">${l}</small></button>`).join('')}
    <p class="note">أو أنشئ حساب متسابق جديدًا من «إنشاء حساب متسابق».</p>
    <button type="button" class="btn sm badb" data-demo-reset>إعادة البيانات التجريبية إلى البداية</button></div></details>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-demo]');
    if (b) { b.disabled = true; try { await window.__iqraDemoLogin(b.dataset.demo); wrap.querySelector('details').open = false; } finally { b.disabled = false; } }
    if (e.target.closest('[data-demo-reset]')) {
      const btn = e.target.closest('[data-demo-reset]');
      if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'اضغط مرة أخرى للتأكيد: تُحذف كل تعديلاتك'; return; }
      try { localStorage.removeItem('iqra-demo-db-v1'); localStorage.removeItem('iqra-demo-db-v1-ver'); sessionStorage.removeItem(JAR); } catch (err) {}
      location.hash = 'home'; location.reload();
    }
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', panel); else panel();
