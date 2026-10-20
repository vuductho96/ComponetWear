const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('Rapid generated source and browser report preserve the same samples and judgements',async()=>{
  const root=path.resolve(__dirname,'..'),dir=path.join(root,'.cloud-publish/measurement-pipeline');
  const expected=JSON.parse(fs.readFileSync(path.join(dir,'expected.json'),'utf8'));
  const spec=JSON.parse(fs.readFileSync(path.join(root,'.cloud-publish/report-native-test/expected.json'),'utf8'));
  const {chromium}=require('C:/Users/415/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();await page.goto('about:blank');
    for(const file of ['jszip.min.js','inspection-report.js'])await page.addScriptTag({path:path.join(root,'ComponentLife/js',file)});
    const result=await page.evaluate(async({source,template,spec,count})=>{
      const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
      const report=await InspectionReports.build(bytes(source),bytes(template),spec,{file:'source.xlsx'});
      const zip=await JSZip.loadAsync(await report.blob.arrayBuffer());
      const doc=new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml');
      const cells=new Map(Array.from(doc.getElementsByTagNameNS('*','c')).map(c=>[c.getAttribute('r'),c]));
      const val=a=>{const c=cells.get(a);return c?.getElementsByTagNameNS('*','v')[0]?.textContent??c?.getElementsByTagNameNS('*','t')[0]?.textContent??'';};
      return {rows:Array.from({length:count},(_,i)=>['B','C','D','F','P'].map(c=>val(c+(spec.first+i)))),sample:val('F'+spec.header),file:Array.from(new Uint8Array(await report.blob.arrayBuffer()))};
    },{source:fs.readFileSync(path.join(dir,'source.xlsx')).toString('base64'),template:fs.readFileSync(spec.template).toString('base64'),spec:spec.spec,count:expected.length});
    assert.equal(result.sample,'11');
    result.rows.forEach((row,i)=>{
      assert.equal(row[4],expected[i][4],`point ${i+1} judgement`);
      if(Number.isFinite(Number(row[3]))&&Number.isFinite(Number(expected[i][3])))assert.equal(Number(row[3]),Number(expected[i][3]),`point ${i+1} actual numeric value`);
      else assert.equal(row[3],expected[i][3],`point ${i+1} actual text is preserved`);
    });
    fs.writeFileSync(path.join(dir,'browser.xlsx'),Buffer.from(result.file));
  }finally{await browser.close();}
});
