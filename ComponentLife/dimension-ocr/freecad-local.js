import * as THREE from 'three';
import {mountCodeWorkspace} from './freecad-code.js';
import {executionCode} from './freecad-code-model.js';
const $=id=>document.getElementById(id);
const text=(tag,value)=>Object.assign(document.createElement(tag),{textContent:value});
const title=name=>name.replace(/^freecad_/,'').split('_').map(s=>s[0].toUpperCase()+s.slice(1)).join(' ');
export function mountLocalFreecad({viewer,switchView,getSketch,updateTree}){
  let address='http://127.0.0.1:8766',key='',connected=false,local=false,busy=false,tools=[],snapshot=null,selected=null,face=null,info=null;
  const button=text('button','FreeCAD trên máy này');button.id='connect-freecad';button.className='ai-toolbar-button';
  document.querySelector('.cad-toolbar').append(button);
  const badge=text('span','Browser CAD');badge.className='fc-badge';button.after(badge);
  const dialog=document.createElement('dialog');dialog.className='fc-connect';dialog.innerHTML=`<form method="dialog"><h2>Kết nối FreeCAD trên máy bạn</h2><p>Website dùng FreeCAD trên máy này để dựng và sửa mô hình thật. Máy cần mở FreeCAD và chạy cầu nối cục bộ.</p><ol><li><a href="./downloads/FreeScan-FreeCAD-Bridge.zip" download>Tải cầu nối + macro</a>, giải nén.</li><li>Trong FreeCAD: Macro → Macros → chọn <b>FreeCAD-Web.FCMacro</b> → Execute.</li><li>Chạy <b>Start-FreeCAD-Web.ps1</b> bằng Node.js đã có. Không cài thêm EXE.</li><li>Mở <a href="http://127.0.0.1:8766/pair" target="_blank" rel="noopener">trang ghép nối trên máy</a>, bấm Connect FreeScan website.</li></ol><details><summary>Nhập kết nối thủ công</summary><label>Địa chỉ cầu nối<input id="fc-address" value="http://127.0.0.1:8766" autocomplete="off"></label><label>Mã ghép nối<input id="fc-key" type="password" autocomplete="off"></label></details><p class="fc-note">Chỉ ghép nối website bạn tin cậy: bộ lệnh MCP có thể chạy Python với quyền tài khoản máy bạn. Key chỉ giữ trong tab này; bản vẽ/mô hình nằm trên máy bạn. Trình duyệt có thể hỏi quyền truy cập mạng cục bộ.</p><div id="fc-connect-error" role="status"></div><div class="fc-actions"><button value="cancel">Đóng</button><button type="button" id="fc-do-connect" class="primary">Kết nối</button></div></form>`;
  document.body.append(dialog);button.onclick=()=>{if(connected)activate(!local);else dialog.showModal();};
  dialog.querySelector('h2').textContent='Kết nối FreeCAD · 2 bước';
  dialog.querySelector('form>p').textContent='Dùng FreeCAD đã cài trên máy. Không cần API key hoặc cài thêm EXE.';
  dialog.querySelector('ol').innerHTML='<li><a href="./downloads/FreeScan-FreeCAD-Bridge.zip" download>Tải bộ kết nối</a>, giải nén rồi bấm đúp <b>Ket-noi-FreeCAD.cmd</b>. Bộ kết nối tự tìm và mở FreeCAD kèm macro.</li><li>Trang ghép nối tự mở: bấm <b>Mở website và ghép nối</b>, rồi bấm <b>Kết nối</b> trong website.</li>';
  const localLink=document.createElement('a');localLink.href='http://127.0.0.1:8766/pair';localLink.target='_blank';localLink.rel='noopener';localLink.className='fc-pair-link';localLink.textContent='Đã chạy bộ kết nối → Mở trang ghép nối';dialog.querySelector('ol').after(localLink);
  const help=document.createElement('p');help.className='fc-note';help.textContent='Giữ cửa sổ bộ kết nối khi dùng. Nếu trình duyệt hỏi truy cập mạng cục bộ, hãy cho phép. Nếu không tìm thấy FreeCAD/Node, bộ kết nối sẽ báo rõ, không tự cài đặt.';localLink.after(help);
  const panel=document.createElement('section');panel.id='fc-panel';panel.hidden=true;
  panel.innerHTML=`<div class="fc-heading"><strong>FreeCAD · máy cá nhân</strong><button id="fc-refresh">Đồng bộ</button><button id="fc-disconnect">Ngắt</button></div><p id="fc-health" role="status">Chưa kết nối</p><div class="fc-actions"><button id="fc-new">Tài liệu mới</button><button id="fc-import">Mở file</button><input id="fc-upload" type="file" accept=".FCStd,.step,.stp,.stl,.iges,.igs,.dxf,.svg" hidden></div><div class="fc-actions"><button id="fc-save">FCStd</button><button id="fc-step">STEP</button><button id="fc-stl">STL</button></div><label>Nhóm công cụ<select id="fc-category"><option value="">Tất cả công cụ</option></select></label><label>Tìm lệnh<input id="fc-search" type="search" placeholder="Pad, Pocket, Constraint, Loft…"></label><select id="fc-tools" size="6" aria-label="FreeCAD tools"></select><div id="fc-command"></div><details open><summary>Đối tượng & tham số</summary><select id="fc-object" aria-label="Selected FreeCAD object"></select><p id="fc-selection"></p><div id="fc-properties"></div></details><details><summary>Kết quả / lịch sử lệnh</summary><pre id="fc-output"></pre></details>`;
  document.querySelector('.tasks-dock').append(panel);
  const tree=document.createElement('div');tree.id='fc-tree';tree.hidden=true;$('model-tree').after(tree);
  const quick=document.createElement('div');quick.className='tool-group fc-quick';quick.hidden=true;
  for(const [label,cmd]of [['Sketch XY','new-sketch'],['Đoạn','line'],['HCN','rectangle'],['Tròn','circle'],['Đóng Sketch','finish']]){
    const b=text('button',label);b.onclick=()=>{switchView('sketch');document.dispatchEvent(new CustomEvent('cad-command',{detail:cmd}));};quick.append(b);
  }
  const transfer=text('button','Sketch → FreeCAD');transfer.onclick=()=>withBusy(transferSketch);quick.append(transfer);
  for(const name of ['pad','pocket','hole','partdesign_fillet','partdesign_chamfer']){const b=text('button',title(name));b.onclick=()=>choose('freecad_'+name);quick.append(b);}
  document.querySelector('.cad-toolbar').append(quick);
  function activate(on){
    local=on;document.body.classList.toggle('fc-local',on);panel.hidden=!on;tree.hidden=!on;quick.hidden=!on;$('model-tree').hidden=on;
    for(const id of ['task-context','tasks-content','gemini-panel'])if($(id))$(id).hidden=on;
    // Gemini panel may be inserted outside the legacy tasks-content.
    document.querySelectorAll('.tasks-dock > :not(.dock-title):not(#fc-panel)').forEach(el=>el.hidden=on);
    if(on){document.querySelector('.cad-docks').classList.add('show-tasks');switchView('model');if(snapshot)renderScene();}
    else{updateTree();badge.textContent=connected?'FreeCAD đã kết nối · Browser CAD':'Browser CAD';}
    button.textContent=on?'Quay lại bản vẽ':'FreeCAD trên máy này';
    document.querySelector('.local-state').textContent=on?'FreeCAD trên thiết bị của bạn':'Crops stay local until sent to Gemini';
  }
  function log(message){$('fc-output').textContent=(new Date().toLocaleTimeString()+' '+message+'\n'+$('fc-output').textContent).slice(0,22000);}
  function health(message,error=false){$('fc-health').textContent=message;$('fc-health').classList.toggle('error',error);}
  async function post(route,data={},blob=false){
    const response=await fetch(address+route,{method:'POST',headers:{'Content-Type':'application/json','X-FreeScan-Key':key,'X-Request-Id':crypto.randomUUID()},body:JSON.stringify(data),signal:AbortSignal.timeout(route==='/connect'?12000:65000),cache:'no-store'});
    if(blob&&response.ok)return response.blob();
    const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'Bridge request failed');return result.result;
  }
  async function connect(){
    const url=new URL($('fc-address').value.trim());
    if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Chỉ chấp nhận địa chỉ loopback http://127.0.0.1:port');
    address=url.origin;key=$('fc-key').value.trim();if(key.length<32)throw Error('Nhập mã từ trang ghép nối cục bộ.');
    info=await post('/connect');if(!info.guiReady)throw Error('Cầu nối đã chạy. Hãy mở FreeCAD và chạy FreeCAD-Web.FCMacro.');
    tools=(await post('/tools')).tools;connected=true;badge.textContent='FreeCAD PC · '+tools.length+' tools';badge.classList.add('connected');
    const engineChoice=$('code-engine');if(engineChoice){engineChoice.value='desktop';engineChoice.dispatchEvent(new Event('change'));}
    document.dispatchEvent(new CustomEvent('freecad-local-status',{detail:{connected:true}}));
    $('fc-key').value='';dialog.close();fillTools();activate(true);await refresh();choose('freecad_create_sketch');
  }
  $('fc-do-connect').onclick=async()=>{const b=$('fc-do-connect');b.disabled=true;try{$('fc-connect-error').textContent='Đang kiểm tra FreeCAD…';await connect();}catch(e){$('fc-connect-error').textContent=/fetch|timeout|timed out|aborted/i.test(e.message)?'Không kết nối được. Chạy Ket-noi-FreeCAD.cmd, mở trang ghép nối để lấy phiên mới và cho phép quyền mạng cục bộ. Có thể thử bằng Chrome hoặc Edge nếu trình duyệt này chặn localhost.':e.message;}finally{b.disabled=false;}};
  async function withBusy(fn){if(busy)return;busy=true;panel.inert=true;try{await fn();}catch(e){health(e.message,true);log('ERROR '+e.message);}finally{busy=false;panel.inert=false;}}
  async function call(name,args,allowPython=false){
    health('Đang chạy '+title(name)+'…');
    const result=await post('/call',{name,arguments:args,allowPython});
    const output=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');log(title(name)+'\n'+output);
    if(result.isError)throw Error(output||'FreeCAD command failed');return result;
  }
  function fillTools(){
    if($('fc-category').options.length===1)for(const group of [...new Set(tools.map(t=>t.group))])$('fc-category').append(new Option(title(group),group));
    const search=$('fc-search').value.toLowerCase(),group=$('fc-category').value,previous=$('fc-tools').value;$('fc-tools').replaceChildren();
    for(const tool of tools)if((!group||tool.group===group)&&(!search||(tool.name+' '+tool.description).toLowerCase().includes(search)))$('fc-tools').append(new Option(title(tool.name),tool.name));
    if([...$('fc-tools').options].some(o=>o.value===previous))$('fc-tools').value=previous;
    if($('fc-tools').value)renderCommand();else $('fc-command').replaceChildren(text('p','Không có công cụ phù hợp.'));
  }
  function choose(name){$('fc-search').value='';$('fc-category').value='';fillTools();$('fc-tools').value=name;renderCommand();}
  $('fc-search').oninput=fillTools;$('fc-category').onchange=fillTools;$('fc-tools').onchange=renderCommand;
  function renderCommand(prefill={}){
    const tool=tools.find(t=>t.name===$('fc-tools').value);if(!tool)return;
    const host=$('fc-command');host.replaceChildren(text('h3',title(tool.name)),text('p',tool.description));
    const form=document.createElement('form');form.className='fc-tool-form';
    for(const [name,schema]of Object.entries(tool.inputSchema.properties||{})){
      const label=text('label',name+((tool.inputSchema.required||[]).includes(name)?' *':''));let input;
      if(schema.enum){input=document.createElement('select');input.append(new Option('—',''));for(const option of schema.enum)input.append(new Option(String(option),String(option)));}
      else if(schema.type==='boolean'){input=document.createElement('select');for(const [a,b]of [['—',''],['True','true'],['False','false']])input.append(new Option(a,b));}
      else{input=document.createElement(['array','object'].includes(schema.type)||name==='code'?'textarea':'input');if(input.tagName==='INPUT'){input.type=['number','integer'].includes(schema.type)?'number':'text';input.step='any';}else input.rows=name==='code'?9:3;}
      input.name=name;input.title=schema.description||name;input.required=(tool.inputSchema.required||[]).includes(name);
      let value=prefill[name]??schema.default;
      if(value===undefined&&selected&&['objectName','name1','baseName','sketchName'].includes(name))value=selected;
      if(value===undefined&&face&&['faceIndex','faceNumber'].includes(name))value=face;
      if(value===undefined&&name==='objectNames'&&selected)value=[selected];
      if(value===undefined&&name==='filePath'&&/export|save_document/.test(tool.name))value=info.folder+'/Model.'+(tool.name==='freecad_save_document'?'FCStd':tool.name.split('_').at(-1));
      if(value!==undefined)input.value=typeof value==='object'?JSON.stringify(value):String(value);
      label.append(input);if(schema.description)label.append(text('small',schema.description));form.append(label);
    }
    if(tool.name==='freecad_execute_python'){
      const warning=text('label','Cho phép đoạn Python này chạy trên máy tôi');const consent=document.createElement('input');consent.type='checkbox';consent.name='__python';consent.required=true;warning.prepend(consent);form.append(warning);
    }
    const run=text('button','Thực hiện trong FreeCAD');run.type='submit';run.className='primary';form.append(run);
    form.onsubmit=e=>{e.preventDefault();withBusy(async()=>{
      const args={};for(const [name,schema]of Object.entries(tool.inputSchema.properties||{})){
        const raw=form.elements.namedItem(name).value;if(raw==='')continue;
        args[name]=schema.type==='boolean'?raw==='true':['number','integer'].includes(schema.type)?Number(raw):['object','array'].includes(schema.type)?JSON.parse(raw):raw;
      }
      await call(tool.name,args,form.elements.namedItem('__python')?.checked===true);await refresh();
    });};host.append(form);
  }
  async function refresh(){
    snapshot=await post('/state');if(!snapshot.objects.some(o=>o.name===selected))selected=snapshot.objects.find(o=>o.visible&&o.faces)?.name||snapshot.objects[0]?.name||null;
    $('fc-object').replaceChildren();for(const o of snapshot.objects)$('fc-object').append(new Option(o.label+' · '+o.type,o.name));$('fc-object').value=selected||'';
    tree.replaceChildren(text('strong',snapshot.document||'No document'));
    for(const o of snapshot.objects){const b=text('button',(o.parents.length?'   ↳ ':'')+o.label+(o.fullyConstrained===true?' ✓':''));b.title=o.type;b.className=o.name===selected?'active':'';b.onclick=()=>selectObject(o.name);tree.append(b);}
    document.querySelector('.document-title').textContent=snapshot.document||'FreeCAD';renderProperties();if(local)renderScene();health((snapshot.document||'Chưa có tài liệu')+' · '+snapshot.objects.length+' đối tượng · '+tools.length+' công cụ');
  }
  function selectObject(name){selected=name;face=null;$('fc-object').value=name;renderProperties();renderCommand();tree.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.textContent.trim().replace(/^↳\s*/,'').replace(/ ✓$/,'')===snapshot.objects.find(o=>o.name===name)?.label));}
  $('fc-object').onchange=()=>selectObject($('fc-object').value);
  function renderProperties(){
    const o=snapshot?.objects.find(o=>o.name===selected),host=$('fc-properties');host.replaceChildren();if(!o)return;
    $('fc-selection').textContent=o.name+(face?' · Face'+face:'')+' · '+o.state.join(', ')+(o.faces?' · '+o.faces+' faces / '+o.edges+' edges':'');
    if(o.bounds)host.append(text('p',o.bounds.map(v=>v.toFixed(3)).join(' × ')+' mm · '+(o.valid?'Valid':'Invalid')+' · '+o.solids+' solid(s)'));
    for(const [name,p]of Object.entries(o.properties)){
      const label=text('label',name),input=document.createElement('input');input.value=p.value;input.disabled=p.readOnly;
      input.type=typeof p.value==='number'?'number':'text';input.step='any';
      const apply=text('button','↵');apply.disabled=p.readOnly;apply.title='Apply '+name;
      apply.onclick=()=>withBusy(async()=>{const value=typeof p.value==='number'?Number(input.value):typeof p.value==='boolean'?input.value==='true':input.value;await post('/property',{object:o.name,property:name,value});await refresh();});
      const row=document.createElement('span');row.append(input,apply);label.append(row);host.append(label);
    }
    if(o.edges){const edgeLabel=text('label','Edge selection'),edges=document.createElement('select');edges.append(new Option('Chọn cạnh theo ID',''));for(let i=1;i<=o.edges;i++)edges.append(new Option('Edge'+i,String(i)));edges.onchange=()=>{const command=$('fc-command').querySelector('form');for(const name of ['edgeIndices','edges'])if(command?.elements.namedItem(name))command.elements.namedItem(name).value=JSON.stringify([Number(edges.value)]);};edgeLabel.append(edges);host.prepend(edgeLabel);}
  }
  let pickMap=[];
  function renderScene(){
    const vertices=[],triangles=[];pickMap=[];
    for(const m of snapshot.meshes){const offset=vertices.length/3;for(const v of m.vertices)vertices.push(v);for(const i of m.triangles)triangles.push(i+offset);for(const f of m.faceIds)pickMap.push({object:m.object,face:f});}
    if(!vertices.length&&!snapshot.wires?.length){viewer.group.children.forEach(o=>o.geometry?.dispose());viewer.group.clear();$('model-empty').hidden=false;$('model-empty').textContent='Tạo Sketch / khối trong FreeCAD để bắt đầu.';return;}
    if(vertices.length){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(triangles);geometry.computeVertexNormals();viewer.show({vertices,normals:Array.from(geometry.attributes.normal.array),triangles});geometry.dispose();}
    else viewer.showSketch([],null);
    const wirePoints=[];
    for(const wire of snapshot.wires||[])for(let i=1;i<wire.length;i++)wirePoints.push(new THREE.Vector3(...wire[i-1]),new THREE.Vector3(...wire[i]));
    if(wirePoints.length){const geometry=new THREE.BufferGeometry().setFromPoints(wirePoints);viewer.group.add(new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x16844c})));if(!vertices.length){const box=new THREE.Box3().setFromPoints(wirePoints);box.getCenter(viewer.center);const size=box.getSize(new THREE.Vector3());viewer.size=Math.max(5,size.x,size.y,size.z)*1.8;viewer.controls.target.copy(viewer.center);viewer.camera.position.copy(viewer.center).add(new THREE.Vector3(1.2,-1.8,1.3).multiplyScalar(viewer.size));viewer.resize();}}switchView('model');
  }
  let down=null;viewer.canvas.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);viewer.canvas.addEventListener('pointerup',e=>{
    if(!local||!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;
    const rect=viewer.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),viewer.camera);
    const hit=ray.intersectObject(viewer.group.children[0]||new THREE.Object3D())[0];const picked=hit&&pickMap[hit.faceIndex];if(picked){selectObject(picked.object);face=picked.face;renderProperties();renderCommand();health(picked.object+' · Face'+face+' selected');
      const old=viewer.group.getObjectByName('picked-face');if(old){old.geometry.dispose();old.material.dispose();viewer.group.remove(old);}
      const source=viewer.group.children[0].geometry,positions=source.attributes.position,index=source.index,verts=[];
      pickMap.forEach((p,i)=>{if(p.object===selected&&p.face===face)for(let k=0;k<3;k++){const v=index.getX(i*3+k);verts.push(positions.getX(v),positions.getY(v),positions.getZ(v));}});
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));const marked=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xffce4a,transparent:true,opacity:.6,side:THREE.DoubleSide,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));marked.name='picked-face';viewer.group.add(marked);
    }
  });
  $('fc-refresh').onclick=()=>withBusy(refresh);
  $('fc-new').onclick=()=>withBusy(async()=>{await call('freecad_new_document',{name:'FreeScan_'+Date.now()});await refresh();});
  $('fc-disconnect').onclick=()=>{connected=false;activate(false);key='';snapshot=null;tools=[];badge.textContent='Browser CAD';badge.classList.remove('connected');health('Đã ngắt kết nối');document.dispatchEvent(new CustomEvent('freecad-local-status',{detail:{connected:false}}));};
  $('fc-import').onclick=()=>$('fc-upload').click();$('fc-upload').onchange=()=>withBusy(async()=>{
    const file=$('fc-upload').files[0];if(!file)return;if(file.size>20*1024*1024)throw Error('Giới hạn file nhập 20 MB.');
    const data=await new Promise((ok,no)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result.split(',')[1]);reader.onerror=no;reader.readAsDataURL(file);});
    const saved=await post('/upload',{name:file.name,data});const ext=file.name.split('.').at(-1).toLowerCase();
    const command=ext==='fcstd'?'freecad_open_document':'freecad_import_'+({stp:'step',igs:'iges'}[ext]||ext);
    await call(command,{filePath:saved.filePath});await refresh();$('fc-upload').value='';
  });
  function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);}
  for(const format of ['step','stl','save'])$('fc-'+format).onclick=()=>withBusy(async()=>{
    const ext=format==='save'?'FCStd':format,filePath=info.folder+'/'+(snapshot.document||'Model')+'-'+Date.now()+'.'+ext;
    const objects=snapshot.objects.filter(o=>o.faces&&o.visible&&!o.parents.some(p=>snapshot.objects.find(x=>x.name===p)?.type==='PartDesign::Body')).map(o=>o.name);
    if(format!=='save'&&!objects.length)throw Error('Chưa có đối tượng solid để xuất.');
    await call(format==='save'?'freecad_save_document':'freecad_export_'+format,format==='save'?{filePath}:{filePath,objectNames:objects});
    download(await post('/download',{filePath},true),filePath.split('/').at(-1));health('Đã tải '+ext+' · file cũng nằm trong thư mục local-files trên máy.');
  });
  async function transferSketch(){
    const sketch=getSketch();if(!sketch.closed||(!sketch.circle&&sketch.profile.length<3))throw Error('Vẽ và đóng Sketch trước khi chuyển sang FreeCAD.');
    const name='WebSketch_'+Date.now();await call('freecad_create_sketch',{name,plane:'XY'});
    if(sketch.circle)await call('freecad_add_sketch_circle',{sketchName:name,centerX:sketch.circle.center[0],centerY:sketch.circle.center[1],radius:sketch.circle.radius});
    else for(let i=0;i<sketch.profile.length;i++){const a=sketch.profile[i],b=sketch.profile[(i+1)%sketch.profile.length];await call('freecad_add_sketch_line',{sketchName:name,x1:a[0],y1:a[1],x2:b[0],y2:b[1]});}
    selected=name;await refresh();choose('freecad_pad');health('Đã tạo Sketch thật. Đặt ràng buộc nếu cần, sau đó Pad.');
  }
  // Pairing arrives in the fragment only; remove it before subsequent navigation.
  const params=new URLSearchParams(location.hash.slice(1));
  if(params.has('freecadKey')){
    $('fc-address').value=params.get('freecadBridge')||address;$('fc-key').value=params.get('freecadKey');history.replaceState(null,'',location.pathname+location.search);dialog.showModal();
    $('fc-connect-error').textContent='Mã đã nhận từ cầu nối. Bấm Kết nối để cho phép tab này điều khiển FreeCAD.';
  }
  async function runCommands(commands){
    if(!connected)throw Error('Ghép nối bằng nút FreeCAD trên máy này trước.');
    if(busy)throw Error('Một lệnh FreeCAD đang chạy.');
    await post('/validate',{commands});busy=true;panel.inert=true;
    try{activate(true);for(const command of commands)await call(command.tool,command.args||{});await refresh();return{count:commands.length,document:snapshot.document};}
    catch(e){health(e.message+' · Đồng bộ để kiểm tra các bước đã chạy.',true);throw e;}
    finally{busy=false;panel.inert=false;}
  }
  async function runCode(code,options){
    if(!connected)throw Error('Ghép nối FreeCAD trên máy này trước khi chạy Python.');
    if(busy)throw Error('FreeCAD đang chạy một lệnh khác.');
    const wrapped=executionCode(code,options);busy=true;panel.inert=true;
    try{
      const response=await call('freecad_execute_python',{code:wrapped},true);
      const raw=response.content?.find(c=>c.type==='text')?.text;
      let result;try{result=JSON.parse(raw);}catch{throw Error('Không đọc được kết quả script. Đồng bộ để kiểm tra FreeCAD.');}
      try{await refresh();const solids=snapshot.objects.filter(o=>o.faces&&o.visible&&!o.parents.some(p=>snapshot.objects.find(x=>x.name===p)?.type==='PartDesign::Body'));result.model={solids:solids.reduce((sum,o)=>sum+o.solids,0),valid:solids.length>0&&solids.every(o=>o.valid),invalidFeatures:snapshot.objects.filter(o=>o.state.some(s=>/invalid|error/i.test(s))).map(o=>o.name)};}catch(e){result.syncError=e.message;}
      return result;
    }finally{busy=false;panel.inert=false;}
  }
  const codeWorkspace=mountCodeWorkspace({runCode,showBrowserModel:(mesh,metrics)=>{activate(false);viewer.show(mesh);switchView('model');},isConnected:()=>connected,connect:()=>dialog.showModal(),showModel:()=>{if(connected){activate(true);if(snapshot)renderScene();}else switchView('model');}});
  return {refresh,runCommands,runCode,openCode:codeWorkspace.open,isConnected:()=>connected,disconnect:()=>$('fc-disconnect').click()};
}

