import {canvas} from './pixels.js';

export const defaultText=()=>({version:1,content:'Text 文字',font:'Microsoft YaHei',size:48,color:'#d4ec98',tracking:0,leading:1.3,align:'left',bold:false,italic:false,mode:'point',width:400,height:180});
export function validateText(t){
  if(t?.version!==1||typeof t.content!=='string'||t.content.length>4000||typeof t.font!=='string'||t.font.length>128||!/^#[a-f0-9]{6}$/i.test(t.color)||!['left','center','right'].includes(t.align)||!['point','box'].includes(t.mode))throw new Error('Invalid text parameters.');
  for(const [key,min,max] of [['size',1,512],['tracking',-20,100],['leading',.5,5],['width',16,8192],['height',16,8192]])if(!Number.isFinite(t[key])||t[key]<min||t[key]>max)throw new Error('Invalid text parameters.');
}
export function textFont(t){return `${t.italic?'italic ':''}${t.bold?'bold ':''}${t.size}px "${t.font.replace(/["\\]/g,'')}"`;}
export function fontAvailable(font){
  if(['sans-serif','serif','monospace'].includes(font))return true;
  const ctx=canvas(1,1).getContext('2d'),sample='AaBbWwmil0123中文测试';
  return ['monospace','serif'].some(fallback=>{ctx.font=`32px ${fallback}`;const width=ctx.measureText(sample).width;ctx.font=`32px "${font.replace(/["\\]/g,'')}", ${fallback}`;return ctx.measureText(sample).width!==width;});
}
export function renderText(t){
  validateText(t);const measure=canvas(1,1).getContext('2d'),pad=Math.ceil(t.size*.3);measure.font=textFont(t);measure.letterSpacing=t.tracking+'px';
  const lines=[];
  for(const paragraph of t.content.replace(/\r\n?/g,'\n').split('\n')){
    if(t.mode==='point'){lines.push(paragraph);continue;}
    let line='';for(const char of paragraph){if(line&&measure.measureText(line+char).width>Math.max(1,t.width-pad*2)){lines.push(line);line='';}line+=char;}lines.push(line);
  }
  const width=t.mode==='box'?t.width:Math.max(1,Math.ceil(Math.max(0,...lines.map(line=>measure.measureText(line).width))+pad*2));
  const height=t.mode==='box'?t.height:Math.ceil((lines.length-1)*t.size*t.leading+t.size*1.4+pad*2),image=canvas(width,height),ctx=image.getContext('2d');
  ctx.font=textFont(t);ctx.letterSpacing=t.tracking+'px';ctx.fillStyle=t.color;ctx.textAlign=t.align;ctx.textBaseline='alphabetic';
  const x=t.align==='left'?pad:t.align==='center'?width/2:width-pad;
  lines.forEach((line,i)=>ctx.fillText(line,x,pad+t.size+i*t.size*t.leading));
  return{image,overflow:pad+t.size+(lines.length-1)*t.size*t.leading>height-pad,pad};
}
export function validatePath(p){
  if(p?.version!==1||!Array.isArray(p.nodes)||p.nodes.length<2||p.nodes.length>1000||!/^#[a-f0-9]{6}$/i.test(p.fill)||!/^#[a-f0-9]{6}$/i.test(p.stroke)||!Number.isFinite(p.strokeWidth)||p.strokeWidth<0||p.strokeWidth>200)throw new Error('Invalid path parameters.');
  for(const node of p.nodes)for(const point of [node,node.in,node.out])if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||Math.abs(point.x)>100000||Math.abs(point.y)>100000)throw new Error('Invalid path parameters.');
}
export function tracePath(ctx,p){
  ctx.beginPath();const nodes=p.nodes;ctx.moveTo(nodes[0].x,nodes[0].y);
  for(let i=1;i<nodes.length+(p.closed?1:0);i++){const a=nodes[i-1],b=nodes[i%nodes.length];ctx.bezierCurveTo(a.out.x,a.out.y,b.in.x,b.in.y,b.x,b.y);}
  if(p.closed)ctx.closePath();
}
export function renderPath(p,width,height,coverage=false){
  validatePath(p);const image=canvas(width,height),ctx=image.getContext('2d');tracePath(ctx,p);
  if(p.fillEnabled&&p.closed){ctx.fillStyle=coverage?'#fff':p.fill;ctx.fill('evenodd');}
  if(p.strokeWidth>0&&!coverage){ctx.strokeStyle=p.stroke;ctx.lineWidth=p.strokeWidth;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();}return image;
}
export function normalizePath(p){
  validatePath(p);const all=p.nodes.flatMap(n=>[n,n.in,n.out]),pad=Math.ceil(p.strokeWidth/2)+2,x=Math.floor(Math.min(...all.map(n=>n.x)))-pad,y=Math.floor(Math.min(...all.map(n=>n.y)))-pad;
  const width=Math.max(1,Math.ceil(Math.max(...all.map(n=>n.x)))-x+pad),height=Math.max(1,Math.ceil(Math.max(...all.map(n=>n.y)))-y+pad),path=structuredClone(p);
  for(const n of path.nodes)for(const a of [n,n.in,n.out]){a.x-=x;a.y-=y;}return{path,x,y,image:renderPath(path,width,height)};
}
export const nodeAt=(x,y)=>({x,y,in:{x,y},out:{x,y},linked:true});
export function shapePath(kind,a,b,style={}){
  const x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(a.x-b.x),h=Math.abs(a.y-b.y);let nodes;
  if(kind==='ellipse'){
    const k=.5522847498;nodes=[nodeAt(x+w/2,y),nodeAt(x+w,y+h/2),nodeAt(x+w/2,y+h),nodeAt(x,y+h/2)];
    nodes[0].in.x-=w*k/2;nodes[0].out.x+=w*k/2;nodes[1].in.y-=h*k/2;nodes[1].out.y+=h*k/2;nodes[2].in.x+=w*k/2;nodes[2].out.x-=w*k/2;nodes[3].in.y+=h*k/2;nodes[3].out.y-=h*k/2;
  }else if(kind==='line')nodes=[nodeAt(a.x,a.y),nodeAt(b.x,b.y)];
  else if(kind==='polygon')nodes=Array.from({length:Math.max(3,Math.min(12,style.sides||5))},(_,i)=>nodeAt(x+w/2+w/2*Math.cos(i*2*Math.PI/(style.sides||5)-Math.PI/2),y+h/2+h/2*Math.sin(i*2*Math.PI/(style.sides||5)-Math.PI/2)));
  else nodes=[nodeAt(x,y),nodeAt(x+w,y),nodeAt(x+w,y+h),nodeAt(x,y+h)];
  return{version:1,nodes,fill:'#d4ec98',stroke:'#ffffff',strokeWidth:2,...style,closed:kind!=='line'&&style.closed!==false,fillEnabled:kind!=='line'&&style.fillEnabled!==false};
}
export function worldPoint(l,p){const a=l.rotation*Math.PI/180,cx=l.image.width/2,cy=l.image.height/2,x=(p.x-cx)*l.scale*(l.flip?-1:1),y=(p.y-cy)*l.scale;return{x:l.x+cx*l.scale+x*Math.cos(a)-y*Math.sin(a),y:l.y+cy*l.scale+x*Math.sin(a)+y*Math.cos(a)};}
export function worldPath(l){const p=structuredClone(l.path);p.nodes=p.nodes.map(n=>({...worldPoint(l,n),in:worldPoint(l,n.in),out:worldPoint(l,n.out),linked:n.linked}));p.strokeWidth*=l.scale;return p;}
// De Casteljau splitting keeps the original cubic instead of replacing it with
// two straight segments when inserting an anchor.
export function splitSegment(p,index,t=.5){
  const mix=(a,b)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}),a=p.nodes[index],b=p.nodes[(index+1)%p.nodes.length],u=mix(a,a.out),v=mix(a.out,b.in),w=mix(b.in,b),d=mix(u,v),e=mix(v,w),point=mix(d,e);
  a.out=u;b.in=w;p.nodes.splice(index+1,0,{...point,in:d,out:e,linked:true});
}
