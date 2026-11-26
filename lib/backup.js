'use strict';
// نسخة احتياطية آمنة لقاعدة البيانات أثناء عمل النظام، تحفظ في data/backups ويحتفظ بآخر 30 نسخة.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

async function runBackup() {
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(dir, `iqra-${stamp}.db`);
  await db.backup(file);
  const all = fs.readdirSync(dir).filter((f) => f.startsWith('iqra-') && f.endsWith('.db')).sort();
  for (const f of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, f));
  return { file };
}

module.exports = { runBackup };
