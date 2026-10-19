export function canvas(w,h){const c=new OffscreenCanvas(w,h);return c;}
export function rotate(src,direction){const c=canvas(src.height,src.width),ctx=c.getContext('2d');ctx.translate(c.width/2,c.height/2);ctx.rotate(direction*Math.PI/2);ctx.drawImage(src,-src.width/2,-src.height/2);return c;}
export function crop(src,b,pad=3){const x=Math.max(0,Math.floor(b.x-pad)),y=Math.max(0,Math.floor(b.y-pad)),w=Math.max(1,Math.min(src.width-x,Math.ceil(b.w+pad*2))),h=Math.max(1,Math.min(src.height-y,Math.ceil(b.h+pad*2)));const c=canvas(w,h);c.getContext('2d').drawImage(src,x,y,w,h,0,0,w,h);return c;}
export function iou(a,b){const area=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return area/(a.w*a.h+b.w*b.h-area||1);}
export function decodeYolo(out,src,size,threshold){const channels=out.dims[1]<out.dims[2]?out.dims[1]:out.dims[2],n=out.dims[1]<out.dims[2]?out.dims[2]:out.dims[1],trans=out.dims[1]===channels,at=(i,j)=>out.data[trans?j*n+i:i*channels+j],ratio=Math.min(size/src.width,size/src.height),left=Math.round((size-Math.round(src.width*ratio))/2-.1),top=Math.round((size-Math.round(src.height*ratio))/2-.1);let candidates=[];for(let i=0;i<n;i++){let score=0,cls=0;for(let j=4;j<channels;j++)if(at(i,j)>score){score=at(i,j);cls=j-4;}if(score<threshold)continue;const x=Math.max(0,(at(i,0)-at(i,2)/2-left)/ratio),y=Math.max(0,(at(i,1)-at(i,3)/2-top)/ratio),x2=Math.min(src.width,(at(i,0)+at(i,2)/2-left)/ratio),y2=Math.min(src.height,(at(i,1)+at(i,3)/2-top)/ratio);if(x2-x>=3&&y2-y>=3)candidates.push({x,y,w:x2-x,h:y2-y,score,cls});}candidates.sort((a,b)=>b.score-a.score);let kept=[];for(const b of candidates)if(!kept.some(a=>a.cls===b.cls&&iou(a,b)>.45))kept.push(b);return kept.sort((a,b)=>Math.floor(a.y/90)-Math.floor(b.y/90)||a.x-b.x);}
export function ctc(out,chars){const vocab=out.dims.at(-1),steps=out.dims.at(-2);let prev=-1,text='',scores=[];for(let t=0;t<steps;t++){let best=0,conf=-Infinity;for(let k=0;k<vocab;k++)if(out.data[t*vocab+k]>conf){conf=out.data[t*vocab+k];best=k;}if(best!==prev&&best!==0){text+=chars[best]||'';scores.push(conf);}prev=best;}return {text:text.trim(),confidence:scores.length?scores.reduce((a,b)=>a+b)/scores.length:0};}
export function normalize(text){return text.replace(/(?<=\d)\s*[.,]\s*(?=\d)/g,'.').replace(/^\d+\s*[-xX×]\s*(?=[CRØøϕ\d])/,'').replace(/^[=_~]+/,'').replace(/(\d+\.\d+)\.+$/,'$1').trim();}
export class Engine{
 constructor(ort,status){this.ort=ort;this.status=status;this.sessions={};this.loading={};}
 async getManifest(){if(!this.manifestPromise)this.manifestPromise=(async()=>{const r=await fetch(new URL('./models/manifest.json',import.meta.url));if(!r.ok)throw Error('Model manifest unavailable: '+r.status);return r.json();})().catch(e=>{this.manifestPromise=null;throw e;});return this.manifestPromise;}
 async loadModel(key){
  if(this.sessions[key])return;
  if(this.loading[key])return this.loading[key];
  this.loading[key]=(async()=>{
   this.ort.env.wasm.numThreads=1;this.ort.env.wasm.wasmPaths=new URL('./vendor/',import.meta.url).href;
   const manifest=await this.getManifest(),paths=manifest[key];if(!Array.isArray(paths)||!paths.length)throw Error('Missing model: '+key);
   const sizes=new Array(paths.length).fill(0),totals=paths.map(p=>manifest.fileSizes?.[p]||0);let last=-1;
   const report=()=>{const done=sizes.reduce((a,b)=>a+b,0),total=totals.reduce((a,b)=>a+b,0),known=totals.every(n=>n>0),percent=known?Math.min(100,Math.floor(done/total*100)):-1;if(percent!==last||percent<0){last=percent;this.status('Loading '+key+' model: '+(known?percent+'%':(done/1048576).toFixed(1)+' MB')+'…');}};
   this.status('Loading '+key+' model…');
   // Keep chunk downloads sequential to limit memory/network pressure on small PCs.
   const parts=[];
   for(let i=0;i<paths.length;i++){
    const r=await fetch(new URL('./models/'+paths[i],import.meta.url));if(!r.ok)throw Error('Model download failed: '+r.status);
    totals[i]=Number(r.headers.get('content-length'))||totals[i];
    if(r.body){const reader=r.body.getReader(),chunks=[];let length=0;for(;;){const {done,value}=await reader.read();if(done)break;chunks.push(value);length+=value.length;sizes[i]=length;report();}const part=new Uint8Array(length);let offset=0;for(const chunk of chunks){part.set(chunk,offset);offset+=chunk.length;}parts.push(part);}
    else {parts.push(new Uint8Array(await r.arrayBuffer()));sizes[i]=parts[i].length;}
    totals[i]=sizes[i];report();
   }
   const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   this.status('Preparing '+key+' model…');
   const session=await this.ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
   try {if(key==='recognizer'&&!this.chars){const r=await fetch(new URL('./models/dict.txt',import.meta.url));if(!r.ok)throw Error('Dictionary download failed: '+r.status);this.chars=['',...(await r.text()).split(/\r?\n/).filter(x=>x.length),' '];}this.sessions[key]=session;}
   catch(e){await session.release?.();throw e;}
  })();
  try{await this.loading[key];}finally{delete this.loading[key];}
 }
 async load(keys=['detector','regions','recognizer']){for(const key of keys)await this.loadModel(key);}

