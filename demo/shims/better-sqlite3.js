'use strict';
// بديل better-sqlite3 داخل المتصفح باستخدام sql.js. يحفظ القاعدة في ذاكرة المتصفح (localStorage).
const KEY = 'iqra-demo-db-v1';
const b64e = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const norm = (a) => (a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const tag = (e) => { if (/UNIQUE constraint failed/.test(e.message)) e.code = 'SQLITE_CONSTRAINT_UNIQUE'; return e; };
class Database {
  constructor() {
    let bytes = null;
    try { const s = localStorage.getItem(KEY); if (s) bytes = b64d(s); } catch (e) {}
    this.db = new globalThis.__SQL.Database(bytes || globalThis.__SEED);
    this.db.exec('PRAGMA foreign_keys=ON');
    globalThis.__iqraDb = this;
  }
  pragma() { return []; }
  exec(sql) { try { this.db.exec(sql); } catch (e) { throw tag(e); } return this; }
  prepare(sql) {
    const self = this;
    const each = (a, fn) => { const st = self.db.prepare(sql); try { st.bind(norm(a)); return fn(st); } catch (e) { throw tag(e); } finally { st.free(); } };
    return {
      run(...a) { each(a, (st) => { st.step(); }); return { changes: self.db.getRowsModified(), lastInsertRowid: self.db.exec('SELECT last_insert_rowid()')[0].values[0][0] }; },
      get(...a) { return each(a, (st) => (st.step() ? st.getAsObject() : undefined)); },
      all(...a) { return each(a, (st) => { const out = []; while (st.step()) out.push(st.getAsObject()); return out; }); },
    };
  }
  transaction(fn) {
    return (...a) => {
      this.db.exec('SAVEPOINT tx');
      try { const r = fn(...a); this.db.exec('RELEASE tx'); return r; }
      catch (e) { this.db.exec('ROLLBACK TO tx'); this.db.exec('RELEASE tx'); throw e; }
    };
  }
  backup() { return Promise.resolve(); }
  save() { try { localStorage.setItem(KEY, b64e(this.db.export())); this.db.exec('PRAGMA foreign_keys=ON'); } catch (e) {} }
}
Database.KEY = KEY;
module.exports = Database;
