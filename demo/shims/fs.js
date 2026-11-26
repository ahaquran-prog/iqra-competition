module.exports = { existsSync: () => false, mkdirSync() {}, readFileSync() { throw new Error('no fs'); }, readdirSync: () => [], unlinkSync() {} };
