'use strict';
const { sha256 } = require('js-sha256');
function randomBytes(n) {
  const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b);
  b.toString = (enc) => { let s = btoa(String.fromCharCode(...b)); return enc === 'base64url' ? s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : s; };
  return b;
}
function randomInt(n) { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; }
module.exports = { randomBytes, randomInt, createHash: () => { const h = sha256.create(); return { update(s) { h.update(s); return this; }, digest() { return h.hex(); } }; }, getRandomValues: (a) => globalThis.crypto.getRandomValues(a) };
