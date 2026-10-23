const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createHash } = require('node:crypto');
const { verifyCloud, captureBaseline } = require('../verify-cloud.cjs');
const hash = text => createHash('sha256').update(text).digest('hex');

test('verification follows same-origin HTML redirects and retries transient assets without accepting bad bytes',async t=>{
  let attempts=0,mode='recover',rootReads=0;
  const manifest={snapshotId:'test',files:['index.html='+hash('html'),'asset.bin='+hash('bytes')]};
  const server=http.createServer((req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    if(file==='/data/version.json')return res.end(JSON.stringify(manifest));
    if(file==='/index.html'){res.writeHead(307,{Location:'/'});return res.end();}
    if(file==='/'){rootReads++;return res.end('html');}
    attempts++;
    if(mode==='cross'){res.writeHead(307,{Location:'https://evil.test/stolen'});return res.end();}
    if(mode==='missing' || (mode==='recover'&&attempts<3)){res.writeHead(404);return res.end('pending');}
    res.end(mode==='corrupt'?'wrong':'bytes');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const url='http://127.0.0.1:'+server.address().port,notices=[],options={retryDelays:[0,0],onRetry:message=>notices.push(message)};
  assert.equal(await verifyCloud(manifest,url,1,null,options),2);
  assert.equal(rootReads,1);assert.equal(attempts,3);assert.equal(notices.length,2);
  mode='missing';attempts=0;await assert.rejects(verifyCloud(manifest,url,1,null,options),/HTTP 404/);assert.equal(attempts,3);
  mode='corrupt';attempts=0;await assert.rejects(verifyCloud(manifest,url,1,null,options),/SHA-256 mismatch/);assert.equal(attempts,1);
  mode='cross';attempts=0;await assert.rejects(verifyCloud(manifest,url,1,null,options),/Cross-origin redirect rejected/);assert.equal(attempts,1);
});

test('private verifier credentials are scoped to the exact HTTPS origin and redirects are inspected', async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'verifier-auth-'));
  const file=path.join(directory,'private.json'),previousEnv=process.env.COMPONENTLIFE_VERIFIER_FILE,previousFetch=global.fetch;
  fs.writeFileSync(file,JSON.stringify({url:'https://trusted.test',token:'private-test-token'}));process.env.COMPONENTLIFE_VERIFIER_FILE=file;
  const manifest={snapshotId:'snapshot',files:['data/private.json='+hash('content')]},requests=[];
  global.fetch=async(url,options)=>{requests.push({url:String(url),...options});return String(url).includes('version.json')?Response.json(manifest):new Response('content');};
  try {
    await verifyCloud(manifest,'https://trusted.test');
    assert.ok(requests.every(r=>r.headers.Authorization==='Bearer private-test-token'&&r.redirect==='manual'));
    requests.length=0;await verifyCloud(manifest,'https://other.test');assert.ok(requests.every(r=>!r.headers.Authorization));
    requests.length=0;await verifyCloud(manifest,'http://trusted.test');assert.ok(requests.every(r=>!r.headers.Authorization));
    await assert.rejects(verifyCloud({...manifest,files:['https://evil.test/private='+hash('content')]},'https://trusted.test'),/does not match/);
  }finally{global.fetch=previousFetch;if(previousEnv===undefined)delete process.env.COMPONENTLIFE_VERIFIER_FILE;else process.env.COMPONENTLIFE_VERIFIER_FILE=previousEnv;fs.rmSync(directory,{recursive:true,force:true});}
});
test('verified baseline skips unchanged bytes and still rejects changed-file corruption', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-delta-'));
  const content = { 'index.html': 'old', 'large.bin': 'unchanged model' };
  const manifest = () => {
    const files = Object.keys(content).sort().map(file => file + '=' + hash(content[file]));
    return { schemaVersion: 1, files, snapshotId: hash(files.join('\n')) };
  };
  let current = manifest(), corrupt = false;
  const requests = [];
  const server = http.createServer((req, res) => {
    const file = new URL(req.url, 'http://localhost').pathname.slice(1);
    requests.push(file);
    res.end(file === 'data/version.json' ? JSON.stringify(current) : corrupt && file === 'index.html' ? 'bad' : content[file]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await verifyCloud(current, url), 2);
  const success = path.join(root, 'success.json'), output = path.join(root, 'baseline.json');
  fs.writeFileSync(success, JSON.stringify({ snapshotId: current.snapshotId, url }));
  await captureBaseline(output, success, url);
  const previous = JSON.parse(fs.readFileSync(output));
  content['index.html'] = 'new'; current = manifest(); requests.length = 0;
  assert.equal(await verifyCloud(current, url, 6, previous), 1);
  assert.deepEqual(requests.sort(), ['data/version.json', 'index.html']);
  corrupt = true;
  await assert.rejects(verifyCloud(current, url, 6, previous), /SHA-256 mismatch/);
  corrupt = false;
  await captureBaseline(output, success, url);
  assert.equal(fs.existsSync(output), false, 'Unverified remote version cannot become a baseline');
  requests.length = 0;
  assert.equal(await verifyCloud(current, url), 2, 'Missing baseline performs full verification');
  assert.ok(requests.includes('large.bin'));
  const invalid = { ...current, snapshotId: 'wrong' };
  await assert.rejects(verifyCloud(invalid, url), /does not match/);
});
