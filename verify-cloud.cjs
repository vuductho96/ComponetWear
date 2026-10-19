// Bounded parallel verification keeps a large drawing library from blocking the publisher for hours.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
async function verifyCloud(manifest, baseUrl, concurrency = 6, previous = null) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const stamp = Date.now() + '-' + Math.random().toString(16).slice(2);
  const remote = await fetch(new URL('data/version.json?verify=' + stamp, base), { signal: AbortSignal.timeout(20000) });
  if (!remote.ok) throw Error('Cloud version unavailable.');
  const version = await remote.json();
  if (version.snapshotId !== manifest.snapshotId || JSON.stringify(version.files) !== JSON.stringify(manifest.files)) throw Error('Cloud version does not match snapshot.');
  const prior = new Set(previous?.files || []);
  const files = manifest.files.filter(entry => !prior.has(entry));
  let index = 0, failed = null;
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (!failed && index < files.length) {
      const entry = files[index++], split = entry.indexOf('='), file = entry.slice(0, split), expected = entry.slice(split + 1);
      try {
        const url = new URL(file, base); url.searchParams.set('verify', stamp);
        const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!response.ok) throw Error('HTTP ' + response.status);
        const hash = createHash('sha256');
        for await (const chunk of response.body) hash.update(chunk);
        if (hash.digest('hex') !== expected) throw Error('SHA-256 mismatch');
      } catch (e) { failed = Error(file + ': ' + e.message); }
    }
  }));
  if (failed) throw failed;
  return files.length;
}
async function captureBaseline(output, successPath, baseUrl) {
  fs.rmSync(output, { force: true });
  try {
    const success = JSON.parse(fs.readFileSync(successPath, 'utf8').replace(/^\uFEFF/, ''));
    if (new URL(success.url).href.replace(/\/$/, '') !== new URL(baseUrl).href.replace(/\/$/, '')) return;
    const response = await fetch(new URL('data/version.json?baseline=' + Date.now(), baseUrl.endsWith('/') ? baseUrl : baseUrl + '/'), { signal: AbortSignal.timeout(15000) });
    if (!response.ok) return;
    const previous = await response.json();
    if (previous.snapshotId !== success.snapshotId || !Array.isArray(previous.files)) return;
    if (createHash('sha256').update(previous.files.join('\n')).digest('hex') !== success.snapshotId) return;
    fs.writeFileSync(output, JSON.stringify(previous));
  } catch { /* Missing verified baseline or unavailable cloud: use full verification. */ }
}
module.exports = { verifyCloud, captureBaseline };
if (require.main === module) {
  if (process.argv[2] === '--capture-baseline') {
    captureBaseline(process.argv[3], process.argv[4], process.argv[5]).catch(e => { console.error(e.message); process.exitCode = 1; });
  } else {
  const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  const previous = process.argv[4] && fs.existsSync(process.argv[4]) ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : null;
  verifyCloud(manifest, process.argv[3], 6, previous).then(count => console.log('Verified ' + count + ' changed/public files; manifest covers ' + manifest.files.length + ' files.')).catch(e => { console.error(e.message); process.exitCode = 1; });
  }
}
