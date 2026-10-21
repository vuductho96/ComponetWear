/* Convert source workbooks to the currently published form entirely in the browser. */
(() => {
  'use strict';
  const M='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const P='http://schemas.openxmlformats.org/package/2006/relationships';
  const C='http://schemas.openxmlformats.org/package/2006/content-types';
  const parser=new DOMParser(), serializer=new XMLSerializer();
  const all=(node,name,ns=M)=>Array.from(node.getElementsByTagNameNS(ns,name));
  const one=(node,name,ns=M)=>all(node,name,ns)[0] || null;
  const xml=text=>{const doc=parser.parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw Error('Không đọc được cấu trúc Excel.');return doc;};
  const col=index=>{let name='';for(;index;index=Math.floor((index-1)/26))name=String.fromCharCode(65+(index-1)%26)+name;return name;};
  const colIndex=name=>Array.from(name).reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const cellMap=doc=>new Map(all(one(doc,'sheetData'),'c').map(cell=>[cell.getAttribute('r'),cell]));
  const path=(base,target)=>{const parts=(target.startsWith('/')?target.slice(1):base.slice(0,base.lastIndexOf('/')+1)+target).split('/'),result=[];for(const p of parts){if(p==='..')result.pop();else if(p&&p!=='.')result.push(p);}return result.join('/');};
  const el=(doc,name,attributes={},text=null,ns=M)=>{const node=doc.createElementNS(ns,name);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==null)node.textContent=String(text);return node;};
  const serialize=node=>serializer.serializeToString(node);
  const text=(zip,name)=>{const entry=zip.file(name);if(!entry)throw Error('File Excel thiếu thành phần '+name);return entry.async('string');};

  function numeric(value){
    if(value===null||value===undefined||String(value).trim()==='')return null;
    let t=String(value).trim().toUpperCase().replaceAll(',','.').replace(/[′’ʹ]/g,"'").replace(/[″”ʺ]/g,'"').replaceAll("''",'"').replaceAll('º','°').replaceAll('−','-').replace(/PHI|[RCØΦϕ⌀\s]/g,'');
    if(/^[+-]?\d+(?:\.\d+)?°\d+(?:\.\d+)?'\d+(?:\.\d+)?'$/.test(t))t=t.slice(0,-1)+'"';
    if(t.includes('°')){
      const match=t.match(/^([+-]?\d+(?:\.\d+)?)°(?:(\d+(?:\.\d+)?)'(?:(\d+(?:\.\d+)?)")?)?$/);
      if(!match)return null;
      const [,d,m='0',s='0']=match;if(Number(m)>=60||Number(s)>=60)return null;
      return (t.startsWith('-')?-1:1)*(Math.abs(Number(d))+Number(m)/60+Number(s)/3600);
    }
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/.test(t))return null;
    const n=Number(t);return Number.isFinite(n)?n:null;
  }
  function result(row){
    const actual=row.slice(5).filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='').map(numeric);
    if(!actual.length)return '';
    const [n,a,b]=row.slice(1,4).map(numeric);
    if(/[°º]/.test(String(row[1])+(row.sourceFormats?.[1]||''))&&(/['"′″ʹʺ]/.test(String(row[1]))||row.slice(2,4).every(v=>v==null||String(v).trim()==='')))return n===null||actual.some(v=>v===null||Math.trunc(v)!==Math.trunc(n))?'NG':'OK';
    if([n,a,b,...actual].includes(null))return 'NG';
    const lo=n+Math.min(a,b),hi=n+Math.max(a,b);
    return actual.some(v=>v<lo-0.0000001||v>hi+0.0000001)?'NG':'OK';
  }
  function sheetNames(pages){
    const span=values=>{const labels=values.filter(v=>v!==null&&v!==undefined&&String(v).trim()!=='').map(v=>String(v).trim());return labels.length?labels[0]===labels.at(-1)?labels[0]:labels[0]+'-'+labels.at(-1):'';};
    const bases=pages.map((page,i)=>{const points=span(page.rows.map(row=>row[0]));return points?'Inspection '+points:'Inspection '+(i+1);});
    const counts=new Map(),used=new Set();
    bases.forEach(name=>counts.set(name.toLowerCase(),(counts.get(name.toLowerCase())||0)+1));
    return bases.map((base,i)=>{
      const samples=span(pages[i].samples);
      const label=(base+(counts.get(base.toLowerCase())>1&&samples?' S'+samples:'')).replace(/[\[\]\\/:*?'\u0000-\u001f]/g,'-');
      let name=label.slice(0,31),n=2;
      while(used.has(name.toLowerCase())){const suffix=' ('+(n++)+')';name=label.slice(0,31-suffix.length)+suffix;}
      used.add(name.toLowerCase());return name;
    });
  }
  async function packageInfo(zip){
    const workbook=xml(await text(zip,'xl/workbook.xml'));
    const rels=xml(await text(zip,'xl/_rels/workbook.xml.rels'));
    const targets=new Map(all(rels,'Relationship',P).map(node=>[node.getAttribute('Id'),node.getAttribute('Target')]));
    const strings=zip.file('xl/sharedStrings.xml')?all(xml(await text(zip,'xl/sharedStrings.xml')),'si').map(node=>all(node,'t').map(t=>t.textContent).join('')):[];
    const styles=zip.file('xl/styles.xml')?xml(await text(zip,'xl/styles.xml')):null;
    const formats=new Map(styles?all(styles,'numFmt').map(n=>[n.getAttribute('numFmtId'),n.getAttribute('formatCode')]):[]);
    const sourceXfs=styles?Array.from(one(styles,'cellXfs')?.children||[]):[];
    const builtins={'0':'General','1':'0','2':'0.00','3':'#,##0','4':'#,##0.00'};
    const formatOf=cell=>{const id=sourceXfs[Number(cell?.getAttribute('s')||0)]?.getAttribute('numFmtId')||'0';return formats.get(id)||builtins[id]||'General';};
    function value(cell,preserveNumber=false){
      if(!cell)return null;
      if(cell.getAttribute('t')==='inlineStr')return all(cell,'t').map(t=>t.textContent).join('');
      const v=one(cell,'v');if(!v)return null;
      const t=cell.getAttribute('t');
      if(t==='s')return strings[Number(v.textContent)]??'';
      if(t==='str'||t==='e')return v.textContent;
      if(t==='b')return v.textContent==='1'?'TRUE':'FALSE';
      if(v.textContent.trim()==='')return null;
      const n=Number(v.textContent),format=formats.get(sourceXfs[Number(cell.getAttribute('s')||0)]?.getAttribute('numFmtId'))||'';
      if(preserveNumber&&Number.isFinite(n))return n;
      const prefix=format.match(/^"([RCØΦ⌀])"/);
      return Number.isFinite(n)?(/[°º]/.test(format)?n+'°':prefix?prefix[1]+n:n):v.textContent;
    }
    const sheets=all(workbook,'sheet').map(node=>({node,path:path('xl/workbook.xml',targets.get(node.getAttributeNS(R,'id')))}));
    return {workbook,rels,strings,sheets,value,formatOf};
  }
  async function sourceGroups(zip,record){
    const pkg=await packageInfo(zip),groups=[];
    const labels={'parts name':'part','mold name':'mold','date/':'date','department/':'department','materia':'material','hrc':'hrc','qty/':'quantity'};
    const base={part:record.part||'',mold:record.mold||'',date:record.measuredDate||''};
    let recognized=false,firstFields=null;
    for(const info of pkg.sheets){
      const doc=xml(await text(zip,info.path)),cells=cellMap(doc);
      const heading=Array.from(cells.values()).find(cell=>{
        const value=norm(pkg.value(cell)),r=cell.getAttribute('r').match(/\d+/)[0];
        return (value.includes('point/')||value==='point'||value==='diem')&&norm(pkg.value(cells.get('B'+r))).includes('nominal');
      });
      if(!heading)continue;
      recognized=true;const header=Number(heading.getAttribute('r').match(/\d+/)[0]),fields={...base};
      for(const cell of cells.values()){
        const address=cell.getAttribute('r'),r=Number(address.match(/\d+/)[0]);if(r>=header)continue;
        const label=Object.keys(labels).find(key=>norm(pkg.value(cell)).startsWith(key));if(!label)continue;
        for(let c=colIndex(address.match(/^[A-Z]+/)[0])+1;c<=16;c++){
          const value=pkg.value(cells.get(col(c)+r));if(value===null||String(value).trim()==='')continue;
          if(Object.keys(labels).some(key=>norm(value).startsWith(key)))break;
          fields[labels[label]]=value;break;
        }
      }
      firstFields??=fields;
      let columns=[];
      for(let c=6;c<=100;c++){
        const value=pkg.value(cells.get(col(c)+header));
        if(value!==null&&/^#?\d+$/.test(String(value)))columns.push([c,value]);
        else if(value!==null&&String(value).trim()!=='')break;
      }
      if(!columns.length)columns=Array.from({length:10},(_,i)=>[i+6,i+1]);
      const rows=[];
      for(const row of all(one(doc,'sheetData'),'row')){
        const r=Number(row.getAttribute('r'));if(r<=header)continue;
        const point=pkg.value(cells.get('A'+r)),nominal=pkg.value(cells.get('B'+r));
        if(point===null||!/^\d+/.test(String(point))||nominal===null)continue;
        rows.push([r,Array.from({length:5},(_,i)=>pkg.value(cells.get(col(i+1)+r),i>=1&&i<=3))]);
      }
      if(!rows.length)continue;
      for(let offset=0;offset<columns.length;offset+=10){
        const batch=columns.slice(offset,offset+10),samples=batch.map(([,n])=>n);
        while(samples.length<10)samples.push(null);
        groups.push({fields,samples,rows:rows.map(([r,prefix])=>{const values=[...prefix,...batch.map(([c])=>pkg.value(cells.get(col(c)+r)))];while(values.length<15)values.push(null);values.sourceFormats=Array.from({length:4},(_,i)=>pkg.formatOf(cells.get(col(i+1)+r)));return values;})});
      }
    }
    if(!recognized)throw Error('Không nhận diện được bảng điểm đo của file nguồn. Chưa tạo file để tránh điền sai dữ liệu.');
    return groups.length?groups:[{fields:firstFields||base,samples:Array.from({length:10},(_,i)=>i+1),rows:[]}];
  }

  function templateLayout(pkg,doc){
    const cells=cellMap(doc),pos=a=>[colIndex(a.match(/^[A-Z]+/)[0]),Number(a.match(/\d+/)[0])];
    const label=v=>norm(v??'').replaceAll('đ','d').replace(/\s+/g,' ').trim();
    const entries=Array.from(cells,([address,cell])=>({address,c:pos(address)[0],r:pos(address)[1],text:label(pkg.value(cell))}));
    const merges=all(doc,'mergeCell').map(n=>{const [a,b]=n.getAttribute('ref').split(':').map(pos);return [...a,...b];});
    const extent=e=>merges.find(m=>m[0]===e.c&&m[1]===e.r)||[e.c,e.r,e.c,e.r];
    const matches=(text,words)=>words.some(word=>text===word||['/',' ',':'].some(separator=>text.startsWith(word+separator)));
    const points=entries.filter(e=>matches(e.text,['point','diem'])&&entries.some(n=>n.r===e.r&&matches(n.text,['nominal','nomial','danh nghia'])));
    if(!points.length)throw Error('Template thiếu tiêu đề Point và Nominal trên cùng hàng.');
    if(points.length!==1)throw Error('Template có nhiều bảng Point/Nominal trên cùng sheet.');
    const point=points[0];
    const nearby=entries.filter(e=>e.r>=point.r&&e.r<=point.r+2),find=words=>nearby.find(e=>matches(e.text,words));
    const nominal=find(['nominal','nomial','danh nghia']),tool=find(['tool','dung cu']),remark=find(['remark','ghi chu']),tolerance=find(['tol','tolerance','dung sai']);
    if(!nominal||!tool||!remark||!tolerance)throw Error('Template cần có Nominal, Tol/Dung sai, Tool và Remark/Ghi chú.');
    const tol=extent(tolerance),signs=new Map(nearby.filter(e=>e.c>=tol[0]&&e.c<=tol[2]&&['-','−','+'].includes(e.text)).map(e=>[e.text.replace('−','-'),e.c]));
    if(!signs.has('-')||!signs.has('+'))throw Error('Không nhận diện được hai cột Tol - và + của template.');
    const samples=Array.from({length:Math.max(0,remark.c-tool.c-1)},(_,i)=>tool.c+i+1);
    if(samples.length!==10)throw Error('Template cần 10 cột Sample liên tiếp giữa Tool và Remark.');
    let headerEnd=Math.max(...[point,nominal,tool,remark,tolerance].map(e=>extent(e)[3]));
    for(const e of nearby)if(e.c>=samples[0]&&e.c<=samples.at(-1)&&(/details|chi tiet/.test(e.text)))headerEnd=Math.max(headerEnd,extent(e)[3]);
    const first=headerEnd+1,footer=entries.filter(e=>e.r>=first&&['ngoai quan','appearance','luu y:','prepare by'].some(word=>e.text.includes(word))).sort((a,b)=>a.r-b.r)[0];
    let last=footer?footer.r-1:first-1;
    if(!footer)while(cells.has(col(remark.c)+(last+1))&&one(cells.get(col(remark.c)+(last+1)),'f'))last++;
    if(last<first)throw Error('Không xác định được cuối vùng điểm đo; cần dòng Ngoại quan/Appearance hoặc công thức Remark.');
    const targets={},aliases={part:['parts name','part name','ten linh kien'],mold:['mold name','ten khuon'],date:['date','ngay kiem tra'],department:['department','bo phan'],material:['materia','material','nguyen lieu'],hrc:['hrc','do cung'],quantity:['qty','quantity','so luong']};
    for(const e of entries.filter(e=>e.r<point.r))for(const [field,words] of Object.entries(aliases))if(matches(e.text,words)||(field==='hrc'&&e.text.startsWith('hrc'))){
      const address=col(extent(e)[2]+1)+e.r;
      if(targets[field]&&targets[field]!==address)throw Error('Template có nhiều vùng '+field+', không tự chọn để tránh điền sai.');
      targets[field]=address;
    }
    const judgementLabel=entries.find(e=>e.r<point.r&&matches(e.text,['judgement','judgment','ket luan']));
    const judgement=judgementLabel?col(judgementLabel.c)+(extent(judgementLabel)[3]+1):Array.from(cells).find(([,cell])=>one(cell,'f')?.textContent.includes('COUNTIF('))?.[0];
    if(!judgement)throw Error('Template thiếu ô Judgement/Kết luận.');
    let sampleHeader=point.r,best=-1;
    for(let r=point.r;r<=headerEnd;r++){const score=samples.filter(c=>/^#?\d+$/.test(String(pkg.value(cells.get(col(c)+r))))).length;if(score>best){best=score;sampleHeader=r;}}
    const columns=[point.c,nominal.c,signs.get('-'),signs.get('+'),tool.c,...samples];
    const appearanceRow=entries.filter(e=>e.r>last&&['ngoai quan','appearance'].some(word=>e.text.includes(word))).sort((a,b)=>a.r-b.r)[0]?.r??null;
    return {header:sampleHeader,first,last,columns,remarkColumn:remark.c,helperColumn:Math.max(...columns,remark.c)+2,targets,judgement,appearanceRow};
  }

  async function build(sourceBytes,templateBytes,spec,record={}){
    if(spec?.schemaVersion!==1||!Number.isInteger(spec.first)||spec.last<spec.first||spec.cleanFormulas?.length!==13||spec.numberFormulas?.length!==13)throw Error('Template chưa sẵn sàng. Hãy Publish lại.');
    const [source,zip]=await Promise.all([JSZip.loadAsync(sourceBytes),JSZip.loadAsync(templateBytes)]);
    const [groups,pkg]=await Promise.all([sourceGroups(source,record),packageInfo(zip)]);
    if(pkg.sheets.length!==1)throw Error('Template có thêm sheet chưa được cấu hình.');
    const template=pkg.sheets[0],templateDoc=xml(await text(zip,template.path));
    const formulaSpec=spec;
    spec={...spec,...templateLayout(pkg,templateDoc)};
    const insertAt=spec.last+1,insertCount=Math.max(0,40-(spec.last-spec.first+1)),expanded=insertCount>0;
    if(expanded){
      const shift=ref=>ref.replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g,(_,c,r)=>c+(Number(r)>=insertAt?Number(r)+insertCount:r));
      const data=one(templateDoc,'sheetData'),lastRow=all(data,'row').find(row=>Number(row.getAttribute('r'))===spec.last);
      for(const row of all(data,'row'))if(Number(row.getAttribute('r'))>=insertAt){
        row.setAttribute('r',Number(row.getAttribute('r'))+insertCount);
        for(const cell of all(row,'c'))cell.setAttribute('r',shift(cell.getAttribute('r')));
      }
      for(const node of all(templateDoc,'mergeCell'))node.setAttribute('ref',shift(node.getAttribute('ref')));
      for(const node of all(templateDoc,'brk'))if(Number(node.getAttribute('id'))>=insertAt)node.setAttribute('id',Number(node.getAttribute('id'))+insertCount);
      for(const node of all(pkg.workbook,'definedName'))node.textContent=shift(node.textContent);
      for(let r=insertAt;r<insertAt+insertCount;r++){
        const row=lastRow.cloneNode(true);row.setAttribute('r',r);
        for(const cell of all(row,'c')){cell.setAttribute('r',cell.getAttribute('r').replace(/\d+$/,r));cell.replaceChildren();cell.removeAttribute('t');}
        data.append(row);
      }
      spec.last+=insertCount;
      if(spec.appearanceRow)spec.appearanceRow+=insertCount;
    }
    const columns=spec.columns,remark=spec.remarkColumn,helper=spec.helperColumn;
    const rawColumns=[...columns.slice(1,4),...columns.slice(5)];
    const formula=(pattern,raw,cleaned,r)=>pattern.replace(/([A-Z]+)@ROW@/g,(_,c)=>col(c===(formulaSpec.formulaBase?.rawColumn||'B')?raw:c===(formulaSpec.formulaBase?.cleanColumn||'R')?cleaned:colIndex(c))+r);
    const templateText=serialize(templateDoc),capacity=40,pages=[];
    for(const group of groups)for(let offset=0;offset<Math.max(1,group.rows.length);offset+=capacity)pages.push({...group,rows:group.rows.slice(offset,offset+capacity)});
    const names=sheetNames(pages),results=pages.flatMap(page=>page.rows.map(result));
    const judgement=results.includes('NG')?'REJECTED':results.includes('OK')?'PASSED':'';
    const styles=xml(await text(zip,'xl/styles.xml')),xfs=one(styles,'cellXfs');let formats=one(styles,'numFmts');
    if(!formats){formats=el(styles,'numFmts',{count:0});styles.documentElement.insertBefore(formats,styles.documentElement.firstChild);}
    const formatCache=new Map();let nextFormat=Math.max(163,...all(formats,'numFmt').map(n=>Number(n.getAttribute('numFmtId'))))+1;
    function style(base,code){
      const key=base+'|'+code;if(formatCache.has(key))return formatCache.get(key);
      const id=nextFormat++;formats.append(el(styles,'numFmt',{numFmtId:id,formatCode:code}));formats.setAttribute('count',formats.children.length);
      const xf=xfs.children[Number(base)].cloneNode(true);xf.setAttribute('numFmtId',id);xf.setAttribute('applyNumberFormat','1');
      const index=xfs.children.length;xfs.append(xf);xfs.setAttribute('count',xfs.children.length);formatCache.set(key,index);return index;
    }
    const fonts=one(styles,'fonts'),emphasisCache=new Map(),fontCache=new Map();
    function emphasis(base,bold){
      const key=base+'|'+bold;if(emphasisCache.has(key))return emphasisCache.get(key);
      const xf=xfs.children[Number(base)].cloneNode(true),fontId=Number(xf.getAttribute('fontId')||0),fontKey=fontId+'|'+bold;
      if(!fontCache.has(fontKey)){
        const font=fonts.children[fontId].cloneNode(true);
        for(const b of all(font,'b'))b.remove();
        if(bold)font.append(el(styles,'b'));
        fontCache.set(fontKey,fonts.children.length);fonts.append(font);fonts.setAttribute('count',fonts.children.length);
      }
      xf.setAttribute('fontId',fontCache.get(fontKey));xf.setAttribute('applyFont','1');
      const index=xfs.children.length;xfs.append(xf);xfs.setAttribute('count',xfs.children.length);emphasisCache.set(key,index);return index;
    }
    const types=xml(await text(zip,'[Content_Types].xml')),sheets=one(pkg.workbook,'sheets');sheets.replaceChildren();
    for(const rel of all(pkg.rels,'Relationship',P))if(['/worksheet','/calcChain'].some(s=>rel.getAttribute('Type').endsWith(s)))rel.remove();
    for(const item of all(types,'Override',C))if(item.getAttribute('PartName').startsWith('/xl/worksheets/')||item.getAttribute('PartName')==='/xl/calcChain.xml')item.remove();
    let rid=Math.max(0,...all(pkg.rels,'Relationship',P).map(r=>Number(r.getAttribute('Id').replace(/^rId/,''))||0))+1;
    const originalRels=template.path.replace('worksheets/','worksheets/_rels/')+'.rels';
    const relText=zip.file(originalRels)?await text(zip,originalRels):null;
    const defined=one(pkg.workbook,'definedNames'),definedCopies=defined?Array.from(defined.children).map(n=>n.cloneNode(true)):[];
    if(defined)defined.replaceChildren();
    for(let pageIndex=0;pageIndex<pages.length;pageIndex++){
      const page=pages[pageIndex],doc=xml(templateText),data=one(doc,'sheetData'),cells=cellMap(doc),rowMap=new Map(all(data,'row').map(row=>[Number(row.getAttribute('r')),row]));
      const put=(address,value=null,formula=null,code=null)=>{
        const rowNumber=Number(address.match(/\d+/)[0]);let row=rowMap.get(rowNumber);if(!row){row=el(doc,'row',{r:rowNumber});data.append(row);rowMap.set(rowNumber,row);}
        let cell=cells.get(address);if(!cell){cell=el(doc,'c',{r:address});row.append(cell);cells.set(address,cell);}
        cell.replaceChildren();cell.removeAttribute('t');if(code)cell.setAttribute('s',style(cell.getAttribute('s')||'0',code));
        if(formula){cell.append(el(doc,'f',{},formula));if(typeof value==='string')cell.setAttribute('t','str');cell.append(el(doc,'v',{},value??''));}
        else if(value!==null&&value!==undefined&&value!==''){
          if(typeof value==='number')cell.append(el(doc,'v',{},value));
          else{cell.setAttribute('t','inlineStr');const str=el(doc,'is'),t=el(doc,'t',{},value);if(/^\s|\s$/.test(String(value)))t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');str.append(t);cell.append(str);}
        }
      };
      for(const [field,address] of Object.entries(spec.targets))put(address,page.fields[field],null,field==='date'&&typeof page.fields[field]==='number'?'dd/mm/yyyy':null);
      page.samples.forEach((sample,i)=>put(col(columns[i+5])+spec.header,sample));
      if(spec.appearanceRow)columns.slice(5).forEach((column,i)=>{
        const measured=page.rows.some(row=>row[i+5]!=null&&String(row[i+5]).trim()!=='');
        put(col(column)+spec.appearanceRow,measured?'OK':'');
      });
      for(let r=spec.first;r<=spec.last;r++){
        const values=page.rows[r-spec.first]||Array(15).fill(null);
        values.forEach((value,i)=>{
          const code=i>=5?'0.000':i>=1&&i<=3?(values.sourceFormats?.[i]||'General'):null;
          // Excel ignores numeric formats on text cells. Convert only plain decimal
          // samples; keep dimension prefixes and degree/minute/second text intact.
          if(i>=5&&typeof value==='string'&&/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))value=numeric(value);
          put(col(columns[i])+r,typeof value==='string'&&i!==4?value.replace(/phi/gi,'Ø'):value,null,code);
        });
        const raw=[values[1],values[2],values[3],...values.slice(5)];
        raw.forEach((value,i)=>{
          const clean=String(value??'').trim().toUpperCase().replace(/PHI|[RCØΦϕ⌀\s]/g,'').replaceAll(',','.').replace(/[′’ʹ]/g,"'").replace(/[″”ʺ]/g,'"').replaceAll("''",'"').replaceAll('º','°').replaceAll('−','-');
          put(col(helper+i)+r,clean,formula(formulaSpec.cleanFormulas[0],rawColumns[i],helper+i,r));
          put(col(helper+13+i)+r,numeric(value)??'',formula(formulaSpec.numberFormulas[0],rawColumns[i],helper+i,r),'0.###############');
        });
        const [n,a,b]=raw.slice(0,3).map(numeric),valid=![n,a,b].includes(null),lo=col(helper+26)+r,hi=col(helper+27)+r;
        const [nr,ar,br]=[13,14,15].map(i=>col(helper+i)+r),actuals=col(helper+16)+r+':'+col(helper+25)+r;
        put(lo,valid?n+Math.min(a,b):'',`IF(COUNT(${nr}:${br})=3,${nr}+MIN(${ar}:${br}),"")`,'0.###############');
        put(hi,valid?n+Math.max(a,b):'',`IF(COUNT(${nr}:${br})=3,${nr}+MAX(${ar}:${br}),"")`,'0.###############');
        const sampleRange=col(columns[5])+r+':'+col(columns.at(-1))+r,count=`COLUMNS(${sampleRange})-COUNTBLANK(${sampleRange})`;
        const cleaned=col(helper)+r;
        const standard=`IF(OR(COUNT(${nr}:${br})<3,COUNT(${actuals})<>(${count})),"NG",IF(OR(MIN(${actuals})<${lo}-0.0000001,MAX(${actuals})>${hi}+0.0000001),"NG","OK"))`;
        const dms=`AND(OR(ISNUMBER(SEARCH("°",${cleaned})),${/[°º]/.test(String(values[1])+(values.sourceFormats?.[1]||''))?'TRUE':'FALSE'}),OR(ISNUMBER(SEARCH("'",${cleaned})),AND(${col(helper+1)+r}="",${col(helper+2)+r}="")))`;
        const degrees=`IF(OR(COUNT(${nr})<1,COUNT(${actuals})<>(${count})),"NG",IF(AND(TRUNC(MIN(${actuals}))=TRUNC(${nr}),TRUNC(MAX(${actuals}))=TRUNC(${nr})),"OK","NG"))`;
        put(col(remark)+r,result(values),`IF((${count})=0,"",IF(${dms},${degrees},${standard}))`);
        const repeated=values.slice(5).some((value,i)=>Number(String(page.samples[i]).replace(/^#/,''))>=2&&value!==null&&value!==undefined&&String(value).trim()!=='');
        for(const c of [...columns,remark]){
          const cell=cells.get(col(c)+r);if(cell)cell.setAttribute('s',emphasis(cell.getAttribute('s')||'0',repeated&&columns.slice(0,4).includes(c)));
        }
      }
      ['Nominal','Tolerance 1','Tolerance 2',...page.samples.map(n=>'Sample '+(n??''))].forEach((label,i)=>put(col(helper+13+i)+spec.header,label));
      const counts=status=>names.map(name=>`COUNTIF('${name}'!${col(remark)}${spec.first}:${col(remark)}${spec.last},"${status}")`).join('+');
      put(spec.judgement,judgement,`IF((${counts('NG')})>0,"REJECTED",IF((${counts('OK')})>0,"PASSED",""))`);
      let cols=one(doc,'cols');if(!cols){cols=el(doc,'cols');data.parentNode.insertBefore(cols,data);}
      for(const node of Array.from(cols.children)){if(Number(node.getAttribute('min'))>=helper)node.remove();else if(Number(node.getAttribute('max'))>=helper)node.setAttribute('max',helper-1);}
      cols.append(el(doc,'col',{min:helper,max:helper+27,width:18,customWidth:1,hidden:1,outlineLevel:1}));
      one(doc,'dimension')?.setAttribute('ref','A1:'+col(helper+27)+Math.max(...rowMap.keys()));
      for(const row of rowMap.values())row.replaceChildren(...Array.from(row.children).sort((a,b)=>colIndex(a.getAttribute('r').match(/^[A-Z]+/)[0])-colIndex(b.getAttribute('r').match(/^[A-Z]+/)[0])));
      data.replaceChildren(...Array.from(rowMap.entries()).sort((a,b)=>a[0]-b[0]).map(([,row])=>row));
      one(doc,'sheetPr')?.removeAttribute('codeName');
      const sheetPath=`xl/worksheets/sheet${pageIndex+1}.xml`;
      zip.file(sheetPath,serialize(doc));
      if(relText){
        const rels=xml(relText);
        for(const rel of all(rels,'Relationship',P))if(rel.getAttribute('Type').endsWith('/drawing')){
          const original=path(template.path,rel.getAttribute('Target')),clone=`xl/drawings/report${pageIndex+1}.xml`;
          if(expanded){
            const drawing=xml(await zip.file(original).async('string'));
            for(const row of all(drawing,'row','http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'))if(Number(row.textContent)>=insertAt-1)row.textContent=Number(row.textContent)+insertCount;
            zip.file(clone,serialize(drawing));
          }else zip.file(clone,await zip.file(original).async('uint8array'));
          const originalDrawingRels=original.replace('drawings/','drawings/_rels/')+'.rels';
          if(zip.file(originalDrawingRels))zip.file(clone.replace('drawings/','drawings/_rels/')+'.rels',await zip.file(originalDrawingRels).async('uint8array'));
          rel.setAttribute('Target',`../drawings/report${pageIndex+1}.xml`);
          types.documentElement.append(el(types,'Override',{PartName:'/'+clone,ContentType:'application/vnd.openxmlformats-officedocument.drawing+xml'},null,C));
        }
        zip.file(`xl/worksheets/_rels/sheet${pageIndex+1}.xml.rels`,serialize(rels));
      }
      const sheet=el(pkg.workbook,'sheet',{name:names[pageIndex],sheetId:pageIndex+1});sheet.setAttributeNS(R,'r:id','rId'+rid);sheets.append(sheet);
      pkg.rels.documentElement.append(el(pkg.rels,'Relationship',{Id:'rId'+rid++,Type:R+'/worksheet',Target:`worksheets/sheet${pageIndex+1}.xml`},null,P));
      types.documentElement.append(el(types,'Override',{PartName:'/'+sheetPath,ContentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml'},null,C));
      for(const old of definedCopies){const name=old.cloneNode(true);name.setAttribute('localSheetId',pageIndex);name.textContent=name.textContent.replaceAll("'"+template.node.getAttribute('name').replaceAll("'","''")+"'!","'"+names[pageIndex]+"'!");defined.append(name);}
      if(pageIndex%2===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    let calc=one(pkg.workbook,'calcPr');if(!calc){calc=el(pkg.workbook,'calcPr');pkg.workbook.documentElement.append(calc);}for(const [key,value] of Object.entries({calcMode:'auto',fullCalcOnLoad:1,forceFullCalc:1}))calc.setAttribute(key,value);
    zip.remove('xl/calcChain.xml');
    zip.file('xl/workbook.xml',serialize(pkg.workbook));zip.file('xl/_rels/workbook.xml.rels',serialize(pkg.rels));zip.file('[Content_Types].xml',serialize(types));zip.file('xl/styles.xml',serialize(styles));
    return {blob:await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}}),name:(record.file||'Inspection').replace(/\.(xlsx|xlsm)$/i,'')+'.xlsx',pages:pages.length};
  }
  window.InspectionReports={build,numeric,result};
})();
