const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {stage}=require('../stage-assets.cjs');
test('fast staging copies only explicit files and links immutable downloads',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'componentlife-stage-'));
  try{
    const sourceRoot=path.join(root,'source'),targetRoot=path.join(root,'stage');
    const pdf='data/inspection/downloads/'+'a'.repeat(64)+'.pdf';
    fs.mkdirSync(path.dirname(path.join(sourceRoot,pdf)),{recursive:true});
    fs.writeFileSync(path.join(sourceRoot,pdf),'original bytes');fs.writeFileSync(path.join(sourceRoot,'index.html'),'public');fs.writeFileSync(path.join(sourceRoot,'private.ps1'),'secret');
    const stats=stage({sourceRoot,targetRoot,files:['index.html',pdf]});
    assert.equal(stats.linked+stats.copied,2);
    assert.equal(fs.readFileSync(path.join(targetRoot,pdf),'utf8'),'original bytes');
    assert.ok(!fs.existsSync(path.join(targetRoot,'private.ps1')));
    fs.writeFileSync(path.join(sourceRoot,'index.html'),'edited');
    assert.equal(fs.readFileSync(path.join(targetRoot,'index.html'),'utf8'),'public');
    for(const relative of ['../private.ps1','/private.ps1','data/../../private.ps1','C:/private.ps1'])assert.throws(()=>stage({sourceRoot,targetRoot,files:[relative]}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
