'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const config = require('./config');

const COOKIE = 'iqra_sid';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(p) { return bcrypt.hashSync(p, 11); }
function checkPassword(p, h) { try { return bcrypt.compareSync(p, h); } catch { return false; } }
// يُستخدم عند عدم وجود الحساب حتى يبقى زمن الاستجابة متقاربًا
const DUMMY = bcrypt.hashSync('dummy-password-1', 11);

// كلمة مرور مؤقتة سهلة القراءة (بدون أحرف ملتبسة)
function tempPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const b of crypto.randomBytes(12)) s += a[b % a.length];
  return s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8);
}

function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف';
  if (p.length > 128) return 'كلمة المرور طويلة جدًا';
  if (!/[0-9]/.test(p) || !/[^0-9]/.test(p)) return 'استخدم أحرفًا وأرقامًا معًا في كلمة المرور';
  return null;
}

function parseCookies(h) {
  const out = {};
  for (const part of (h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(sha(token), userId, now, now + config.sessionHours * 3600e3);
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.sessionHours * 3600}${config.cookieSecure ? '; Secure' : ''}`);
}

function clearSession(req, res) {
  const t = parseCookies(req.headers.cookie)[COOKIE];
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha(t));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure ? '; Secure' : ''}`);
}

const getSessionUser = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`);

function loadUser(req, _res, next) {
  const t = parseCookies(req.headers.cookie)[COOKIE];
  req.user = t ? getSessionUser.get(sha(t), Date.now()) || null : null;
  next();
}

// حماية من الطلبات عبر المواقع: كل طلب يغيّر بيانات يحمل هذه الترويسة، والمتصفح لا يسمح لموقع آخر بإرسالها
function csrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Iqra') !== '1') return res.status(403).json({ error: 'طلب غير مسموح' });
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  if (req.user.must_change && !['/password', '/me', '/logout'].includes(req.path))
    return res.status(403).json({ error: 'يجب تغيير كلمة المرور أولًا', mustChange: true });
  next();
}

// تحديد المحاولات: 8 محاولات خاطئة لكل مفتاح خلال 15 دقيقة
const attempts = new Map();
const WINDOW = 15 * 60e3;
function tooMany(key, max = 8) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) return false;
  return a.n >= max;
}
function failed(key) {
  const now = Date.now(), a = attempts.get(key);
  if (!a || now - a.first > WINDOW) attempts.set(key, { n: 1, first: now });
  else a.n++;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of attempts) if (now - a.first > WINDOW) attempts.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(now);
}, 10 * 60e3).unref();

module.exports = { hashPassword, checkPassword, DUMMY, tempPassword, passwordProblem, createSession, clearSession, loadUser, csrf, requireAuth, tooMany, failed, sha };
