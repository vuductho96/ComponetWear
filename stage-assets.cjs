// Copy only the publisher's explicit, already validated public manifest.
const fs=require('node:fs');
const path=require('node:path');
function stage({sourceRoot,targetRoot,files}){
  const source=path.resolve(sourceRoot),target=path.resolve(targetRoot),dirs=new Set();
  const stats={linked:0,copied:0};
  for(const relative of files){
    if(typeof relative!=='string'||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..')||relative.includes(':'))throw Error('Invalid staging path');
    const from=path.resolve(source,relative),to=path.resolve(target,relative);
    if(!from.startsWith(source+path.sep)||!to.startsWith(target+path.sep))throw Error('Staging path escaped root');
    const parent=path.dirname(to);
    if(!dirs.has(parent)){fs.mkdirSync(parent,{recursive:true});dirs.add(parent);}
    if(/^data\/inspection\/(?:drawings\/[a-f0-9]{64}-v[0-9]+-p[0-9]{4}\.webp|downloads\/[a-f0-9]{64}\.(?:pdf|xlsx|xlsm))$/.test(relative)){
      try{fs.linkSync(from,to);stats.linked++;continue;}catch(error){if(error.code==='EEXIST')throw error;}
    }
    fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);stats.copied++;
  }
  return stats;
}
module.exports={stage};
if(require.main===module){let input='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{try{process.stdout.write(JSON.stringify(stage(JSON.parse(input))));}catch(error){console.error(error.message);process.exitCode=1;}});}
