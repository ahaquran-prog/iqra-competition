'use strict';
// حفظ الملفات المرفوعة بحسب بصمتها (SHA-256): الملف لا يتغير بعد حفظه، ورفع الملف نفسه مرتين لا يكرره.
// في الخادم تُحفظ في مجلد البيانات الدائم (data/files)، وفي النسخة التجريبية داخل قاعدة البيانات.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

const dir = () => path.join(config.dataDir, 'files');
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const okSha = (s) => /^[a-f0-9]{64}$/.test(String(s));

function put(bytes) {
  const sha = hash(bytes);
  if (config.blobsInDb) { db.prepare('INSERT OR IGNORE INTO blobs(sha256,data) VALUES (?,?)').run(sha, bytes); return sha; }
  fs.mkdirSync(dir(), { recursive: true });
  const file = path.join(dir(), sha);
  if (!fs.existsSync(file)) {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
  }
  return sha;
}

function get(sha) {
  if (!okSha(sha)) return null;
  if (config.blobsInDb) { const r = db.prepare('SELECT data FROM blobs WHERE sha256=?').get(sha); return r ? r.data : null; }
  const file = path.join(dir(), sha);
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

module.exports = { put, get, hash };
