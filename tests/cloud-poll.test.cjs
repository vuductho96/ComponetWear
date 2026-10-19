const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto, createHash } = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/api.js'), 'utf8');
const heartbeat = fs.readFileSync(path.join(__dirname, '../ComponentLife/js/heartbeat.js'), 'utf8');
function setup() {
  const values = { 'ComponentMaster.json': [{ PartName: 'TEST' }], 'data/shoot-data.json': [{ Output: 42 }], 'data/replacement-log.json': [], 'data/stock-data.json': {} };
  let version = 'a', codeVersion = 'code1', fail = false, corrupt = false, reloads = 0;
  const context = vm.createContext({ console: { warn() {} }, AbortSignal, TextDecoder, crypto: webcrypto, _currentDataVersion: null, _masterLookupMap: null, masterData: [], db: {}, _stockData: {},
    window: { location: { hostname: 'test.workers.dev', reload() { reloads++; } } },
    updateMasterData(v) { context.masterData = v; }, invalidatePartsCache() {}, buildMonthOptions() {}, rebuild() {}, renderActiveTabOnly() {},
    setInterval() {},
    async fetch(url) {
      const p = url.split('?')[0].replace(/^\//, '');
      if (fail) throw Error('offline');
      if (p === 'data/version.json') return { ok: true, json: async () => ({ snapshotId: version, codeVersion, files: Object.entries(values).map(([p, v]) => p + '=' + createHash('sha256').update(JSON.stringify(v)).digest('hex')) }) };
      const b = Buffer.from(corrupt ? '[]' : JSON.stringify(values[p]));
      return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
  });
  vm.runInContext(code, context);
  context.updateMasterData = v => { context.masterData = v; };
  return { context, values, setVersion: v => version = v, setCode: v => codeVersion = v, fail: v => fail = v, corrupt: v => corrupt = v, reloads: () => reloads };
}
test('cloud polls recover from offline, accept resets, and reload code changes', async () => {
  const s = setup();
  s.fail(true); await s.context.checkDataVersionLoop(); assert.equal(s.context._currentDataVersion, null);
  s.fail(false); await s.context.checkDataVersionLoop(); assert.equal(s.context._currentDataVersion, 'a');
  s.setVersion('0'); s.values['data/shoot-data.json'][0].Output = 99;
  s.corrupt(true); await s.context.checkDataVersionLoop(); assert.equal(s.context._currentDataVersion, 'a');
  s.corrupt(false); await s.context.checkDataVersionLoop(); assert.equal(s.context._currentDataVersion, '0');
  assert.equal(s.context.db.shoot[0].Output, 99);
  s.setCode('code2'); await s.context.checkDataVersionLoop(); assert.equal(s.reloads(), 1);
});
test('cloud creates no polling timers and sends no background requests', () => {
  const timers = [], requests = [];
  const c = vm.createContext({ window: { location: { hostname: 'test.workers.dev' } }, setInterval(fn, ms) { timers.push(ms); }, checkDataVersionLoop() { requests.push('version'); }, fetch(url) { requests.push(url); } });
  vm.runInContext(heartbeat, c); c.initHeartbeat();
  assert.deepEqual(timers, []); assert.deepEqual(requests, []);
});
