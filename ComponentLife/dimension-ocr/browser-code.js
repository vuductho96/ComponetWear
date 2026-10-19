export const SAMPLE_JS = `// Millimetres · khối 40 × 25 × 8, hốc Ø6 sâu 4
const width = 40, height = 25, thickness = 8;
const body = cad.makeBox([0, 0, 0], [width, height, thickness]);
const tool = cad.makeCylinder(3, 5, [20, 12.5, 4], [0, 0, 1]);
const part = body.cut(tool);
body.delete(); tool.delete();
return part;
`;
export const BROWSER_PROMPT = `Phân tích các crop hình chiếu tôi gửi và viết JavaScript Replicad 1.1 chạy trực tiếp trong browser với OpenCascade. Biến cad đã được cung cấp là namespace Replicad; không import, không Python/FreeCAD/CadQuery, không fetch hoặc đọc/ghi file. Dùng mm; đặt tham số kích thước ở đầu; cuối script phải return đúng một Shape3D solid hợp lệ. API đã kiểm chứng: cad.makeBox([xmin,ymin,zmin],[xmax,ymax,zmax]), cad.makeCylinder(radius,height,[x,y,z],[dx,dy,dz]), cad.draw([x,y]).lineTo([x,y]).close().sketchOnPlane('XY').extrude(depth), shape.cut(tool), shape.fuse(tool), shape.fillet(radius), shape.chamfer(distance). Bo/vát chỉ khi kích thước rõ ràng. Không trả mesh hay JSON. Trước code, lập bảng kích thước và nêu phần thiếu/giả định để tôi xác nhận. Không âm thầm đoán kích thước. Chỉ dùng API bạn chắc chắn; không tạo khối bao thay cho chi tiết. Website tự kiểm tra BRep và xuất STEP/STL; không gọi export trong code.`;
export function normalizeJS(input) {
 let code=String(input||'').replace(/^\uFEFF/,'').trim();
 const fence=code.match(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/i);if(fence)code=fence[1];
 if(!code||code.length>200000)throw Error('Dán JavaScript, tối đa 200.000 ký tự.');
 if(code.includes('```'))throw Error('Chỉ dán một khối code JavaScript.');
 if(/^\s*(?:from\s+\w+\s+import|import\s+(?:FreeCAD|Part|Sketcher)|def\s+)/m.test(code))throw Error('Đây là Python. Chọn FreeCAD máy tính hoặc dùng prompt để ChatGPT đổi sang JavaScript Replicad.');
 return code+'\n';
}
export function createBrowserRunner(onModel) {
 let worker,seq=0,pending=new Map(),ready=false;
 function stop(message='Đã dừng. Chạy lại để tạo solid mới.'){
  worker?.terminate();worker=null;ready=false;
  for(const job of pending.values()){clearTimeout(job.timer);job.reject(Error(message));}pending.clear();
 }
 function request(type,extra={}){
  if(!worker){worker=new Worker(new URL('./cad-worker.js',import.meta.url),{type:'module'});
   worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job||data.type==='status')return;clearTimeout(job.timer);pending.delete(data.id);data.type==='error'?job.reject(Error(data.message)):job.resolve(data);};
   worker.onerror=e=>stop(e.message||'CAD worker bị lỗi.');
  }
  return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject,timer:setTimeout(()=>stop('Quá 60 giây. Worker đã dừng; hãy giảm độ phức tạp hoặc sửa vòng lặp.'),60000)});worker.postMessage({id,type,...extra});});
 }
 return {stop,hasModel:()=>ready,async run(code){ready=false;const result=await request('execute',{code:normalizeJS(code)});ready=true;onModel(result.mesh,result.metrics);return result;},async export(format){if(!ready)throw Error('Chạy code thành công trước khi xuất.');return (await request('export',{format})).blob;}};
}
