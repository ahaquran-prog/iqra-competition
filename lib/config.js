'use strict';
// يقرأ الإعدادات من متغيرات البيئة، ومن ملف .env في جذر المشروع إن وُجد.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

module.exports = {
  ROOT,
  port: parseInt(env('PORT', '3000'), 10),
  host: env('HOST', '0.0.0.0'),
  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
  orgName: env('ORG_NAME', 'جمعية اقرأ لعلوم القرآن'),
  // المنطقة الزمنية التي تُقارن بها مواعيد فتح التسجيل وإغلاقه
  timeZone: env('TIME_ZONE', 'Asia/Riyadh'),
  cookieSecure: env('COOKIE_SECURE', '0') === '1',
  sessionHours: parseInt(env('SESSION_HOURS', '12'), 10),
  trustProxy: env('TRUST_PROXY', '0') === '1',
  publicUrl: env('PUBLIC_URL', env('RENDER_EXTERNAL_URL', '')),
  // السماح بإنشاء حسابات المتسابقين من الصفحة العامة (0 لإيقافه)
  allowSignup: env('ALLOW_SIGNUP', '1') === '1',
  // القنوات الخارجية للإشعارات: كلها متوقفة حتى تُضبط مع الجمعية ومزودها (D10)
  smtp: { host: env('SMTP_HOST', ''), port: parseInt(env('SMTP_PORT', '587'), 10), secure: env('SMTP_SECURE', '0') === '1', user: env('SMTP_USER', ''), pass: env('SMTP_PASS', ''), from: env('SMTP_FROM', '') },
  // رسائل الجوال وواتساب عبر مزود يستقبل طلب POST بصيغة JSON: { to, message } مع ترويسة Authorization
  sms: { url: env('SMS_WEBHOOK_URL', ''), token: env('SMS_WEBHOOK_TOKEN', '') },
  whatsapp: { url: env('WHATSAPP_WEBHOOK_URL', ''), token: env('WHATSAPP_WEBHOOK_TOKEN', '') },
  // رمز الدولة الافتراضي للأرقام المحلية عند الإرسال (مثل 973)
  countryCode: env('DEFAULT_COUNTRY_CODE', '973'),
  // ساعات التذكير قبل الموعد
  reminderHours: parseInt(env('REMINDER_HOURS', '24'), 10),
  // أقصى حجم لملف المذكرة بالميغابايت
  materialMaxMB: parseFloat(env('MATERIAL_MAX_MB', '25')),
  // حفظ الملفات داخل قاعدة البيانات بدل مجلد البيانات (للنسخة التجريبية)
  blobsInDb: env('BLOBS_IN_DB', '0') === '1',
};