 async detect(src,key,size,threshold){const c=canvas(size,size),ctx=c.getContext('2d'),ratio=Math.min(size/src.width,size/src.height),w=Math.round(src.width*ratio),h=Math.round(src.height*ratio);ctx.fillStyle='rgb(114,114,114)';ctx.fillRect(0,0,size,size);ctx.drawImage(src,Math.round((size-w)/2-.1),Math.round((size-h)/2-.1),w,h);const rgba=ctx.getImageData(0,0,size,size).data,area=size*size,data=new Float32Array(area*3);for(let i=0;i<area;i++)for(let j=0;j<3;j++)data[j*area+i]=rgba[i*4+j]/255;const s=this.sessions[key],tensor=new this.ort.Tensor('float32',data,[1,3,size,size]);let out;try{out=await s.run({[s.inputNames[0]]:tensor});return decodeYolo(out[s.outputNames[0]],src,size,threshold);}finally{tensor.dispose();if(out)Object.values(out).forEach(t=>t.dispose());}}
 async read(src){const h=48,rw=Math.max(16,Math.ceil(h*src.width/src.height)),w=Math.max(320,Math.ceil(rw/32)*32);if(w>4096)throw Error('OCR region is too wide; use a closer crop.');const c=canvas(rw,h),ctx=c.getContext('2d');ctx.drawImage(src,0,0,rw,h);const rgba=ctx.getImageData(0,0,rw,h).data,data=new Float32Array(w*h*3);for(let y=0;y<h;y++)for(let x=0;x<rw;x++)for(let j=0;j<3;j++)data[j*w*h+y*w+x]=rgba[(y*rw+x)*4+(2-j)]/127.5-1;const s=this.sessions.recognizer,tensor=new this.ort.Tensor('float32',data,[1,3,h,w]);let out;try{out=await s.run({[s.inputNames[0]]:tensor});return ctc(out[s.outputNames[0]],this.chars);}finally{tensor.dispose();if(out)Object.values(out).forEach(t=>t.dispose());}}
 async extract(src,threshold,onrow,cancelled){await this.load();this.status('Detecting dimension callouts…');const boxes=await this.detect(src,'detector',1024,threshold);let rows=[];for(let i=0;i<boxes.length;i++){if(cancelled())break;this.status(`Reading dimension ${i+1} of ${boxes.length}…`);const b=boxes[i],rawCrop=crop(src,b,4),c=rawCrop.height>rawCrop.width*1.22?rotate(rawCrop,1):rawCrop,regions=await this.detect(c,'regions',320,.3),parts={};for(const r of regions){if(!parts[r.cls]||r.score>parts[r.cls].score)parts[r.cls]=r;}let nominal='',upper='',lower='',confidence=0,raw='';if(parts[0]){const n=await this.read(crop(c,parts[0],2));nominal=normalize(n.text);raw=n.text;confidence=n.confidence;for(const [cls,key] of [[1,'upper'],[2,'lower']])if(parts[cls]){const t=await this.read(crop(c,parts[cls],2));if(key==='upper')upper=normalize(t.text);else lower=normalize(t.text);confidence=Math.min(confidence,t.confidence);}}else{const n=await this.read(c);nominal=normalize(n.text);raw=n.text;confidence=n.confidence;}for(const value of [upper,lower]){const m=value.match(/±\s*([\d.]+)/);if(m){upper='+'+m[1];lower='-'+m[1];break;}}const sym=nominal.match(/^(.+?)\s*±\s*([\d.]+)$/);if(sym){nominal=sym[1];upper='+'+sym[2];lower='-'+sym[2];}if(/\d/.test(nominal)){const row={...b,nominal,upper,lower,confidence,raw};rows.push(row);onrow(row,i+1,boxes.length);}}return rows;}
}
