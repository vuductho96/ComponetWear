// Integration checks with fake Wrangler and a real local HTTP endpoint; never deploys to Cloudflare.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const project = path.resolve(__dirname, '..');

function run(root, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'path' && env.PATH) delete childEnv[key];
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(project, 'Publish-ComponentLife.ps1'), '-ProjectRoot', root, ...args], { env: { ...childEnv, ...env } });
    let output = '';
    child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
    child.on('error', reject); child.on('close', code => resolve({ code, output }));
  });
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'component-publish-'));
  const app = path.join(root, 'ComponentLife');
  for (const dir of ['js', 'css', 'data']) fs.mkdirSync(path.join(app, dir), { recursive: true });
  fs.copyFileSync(path.join(project, 'ComponentLife/cloud_publish.ps1'), path.join(app, 'cloud_publish.ps1'));
  fs.copyFileSync(path.join(project, 'ComponentLife/publish-manifest.cjs'), path.join(app, 'publish-manifest.cjs'));
  for (const [file, content] of Object.entries({ 'index.html': '<h1>Test</h1>', 'js/app.js': '// test', 'css/app.css': 'body{}', 'ComponentMaster.json': '[]', 'data/shoot-data.json': '[]', 'data/replacement-log.json': '[]', 'data/stock-data.json': '{}', 'data/.sync_cache.json': '{"private":"hidden"}', 'private.ps1': 'secret' })) fs.writeFileSync(path.join(app, file), content);
  const drawings = path.join(app, 'data/inspection/drawings'); fs.mkdirSync(drawings, { recursive: true });
  const drawing = Buffer.from('%PDF-1.4\nfixture for hashing only');
  const drawingName = createHash('sha256').update(drawing).digest('hex') + '.pdf';
  fs.writeFileSync(path.join(drawings, drawingName), drawing);
  fs.writeFileSync(path.join(drawings, drawingName.replace('.pdf', '-v1-p0001.webp')), 'preview image fixture');
  const pointName = 'points-' + drawingName.slice(0, -4) + '-123456789abc.json';
  fs.writeFileSync(path.join(drawings, pointName), JSON.stringify({ schemaVersion: 1, points: {} }));
  fs.writeFileSync(path.join(drawings, 'recognizer.onnx'), 'private weights');
  fs.writeFileSync(path.join(app, 'data/inspection/detail-00.json'), '{}');
  fs.writeFileSync(path.join(app, 'data/inspection/summary.json'), JSON.stringify({ schemaVersion: 1, drawingMode: 'images-only', records: [{ detailFile: 'detail-00.json', drawings: [{ pointMap: 'data/inspection/drawings/' + pointName, pages: ['data/inspection/drawings/' + drawingName.replace('.pdf', '-v1-p0001.webp')] }] }] }));
  fs.writeFileSync(path.join(app, 'data/inspection/private-cache.json'), '{"private":true}');
  const ocr = path.join(app, 'dimension-ocr');
  fs.mkdirSync(path.join(ocr, 'models'), { recursive: true }); fs.mkdirSync(path.join(ocr, 'vendor'));
  fs.writeFileSync(path.join(ocr, 'index.html'), '<h1>Dimension OCR Beta</h1>');
  fs.writeFileSync(path.join(ocr, 'models/test.bin'), 'public browser model fixture');
  fs.writeFileSync(path.join(ocr, 'vendor/engine.wasm'), 'public browser runtime fixture');
  fs.writeFileSync(path.join(ocr, 'assets.json'), JSON.stringify({ schemaVersion: 1, files: ['index.html', 'models/test.bin', 'vendor/engine.wasm'] }));
  fs.writeFileSync(path.join(ocr, 'private.env'), 'not public');
  fs.writeFileSync(path.join(ocr, 'private.ps1'), 'not public');
  fs.writeFileSync(path.join(drawings, 'private-workbook.xlsx'), 'private');
  fs.writeFileSync(path.join(root, 'wrangler.jsonc'), '{}');
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'npx.cmd'), '@echo off\r\nexit /b %MOCK_EXIT%\r\n');
  return { root, app, env: { PATH: bin + path.delimiter + process.env.PATH, MOCK_EXIT: '0' } };
}
test('publisher snapshots, failure handling, verification and lock', async t => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  let corrupt = false;
  const server = http.createServer((req, res) => {
    const file = path.join(f.root, '.cloud-publish/assets', new URL(req.url, 'http://localhost').pathname);
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    res.end(corrupt && file.endsWith('app.js') ? 'corrupted' : fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const args = ['-CloudUrl', `http://127.0.0.1:${server.address().port}`];
  const state = () => JSON.parse(fs.readFileSync(path.join(f.root, '.cloud-publish/success.json')));
  const manifest = () => JSON.parse(fs.readFileSync(path.join(f.root, '.cloud-publish/assets/data/version.json')));
  await t.test('build is deterministic and excludes private files', async () => {
    assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 0);
    const first = manifest().snapshotId;
    assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 0);
    assert.equal(manifest().snapshotId, first);
    assert.ok(!fs.existsSync(path.join(f.root, '.cloud-publish/assets/private.ps1')));
    assert.ok(!fs.existsSync(path.join(f.root, '.cloud-publish/assets/data/.sync_cache.json')));
    assert.ok(!fs.existsSync(path.join(f.root, '.cloud-publish/assets/data/inspection/private-cache.json')));
    assert.ok(!fs.existsSync(path.join(f.root, '.cloud-publish/assets/data/inspection/drawings/private-workbook.xlsx')));
    assert.ok(manifest().files.some(entry => /^data\/inspection\/drawings\/[a-f0-9]{64}-v1-p0001\.webp=/.test(entry)));
    assert.ok(manifest().files.some(entry => /\/points-[a-f0-9]{64}-[a-f0-9]{12}\.json=/.test(entry)));
    assert.ok(!manifest().files.some(entry => /inspection-ocr\/|\.onnx=/.test(entry)));
    assert.ok(manifest().files.some(entry => entry.startsWith('dimension-ocr/models/test.bin=')));
    assert.ok(manifest().files.some(entry => entry.startsWith('dimension-ocr/vendor/engine.wasm=')));
    assert.ok(!manifest().files.some(entry => /private\.env|private\.ps1/.test(entry)));
    assert.ok(!manifest().files.some(entry => /\.pdf=/.test(entry)), 'Unlisted source PDFs must not be published');
    assert.ok(!fs.existsSync(path.join(f.root, '.cloud-publish/success.json')));
  });
  await t.test('only explicitly indexed original downloads are published', async () => {
    const directory = path.join(f.app, 'data/inspection/downloads'); fs.mkdirSync(directory);
    const pdf = 'data/inspection/downloads/' + 'a'.repeat(64) + '.pdf';
    const excel = 'data/inspection/downloads/' + 'b'.repeat(64) + '.xlsm';
    const template = 'data/inspection/downloads/' + 'c'.repeat(64) + '.xlsx';
    fs.writeFileSync(path.join(f.app, pdf), 'encrypted PDF fixture');
    fs.writeFileSync(path.join(f.app, excel), 'original workbook fixture');
    fs.writeFileSync(path.join(f.app, template), 'report template fixture');
    fs.writeFileSync(path.join(directory, 'unlisted.pdf'), 'private source');
    const index = path.join(f.app, 'data/inspection/downloads.json');
    const value = { schemaVersion:1, excel:{record:{url:excel}}, pdf:{drawing:{url:pdf}}, reportTemplate:{schemaVersion:1,url:template} };
    try {
      fs.writeFileSync(index, JSON.stringify(value));
      const result = await run(f.root, ['-BuildOnly'], f.env);
      assert.equal(result.code, 0, result.output);
      assert.ok(manifest().files.some(entry => entry.startsWith(pdf + '=')));
      assert.ok(manifest().files.some(entry => entry.startsWith(excel + '=')));
      assert.ok(manifest().files.some(entry => entry.startsWith(template + '=')));
      assert.ok(!manifest().files.some(entry => entry.includes('unlisted.pdf')));
      value.pdfPassword = 'must-not-be-public'; fs.writeFileSync(index, JSON.stringify(value));
      assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 1);
      delete value.pdfPassword;
      value.reportTemplate.url = '../private.xlsx'; fs.writeFileSync(index, JSON.stringify(value));
      assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 1);
      value.reportTemplate.url = template;
      value.pdf.drawing.url = '../private.ps1'; fs.writeFileSync(index, JSON.stringify(value));
      assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 1);
    } finally { fs.unlinkSync(index); }
  });
  await t.test('Dimension OCR public list cannot traverse to private source files', async () => {
    const file = path.join(f.app, 'dimension-ocr/assets.json'), original = fs.readFileSync(file);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, files: ['../private.ps1'] }));
    try { assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 1); }
    finally { fs.writeFileSync(file, original); }
  });
  await t.test('nonzero Wrangler exit never marks success', async () => {
    const result = await run(f.root, args, { ...f.env, MOCK_EXIT: '7' });
    assert.equal(result.code, 1, result.output);
    assert.ok(!fs.existsSync(path.join(f.root, '.cloud-publish/success.json')));
    assert.match(fs.readFileSync(path.join(f.root, '.cloud-publish/publish.log'), 'utf8'), /Wrangler exited with code 7/);
  });
  await t.test('success requires every remote hash to match', async () => {
    const result = await run(f.root, args, f.env);
    assert.equal(result.code, 0, result.output);
    assert.equal(state().snapshotId, manifest().snapshotId);
  });
  await t.test('remote corruption preserves last successful version', async () => {
    const previous = state().snapshotId;
    fs.writeFileSync(path.join(f.app, 'js/app.js'), '// changed'); corrupt = true;
    const result = await run(f.root, args, f.env);
    assert.equal(result.code, 1, result.output);
    assert.equal(state().snapshotId, previous);
    corrupt = false;
    assert.equal((await run(f.root, args, f.env)).code, 0);
    assert.notEqual(state().snapshotId, previous);
  });
  await t.test('invalid JSON fails before deployment', async () => {
    const previous = state().snapshotId;
    fs.writeFileSync(path.join(f.app, 'data/shoot-data.json'), '{');
    assert.equal((await run(f.root, args, f.env)).code, 1);
    assert.equal(state().snapshotId, previous);
    fs.writeFileSync(path.join(f.app, 'data/shoot-data.json'), '[]');
  });
  await t.test('a PDF source link in metadata blocks publication', async () => {
    const file = path.join(f.app, 'data/inspection/summary.json');
    const original = fs.readFileSync(file, 'utf8');
    const summary = JSON.parse(original);
    summary.records[0].drawings[0].url = 'data/inspection/drawings/original.pdf';
    fs.writeFileSync(file, JSON.stringify(summary));
    try { assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 1); }
    finally { fs.writeFileSync(file, original); }
  });
  await t.test('a second publisher cannot enter while lock is held', async () => {
    const lockPath = path.join(f.root, '.cloud-publish/publish.lock').replaceAll("'", "''");
    const locker = spawn('powershell.exe', ['-NoProfile', '-Command', `$f=[IO.File]::Open('${lockPath}','OpenOrCreate','ReadWrite','None'); Write-Output 'LOCKED'; Start-Sleep -Seconds 30; $f.Dispose()`]);
    try {
      await new Promise((resolve, reject) => { locker.stdout.once('data', resolve); locker.once('error', reject); });
      assert.equal((await run(f.root, ['-BuildOnly'], f.env)).code, 1);
    } finally { locker.kill(); }
  });
});
