// Persistent hashes live outside public assets. NTFS change timestamps also
// invalidate entries when an editor restores the original modification time.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const immutablePreview = relative => /^(?:data\/inspection\/drawings\/[a-f0-9]{64}-v[0-9]+-p[0-9]{4}\.webp|data\/inspection\/downloads\/[a-f0-9]{64}\.(?:pdf|xlsx|xlsm))$/.test(relative);
const normalizeSignature = (value, relative) => { const parts = value.split(':'); if (immutablePreview(relative)) parts[4] = '*'; return parts.join(':'); };
const signature = (stat, relative) => normalizeSignature(['dev','ino','size','mtimeNs','ctimeNs','birthtimeNs'].map(key => String(stat[key])).join(':'), relative);
const cacheVersion = hash(fs.readFileSync(__filename));
function buildManifest({ root, files, cacheDirectory }) {
  root = path.resolve(root);
  const cacheFile = cacheDirectory && path.join(cacheDirectory, hash(root.toLowerCase()) + '.json');
  let old = {};
  if (cacheFile) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if ([cacheVersion, 'e30ffa5483528680fe08834a7682908efab90b1b7e11c3c2476dba907e137728', '396de6be07686ae1d2ed31c405fea3f62d9a2ab060fffefa9d5055d078b039bb'].includes(cached.version) && cached.root === root) old = cached.files;
    } catch { /* Missing/corrupt cache is rebuilt from actual bytes. */ }
  }
  const entries = [], data = [], code = [], next = {};
  const stats = { hashed: 0, cached: 0, bytesRead: 0 };
  for (const relative of files) {
    const file = path.join(root, relative), before = signature(fs.statSync(file, { bigint: true }), relative);
    let digest;
    const prior = old[relative];
    if (prior && normalizeSignature(prior.signature, relative) === before && /^[a-f0-9]{64}$/.test(prior.hash)) {
      digest = prior.hash; stats.cached++;
    } else {
      const bytes = fs.readFileSync(file);
      if (relative.endsWith('.json')) JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      digest = hash(bytes); stats.hashed++; stats.bytesRead += bytes.length;
    }
    if (signature(fs.statSync(file, { bigint: true }), relative) !== before) throw Error('Source changed while hashing: ' + relative);
    next[relative] = { signature: before, hash: digest };
    const entry = relative + '=' + digest;
    entries.push(entry);
    (relative.endsWith('.json') || relative.startsWith('data/') ? data : code).push(entry);
  }
  const manifest = { schemaVersion: 1, snapshotId: hash(entries.join('\n')), dataVersion: hash(data.join('\n')), codeVersion: hash(code.join('\n')), generatedAt: new Date().toISOString(), files: entries };
  if (cacheFile) {
    fs.mkdirSync(cacheDirectory, { recursive: true });
    const temp = cacheFile + '.' + randomUUID() + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify({ version: cacheVersion, root, files: next })); fs.renameSync(temp, cacheFile); }
    finally { fs.rmSync(temp, { force: true }); }
  }
  return { manifest, stats };
}
module.exports = { buildManifest };
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => input += chunk);
  process.stdin.on('end', () => {
    try { process.stdout.write(JSON.stringify(buildManifest(JSON.parse(input.replace(/^\uFEFF/, ''))))); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  });
}
