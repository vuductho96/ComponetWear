import {processRows} from './dimension-parser.js';
import {annotationGeometry,positionAnnotations,paintAnnotation,clampPoint} from './iqc-annotations.js?v=20261020-iqc';
import * as pdfjs from './vendor/pdf.mjs';
import {crop} from './inference.js';
import {OcrClient} from './ocr-client.js';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const MIN_ZOOM=.22,MAX_ZOOM=8;
const $=id=>document.getElementById(id),engine=new OcrClient(status),drawing=$('drawing');let pdf=null,image=null,rows=[],busy=false,cancel=false,scale=1,fileName='',selected=-1;
function status(s){const messages={'Rendering drawing…':'Đang mở bản vẽ…','Drawing ready. Extract numbers to begin.':'Bản vẽ đã sẵn sàng. Nhận dạng OCR hoặc đánh số điểm để bắt đầu.','Reading selected region…':'Đang nhận dạng vùng đã chọn…','Đang chuẩn bị OCR…':'Đang chuẩn bị OCR…','Numbers copied.':'Đã sao chép bảng kích thước.','Drawing and results removed from this session.':'Đã đóng bản vẽ và xóa phiên kiểm tra.','Geometry parser enabled. Flagged OCR can be included in settings.':'Đã bật chuẩn hóa kích thước và dung sai.','Original OCR shown. Geometry cleanup is off.':'Đang hiển thị nguyên bản kết quả OCR.','Flagged OCR included in results and export.':'Đã hiện cả kết quả cần kiểm tra lại.','Flagged OCR excluded from results and export.':'Đã ẩn kết quả cần kiểm tra lại.','Manual crop added as original OCR. Parser is not applied.':'Đã thêm điểm từ vùng chọn. Hãy đối chiếu với bản vẽ.'};s=messages[s]||s;$('status').textContent=s;$('ocr-stage').textContent=s;}
function setOcrRunning(active){if(active)$('ocr-stage').textContent='Đang chuẩn bị OCR…';$('ocr-activity').hidden=!active;vp.setAttribute('aria-busy',String(active));}
function yieldToPaint(){return new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));});}
export function discardDrawing(){const oldPdf=pdf;pdf=null;if(image&&image!==drawing&&typeof image.close==='function')image.close();image=null;rows=[];selected=-1;fileName='';drawing.width=0;drawing.height=0;$('file').value='';$('filename').textContent='Chưa chọn bản vẽ';$('page').replaceChildren(new Option('1','1'));$('sheet').hidden=true;$('empty').hidden=false;$('dimensions').textContent='Chưa có bản vẽ';$('zoom').textContent='100%';update();if(oldPdf)oldPdf.destroy().catch(()=>{});}
function buttons(){ $('extract').disabled=busy||!image;$('extract').querySelector('span').textContent=busy?'Đang đọc…':'Nhận dạng OCR';$('file').disabled=busy;$('discard').disabled=busy||!image;$('page').disabled=busy||!pdf;$('clear').disabled=busy||!rows.length;$('download-drawing').disabled=busy||!image;$('csv').disabled=busy||!exportRows().length;$('copy').disabled=busy||!exportRows().length;$('zoomout').disabled=!image||scale<=MIN_ZOOM;$('zoomin').disabled=!image||scale>=MAX_ZOOM;$('fit').disabled=!image;$('fit-width').disabled=!image;$('geometry-parser').disabled=busy;$('parser-toolbar').disabled=busy;$('include-flagged').disabled=busy;$('point-mode').disabled=busy||!image;$('crop-mode').disabled=busy||!image;renderInspector();}
function fit(){scale=Math.min(1,($('viewport').clientWidth-40)/drawing.width,Math.max(100,$('viewport').clientHeight-40)/drawing.height);resize();}
function resize(){scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,scale));$('zoomout').disabled=scale<=MIN_ZOOM;$('zoomin').disabled=scale>=MAX_ZOOM; $('sheet').style.width=drawing.width*scale+'px';$('sheet').style.height=drawing.height*scale+'px';$('zoom').textContent=Math.round(scale*100)+'%';renderAnnotations();}
async function render(){status('Rendering drawing…');if(pdf){const p=await pdf.getPage(Number($('page').value)),base=p.getViewport({scale:1}),vp=p.getViewport({scale:Math.min(3,3500/Math.max(base.width,base.height))});drawing.width=Math.ceil(vp.width);drawing.height=Math.ceil(vp.height);await p.render({canvasContext:drawing.getContext('2d'),viewport:vp}).promise;}else{drawing.width=image.width;drawing.height=image.height;drawing.getContext('2d').drawImage(image,0,0);}image=drawing;$('empty').hidden=true;$('sheet').hidden=false;$('dimensions').textContent=`${drawing.width} × ${drawing.height} px`;rows=[];selected=-1;update();fit();status('Drawing ready. Extract numbers to begin.');buttons();}
export async function open(file){if(!file||busy)return;if(file.size>50*1024*1024){status('Please choose a file smaller than 50 MB.');return;}busy=true;buttons();try{discardDrawing();fileName=file.name;$('filename').textContent=fileName;pdf=null;const bytes=await file.arrayBuffer();if(/\.pdf$/i.test(file.name)){pdf=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;$('page').replaceChildren(...Array.from({length:pdf.numPages},(_,i)=>new Option(String(i+1),String(i+1))));}else if(/^image\/(png|jpeg|webp)$/.test(file.type)){image=await createImageBitmap(new Blob([bytes],{type:file.type}));if(image.width*image.height>30000000){image.close();throw Error('Image is too large. Resize it below 30 megapixels.');}$('page').replaceChildren(new Option('1','1'));}else throw Error('Choose a PDF, PNG, JPG or WebP drawing.');await render();}catch(e){status('Could not open drawing: '+e.message);}finally{busy=false;buttons();$('file').value='';}}
$('file').onchange=e=>open(e.target.files[0]);$('page').onchange=async()=>{busy=true;buttons();try{await render();}catch(e){status(e.message);}finally{busy=false;buttons();}};
const vp=$('viewport');vp.ondragover=e=>{e.preventDefault();vp.classList.add('dragover');};vp.ondragleave=()=>vp.classList.remove('dragover');vp.ondrop=e=>{e.preventDefault();vp.classList.remove('dragover');open(e.dataTransfer.files[0]);};
function annotationOptions(){return {radius:Number($('balloon-size').value)/Math.max(.01,scale)/2,lineWidth:Number($('leader-width').value),dashed:$('leader-style').value==='dashed',leaders:$('show-leaders').checked,balloons:$('show-balloons').checked};}
function renderAnnotations(){
 const svg=$('iqc-balloons');svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${drawing.width||1} ${drawing.height||1}`);
 if(!image||!rows.length)return;
 const options=annotationOptions(),ns='http://www.w3.org/2000/svg';
 const element=(name,attrs={},text)=>{const n=document.createElementNS(ns,name);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
 rows.forEach((r,i)=>{
  if(r.flagged&&!$('include-flagged').checked)return;
  const g=annotationGeometry(r,drawing.width,drawing.height,options.radius),active=i===selected,color=active?'#f59e0b':'#2563eb',label=String(i+1).padStart(2,'0');
  const group=element('g',{'class':'iqc-annotation'+(r.excluded?' is-excluded':''),'data-index':i,'tabindex':0,'role':'button','aria-label':`Điểm ${label}: ${r.nominal||'chưa nhập kích thước'}`});
  if(options.leaders){
   group.append(element('polyline',{points:[g.edge,g.elbow,g.anchor].map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:color,'stroke-width':options.lineWidth,'stroke-dasharray':options.dashed?'7 5':'none','vector-effect':'non-scaling-stroke'}));
   group.append(element('polygon',{points:g.arrow.map(p=>`${p.x},${p.y}`).join(' '),fill:color}));
  }
  if(options.balloons){
   const handle=element('g',{'data-drag':'balloon'});
   handle.append(element('circle',{cx:g.balloon.x,cy:g.balloon.y,r:g.radius,fill:'white',stroke:color,'stroke-width':options.lineWidth,'vector-effect':'non-scaling-stroke','class':'iqc-balloon-circle'}));
   handle.append(element('text',{x:g.balloon.x,y:g.balloon.y,'text-anchor':'middle','dominant-baseline':'central','font-size':g.radius*.86,fill:color,'class':'iqc-balloon-text'},label));group.append(handle);
  }
  if(active&&options.leaders){
   const size=7/scale;group.append(element('rect',{x:g.elbow.x-size/2,y:g.elbow.y-size/2,width:size,height:size,'data-drag':'elbow','class':'iqc-handle'}));
   group.append(element('circle',{cx:g.anchor.x,cy:g.anchor.y,r:4/scale,'data-drag':'anchor','class':'iqc-handle'}));
  }
  svg.append(group);
 });
}
function renderInspector(){
 const r=rows[selected],label=String(selected+1).padStart(2,'0');
 $('iqc-selected-title').textContent=r?'Điểm '+label:'Chú thích bản vẽ';
 $('iqc-point-label').value=r?label:'—';
 $('iqc-point-type').textContent=r?(r.manual?'Điểm nhập thủ công':`OCR · Độ tin cậy ${Math.round(r.confidence*100)}%`):'Đường dóng & bong bóng';
 $('iqc-delete').disabled=busy||!r;$('iqc-reset').disabled=busy||!r;
}
function select(i){
 selected=i;if(document.querySelector('.workspace').classList.contains('results-hidden'))$('toggle-results').click();
 Array.from($('rows').children).forEach((r,j)=>r.classList.toggle('selected',i===j));
 Array.from($('boxes').children).forEach((b,j)=>b.classList.toggle('selected',i===j));
 $('rows').children[i]?.scrollIntoView({block:'nearest'});renderAnnotations();renderInspector();
 if(rows[i])status(`Điểm ${String(i+1).padStart(2,'0')} · ${rows[i].nominal||'Nhập kích thước tại phiếu kiểm tra.'}`);
}
function displayedRows(){return rows.filter(r=>!r.flagged||$('include-flagged').checked);}
function exportRows(){return displayedRows().filter(r=>!r.excluded);}
function removeRow(i){if(busy||!rows[i])return;rows.splice(i,1);selected=rows.length?Math.min(i,rows.length-1):-1;update();status('Đã xóa điểm đo và đánh lại số.');}
function update(){
 processRows(rows,$('geometry-parser').checked);const visible=exportRows().length,displayed=displayedRows().length;
 $('count').textContent=visible;$('toggle-results').textContent=rows.length?`Phiếu (${visible}/${rows.length})`:'Phiếu kiểm tra';
 $('results').hidden=!displayed;$('result-empty').hidden=!!displayed;
 $('result-empty').querySelector('h3').textContent=rows.length&&!displayed?'Kết quả cần kiểm tra lại':'Chưa có điểm kiểm tra';
 $('result-empty').querySelector('p').textContent=rows.length&&!visible?'Bật “Hiện cả kết quả cần kiểm tra lại” trong thiết lập OCR.':'Chọn “Đánh số điểm” rồi bấm lên bản vẽ, hoặc dùng OCR để nhận dạng kích thước.';
 $('rows').replaceChildren();$('boxes').replaceChildren();$('boxes').hidden=!$('showboxes').checked;
 rows.forEach((r,i)=>{
  const label=String(i+1).padStart(2,'0'),tr=document.createElement('tr');tr.hidden=r.flagged&&!$('include-flagged').checked;tr.dataset.point=String(i+1);tr.classList.toggle('flagged',!!r.flagged);tr.classList.toggle('selected',i===selected);tr.classList.toggle('excluded',!!r.excluded);tr.title=r.flagReason||r.note||'';
  const num=document.createElement('td'),choose=document.createElement('input'),number=document.createElement('span');
  choose.type='checkbox';choose.disabled=busy;choose.checked=!r.excluded;choose.setAttribute('aria-label',`Bao gồm điểm ${label}`);choose.onclick=e=>e.stopPropagation();choose.onchange=()=>{r.excluded=!choose.checked;update();};
  number.textContent=label;num.append(choose,number);num.style.cursor='pointer';num.onclick=()=>select(i);tr.append(num);
  for(const key of ['nominal','lower','upper']){
   const td=document.createElement('td'),input=document.createElement('input');input.value=r[key]||'';input.disabled=busy;
   input.setAttribute('aria-label',`${{nominal:'Danh nghĩa',lower:'Tol âm',upper:'Tol dương'}[key]} điểm ${label}`);
   input.title='OCR gốc: '+(r.original?.[key==='nominal'?'raw':key]||r.original?.[key]||'');
   input.oninput=()=>{r[key]=input.value;r.userEdited=true;r.flagged=false;r.flagReason='';tr.classList.remove('flagged');renderAnnotations();};input.onfocus=()=>select(i);td.append(input);tr.append(td);
  }
  const confidence=document.createElement('td');confidence.textContent=r.manual?'—':Math.round(r.confidence*100);if(!r.manual&&r.confidence<.8)confidence.style.color='#b78531';tr.append(confidence);
  const del=document.createElement('td'),btn=document.createElement('button');btn.textContent='×';btn.setAttribute('aria-label',`Xóa điểm ${label}`);btn.disabled=busy;btn.onclick=()=>removeRow(i);del.append(btn);tr.append(del);$('rows').append(tr);
  const box=document.createElement('div');box.className='box'+(i===selected?' selected':'');box.hidden=r.flagged&&!$('include-flagged').checked;box.classList.toggle('flagged',!!r.flagged);box.classList.toggle('excluded',!!r.excluded);
  Object.assign(box.style,{left:r.x/drawing.width*100+'%',top:r.y/drawing.height*100+'%',width:r.w/drawing.width*100+'%',height:r.h/drawing.height*100+'%'});
  box.onclick=()=>select(i);box.ondblclick=e=>{e.stopPropagation();zoomToBox(i);};box.tabIndex=0;box.setAttribute('role','button');box.setAttribute('aria-label',`Điểm ${label}: ${r.nominal}`);box.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();select(i);}};$('boxes').append(box);
 });
 positionAnnotations(rows,drawing.width,drawing.height,annotationOptions().radius);renderAnnotations();renderInspector();buttons();
}
let annotationDrag=null;
$('iqc-balloons').addEventListener('pointerdown',e=>{
 const handle=e.target.closest('[data-drag]');if(!handle||busy||e.button!==0)return;
 e.preventDefault();e.stopPropagation();const i=Number(handle.closest('[data-index]').dataset.index);select(i);
 annotationDrag={i,kind:handle.dataset.drag};$('iqc-balloons').setPointerCapture(e.pointerId);
});
$('iqc-balloons').addEventListener('pointermove',e=>{if(!annotationDrag)return;e.preventDefault();e.stopPropagation();const r=rows[annotationDrag.i];if(!r)return;const point=drawingPoint(e);r[annotationDrag.kind]=clampPoint(point,drawing.width,drawing.height,annotationDrag.kind==='balloon'?annotationOptions().radius+3:0);renderAnnotations();});
const stopAnnotationDrag=e=>{if(!annotationDrag)return;e.stopPropagation();annotationDrag=null;if($('iqc-balloons').hasPointerCapture(e.pointerId))$('iqc-balloons').releasePointerCapture(e.pointerId);};
$('iqc-balloons').addEventListener('pointerup',stopAnnotationDrag);$('iqc-balloons').addEventListener('pointercancel',stopAnnotationDrag);$('iqc-balloons').addEventListener('lostpointercapture',()=>annotationDrag=null);
$('iqc-balloons').addEventListener('keydown',e=>{const group=e.target.closest('[data-index]');if(group&&(e.key==='Enter'||e.key===' ')){e.preventDefault();select(Number(group.dataset.index));}});
for(const id of ['show-balloons','show-leaders','balloon-size','leader-style','leader-width'])$(id).addEventListener('change',renderAnnotations);
$('iqc-delete').onclick=()=>removeRow(selected);$('iqc-reset').onclick=()=>{const r=rows[selected];if(!r)return;delete r.balloon;delete r.anchor;delete r.elbow;positionAnnotations(rows,drawing.width,drawing.height,annotationOptions().radius);renderAnnotations();};
function addInspectionPoint(point){
 const size=Math.max(8,12/scale);rows.push({x:Math.max(0,point.x-size/2),y:Math.max(0,point.y-size/2),w:size,h:size,anchor:point,nominal:'',upper:'',lower:'',raw:'',confidence:1,manual:true,userEdited:true});selected=rows.length-1;update();select(selected);$('rows').children[selected]?.querySelector('input[aria-label^="Danh nghĩa"]')?.focus({preventScroll:true});
}
$('extract').onclick=async()=>{busy=true;cancel=false;setOcrRunning(true);buttons();$('progress').hidden=false;$('progress').value=0;const old=rows;let next=[];try{await yieldToPaint();await engine.extract(drawing,Number($('threshold').value),(r,i,total)=>{next.push(r);rows=next;update();$('progress').value=i/total*100;},()=>cancel);rows=next;update();status(rows.length?`Complete — ${exportRows().length} included, ${rows.length-exportRows().length} flagged. Review values before exporting.`:'No dimension numbers detected. Try a clearer drawing or lower detection confidence.');}catch(e){rows=old;update();console.error(e);status('Extraction failed: '+e.message+'. You can retry.');}finally{busy=false;setOcrRunning(false);$('progress').hidden=true;update();}};
$('clear').onclick=()=>{rows=[];selected=-1;update();status('Đã xóa toàn bộ điểm kiểm tra.');};$('showboxes').onchange=e=>$('boxes').hidden=!e.target.checked;$('fit').onclick=fit;$('zoomin').onclick=()=>zoomAt(scale*1.25);$('zoomout').onclick=()=>zoomAt(scale/1.25);$('threshold').oninput=e=>$('threshold-value').textContent=Math.round(e.target.value*100)+'%';
function csvCell(v){v=String(v);if(/^[=\t\r@]/.test(v)||/^[+-](?!\d)/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';}
$('csv').onclick=()=>{const data=[['Page','No','Nominal','Upper tolerance','Lower tolerance','Confidence'],...exportRows().map(r=>[$('page').value,rows.indexOf(r)+1,r.nominal,r.upper,r.lower,Math.round(r.confidence*100)+'%'])].map(r=>r.map(csvCell).join(',')).join('\r\n');const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\uFEFF'+data],{type:'text/csv;charset=utf-8'}));a.href=url;a.download=fileName.replace(/\.[^.]+$/,'')+'-numbers.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('CSV downloaded. This session stays available until refresh or Clear drawing.');};$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(exportRows().map(r=>[r.nominal,r.upper,r.lower].join('\t')).join('\n'));status('Numbers copied.');}catch{status('Clipboard unavailable. Use Export CSV.');}};
window.addEventListener('resize',()=>{if(image)resize();});

$('discard').onclick=()=>{discardDrawing();status('Drawing and results removed from this session.');};window.addEventListener('pagehide',discardDrawing);

let mode='pan',gesture=null,spaceHeld=false;
function fitWidth(){if(!image)return;scale=Math.min(1,(vp.clientWidth-40)/drawing.width);resize();vp.scrollLeft=0;vp.scrollTop=0;}
function zoomAt(next,x=vp.clientWidth/2,y=vp.clientHeight/2){if(!image)return;const rect=$('sheet').getBoundingClientRect(),vr=vp.getBoundingClientRect(),px=(vr.left+x-rect.left)/scale,py=(vr.top+y-rect.top)/scale;scale=Math.max(MIN_ZOOM,Math.min(MAX_ZOOM,next));resize();const after=$('sheet').getBoundingClientRect();vp.scrollLeft+=after.left+px*scale-(vr.left+x);vp.scrollTop+=after.top+py*scale-(vr.top+y);}
function zoomToBox(i){const r=rows[i];if(!r)return;select(i);zoomAt(Math.min(5,(vp.clientWidth-100)/r.w,(vp.clientHeight-100)/r.h));const sr=$('sheet').getBoundingClientRect(),vr=vp.getBoundingClientRect();vp.scrollLeft+=sr.left+(r.x+r.w/2)*scale-vr.left-vp.clientWidth/2;vp.scrollTop+=sr.top+(r.y+r.h/2)*scale-vr.top-vp.clientHeight/2;status(`Dimension ${i+1} selected. Edit its values in Results. Delete removes the box.`);}
function setMode(next){mode=next;$('point-mode').classList.toggle('active',next==='point');$('point-mode').setAttribute('aria-pressed',next==='point');vp.dataset.mode=next;$('pan-mode').classList.toggle('active',next==='pan');$('crop-mode').classList.toggle('active',next==='crop');$('pan-mode').setAttribute('aria-pressed',next==='pan');$('crop-mode').setAttribute('aria-pressed',next==='crop');$('crop-selection').hidden=true;status(next==='point'?'Bấm vào vị trí cần đo trên bản vẽ để tạo một điểm kiểm tra.':next==='crop'?'Kéo chọn vùng cần nhận dạng trên bản vẽ.':'Kéo để di chuyển. Cuộn chuột để thu phóng.');}
$('point-mode').onclick=()=>setMode('point');$('pan-mode').onclick=()=>setMode('pan');$('crop-mode').onclick=()=>setMode('crop');$('fit-width').onclick=fitWidth;vp.dataset.mode='pan';
vp.addEventListener('wheel',e=>{if(!image)return;e.preventDefault();const r=vp.getBoundingClientRect();zoomAt(scale*Math.exp(-Math.max(-160,Math.min(160,e.deltaY))*.003),e.clientX-r.left,e.clientY-r.top);},{passive:false});
function drawingPoint(e){const r=$('sheet').getBoundingClientRect();return{x:Math.max(0,Math.min(drawing.width,(e.clientX-r.left)/scale)),y:Math.max(0,Math.min(drawing.height,(e.clientY-r.top)/scale))};}
vp.addEventListener('pointerdown',e=>{if(!image||busy||![0,1].includes(e.button))return;if(e.target.closest('.box, #iqc-balloons [data-index]')&&!spaceHeld&&e.button===0&&mode==='pan')return;e.preventDefault();vp.focus({preventScroll:true});const kind=!spaceHeld&&e.button===0?mode:'pan';gesture={kind,x:e.clientX,y:e.clientY,left:vp.scrollLeft,top:vp.scrollTop,start:drawingPoint(e),moved:false};vp.setPointerCapture(e.pointerId);vp.classList.add('dragging');});
vp.addEventListener('pointermove',e=>{if(!gesture)return;const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;gesture.moved ||=Math.abs(dx)+Math.abs(dy)>4;if(gesture.kind==='pan'){vp.scrollLeft=gesture.left-dx;vp.scrollTop=gesture.top-dy;}else if(gesture.kind==='crop'){const p=drawingPoint(e),r=$('sheet').getBoundingClientRect(),v=vp.getBoundingClientRect(),x=Math.min(p.x,gesture.start.x),y=Math.min(p.y,gesture.start.y);Object.assign($('crop-selection').style,{left:r.left-v.left+vp.scrollLeft+x*scale+'px',top:r.top-v.top+vp.scrollTop+y*scale+'px',width:Math.abs(p.x-gesture.start.x)*scale+'px',height:Math.abs(p.y-gesture.start.y)*scale+'px'});$('crop-selection').hidden=false;}});
vp.addEventListener('pointerup',e=>{if(!gesture)return;const g=gesture,p=drawingPoint(e);gesture=null;vp.classList.remove('dragging');if(vp.hasPointerCapture(e.pointerId))vp.releasePointerCapture(e.pointerId);$('crop-selection').hidden=true;if(g.kind==='point'&&!g.moved){addInspectionPoint(p);}if(g.kind==='crop'&&g.moved){const b={x:Math.min(g.start.x,p.x),y:Math.min(g.start.y,p.y),w:Math.abs(g.start.x-p.x),h:Math.abs(g.start.y-p.y)};if(b.w>=5&&b.h>=5)readManualCrop(b);}});
vp.addEventListener('pointercancel',()=>{gesture=null;vp.classList.remove('dragging');$('crop-selection').hidden=true;});
async function readManualCrop(b){if(busy)return;busy=true;setOcrRunning(true);buttons();status('Reading selected region…');try{await yieldToPaint();const result=await engine.readCrop(crop(drawing,b,2));const nominal=result.text,upper='',lower='';if(!nominal.trim()){status('No text found in this region. Try a tighter selection.');return;}rows.push({...b,nominal,upper,lower,confidence:result.confidence,raw:result.text,manual:true});selected=rows.length-1;update();if(document.querySelector('.workspace').classList.contains('results-hidden'))$('toggle-results').click();select(selected);status('Manual crop added as original OCR. Parser is not applied.');}catch(e){status('Could not read this region: '+e.message);}finally{busy=false;setOcrRunning(false);update();}}
document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,button'))return;if(e.code==='Space'){spaceHeld=true;vp.classList.add('space-pan');if(image)e.preventDefault();}if(e.key==='Escape'){gesture=null;$('crop-selection').hidden=true;vp.classList.remove('dragging');setMode('pan');}if(e.key==='Delete'&&selected>=0&&!busy){removeRow(selected);}});document.addEventListener('keyup',e=>{if(e.code==='Space'){spaceHeld=false;vp.classList.remove('space-pan');}});window.addEventListener('blur',()=>{spaceHeld=false;gesture=null;vp.classList.remove('space-pan','dragging');});
$('toggle-results').onclick=()=>{const w=document.querySelector('.workspace'),hidden=w.classList.toggle('results-hidden');$('toggle-results').setAttribute('aria-expanded',String(!hidden));};
$('settings-toggle').onclick=()=>{const d=document.querySelector('details');d.open=!d.open;};
let dividing=false;$('divider').addEventListener('pointerdown',e=>{e.preventDefault();dividing=true;$('divider').setPointerCapture(e.pointerId);});$('divider').addEventListener('pointermove',e=>{if(!dividing)return;const r=document.querySelector('.panels').getBoundingClientRect(),width=Math.max(280,Math.min(600,r.width*.55,r.right-e.clientX));document.querySelector('.panels').style.setProperty('--results-width',width+'px');});$('divider').addEventListener('pointerup',()=>dividing=false);$('divider').addEventListener('pointercancel',()=>dividing=false);$('divider').addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const p=document.querySelector('.panels'),n=document.querySelector('aside').getBoundingClientRect().width+(e.key==='ArrowLeft'?20:-20);p.style.setProperty('--results-width',Math.max(280,Math.min(600,n))+'px');}});



buttons();

$('parser-toolbar').onchange=()=>{$('geometry-parser').checked=$('parser-toolbar').checked;$('geometry-parser').onchange();};
$('geometry-parser').onchange=()=>{$('parser-toolbar').checked=$('geometry-parser').checked;update();status($('geometry-parser').checked?'Geometry parser enabled. Flagged OCR can be included in settings.':'Original OCR shown. Geometry cleanup is off.');};$('include-flagged').onchange=()=>{update();status($('include-flagged').checked?'Flagged OCR included in results and export.':'Flagged OCR excluded from results and export.');};

window.addEventListener('pagehide',()=>engine.dispose());

$('download-drawing').onclick=()=>{
 if(busy||!image)return;
 const canvas=document.createElement('canvas');canvas.width=drawing.width;canvas.height=drawing.height;
 const ctx=canvas.getContext('2d');ctx.drawImage(drawing,0,0);const options=annotationOptions();
 exportRows().forEach(r=>paintAnnotation(ctx,annotationGeometry(r,drawing.width,drawing.height,options.radius),String(rows.indexOf(r)+1).padStart(2,'0'),{...options,lineWidth:options.lineWidth/scale}));
 const name=fileName.replace(/\.[^.]+$/,'')+'-IQC-trang-'+$('page').value+'.png';
 canvas.toBlob(blob=>{if(!blob){status('Không xuất được bản vẽ.');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);canvas.width=canvas.height=0;status('Đã tải bản vẽ PNG kèm bong bóng và đường dóng.');},'image/png');
};

discardDrawing();
