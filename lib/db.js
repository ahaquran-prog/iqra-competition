'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

fs.mkdirSync(config.dataDir, { recursive: true });
const db = new Database(process.env.IQRA_DB_FILE || path.join(config.dataDir, 'iqra.db'));
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

db.exec(`
-- الحسابات: المتسابق يدخل برقم هويته، والموظفون باسم مستخدم يبدأ بحرف لاتيني
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('contestant','judge','coordinator','chief','exec','top')),
  section TEXT NOT NULL DEFAULT '' CHECK (section IN ('','M','F')),
  specialty TEXT NOT NULL DEFAULT '',
  pass_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  created_by INTEGER,
  last_login INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- الدورة: سجل مستقل لكل سنة، وإعداداتها تُنسخ للدورة التالية ثم تُراجع
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  reg_open TEXT,
  reg_close TEXT,
  edit_close TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','archived')),
  min_birth_year INTEGER NOT NULL DEFAULT 1900,
  is_current INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  intro TEXT NOT NULL DEFAULT '',
  conditions TEXT NOT NULL DEFAULT '',
  stages TEXT NOT NULL DEFAULT '',
  registrable INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (comp_id, code)
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  from_year INTEGER,
  to_year INTEGER,
  branches TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (comp_id, name)
);
-- المقررات: category_id فارغ يعني «لكل الأعمار»
CREATE TABLE IF NOT EXISTS curricula (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  track TEXT NOT NULL,
  track_name TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  content TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);

-- ملف الشخص الموحد: ينشأ مرة واحدة ويرتبط بحسابه
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER UNIQUE REFERENCES users(id),
  national_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  phone2 TEXT NOT NULL DEFAULT '',
  birth_year INTEGER,
  gender TEXT NOT NULL DEFAULT '' CHECK (gender IN ('','M','F')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- تسجيل الشخص في الدورة، وتحته مشاركة مستقلة لكل فرع. تحفظ نسخة الفئة والمقرر وقت التسجيل.
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  section TEXT NOT NULL CHECK (section IN ('M','F')),
  category_id INTEGER REFERENCES categories(id),
  category_name TEXT NOT NULL,
  birth_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','returned','accepted','rejected','withdrawn')),
  staff_note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at INTEGER,
  UNIQUE (comp_id, person_id)
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  branch TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  track TEXT NOT NULL,
  track_name TEXT NOT NULL DEFAULT '',
  curriculum_id INTEGER,
  curriculum_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','withdrawn')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (registration_id, branch)
);
-- سجل التدقيق: لا يُعدَّل ولا يُحذف من الواجهة
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  section TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  before TEXT,
  after TEXT,
  reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_reg_comp ON registrations(comp_id, section, status);
CREATE INDEX IF NOT EXISTS idx_entries_reg ON entries(registration_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
`);

module.exports = db;
