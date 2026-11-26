'use strict';
// بديل مصغّر لـ Express يكفي لتشغيل server.js داخل المتصفح: ترتيب الطبقات نفسه، والمسارات بالمعاملات، والوسطاء.
function compile(p) {
  if (p === '*') return /^.*$/;
  const keys = [];
  const re = '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '$';
  return Object.assign(new RegExp(re), { keys });
}
function express() {
  const stack = [];
  const add = (method) => (path, ...fns) => {
    if (typeof path === 'function') { fns = [path, ...fns]; path = null; }
    const paths = path == null ? null : Array.isArray(path) ? path : [path];
    stack.push({ method, prefix: method === null ? paths && paths[0] : null, routes: method ? paths.map(compile) : null, fns: fns.flat() });
  };
  const app = { use: add(null), get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), delete: add('DELETE'), disable() {}, set() {}, listen() { return { address: () => ({ port: 0 }), close() {} }; } };
  app.handle = (req, res) => new Promise((resolve) => {
    res._done = resolve;
    const full = req.path;
    const layers = [];
    for (const l of stack) {
      if (l.method === null) { if (!l.prefix || full === l.prefix || full.startsWith(l.prefix + '/')) for (const f of l.fns) if (f.length < 4) layers.push({ f, prefix: l.prefix }); }
      else if (l.method === req.method || (l.method === 'GET' && req.method === 'HEAD')) {
        for (const re of l.routes) { const m = full.match(re); if (m) { const params = {}; (re.keys || []).forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); }); for (const f of l.fns) layers.push({ f, params }); break; } }
      }
    }
    let i = 0;
    const next = (err) => {
      req.path = full;
      if (err) { res.status(500).json({ error: 'حدث خطأ' }); return; }
      const l = layers[i++];
      if (!l) { res.status(404).json({ error: 'غير موجود' }); return; }
      if (l.prefix) req.path = full.slice(l.prefix.length) || '/';
      if (l.params) req.params = l.params;
      try { l.f(req, res, next); } catch (e) { console.error(e); if (!res._sent) res.status(500).json({ error: 'حدث خطأ في الخادم' }); }
    };
    next();
  });
  return app;
}
express.json = () => (req, res, next) => next();
express.static = () => (req, res, next) => next();
module.exports = express;
