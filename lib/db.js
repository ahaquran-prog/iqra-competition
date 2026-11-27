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
  role TEXT NOT NULL CHECK (role IN ('contestant','judge','coordinator','chief','exec','top','screen')),
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
  surah INTEGER,
  ayah_from INTEGER,
  ayah_to INTEGER,
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
-- لجان التحكيم: لكل قسم ومرحلة. tracks وcategories فارغة تعني «الكل»
CREATE TABLE IF NOT EXISTS committees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  section TEXT NOT NULL CHECK (section IN ('M','F')),
  stage TEXT NOT NULL DEFAULT 'prelim' CHECK (stage IN ('prelim','semi','final')),
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  tracks TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  hall TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (comp_id, section, stage, name)
);
-- تكليف المستخدمين باللجان: محكم بتخصصه، أو منسق يملك النداء
CREATE TABLE IF NOT EXISTS committee_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  committee_id INTEGER NOT NULL REFERENCES committees(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('judge','coordinator')),
  created_at INTEGER NOT NULL,
  UNIQUE (committee_id, user_id)
);
-- تذكرة الطابور: مشاركة واحدة في مرحلة واحدة. seq رقم وصول متزايد يحدده الخادم
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  section TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'prelim',
  committee_id INTEGER REFERENCES committees(id),
  status TEXT NOT NULL CHECK (status IN ('needs_committee','waiting','called','testing','no_show','done','cancelled')),
  seq INTEGER NOT NULL,
  arrived_at INTEGER NOT NULL,
  called_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER,
  calls INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE (entry_id, stage)
);
-- أحداث النداء التي تعرضها شاشة الانتظار
CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  section TEXT NOT NULL,
  committee_id INTEGER NOT NULL REFERENCES committees(id),
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('call','recall')),
  by_user INTEGER REFERENCES users(id)
);
-- التقييمات: سجل مستقل لكل محكم (استمارة + خانة) لكل مشاركة في كل مرحلة
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  registration_id INTEGER NOT NULL REFERENCES registrations(id),
  section TEXT NOT NULL,
  stage TEXT NOT NULL,
  rubric TEXT NOT NULL,
  slot INTEGER NOT NULL DEFAULT 1,
  rubric_version INTEGER NOT NULL DEFAULT 1,
  judge_id INTEGER NOT NULL REFERENCES users(id),
  committee_id INTEGER REFERENCES committees(id),
  status TEXT NOT NULL CHECK (status IN ('draft','submitted')),
  data TEXT NOT NULL DEFAULT '{}',
  raw REAL,
  base REAL,
  extra REAL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  submitted_at INTEGER,
  UNIQUE (entry_id, stage, rubric, slot)
);
-- النسخ السابقة عند إعادة الفتح أو التصحيح: لا يُكتب فوق تقييم المحكم بصمت
CREATE TABLE IF NOT EXISTS evaluation_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evaluation_id INTEGER NOT NULL REFERENCES evaluations(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  raw REAL,
  extra REAL,
  judge_id INTEGER,
  action TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  actor_id INTEGER,
  at INTEGER NOT NULL
);
-- كشف معتمد لمجموعة تنافسية في مرحلة: نسخة محفوظة من الصفوف والترتيب. الاعتماد والنشر حدثان مختلفان
CREATE TABLE IF NOT EXISTS result_sheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  stage TEXT NOT NULL,
  group_key TEXT NOT NULL,
  group_name TEXT NOT NULL,
  section TEXT NOT NULL,
  branch TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('approved','published','superseded')),
  rows TEXT NOT NULL,
  hash TEXT NOT NULL,
  max REAL NOT NULL,
  approved_by INTEGER REFERENCES users(id),
  approved_at INTEGER NOT NULL,
  published_by INTEGER REFERENCES users(id),
  published_at INTEGER,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sheets ON result_sheets(comp_id, stage, group_key, status);
