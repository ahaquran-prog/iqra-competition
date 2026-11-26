'use strict';
const { runBackup } = require('../lib/backup');
runBackup().then((r) => console.log('✓ نسخة احتياطية: ' + r.file)).catch((e) => { console.error(e); process.exit(1); });
