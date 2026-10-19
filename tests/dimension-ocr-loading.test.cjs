const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('crop loads only recognizer, full OCR reuses it, failed downloads can retry', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../ComponentLife/dimension-ocr/inference.js'), 'utf8').replaceAll('import.meta.url', '"https://ocr.test/inference.js"');
  const { Engine } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const originalFetch = global.fetch, requests = [], messages = [];
  let fail = '';
  const manifest = { detector: ['d.bin'], regions: ['g.bin'], recognizer: ['r.bin'], fileSizes: { 'd.bin': 4, 'g.bin': 4, 'r.bin': 4 } };
  global.fetch = async url => {
    const file = new URL(url).pathname.split('/').pop(); requests.push(file);
    if (file === fail) return new Response('unavailable', { status: 503 });
    return new Response(file === 'manifest.json' ? JSON.stringify(manifest) : file === 'dict.txt' ? '0\n1\n2' : 'test', { headers: { 'content-length': '4' } });
  };
  const ort = { env: { wasm: {} }, InferenceSession: { create: async () => ({ release: async () => {} }) } };
  try {
    const engine = new Engine(ort, text => messages.push(text));
    await engine.load(['recognizer']);
    assert.deepEqual(requests, ['manifest.json', 'r.bin', 'dict.txt']);
    assert.ok(messages.some(s => /recognizer model: 100%/.test(s)));
    requests.length = 0;
    await engine.load();
    assert.deepEqual(requests, ['d.bin', 'g.bin']);
    requests.length = 0;
    await engine.load(); assert.deepEqual(requests, []);
    const retry = new Engine(ort, () => {});
    fail = 'r.bin';
    await assert.rejects(retry.load(['recognizer']), /503/);
    fail = '';
    await retry.load(['recognizer']);
    assert.ok(retry.sessions.recognizer);
    assert.equal(retry.sessions.detector, undefined);
  } finally { global.fetch = originalFetch; }
});
