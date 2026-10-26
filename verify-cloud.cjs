// Bounded parallel verification keeps a large drawing library from blocking the publisher for hours.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
function verifierHeaders(baseUrl) {
  const file=process.env.COMPONENTLIFE_VERIFIER_FILE || path.join(__dirname,'.cloud-publish','auth-verifier.json');
  if(!fs.existsSync(file)) return {};
  const saved=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  const target=new URL(baseUrl),trusted=new URL(saved.url);
  if(target.protocol!=='https:' || target.origin!==trusted.origin) return {};
  return {Authorization:'Bearer '+saved.token};
}
async function readCloudAsset(url, headers, timeout, read, options) {
  const delays=options.retryDelays || [1000,3000,7000,15000];
  for(let attempt=0;;attempt++) {
    try {
      let current=new URL(url);
      current.searchParams.set('verifyAttempt',String(attempt));
      for(let redirects=0;;redirects++) {
        const response=await fetch(current,{headers,redirect:'manual',signal:AbortSignal.timeout(timeout)});
        if([301,302,303,307,308].includes(response.status)) {
          await response.body?.cancel();
          const location=response.headers.get('location');
          if(!location)throw Error('Redirect without location');
          const target=new URL(location,current);
          if(target.origin!==url.origin || target.username || target.password)throw Error('Cross-origin redirect rejected');
          if(redirects>=5)throw Error('Too many redirects');
          current=target;continue;
        }
        if(!response.ok) {
          await response.body?.cancel();
          throw Object.assign(Error('HTTP '+response.status),{retryable:[404,408,425,429,500,502,503,504].includes(response.status)});
        }
        return await read(response);
      }
    } catch(error) {
      if(!(error.retryable || error instanceof TypeError || ['TimeoutError','AbortError'].includes(error.name)) || attempt>=delays.length)throw error;
      options.onRetry?.(`${url.pathname}: ${error.message}; retry ${attempt+1}/${delays.length} in ${delays[attempt]/1000}s`);
      await new Promise(resolve=>setTimeout(resolve,delays[attempt]));
    }
  }
}
function validManifest(manifest) {
  return Boolean(manifest && Array.isArray(manifest.files) &&
    createHash('sha256').update(manifest.files.join('\n')).digest('hex') === manifest.snapshotId);
}
async function readRemoteVersion(base, stamp, options) {
  // The public version response is intentionally compact and reliably fast.
  // Asset hashes below still use the private verifier header.
  return readCloudAsset(new URL('data/version.json?verify=' + stamp, base), {}, 20000, response => response.json(), options);
}
async function verifyCloud(manifest, baseUrl, concurrency = 6, previous = null, options = {}) {
  const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
  const stamp = Date.now() + '-' + Math.random().toString(16).slice(2);
  const headers=verifierHeaders(baseUrl);
  const version = await readRemoteVersion(base, stamp, options);
  if (version.snapshotId !== manifest.snapshotId) throw Error('Cloud version does not match snapshot.');
  // Public version responses omit the full asset list. Wrangler already
  // content-addressed the upload; use the exact snapshot plus the captured
  // baseline to verify only changed assets. A first-ever deploy gets a
  // manifest-only confirmation instead of downloading the full library.
  if (Array.isArray(version.files) && JSON.stringify(version.files) !== JSON.stringify(manifest.files)) throw Error('Cloud version does not match snapshot.');
  const prior = new Set(previous?.files || []);
  const files = Array.isArray(version.files) || previous ? manifest.files.filter(entry => !prior.has(entry)) : [];
  let index = 0, failed = null;
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, async () => {
    while (!failed && index < files.length) {
      const entry = files[index++], split = entry.indexOf('='), file = entry.slice(0, split), expected = entry.slice(split + 1);
      try {
        const url = new URL(file, base); url.searchParams.set('verify', stamp);
        if(url.origin!==base.origin) throw Error('Cross-origin asset rejected');
        await readCloudAsset(url,headers,60000,async response=>{
          const hash = createHash('sha256');
          for await (const chunk of response.body) hash.update(chunk);
          if (hash.digest('hex') !== expected) throw Error('SHA-256 mismatch');
        },options);
      } catch (e) { failed = Error(file + ': ' + e.message); }
    }
  }));
  if (failed) throw failed;
  return files.length;
}
async function captureBaseline(output, baseUrl, localManifestPath = '') {
  fs.rmSync(output, { force: true });
  try {
    const base = new URL(baseUrl.endsWith('/') ? baseUrl : baseUrl + '/');
    // Fetch the compact browser snapshot first, rather than depending on a
    // multi-megabyte private asset manifest every time Publish is clicked.
    const response = await fetch(new URL('data/version.json?baseline=' + Date.now(), base), { redirect:'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return;
    const previous = await response.json();
    if (validManifest(previous)) {
      fs.writeFileSync(output, JSON.stringify(previous));
      return;
    }
    // A previous local verifier may have timed out after Cloudflare accepted
    // its upload. Reuse its complete staged manifest only when its snapshot
    // matches the compact public snapshot currently served by Cloudflare.
    if (localManifestPath && fs.existsSync(localManifestPath)) {
      const local = JSON.parse(fs.readFileSync(localManifestPath, 'utf8').replace(/^\uFEFF/, ''));
      if (local.snapshotId === previous.snapshotId && validManifest(local))
        fs.writeFileSync(output, JSON.stringify(local));
    }
  } catch { /* Remote baseline unavailable: use full verification. */ }
}
module.exports = { verifyCloud, captureBaseline };
if (require.main === module) {
  if (process.argv[2] === '--capture-baseline') {
    captureBaseline(process.argv[3], process.argv[4], process.argv[5]).catch(e => { console.error(e.message); process.exitCode = 1; });
  } else {
  const manifest = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  const previous = process.argv[4] && fs.existsSync(process.argv[4]) ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : null;
  verifyCloud(manifest, process.argv[3], 6, previous, {onRetry:message=>console.log('Verification retry: '+message)}).then(count => console.log('Verified ' + count + ' changed/public files; manifest covers ' + manifest.files.length + ' files.')).catch(e => { console.error(e.message); process.exitCode = 1; });
  }
}