-- التأهل من مرحلة إلى التالية بقرار معتمد، مع الاستثناءات وأسبابها
CREATE TABLE IF NOT EXISTS qualifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  sheet_id INTEGER REFERENCES result_sheets(id),
  status TEXT NOT NULL CHECK (status IN ('qualified','excluded')),
  exceptional INTEGER NOT NULL DEFAULT 0,
  rule TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  decided_by INTEGER REFERENCES users(id),
  decided_at INTEGER NOT NULL,
  UNIQUE (entry_id, to_stage)
);
-- مقاطع التلاوة للمراحل اللاحقة لكل مقرر
CREATE TABLE IF NOT EXISTS stage_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  curriculum_id INTEGER NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('semi','final')),
  surah INTEGER NOT NULL,
  ayah_from INTEGER NOT NULL,
  ayah_to INTEGER NOT NULL,
  UNIQUE (curriculum_id, stage)
);
-- بنك مقاطع القرعة: مقاطع تعدّها الإدارة لكل مقرر (مسار وفئة) ولكل مرحلة لاحقة
CREATE TABLE IF NOT EXISTS passage_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  curriculum_id INTEGER NOT NULL REFERENCES curricula(id),
  stage TEXT NOT NULL CHECK (stage IN ('semi','final')),
  surah INTEGER NOT NULL,
  ayah_from INTEGER NOT NULL,
  ayah_to INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,       -- 0: أُزيل من البنك بعد أن سُحب، ويبقى أثره في سحوبات المتسابقين
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank ON passage_bank(curriculum_id, stage);
-- سحوبات المتسابق: حتى ثلاث محاولات لكل مشاركة ومرحلة، يُحفظ المقطع فيها كما ظهر
CREATE TABLE IF NOT EXISTS passage_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  stage TEXT NOT NULL CHECK (stage IN ('semi','final')),
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  bank_id INTEGER REFERENCES passage_bank(id),
  surah INTEGER NOT NULL,
  ayah_from INTEGER NOT NULL,
  ayah_to INTEGER NOT NULL,
  drawn_by INTEGER REFERENCES users(id),
  drawn_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by INTEGER REFERENCES users(id),
  reset_at INTEGER,                        -- أُلغي بإعادة تعيين القرعة من الإدارة
  reset_by INTEGER REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_draw ON passage_draws(entry_id, stage, attempt) WHERE reset_at IS NULL;
-- توزيع المتسابقين على أيام التصفيات الأولية: أيام القسم، وسعة كل يوم لكل فرع وفئة، وتعيين كل مشاركة ميدانية ليوم
CREATE TABLE IF NOT EXISTS prelim_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  section TEXT NOT NULL CHECK (section IN ('M','F')),
  day_no INTEGER NOT NULL,
  date TEXT NOT NULL,                       -- YYYY-MM-DD
  UNIQUE (comp_id, section, day_no)
);
CREATE TABLE IF NOT EXISTS day_caps (
  day_id INTEGER NOT NULL REFERENCES prelim_days(id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  cap INTEGER NOT NULL CHECK (cap >= 0),
  PRIMARY KEY (day_id, branch, category_id)
);
CREATE TABLE IF NOT EXISTS day_assign (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id),
  day_id INTEGER NOT NULL REFERENCES prelim_days(id) ON DELETE CASCADE,
  manual INTEGER NOT NULL DEFAULT 0,        -- نُقل يدويًا
  assigned_at INTEGER NOT NULL,
  assigned_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS day_plans (
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  section TEXT NOT NULL CHECK (section IN ('M','F')),
  published_at INTEGER,
  changed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comp_id, section)
);
-- اختبار التفسير الإلكتروني: اختبار لفرع التفسير (branch) أو اختبار تفسير مقطع التلاوة (passage)، لكل مقرر
CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  kind TEXT NOT NULL CHECK (kind IN ('branch','passage')),
  curriculum_id INTEGER NOT NULL REFERENCES curricula(id),
  title TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  question_count INTEGER NOT NULL DEFAULT 10,
  duration_min INTEGER NOT NULL DEFAULT 20,
  pass_mark REAL,
  opens_at INTEGER,
  closes_at INTEGER,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed')),
  results_published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (comp_id, kind, curriculum_id)
);
-- بنك الأسئلة: يُراجع السؤال قبل استخدامه، ولا يصل مفتاح التصحيح إلى واجهة المتسابق
CREATE TABLE IF NOT EXISTS test_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('mcq','tf')),
  text TEXT NOT NULL,
  options TEXT NOT NULL,
  correct INTEGER NOT NULL,
  points REAL NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved')),
  created_by INTEGER REFERENCES users(id),
  reviewed_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
