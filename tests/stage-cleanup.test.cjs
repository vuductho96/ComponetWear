const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
test('stage cleanup removes only retired staging directories and skips junctions', {skip:process.platform!=='win32'},()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'component-stage-cleanup-'));
  const work=path.join(root,'.cloud-publish');fs.mkdirSync(work);
  const retired=path.join(work,'previous-'+'a'.repeat(32)),keep=path.join(work,'previous-important'),outside=path.join(root,'source');
  for(const dir of [retired,keep,outside]){fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'keep.txt'),'source');}
  const junction=path.join(work,'previous-'+'b'.repeat(32));fs.symlinkSync(outside,junction,'junction');
  try{
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve(__dirname,'../Cleanup-ComponentLifeStage.ps1'),'-ProjectRoot',root]);
    assert.ok(!fs.existsSync(retired));assert.ok(fs.existsSync(keep));assert.ok(fs.existsSync(path.join(outside,'keep.txt')));assert.ok(fs.existsSync(junction));
  }finally{
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  }
});
