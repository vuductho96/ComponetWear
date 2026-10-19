export class OcrClient{
 constructor(status){this.status=status;this.pending=new Map();this.sequence=0;this.worker=null;}
 getWorker(){if(this.worker)return this.worker;const worker=new Worker(new URL('./ocr-worker.js',import.meta.url));worker.onmessage=({data})=>{const p=this.pending.get(data.id);if(!p)return;if(data.type==='status')this.status(data.text);else if(data.type==='row')p.onrow?.(data.row,data.i,data.total);else if(data.type==='result'){this.pending.delete(data.id);p.resolve(data.result);}else if(data.type==='error'){this.pending.delete(data.id);p.reject(Error(data.message));}};worker.onerror=()=>this.dispose('Could not run the OCR worker. Please retry.');this.worker=worker;return worker;}
 async run(type,source,options={},onrow){const bitmap=await createImageBitmap(source),id=++this.sequence;return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject,onrow});try{this.getWorker().postMessage({id,type,bitmap,...options},[bitmap]);}catch(e){this.pending.delete(id);bitmap.close();reject(e);}});}
 extract(source,threshold,onrow,cancelled){if(cancelled?.())return Promise.resolve([]);return this.run('extract',source,{threshold},onrow);}
 readCrop(source){return this.run('crop',source);}
 dispose(message='OCR cancelled'){this.worker?.terminate();this.worker=null;for(const p of this.pending.values())p.reject(Error(message));this.pending.clear();}
}
