// Drawing-space geometry is shared by SVG interaction and the PNG export.
export function clampPoint(point,width,height,margin=0){
  const clamp=(n,min,max)=>Math.max(min,Math.min(Math.max(min,max),Number.isFinite(n)?n:min));
  return {x:clamp(point.x,margin,width-margin),y:clamp(point.y,margin,height-margin)};
}

export function annotationGeometry(row,width,height,radius=14){
  const anchor=clampPoint(row.anchor||{x:row.x+row.w/2,y:row.y+row.h/2},width,height);
  const side=anchor.x>width/2?-1:1;
  const balloon=clampPoint(row.balloon||{x:anchor.x+side*Math.max(radius*4,width*.045),y:anchor.y-Math.max(radius*3,height*.035)},width,height,radius+3);
  const elbow=clampPoint(row.elbow||{x:(anchor.x+balloon.x)/2,y:balloon.y},width,height);
  const dx=elbow.x-balloon.x,dy=elbow.y-balloon.y,length=Math.hypot(dx,dy)||1;
  const edge={x:balloon.x+dx/length*radius,y:balloon.y+dy/length*radius};
  const ax=elbow.x-anchor.x,ay=elbow.y-anchor.y,angle=Math.atan2(ay,ax),head=Math.max(5,radius*.48);
  const arrow=[anchor,{x:anchor.x+head*Math.cos(angle-.4),y:anchor.y+head*Math.sin(angle-.4)},{x:anchor.x+head*Math.cos(angle+.4),y:anchor.y+head*Math.sin(angle+.4)}];
  return {anchor,balloon,elbow,edge,arrow,radius};
}

export function positionAnnotations(rows,width,height,radius=14){
  const placed=[];
  rows.forEach((row,index)=>{
    if(!row.balloon){
      const initial=annotationGeometry(row,width,height,radius).balloon;
      let candidate=initial;
      for(let attempt=0;attempt<20;attempt++){
        candidate=clampPoint({x:initial.x+(attempt>9?radius*3:0),y:initial.y+(attempt%10)*radius*2.8},width,height,radius+3);
        if(!placed.some(p=>Math.hypot(p.x-candidate.x,p.y-candidate.y)<radius*2.4))break;
      }
      row.balloon=candidate;
    }
    placed.push(annotationGeometry(row,width,height,radius).balloon);
  });
}

export function paintAnnotation(ctx,geometry,label,{color='#2563eb',lineWidth=2,dashed=false,leaders=true,balloons=true}={}){
  const {anchor,elbow,edge,arrow,balloon,radius}=geometry;
  ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=lineWidth;ctx.lineJoin='round';
  if(leaders){
    ctx.setLineDash(dashed?[lineWidth*4,lineWidth*3]:[]);ctx.beginPath();ctx.moveTo(edge.x,edge.y);ctx.lineTo(elbow.x,elbow.y);ctx.lineTo(anchor.x,anchor.y);ctx.stroke();
    ctx.setLineDash([]);ctx.beginPath();arrow.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fill();
  }
  if(balloons){
    ctx.beginPath();ctx.arc(balloon.x,balloon.y,radius,0,Math.PI*2);ctx.fillStyle='white';ctx.fill();ctx.stroke();
    ctx.fillStyle=color;ctx.font=`600 ${radius*.86}px Arial`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,balloon.x,balloon.y);
  }
  ctx.restore();
}
