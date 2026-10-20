const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const python=path.join(root,'.cloud-publish/python-runtime/Scripts/python.exe');
test('browser conversion preserves template and recalculates source updates without uploading reports', {skip:!fs.existsSync(python)},async()=>{
  execFileSync(python,[path.join(__dirname,'inspection-report.tests.py'),'--native-fixture'],{cwd:root});
  const fixture=path.join(root,'.cloud-publish/report-native-test');
  const expected=JSON.parse(fs.readFileSync(path.join(fixture,'expected.json'),'utf8'));
  const {chromium}=require('C:/Users/415/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({path:path.join(root,'ComponentLife/js/jszip.min.js')});
    await page.addScriptTag({path:path.join(root,'ComponentLife/js/inspection-report.js')});
    const outcome=await page.evaluate(async({source,template,expected})=>{
      const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
      const sourceBytes=bytes(source),templateBytes=bytes(template),record={file:'source.xlsm'};
      const make=data=>InspectionReports.build(data,templateBytes,expected.spec,record);
      const read=async report=>{
        const zip=await JSZip.loadAsync(await report.blob.arrayBuffer()),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
        const doc=new DOMParser().parseFromString(xml,'application/xml');
        const cell=address=>Array.from(doc.getElementsByTagNameNS('*','c')).find(c=>c.getAttribute('r')===address);
        const value=address=>{const node=cell(address);return node?.getElementsByTagNameNS('*','v')[0]?.textContent??node?.getElementsByTagNameNS('*','t')[0]?.textContent??'';};
        const styles=new DOMParser().parseFromString(await zip.file('xl/styles.xml').async('string'),'application/xml');
        const xfs=styles.getElementsByTagNameNS('*','cellXfs')[0],fonts=styles.getElementsByTagNameNS('*','fonts')[0];
        const bold=address=>{const xf=xfs.children[Number(cell(address).getAttribute('s')||0)],font=fonts.children[Number(xf.getAttribute('fontId')||0)];return font.getElementsByTagNameNS('*','b').length>0;};
        return {zip,bold:Array.from({length:16},(_,i)=>bold(String.fromCharCode(65+i)+expected.first)),values:expected.cases.map((_,i)=>value('P'+(expected.first+i))),judgement:value(expected.spec.judgement),sample:value('F'+expected.spec.header),nominals:expected.cases.map((_,i)=>value('B'+(expected.first+i)))};
      };
      const report=await make(sourceBytes),initial=await read(report);
      const templateZip=await JSZip.loadAsync(templateBytes);let preserved=0;
      for(const name of Object.keys(templateZip.files).filter(n=>n.startsWith('xl/media/')&&!templateZip.files[n].dir)){
        const a=await templateZip.file(name).async('base64'),b=await initial.zip.file(name).async('base64');if(a!==b)throw Error('Changed template image '+name);preserved++;
      }
      const sourceZip=await JSZip.loadAsync(sourceBytes),sourceDoc=new DOMParser().parseFromString(await sourceZip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml');
      const M='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const cells=Array.from(sourceDoc.getElementsByTagNameNS(M,'c'));
      for(const cell of cells){const r=Number(cell.getAttribute('r').match(/\d+/)[0]),c=cell.getAttribute('r').match(/^[A-Z]+/)[0];if(r>expected.first&&r<=expected.spec.last&&c.length===1&&c<='O')cell.replaceChildren();}
      const actual=cells.find(c=>c.getAttribute('r')==='F'+expected.first);
      const set=value=>{actual.replaceChildren();actual.removeAttribute('t');const v=sourceDoc.createElementNS(M,'v');v.textContent=value;actual.append(v);sourceZip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(sourceDoc));};
      set('0.41');const good=await read(await make(await sourceZip.generateAsync({type:'uint8array'})));
      set('0.43');const bad=await read(await make(await sourceZip.generateAsync({type:'uint8array'})));
      // A one-row source header must not lose its first measurement.
      const firstRow=Array.from(sourceDoc.getElementsByTagNameNS(M,'row')).find(r=>r.getAttribute('r')===String(expected.first));
      const previousRow=Array.from(sourceDoc.getElementsByTagNameNS(M,'row')).find(r=>r.getAttribute('r')===String(expected.first-1));
      for(const cell of Array.from(firstRow.children).filter(c=>/^[A-O]\d+$/.test(c.getAttribute('r')))){
        const address=cell.getAttribute('r').replace(/\d+$/,expected.first-1);const old=Array.from(previousRow.children).find(c=>c.getAttribute('r')===address);old?.remove();cell.setAttribute('r',address);previousRow.append(cell);
      }
      sourceZip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(sourceDoc));
      const oneRow=await read(await make(await sourceZip.generateAsync({type:'uint8array'})));
      const sampleCell=cells.find(c=>c.getAttribute('r')==='F'+expected.spec.header);sampleCell.replaceChildren();sampleCell.removeAttribute('t');const sampleValue=sourceDoc.createElementNS(M,'v');sampleValue.textContent='1';sampleCell.append(sampleValue);
      sourceZip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(sourceDoc));
      const single=await read(await make(await sourceZip.generateAsync({type:'uint8array'})));
      return {repeatedBold:initial.bold,singleBold:single.bold,name:report.name,values:initial.values,sample:initial.sample,nominals:initial.nominals,preserved,good:[good.values[0],good.judgement],bad:[bad.values[0],bad.judgement],oneRow:oneRow.values[0],file:Array.from(new Uint8Array(await report.blob.arrayBuffer()))};
    },{source:fs.readFileSync(path.join(fixture,'source.xlsx')).toString('base64'),template:fs.readFileSync(expected.template).toString('base64'),expected});
    assert.equal(outcome.name,'source.xlsx');
    assert.ok(outcome.repeatedBold.every(Boolean));assert.ok(outcome.singleBold.every(b=>!b));
    assert.deepEqual(outcome.values,expected.cases.map(c=>c[4]));
    assert.equal(outcome.sample,'11');assert.ok(outcome.preserved>=11);
    assert.ok(outcome.nominals.every(n=>!/phi/i.test(n)));
    assert.deepEqual(outcome.good,['OK','PASSED']);assert.deepEqual(outcome.bad,['NG','REJECTED']);assert.equal(outcome.oneRow,'NG');
    fs.writeFileSync(path.join(fixture,'browser.xlsx'),Buffer.from(outcome.file));
  }finally{await browser.close();}
});
