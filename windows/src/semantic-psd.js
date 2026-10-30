import {defaultText,validateText,validatePath,worldPoint,worldPath} from './semantic.js';
const rgb=hex=>({r:parseInt(hex.slice(1,3),16),g:parseInt(hex.slice(3,5),16),b:parseInt(hex.slice(5,7),16)});
const hex=color=>color&&['r','g','b'].every(k=>Number.isFinite(color[k]))?'#'+['r','g','b'].map(k=>Math.max(0,Math.min(255,Math.round(color[k]))).toString(16).padStart(2,'0')).join(''):null;
export function importText(n){
  const p=n.text;if(!p||p.orientation==='vertical'||p.textPath||(p.warp&&p.warp.style!=='none'))return null;
  const style={...p.style,...p.styleRuns?.[0]?.style},paragraph={...p.paragraphStyle,...p.paragraphStyleRuns?.[0]?.style};
  if(p.styleRuns?.some(r=>JSON.stringify({...p.style,...r.style})!==JSON.stringify(style))||p.paragraphStyleRuns?.some(r=>JSON.stringify({...p.paragraphStyle,...r.style})!==JSON.stringify(paragraph)))return null;
  if(style.baselineShift||style.underline||style.strikethrough||style.strokeFlag||style.fontCaps||style.fontBaseline||style.verticalScale&&style.verticalScale!==1||style.horizontalScale&&style.horizontalScale!==1||paragraph.firstLineIndent||paragraph.startIndent||paragraph.endIndent||paragraph.spaceBefore||paragraph.spaceAfter)return null;
  const matrix=p.transform||[1,0,0,1,0,0];if(matrix.length!==6||matrix.some(v=>!Number.isFinite(v))||Math.abs(matrix[1])>.0001||Math.abs(matrix[2])>.0001||Math.abs(matrix[0]-matrix[3])>.0001||matrix[0]<=0)return null;
  const color=hex(style.fillColor);if(!color||!['left','center','right',undefined].includes(paragraph.justification))return null;
  const box=p.boxBounds,t={...defaultText(),content:p.text.replace(/\r/g,'\n'),font:style.font?.name==='ArialMT'?'Arial':style.font?.name||'Arial',size:(style.fontSize||48)*matrix[0],color,tracking:(style.tracking||0)*(style.fontSize||48)*matrix[0]/1000,leading:style.leading?style.leading/(style.fontSize||48):1.3,align:paragraph.justification||'left',bold:!!style.fauxBold,italic:!!style.fauxItalic,mode:p.shapeType==='box'?'box':'point',width:Math.max(16,Math.min(8192,Math.round(box?box[2]-box[0]:(n.right-n.left)||400))),height:Math.max(16,Math.min(8192,Math.round(box?box[3]-box[1]:(n.bottom-n.top)||180))),psdSource:structuredClone(p),psdOrigin:{x:n.left||0,y:n.top||0}};
  try{validateText(t);return t;}catch{return null;}
}
export function exportText(l){
  const t=l.text;if(t?.version!==1||l.warp||l.filters.some(f=>f.enabled!==false))return null;
  if(t.psdSource&&l.scale===1&&l.rotation===0&&!l.flip){const p=structuredClone(t.psdSource);p.transform=p.transform||[1,0,0,1,0,0];p.transform[4]+=l.x-t.psdOrigin.x;p.transform[5]+=l.y-t.psdOrigin.y;return p;}
  const a=l.rotation*Math.PI/180,c=Math.cos(a),s=Math.sin(a),pad=Math.ceil(t.size*.3),anchor=worldPoint(l,{x:t.align==='center'?l.image.width/2:t.align==='right'?l.image.width-pad:pad,y:pad+t.size});
  const p={text:t.content.replace(/\n/g,'\r'),transform:[c*l.scale*(l.flip?-1:1),s*l.scale*(l.flip?-1:1),-s*l.scale,c*l.scale,anchor.x,anchor.y],orientation:'horizontal',antiAlias:'smooth',shapeType:t.mode==='box'?'box':'point',style:{font:{name:t.font==='Arial'?'ArialMT':t.font},fontSize:t.size,fillColor:rgb(t.color),tracking:t.tracking/t.size*1000,autoLeading:false,leading:t.size*t.leading,fauxBold:t.bold,fauxItalic:t.italic},paragraphStyle:{justification:t.align}};
  if(t.mode==='box')p.boxBounds=[0,-t.size,t.width-pad*2,t.height-pad-t.size];return p;
}
export function importVector(n){
  const m=n.vectorMask,p=m?.paths?.[0];if(!p||m.paths.length!==1||m.invert||m.notLink||m.fillStartsWithAllPixels||p.operation&&p.operation!=='combine'||p.knots.length<2||p.knots.length>1000||n.mask&&!n.mask.fromVectorData||n.vectorFill&&n.vectorFill.type!=='color'||n.vectorStroke?.content&&n.vectorStroke.content.type!=='color'||m.disable&&n.vectorFill)return null;
  const s=n.vectorStroke;
  if(n.mask?.vectorMaskFeather||n.mask?.vectorMaskDensity!==undefined&&n.mask.vectorMaskDensity!==1)return null;
  if(s?.strokeEnabled&&(s.lineDashSet?.length||s.lineDashOffset?.value||s.lineWidth?.units&&s.lineWidth.units!=='Pixels'||s.lineAlignment&&s.lineAlignment!=='center'||s.lineCapType&&s.lineCapType!=='round'||s.lineJoinType&&s.lineJoinType!=='round'||s.blendMode&&s.blendMode!=='normal'||s.opacity!==undefined&&s.opacity!==1))return null;
  const color=hex(n.vectorFill?.color),stroke=hex(n.vectorStroke?.content?.color);if(n.vectorFill&&!color)return null;
  const path={version:1,nodes:p.knots.map(k=>({x:k.points[2]-(n.left||0),y:k.points[3]-(n.top||0),in:{x:k.points[0]-(n.left||0),y:k.points[1]-(n.top||0)},out:{x:k.points[4]-(n.left||0),y:k.points[5]-(n.top||0)},linked:k.linked})),closed:!p.open,fillEnabled:!!color&&n.vectorStroke?.fillEnabled!==false,fill:color||'#ffffff',stroke:stroke||'#ffffff',strokeWidth:n.vectorStroke?.strokeEnabled?(n.vectorStroke.lineWidth?.value||1):0};
  try{validatePath(path);return{path,shape:!!n.vectorFill};}catch{return null;}
}
export function exportVector(l){
  const path=l.path||l.vectorMask;if(path?.version!==1||l.warp||l.filters.some(f=>f.enabled!==false))return null;
  const p=worldPath({...l,path}),vectorMask={paths:[{open:!p.closed,operation:'combine',fillRule:'even-odd',knots:p.nodes.map(n=>({linked:n.linked!==false,points:[n.in.x,n.in.y,n.x,n.y,n.out.x,n.out.y]}))}]};
  const result={vectorMask};if(l.vectorMask)vectorMask.disable=l.maskEnabled===false;if(l.path){result.vectorFill={type:'color',color:rgb(path.fill)};result.vectorStroke={strokeEnabled:path.strokeWidth>0,fillEnabled:path.fillEnabled,lineWidth:{units:'Pixels',value:path.strokeWidth*l.scale},lineCapType:'round',lineJoinType:'round',lineAlignment:'center',blendMode:'normal',opacity:1,content:{type:'color',color:rgb(path.stroke)}};}return result;
}
export function psdExportNotes(doc){const notes=[];const visit=nodes=>nodes.forEach(l=>{if(l.warp)notes.push(`${l.name}: Deformation exports as a raster copy; original pixels and editable deformation remain in .cwin.`);else{if(l.text&&!exportText(l))notes.push(`${l.name}: Text with pixel filters exports as a raster copy.`);if((l.path||l.vectorMask)&&!exportVector(l))notes.push(`${l.name}: Filtered vector content exports as a raster copy.`);}if(l.children)visit(l.children);});visit(doc.layers);return notes;}
