// A reversible postprocessor: the OCR source is retained on each row.
const NUMBER='[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const DIMENSION=new RegExp(`^((?:DP|[ØRCM])?)\\s*(${NUMBER})(?:\\s*([–-])\\s*(${NUMBER}))?(?:\\s*(?:[x×]\\s*(${NUMBER})|((?:js|JS|[a-hA-Hj-nJ-NpPrRsStTuUxXzZ])[4-9])|(°|DP|mm|in)))?`);
function decimal(s){return s.replace(/^([+-]?)\./,'$10.');}
export function cleanText(raw){return String(raw??'').normalize('NFKC').replace(/[\u200b-\u200f\ufeff]/g,'').replace(/[φϕ⌀ø]/g,'Ø').replace(/[−﹣]/g,'-').replace(/(?<=\d)\s*[,，]\s*(?=\d)/g,'.').replace(/(?<=\d)\s*\.\s*(?=\d)/g,'.').replace(/\s+/g,' ').trim();}
export function parseDimension(source,box={}){
 let text=cleanText(source.raw||source.nominal),notes=[];
 text=text.replace(/^[=_~:;△▲∆]+\s*/,'').replace(/^\d+\s*(?:[xX×]|-(?=[ØRCM]|\d+\.\d))\s*/,'').trim();
 const reference=text.startsWith('(');text=text.replace(/^\(/,'');
 const match=text.match(DIMENSION);if(!match)return{nominal:cleanText(source.nominal||text),upper:cleanText(source.upper),lower:cleanText(source.lower),flagged:true,flagReason:'No valid dimension at the beginning of the OCR text'};
 let nominal=match[1]+decimal(match[2]);if(match[4])nominal+='–'+decimal(match[4]);if(match[5])nominal+='×'+decimal(match[5]);if(match[6])nominal+=match[6];if(match[7])nominal+=match[7];if(reference)nominal='('+nominal+')';
 const rest=text.slice(match[0].length).trim();let upper=cleanText(source.upper),lower=cleanText(source.lower);
 const symmetric=(rest+' '+upper+' '+lower).match(/±\s*([\d]+(?:\.\d+)?|\.\d+)/);
 const stacked=rest.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*\/\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))/);
 if(symmetric){const t=decimal(symmetric[1]);upper='+'+t;lower='-'+t;}else if(stacked){upper=decimal(stacked[1]);lower=decimal(stacked[2]);}
 const base=Math.abs(Number(match[2]));
 function tolerance(v){if(!v)return '';let m=v.match(new RegExp(`^(${NUMBER})$`));if(!m)m=v.match(/([+-](?:\d+(?:\.\d+)?|\.\d+))/);if(!m){notes.push('Removed unparsed tolerance text');return '';}const n=decimal(m[1]),value=Math.abs(Number(n));if(base>0&&(value===base||value>base)){notes.push('Removed a duplicate or oversized tolerance');return '';}return n;}
 upper=tolerance(upper);lower=tolerance(lower);
 let flagReason='';const tail=rest.replace(/±\s*[\d.]+|^[+-]?[\d.]+\s*\/\s*[+-]?[\d.]+/g,'').replace(/\([^)]*\)?/g,'').replace(/\b(?:MAX|MIN|TYP|REF|THRU|DEEP|PLC|PCS)\b/gi,'').replace(/[).\s_-]/g,'');
 if(/\d/.test(tail))flagReason='Additional numbers could not be assigned to this dimension';
 const ratio=Math.max(box.w||0,box.h||0)/Math.max(1,Math.min(box.w||1,box.h||1));if(box.w&&box.h&&(Math.min(box.w,box.h)<4||ratio>35))flagReason='Detection shape looks like a line rather than a callout';
 if(Number.isFinite(box.confidence)&&box.confidence<.55)flagReason='Low OCR confidence';
 if(text!==nominal&& !symmetric&&!stacked)notes.push('Removed quantity prefix or annotation characters');
 return{nominal,upper,lower,flagged:!!flagReason,flagReason,note:notes.join('; ')};
}
export function processRows(rows,enabled=true){
 for(const row of rows){if(!row.original)row.original={nominal:row.nominal,upper:row.upper,lower:row.lower,raw:row.raw};if(row.manual){if(!row.userEdited)Object.assign(row,{nominal:row.original.raw??row.original.nominal,upper:row.original.upper,lower:row.original.lower});row.flagged=false;row.flagReason='';row.note='Manual crop — parser bypassed';continue;}if(row.userEdited){row.flagged=false;row.flagReason='';continue;}if(enabled)Object.assign(row,parseDimension(row.original,row));else Object.assign(row,{nominal:row.original.raw||row.original.nominal,upper:row.original.upper,lower:row.original.lower,flagged:false,flagReason:'',note:''});}
 if(!enabled)return rows;
 // Match a separately detected signed tolerance to a nearby dimension on its left.
 const signed=new RegExp(`^([+-]${NUMBER.replace('[+-]?','')})$`);
 for(const row of rows){if(row.manual||row.userEdited||row.flagged)continue;const token=cleanText(row.original.raw||row.original.nominal).match(signed);if(!token)continue;const v=Math.abs(Number(token[1]));let best=null,distance=Infinity;
 for(const base of rows){if(base===row||base.manual||base.userEdited||base.flagged||signed.test(cleanText(base.original.raw||base.original.nominal)))continue;const nominal=Math.abs(Number(base.nominal.replace(/^[ØRCM]|^DP/,'').match(new RegExp(NUMBER))?.[0]));if(!nominal||v>nominal*.25)continue;const dx=row.x-(base.x+base.w),dy=row.y+row.h/2-(base.y+base.h/2);if(dx< -base.w*.25||dx>Math.max(base.w,base.h*3)||Math.abs(dy)>base.h*1.3||row.h>base.h*1.3)continue;const key=dy<0?'upper':'lower';if(base[key])continue;const d=Math.abs(dx)+Math.abs(dy);if(d<distance){distance=d;best={base,key};}}
 if(best){best.base[best.key]=token[1];row.flagged=true;row.flagReason='Tolerance joined to a nearby dimension using its position';}
 }
 return rows;
}
