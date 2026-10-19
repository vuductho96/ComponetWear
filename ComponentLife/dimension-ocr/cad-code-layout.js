// Focused FreeCAD-style workspace: code dock + actual 3D viewport.
export function mountCodeLayout(){
 const $=id=>document.getElementById(id);document.body.classList.add('cad-code-only');
 const pane=$('cad-code-pane');document.querySelector('.cad-docks').prepend(pane);pane.hidden=false;
 const bar=document.querySelector('.cad-toolbar');
 const views=document.createElement('div');views.className='code-view-tools';
 for(const [name,selector] of [['Fit','[data-command="fit"]'],['Isometric','#home-view'],['Front','[data-face="Front"]'],['Top','[data-face="Top"]']]){
  const button=document.createElement('button');button.textContent=name;
  button.onclick=()=>{if(name==='Front'||name==='Top'){const match=[...document.querySelectorAll('#view-shortcuts button')].find(b=>b.textContent.trim()===name);match?.click();}else document.querySelector(selector)?.click();};views.append(button);
 }
 bar.append(views);
 const exportRow=document.createElement('div');exportRow.id='code-native-exports';exportRow.className='code-actions';
 for(const [label,id] of [['Đồng bộ 3D','fc-refresh'],['FCStd · tham số','fc-save'],['STEP','fc-step'],['STL','fc-stl']]){const b=document.createElement('button');b.textContent=label;b.onclick=()=>$(id).click();exportRow.append(b);}
 const nativeState=document.createElement('p');nativeState.id='code-native-state';nativeState.className='code-footnote';exportRow.append(nativeState);
 pane.querySelector('.code-runbar').after(exportRow);
 const note=document.createElement('p');note.className='code-footnote';note.id='code-format-note';note.textContent='STEP: sửa hình học trong FreeCAD, không có lịch sử Sketch. FCStd: giữ tham số nếu Python dựng bằng Sketch / Pad / Pocket.';pane.append(note);
 const sync=()=>{const desktop=$('code-engine').value==='desktop';exportRow.hidden=!desktop;const connected=$('code-connection').textContent.includes('đã ghép nối');exportRow.querySelectorAll('button').forEach(b=>b.disabled=!connected);$('code-native-state').textContent=connected?'Xuất từ tài liệu đang mở trên FreeCAD.':'Kết nối FreeCAD để dựng Python và xuất FCStd.';$('cad-python').placeholder=desktop?'Dán Python FreeCAD từ ChatGPT…':'Dán JavaScript Replicad từ ChatGPT…';$('code-note').textContent=desktop?'Python chạy bằng quyền tài khoản máy bạn. Dùng Sketch và feature có tham số để file FCStd chỉnh sửa được.':'Dựng solid trên thiết bị bằng OpenCascade WASM. Không cần API key. Chỉ chạy JavaScript bạn tin cậy.';};
 $('code-engine').addEventListener('change',()=>{const desktop=$('code-engine').value==='desktop';$('code-step').hidden=desktop;$('code-stl').hidden=desktop;const result=document.querySelector('.browser-code-result');result.hidden=desktop||!result.querySelector('span').textContent;});
 new MutationObserver(()=>{if($('code-engine').value==='desktop'&&$('fc-health').textContent!=='Chưa kết nối')nativeState.textContent=$('fc-health').textContent;}).observe($('fc-health'),{childList:true,subtree:true,characterData:true});
 $('code-engine').addEventListener('change',sync);document.addEventListener('freecad-local-status',sync);sync();
 $('model-empty').textContent='Dán code và bấm Chạy để dựng solid 3D';
 $('view-solid').click();document.body.classList.remove('cad-code-mode');
 $('edit-state').textContent='3D viewport';$('doc-tab-label').textContent='Model · mm';$('cad-status').textContent='Dán code → chọn engine → dựng solid → xuất STEP / FCStd';$('kernel-status').textContent='OpenCascade / FreeCAD';
}
