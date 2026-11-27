'use strict';
// يبني النسخة التجريبية: ملف HTML واحد يشغّل server.js الحقيقي داخل المتصفح.
// الخطوات: (1) قاعدة بيانات تجريبية بالكود الحقيقي، (2) حزمة esbuild، (3) دمج الواجهة في ملف واحد.
// التشغيل: cd demo && npm install && npm run build  ← الناتج demo/dist/index.html
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DIST = path.join(__dirname, 'dist');
fs.mkdirSync(DIST, { recursive: true });

// (1) قاعدة البيانات التجريبية تُبنى في عملية منفصلة بـ better-sqlite3 الحقيقي
execFileSync(process.execPath, [path.join(__dirname, 'seed-demo.js'), path.join(DIST, 'seed.db')], { stdio: 'inherit', cwd: ROOT });

// (2) الحزمة
const META = JSON.parse(fs.readFileSync(path.join(DIST, 'seed.meta.json'), 'utf8'));
const esbuild = require('esbuild');
const shim = (n) => path.join(__dirname, 'shims', n);
const out = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'entry.js')],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'es2020', minify: true, charset: 'utf8', legalComments: 'none',
  alias: { 'better-sqlite3': shim('better-sqlite3.js'), express: shim('express.js'), crypto: shim('crypto.js'), fs: shim('fs.js'), path: require.resolve('path-browserify') },
  loader: { '.wasm': 'binary', '.db': 'binary' },
  define: { __dirname: '"/app"', 'require.main': 'undefined', __DEMO_DRAW__: JSON.stringify(META.drawAccount || '') },
  banner: { js: 'globalThis.process=globalThis.process||{env:{BLOBS_IN_DB:"1",MATERIAL_MAX_MB:"1"},argv:[],platform:"browser"};if(!Number.prototype.unref)Object.defineProperty(Number.prototype,"unref",{value:function(){return this}});' },
  external: ['nodemailer'], // البريد لا يعمل داخل المتصفح
  logLevel: 'warning',
});
const bundle = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

// (3) الدمج
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, 'demo.css'), 'utf8');
const dataUri = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'public', f)).toString('base64');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').replace(/<\/script/gi, '<\\/script')
  .replace('"/emblem-light.png"', () => `"${dataUri('emblem-light.png')}"`).replace('"/emblem-color.png"', () => `"${dataUri('emblem-color.png')}"`);
const icon = 'data:image/svg+xml;base64,' + Buffer.from(fs.readFileSync(path.join(ROOT, 'public/icon.svg'))).toString('base64');
let page = html
  .replace('<link rel="icon" href="/icon.svg" type="image/svg+xml">', `<link rel="icon" href="${icon}" type="image/svg+xml">`)
  .replace('<title>اقرأ | منصة المسابقات القرآنية</title>', '<title>اقرأ | منصة المسابقات القرآنية (تجريبية)</title>')
  .replace('<link rel="stylesheet" href="/style.css">', () => `<style>\n${css}\n</style>`)
  .replace('<script src="/app.js"></script>', () => `<script>\n${bundle}\n</script>\n<script>\n${app}\n</script>`);
if (page.includes('/app.js') || page.includes('/style.css')) throw new Error('لم يكتمل الدمج');
fs.writeFileSync(path.join(DIST, 'index.html'), page);
console.log(`✓ demo/dist/index.html (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
