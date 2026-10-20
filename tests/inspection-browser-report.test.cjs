const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const python=process.env.COMPONENTLIFE_TEST_PYTHON||path.join(root,'.cloud-publish/python-runtime/Scripts/python.exe');
test('browser conversion preserves template and recalculates source updates without uploading reports', {skip:!fs.existsSync(python)},async()=>{
  execFileSync(python,[path.join(__dirname,'inspection-report.tests.py'),'--native-fixture'],{cwd:root});
  const fixture=path.join(root,'.cloud-publish/report-native-test');
  const expected=JSON.parse(fs.readFileSync(path.join(fixture,'expected.json'),'utf8'));
  const {chromium}=require('playwright');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({path:path.join(root,'ComponentLife/js/jszip.min.js')});
    await page.addScriptTag({path:path.join(root,'ComponentLife/js/inspection-report.js')});
    const outcome=await page.evaluate(async({source,template,movedTemplate,expected})=>{
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
        const numFmts=new Map(Array.from(styles.getElementsByTagNameNS('*','numFmt')).map(n=>[n.getAttribute('numFmtId'),n.getAttribute('formatCode')]));
        const addresses=['B','C','D','F','G','H','I'].map(c=>c+expected.first);
        const precision={values:addresses.map(value),formats:addresses.map(a=>numFmts.get(xfs.children[Number(cell(a).getAttribute('s')||0)].getAttribute('numFmtId'))||'General'),types:addresses.map(a=>cell(a).getAttribute('t'))};
        const bold=address=>{const xf=xfs.children[Number(cell(address).getAttribute('s')||0)],font=fonts.children[Number(xf.getAttribute('fontId')||0)];return font.getElementsByTagNameNS('*','b').length>0;};
        return {zip,precision,bold:Array.from({length:16},(_,i)=>bold(String.fromCharCode(65+i)+expected.first)),values:expected.cases.map((_,i)=>value('P'+(expected.first+i))),judgement:value(expected.spec.judgement),sample:value('F'+expected.spec.header),nominals:expected.cases.map((_,i)=>value('B'+(expected.first+i)))};
      };
      const report=await make(sourceBytes),initial=await read(report);
      // Deliberately reuse the OLD coordinates/formulas with a relocated template.
      // The browser must discover the new form instead of trusting those addresses.
      const movedReport=await InspectionReports.build(sourceBytes,bytes(movedTemplate),expected.spec,record);
      const movedZip=await JSZip.loadAsync(await movedReport.blob.arrayBuffer());
      const movedDoc=new DOMParser().parseFromString(await movedZip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml');
      const movedCells=new Map(Array.from(movedDoc.getElementsByTagNameNS('*','c')).map(c=>[c.getAttribute('r'),c]));
      const movedValue=a=>movedCells.get(a)?.getElementsByTagNameNS('*','v')[0]?.textContent??movedCells.get(a)?.getElementsByTagNameNS('*','t')[0]?.textContent??'';
      const adapted={part:movedValue('E14'),judgement:movedValue('R17'),values:expected.cases.map((_,i)=>movedValue('R'+(23+i))),formula:movedCells.get('R23').getElementsByTagNameNS('*','f')[0].textContent,point:movedValue('C23'),header:movedValue('H21'),minus:movedValue('F23'),plus:movedValue('E23')};
      const invalidZip=await JSZip.loadAsync(bytes(movedTemplate));
      const invalidDoc=new DOMParser().parseFromString(await invalidZip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml');
      Array.from(invalidDoc.getElementsByTagNameNS('*','c')).find(c=>c.getAttribute('r')==='D21').replaceChildren();
      invalidZip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(invalidDoc));
      let invalidError='';try{await InspectionReports.build(sourceBytes,await invalidZip.generateAsync({type:'uint8array'}),expected.spec,record);}catch(e){invalidError=e.message;}
      // Custom dimension formats must survive without converting their numeric
      // values to text; decimal samples stored as text still need three places.
      const precisionZip=await JSZip.loadAsync(sourceBytes);
      const precisionStyles=new DOMParser().parseFromString(await precisionZip.file('xl/styles.xml').async('string'),'application/xml');
      const precisionDoc=new DOMParser().parseFromString(await precisionZip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml');
      const precisionXfs=precisionStyles.getElementsByTagNameNS('*','cellXfs')[0],precisionFormats=precisionStyles.getElementsByTagNameNS('*','numFmts')[0];
      const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
      const sourceCells=new Map(Array.from(precisionDoc.getElementsByTagNameNS(ns,'c')).map(c=>[c.getAttribute('r'),c]));
      for(const [i,[c,v,format,isText]] of [['B','0.3','"R"0.00',false],['C','-0.01','0.00',false],['D','0','0',false],['F','0.3',null,true],['G','0,300',null,true],['H','0',null,false],['I','36°13\'22"',null,true]].entries()){
        const cell=sourceCells.get(c+expected.first);cell.replaceChildren();cell.removeAttribute('t');
        if(format){
          const num=precisionStyles.createElementNS(ns,'numFmt');num.setAttribute('numFmtId',1000+i);num.setAttribute('formatCode',format);precisionFormats.append(num);
          const xf=precisionXfs.children[0].cloneNode(true);xf.setAttribute('numFmtId',1000+i);xf.setAttribute('applyNumberFormat','1');cell.setAttribute('s',precisionXfs.children.length);precisionXfs.append(xf);
        }
        if(isText){cell.setAttribute('t','inlineStr');const s=precisionDoc.createElementNS(ns,'is'),t=precisionDoc.createElementNS(ns,'t');t.textContent=v;s.append(t);cell.append(s);}
        else{const n=precisionDoc.createElementNS(ns,'v');n.textContent=v;cell.append(n);}
      }
      precisionFormats.setAttribute('count',precisionFormats.children.length);precisionXfs.setAttribute('count',precisionXfs.children.length);
      precisionZip.file('xl/styles.xml',new XMLSerializer().serializeToString(precisionStyles));precisionZip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(precisionDoc));
      const precision=(await read(await make(await precisionZip.generateAsync({type:'uint8array'})))).precision;
      const namingZip=await JSZip.loadAsync(sourceBytes);
      const namingDoc=new DOMParser().parseFromString(await namingZip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml');
      const data=namingDoc.getElementsByTagNameNS(ns,'sheetData')[0];
      const seed=Array.from(data.children).find(row=>row.getAttribute('r')===String(expected.first)).cloneNode(true);
      for(const row of Array.from(data.children))if(Number(row.getAttribute('r'))>=expected.first)row.remove();
      for(let point=1;point<=50;point++){
        const row=seed.cloneNode(true),r=expected.first+point-1;row.setAttribute('r',r);
        for(const cell of row.children)cell.setAttribute('r',cell.getAttribute('r').replace(/\d+$/,r));
        const first=row.children[0];first.replaceChildren();first.removeAttribute('t');const v=namingDoc.createElementNS(ns,'v');v.textContent=point;first.append(v);data.append(row);
      }
      const header=Array.from(data.children).find(row=>row.getAttribute('r')===String(expected.spec.header));
      const setHeader=(column,label)=>{let cell=Array.from(header.children).find(c=>c.getAttribute('r')===column+expected.spec.header);if(!cell){cell=namingDoc.createElementNS(ns,'c');cell.setAttribute('r',column+expected.spec.header);header.append(cell);}cell.replaceChildren();cell.removeAttribute('t');const v=namingDoc.createElementNS(ns,'v');v.textContent=label;cell.append(v);};
      for(let i=0;i<10;i++)setHeader(String.fromCharCode(70+i),i+1);
      const named=async()=>{
        namingZip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(namingDoc));
        const report=await make(await namingZip.generateAsync({type:'uint8array'})),zip=await JSZip.loadAsync(await report.blob.arrayBuffer());
        const book=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml');
        const names=Array.from(book.getElementsByTagNameNS(ns,'sheet')).map(sheet=>sheet.getAttribute('name'));
        const sheets=await Promise.all(names.map((_,i)=>zip.file('xl/worksheets/sheet'+(i+1)+'.xml').async('string')));
        const first=parseSheet(sheets[0]);
        function parseSheet(value){return new DOMParser().parseFromString(value,'application/xml');}
        const firstCells=new Map(Array.from(first.getElementsByTagNameNS(ns,'c')).map(c=>[c.getAttribute('r'),c]));
        const strings=Array.from(parseSheet(await zip.file('xl/sharedStrings.xml').async('string')).getElementsByTagNameNS(ns,'si')).map(s=>Array.from(s.getElementsByTagNameNS(ns,'t')).map(t=>t.textContent).join(''));
        const v=a=>{const cell=firstCells.get(a),raw=cell?.getElementsByTagNameNS(ns,'v')[0]?.textContent??cell?.getElementsByTagNameNS(ns,'t')[0]?.textContent??'';return cell?.getAttribute('t')==='s'?strings[Number(raw)]:raw;};
        const drawing=parseSheet(await zip.file('xl/drawings/report1.xml').async('string'));
        return {names,point40:v('A59'),footer:v('A60'),signature:v('A64'),dimension:first.getElementsByTagNameNS(ns,'dimension')[0].getAttribute('ref'),printAreas:Array.from(book.getElementsByTagNameNS(ns,'definedName')).map(n=>n.textContent),anchors:Array.from(drawing.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing','row')).map(n=>Number(n.textContent)),refs:sheets.every(sheet=>names.every(name=>sheet.includes("'"+name+"'!")))};
      };
      const namedPoints=await named();
      for(let i=0;i<10;i++)setHeader(String.fromCharCode(80+i),i+11);
      const namedSamples=await named();
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
      return {invalidError,adapted,namedPoints,namedSamples,precision,repeatedBold:initial.bold,singleBold:single.bold,name:report.name,values:initial.values,sample:initial.sample,nominals:initial.nominals,preserved,good:[good.values[0],good.judgement],bad:[bad.values[0],bad.judgement],oneRow:oneRow.values[0],file:Array.from(new Uint8Array(await report.blob.arrayBuffer()))};
    },{source:fs.readFileSync(path.join(fixture,'source.xlsx')).toString('base64'),template:fs.readFileSync(expected.template).toString('base64'),movedTemplate:fs.readFileSync(expected.movedTemplate).toString('base64'),expected});
    assert.equal(outcome.name,'source.xlsx');
    assert.deepEqual(outcome.repeatedBold,Array.from({length:16},(_,i)=>i<4));assert.ok(outcome.singleBold.every(b=>!b));
    assert.deepEqual(outcome.precision.values,['0.3','-0.01','0','0.3','0.3','0','36°13\'22"']);
    assert.deepEqual(outcome.precision.formats,['"R"0.00','0.00','0','0.000','0.000','0.000','0.000']);
    assert.deepEqual(outcome.precision.types,[null,null,null,null,null,null,'inlineStr']);
    assert.deepEqual(outcome.namedPoints.names,['Inspection 1-40','Inspection 41-50']);assert.ok(outcome.namedPoints.refs);
    assert.equal(outcome.namedPoints.point40,'40');assert.match(outcome.namedPoints.footer,/Appearance/);assert.match(outcome.namedPoints.signature,/Prepare by/);
    assert.equal(outcome.namedPoints.dimension,'A1:AS65');assert.ok(outcome.namedPoints.printAreas.every(a=>a.endsWith('$P$65')));
    assert.ok(outcome.namedPoints.anchors.includes(63));assert.ok(!outcome.namedPoints.anchors.includes(62));
    assert.deepEqual(outcome.namedSamples.names,['Inspection 1-40 S1-10','Inspection 41-50 S1-10','Inspection 1-40 S11-20','Inspection 41-50 S11-20']);assert.ok(outcome.namedSamples.refs);
    assert.equal(outcome.adapted.part,'TEST214');assert.equal(outcome.adapted.judgement,'REJECTED');assert.equal(outcome.adapted.point,'1');assert.equal(outcome.adapted.header,'11');
    assert.equal(outcome.adapted.minus,'+0.01');assert.equal(outcome.adapted.plus,'+0.02');
    assert.match(outcome.invalidError,/Point.*Nominal/);
    assert.deepEqual(outcome.adapted.values,expected.cases.map(c=>c[4]));assert.match(outcome.adapted.formula,/COUNT\(AG23:AI23\)/);assert.match(outcome.adapted.formula,/MIN\(AJ23:AS23\)/);
    assert.deepEqual(outcome.values,expected.cases.map(c=>c[4]));
    assert.equal(outcome.sample,'11');assert.ok(outcome.preserved>=11);
    assert.ok(outcome.nominals.every(n=>!/phi/i.test(n)));
    assert.deepEqual(outcome.good,['OK','PASSED']);assert.deepEqual(outcome.bad,['NG','REJECTED']);assert.equal(outcome.oneRow,'NG');
    fs.writeFileSync(path.join(fixture,'browser.xlsx'),Buffer.from(outcome.file));
    const degreeSource=path.join('C:/Users/415/Desktop/File đo linh kiện/đo tủ link kiên/Tháng 11/215-MF00521/Inspection 215-MF00521.xlsx');
    if(fs.existsSync(degreeSource)){
      const degree=await page.evaluate(async({source,template,spec})=>{
        const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
        const report=await InspectionReports.build(bytes(source),bytes(template),spec,{file:'215.xlsx'});
        const zip=await JSZip.loadAsync(await report.blob.arrayBuffer());
        for(const name of Object.keys(zip.files).filter(n=>/^xl\/worksheets\/sheet\d+.xml$/.test(n))){
          const doc=new DOMParser().parseFromString(await zip.file(name).async('string'),'application/xml');
          for(const row of doc.getElementsByTagNameNS('*','row')){
            const cells=Array.from(row.children),get=col=>cells.find(c=>c.getAttribute('r')===col+row.getAttribute('r'));
            if(Number(row.getAttribute('r'))>=spec.first&&get('A')?.textContent==='21'&&get('B')?.textContent)return [get('B')?.textContent,get('F')?.textContent];
          }
        }
      },{source:fs.readFileSync(degreeSource).toString('base64'),template:fs.readFileSync(expected.template).toString('base64'),spec:expected.spec});
      assert.deepEqual(degree,['1°','1°']);
    }
  }finally{await browser.close();}
});