-- محاولة واحدة لكل متسابق: الأسئلة المسحوبة وترتيبها، والإجابات المحفوظة تدريجيًا، والزمن من الخادم
CREATE TABLE IF NOT EXISTS test_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_id INTEGER NOT NULL REFERENCES tests(id),
  entry_id INTEGER NOT NULL REFERENCES entries(id),
  person_id INTEGER NOT NULL REFERENCES people(id),
  section TEXT NOT NULL,
  question_ids TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  started_at INTEGER NOT NULL,
  deadline INTEGER NOT NULL,
  submitted_at INTEGER,
  auto_submitted INTEGER NOT NULL DEFAULT 0,
  score REAL,
  max REAL,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted')),
  UNIQUE (test_id, person_id)
);
-- مواعيد المراحل: لكل مرحلة وقسم، ولفرع محدد أو لكل الفروع (branch فارغ)
CREATE TABLE IF NOT EXISTS stage_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  stage TEXT NOT NULL CHECK (stage IN ('prelim','semi','final')),
  section TEXT NOT NULL CHECK (section IN ('M','F')),
  branch TEXT NOT NULL DEFAULT '',
  starts_at INTEGER NOT NULL,
  days INTEGER NOT NULL DEFAULT 1,          -- مدة الموعد بالأيام المتتالية
  end_time TEXT NOT NULL DEFAULT '',        -- وقت الانتهاء اليومي HH:MM (اختياري)
  location TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  updated_at INTEGER NOT NULL,
  UNIQUE (comp_id, stage, section, branch)
);
-- الإشعارات داخل الحساب. dedupe يمنع تكرار الإشعار نفسه عند إعادة المحاولة
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  event TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  dedupe TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id DESC);
-- سجل الإرسال عبر القنوات الخارجية: نجاح الإنشاء لا يعني الوصول
CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','sms','whatsapp')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  provider_ref TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE (notification_id, channel)
);
CREATE INDEX IF NOT EXISTS idx_deliv_q ON deliveries(status, next_at);
-- مذكرات المقررات: ملف لفرع، ويمكن تخصيصه بمقرر أو فئة أو قسم أو مرحلة لاحقة (للمتأهلين فقط)
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comp_id INTEGER NOT NULL REFERENCES competitions(id),
  section TEXT NOT NULL DEFAULT '' CHECK (section IN ('','M','F')),
  branch TEXT NOT NULL,
  curriculum_id INTEGER REFERENCES curricula(id),
  category_id INTEGER REFERENCES categories(id),
  stage TEXT NOT NULL DEFAULT '' CHECK (stage IN ('','semi','final')),
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  file_at INTEGER NOT NULL,
  published_at INTEGER,
  deleted_at INTEGER,
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials ON materials(comp_id, branch);
-- من نزّل المذكرة من المتسابقين، وكم مرة
CREATE TABLE IF NOT EXISTS material_downloads (
  material_id INTEGER NOT NULL REFERENCES materials(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (material_id, user_id)
);
-- محتوى الملفات داخل القاعدة: للنسخة التجريبية فقط. في الخادم تُحفظ الملفات في مجلد البيانات
CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  data BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eval_entry ON evaluations(entry_id, stage);
CREATE INDEX IF NOT EXISTS idx_tickets_q ON tickets(committee_id, status, seq);
CREATE INDEX IF NOT EXISTS idx_tickets_person ON tickets(person_id, status);
CREATE INDEX IF NOT EXISTS idx_calls ON call_events(section, id);
CREATE INDEX IF NOT EXISTS idx_reg_comp ON registrations(comp_id, section, status);
CREATE INDEX IF NOT EXISTS idx_entries_reg ON entries(registration_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at DESC);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
`);

// ترقية قواعد البيانات الأقدم: إضافة الأعمدة الجديدة إن لم توجد
const addCol = (t, c, def) => { if (!db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`); };
addCol('stage_sessions', 'days', 'INTEGER NOT NULL DEFAULT 1');
addCol('stage_sessions', 'end_time', "TEXT NOT NULL DEFAULT ''");

module.exports = db;
