'use strict';
// الاستخدام: npm run create-admin -- <اسم_المستخدم> "<الاسم الكامل>"
// ينشئ حساب الإدارة العليا بكلمة مرور مؤقتة تُطبع على الشاشة، ويُطلب تغييرها عند أول دخول.
// إن كان اسم المستخدم موجودًا، يعاد تعيين كلمة مروره ويُرقّى إلى الإدارة العليا.
const db = require('../lib/db');
const auth = require('../lib/auth');

const [username, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim() || 'الإدارة العليا';
if (!username || !/^[A-Za-z][A-Za-z0-9._@-]{2,63}$/.test(username)) {
  console.error('الاستخدام: npm run create-admin -- <اسم_المستخدم> "<الاسم الكامل>"');
  console.error('اسم المستخدم يبدأ بحرف إنجليزي، 3 أحرف على الأقل، بدون مسافات.');
  process.exit(1);
}
const pass = auth.tempPassword();
const ex = db.prepare('SELECT id FROM users WHERE login=?').get(username);
if (ex) {
  db.prepare("UPDATE users SET role='top', section='', active=1, must_change=1, pass_hash=? WHERE id=?").run(auth.hashPassword(pass), ex.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(ex.id);
  console.log(`✓ أُعيد تعيين كلمة مرور «${username}» وأصبح حساب إدارة عليا.`);
} else {
  db.prepare("INSERT INTO users(login,name,role,pass_hash,must_change,created_at) VALUES (?,?,'top',?,1,?)").run(username, name, auth.hashPassword(pass), Date.now());
  console.log(`✓ أُنشئ حساب الإدارة العليا «${username}».`);
}
console.log(`  كلمة المرور المؤقتة: ${pass}\n  سيُطلب تغييرها عند أول تسجيل دخول.`);
