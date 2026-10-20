const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const geometry=import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(__dirname,'../ComponentLife/dimension-ocr/iqc-annotations.js'),'utf8')).toString('base64'));
test('balloons and leader geometry stay inside drawing bounds and use custom positions',async()=>{
  const {annotationGeometry}=await geometry;
  const row={x:480,y:5,w:20,h:10,balloon:{x:1000,y:-10},elbow:{x:200,y:40}};
  const g=annotationGeometry(row,500,300,14);
  assert.deepEqual(g.anchor,{x:490,y:10});assert.deepEqual(g.balloon,{x:483,y:17});assert.deepEqual(g.elbow,row.elbow);
  assert.ok(Math.abs(Math.hypot(g.edge.x-g.balloon.x,g.edge.y-g.balloon.y)-14)<1e-8);
  assert.deepEqual(g.arrow[0],g.anchor);
});
test('automatic balloons avoid collisions and preserve a dragged position',async()=>{
  const {positionAnnotations}=await geometry;
  const rows=Array.from({length:4},()=>({x:250,y:200,w:30,h:20}));
  positionAnnotations(rows,1000,800,14);
  assert.equal(new Set(rows.map(r=>JSON.stringify(r.balloon))).size,4);
  rows[0].balloon={x:82,y:65};positionAnnotations(rows,1000,800,14);assert.deepEqual(rows[0].balloon,{x:82,y:65});
});
