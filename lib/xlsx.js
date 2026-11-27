'use strict';
// قراءة ملفات Excel (xlsx) وكتابتها دون مكتبة جداول خارجية: الملف حزمة zip من ملفات XML.
// الكتابة تضع النصوص نصوصًا مضمّنة (inlineStr) فلا يُفسَّر نص يبدأ بعلامة «=» معادلةً.
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const unesc = (s) => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colName = (i) => { let s = ''; i += 1; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
const sheetName = (s, i) => (String(s || `ورقة ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31).trim() || `ورقة ${i + 1}`);

/**
 * يكتب مصنفًا من أوراق: [{ name, rows: [[قيم]], widths?: [عرض الأعمدة] }]. الصف الأول عنوان بخط عريض.
 * الأوراق من اليمين إلى اليسار. يعيد Uint8Array.
 */
function write(sheets) {
  const files = {};
  const ws = sheets.map((sh, si) => {
    const rows = sh.rows || [];
    const ncol = Math.max(1, ...rows.map((r) => r.length));
    const widths = sh.widths || Array.from({ length: ncol }, (_, c) => Math.min(60, Math.max(8, ...rows.map((r) => String(r[c] ?? '').length + 2))));
    const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      if (v === null || v === undefined || v === '') return '';
      const ref = colName(ci) + (ri + 1), st = ri === 0 && sh.header !== false ? ' s="1"' : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${si + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1">${rows.length > 1 && sh.header !== false ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : ''}</sheetView></sheetViews><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`);
    return sheetName(sh.name, si);
  });
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ws.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${ws.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${ws.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${ws.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEDE7F3"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  return zipSync(files, { level: 6 });
}

/** يقرأ الورقة الأولى من ملف xlsx ويعيد صفوفها مصفوفات نصوص (الخلايا الفارغة نص فارغ). */
function read(bytes) {
  let z;
  try { z = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)); } catch (e) { throw new Error('الملف ليس ملف Excel صالحًا (xlsx)'); }
  const txt = (p) => (z[p] ? strFromU8(z[p]) : '');
  const wb = txt('xl/workbook.xml'); if (!wb) throw new Error('الملف ليس ملف Excel صالحًا (xlsx)');
  const first = (wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
  const rels = txt('xl/_rels/workbook.xml.rels');
  let target = first && (new RegExp(`<Relationship\\b[^>]*Id="${first}"[^>]*Target="([^"]+)"`).exec(rels) || new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${first}"`).exec(rels) || [])[1];
  target = target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')) : 'xl/worksheets/sheet1.xml';
  const sheet = txt(target); if (!sheet) throw new Error('تعذّرت قراءة الورقة الأولى من الملف');
  const tOf = (x) => unesc((x.match(/<t\b[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/^<t\b[^>]*>|<\/t>$/g, '')).join(''));
  const shared = (txt('xl/sharedStrings.xml').match(/<si>[\s\S]*?<\/si>/g) || []).map(tOf);
  const rows = [];
  for (const rm of sheet.match(/<row\b[^>]*>[\s\S]*?<\/row>|<row\b[^>]*\/>/g) || []) {
    const rn = +(rm.match(/\br="(\d+)"/) || [])[1] || rows.length + 1;
    const row = [];
    for (const cm of rm.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) || []) {
      const attrs = cm.match(/^<c\b[^>]*>/)[0], ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (cm.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = tOf(cm);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) val = unesc(v);
      row[ref ? colIndex(ref) : row.length] = String(val).trim();
    }
    rows[rn - 1] = Array.from(row, (x) => x ?? '');
  }
  return Array.from(rows, (r) => r || []).filter((r, i, all) => i < all.length);
}

module.exports = { write, read };
