import { canvas, copy, layer, cloneDocument, cloneLayer, walk, findLayer, siblings, invalidate, composite, filtered, localPoint, pixelBytes } from './engine.js';
import { serializeProject, parseProject, loadImage } from './formats.js';
import { getLanguage } from './i18n.js';
import { normalizedSelection, shapeSelection, selectionFromMask, featherSelection, combineSelections, invertSelection, coverageInLayer, applyCoverage, floodMask, moveLayer } from './selection.js';
const $ = id => document.getElementById(id);
const names = {
  move:['Move','移动'], select:['Rectangle selection','矩形选区'], ellipse:['Ellipse selection','椭圆选区'], lasso:['Lasso','套索'], polygon:['Polygon selection','多边形套索'], wand:['Magic wand','魔棒'],
  brush:['Brush','画笔'], erase:['Eraser','橡皮'], clone:['Clone stamp','仿制图章'], crop:['Crop','裁剪'], bucket:['Paint bucket','油漆桶'], gradient:['Gradient','渐变'], picker:['Eyedropper','吸管'], hand:['Hand','抓手'], zoom:['Zoom','缩放']
};
const icons={move:'M4 4v15l5-5 4 7 3-2-4-7h7Z',select:'M4 4h16v16H4Z',ellipse:'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',lasso:'M6 16C-2 7 6 2 15 4s9 12 0 13S5 12 7 19q2 4 5 1',polygon:'m4 8 8-5 8 7-5 10-10-3Z',wand:'m4 20 12-12m-3-5v3m6-1 2-2m-2 8h3',brush:'m8 14 9-10q3-2 3 1l-8 11M8 14q-5-1-4 5l-2 2q8 1 10-5Z',erase:'m3 14 9-10 9 8-8 8H9ZM8 9l9 8M13 20h9',clone:'M5 16h14v5H5Zm3-4 2-3V5q2-4 4 0v4l2 3v4H8Z',crop:'M7 2v15h15M2 7h15v15',bucket:'m3 10 8-8 9 9-8 8Zm0 0h17M19 16q-5 6 0 6t0-6',gradient:'M3 4h18v16H3ZM5 6v12m3-12v12m3-12v12m4-12v12',picker:'m14 3 7 7-3 3-3-3-9 10H3v-3l10-9-2-2Z',hand:'M8 11V5q0-3 2 0v6-8q2-3 3 0v8-7q3-2 3 1v7-6q3-1 3 2v9q0 5-6 5-4 0-6-4l-4-5q-1-3 2-2l3 3',zoom:'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6M6 10h8m-4-4v8'};
const keys={v:'move',m:'select',l:'lasso',w:'wand',b:'brush',e:'erase',s:'clone',c:'crop',g:'gradient',i:'picker',h:'hand',z:'zoom'};
const text = (en, zh) => getLanguage()==='zh-CN' ? zh : en;
const selectionTools=['select','ellipse','lasso','polygon','wand'];
const brushTools=['brush','erase','clone'];
export function installInteractions(s) {
  let gesture=null, polygon=[], pendingShape=null, floating=null, dropped=false, layerDrag=null, cloneSource=null, alignedOffset=null, spaceTool=null, operationBusy=false;
  const options={};
  for(const name of Object.keys(names)) options[name]={size:40,hardness:100,flow:100,color:'#d4ec98',mode:'replace',feather:0,ratio:'free',tolerance:32,contiguous:true,autoSelect:true,aligned:true,sample:'layer',radius:1,gradient:'linear',endColor:'#ffffff'};
  const oldActions={};
  const commands=new Map();
  let clipboardQueue=Promise.resolve(), pendingClipboard=0;
  const message=(en,zh)=>s.toast(text(en,zh));
  const sel=()=>normalizedSelection(s.selection,s.doc.width,s.doc.height);
  const current=()=>findLayer(s.doc,s.active);
  const surface=()=>s.target==='mask'?current()?.mask:current()?.image;
  function remember() { s.checkpoint(); const snapshot=s.history.past.at(-1); if(snapshot) snapshot._selection=s.selection; }
  function change(fn) { if(s.busy||operationBusy) return; remember(); fn(); s.reveal(); s.render(); }
  function setSelection(value) { if(value===s.selection)return;remember();s.selection=value;s.render(); }
  function combine(next,mode) { setSelection(combineSelections(sel(),next,mode,s.doc.width,s.doc.height)); }
  function mode(event) { return event.shiftKey&&event.altKey?'intersect':event.shiftKey?'add':event.altKey?'subtract':options[s.tool].mode; }
  function point(e) { const box=$('overlay').getBoundingClientRect(); return {x:(e.clientX-box.left)/s.zoom,y:(e.clientY-box.top)/s.zoom}; }
  function bounded(p) { return {x:Math.max(0,Math.min(s.doc.width,p.x)),y:Math.max(0,Math.min(s.doc.height,p.y))}; }
  function shapeEnd(start,end) { const ratio=options[s.tool].ratio; if(ratio==='free') return end; const [w,h]=ratio.split(':').map(Number), dx=end.x-start.x,dy=end.y-start.y; const size=Math.min(Math.abs(dx),Math.abs(dy)*w/h); return bounded({x:start.x+Math.sign(dx||1)*size,y:start.y+Math.sign(dy||1)*size*h/w}); }
  function coverage(l=current()) { return s.selection ? coverageInLayer(sel(),l,(s.target==='mask'?l.mask:l.image).width,(s.target==='mask'?l.mask:l.image).height) : null; }
  function gray(hex) { const a=hex.slice(1).match(/../g).map(v=>parseInt(v,16)); const n=Math.round(a[0]*.2126+a[1]*.7152+a[2]*.0722); return `rgb(${n},${n},${n})`; }
  function register(id,en,zh,run,enabled=()=>true) { commands.set(id,{id,en,zh,run,enabled}); }
  async function execute(id) {
    const command=commands.get(id); if(!command||s.busy||operationBusy) return;
    if(floating&&!['commit-float','cancel-float'].includes(id)) commitFloating();
    if(!command.enabled()) { message('This command is not available for the current target.','当前目标无法执行此操作。'); return; }
    if(['copy','cut','copy-merged','paste'].includes(id)) {
      pendingClipboard++;
      const task=clipboardQueue.then(()=>command.run());
      clipboardQueue=task.catch(e=>s.toast(e.message)).finally(()=>{pendingClipboard--;});
      return clipboardQueue;
    }
    try { return await command.run(); } catch(e) { s.toast(e.message); }
  }
  function drawOverlay(ctx) {
    const selection=sel();
    ctx.save(); ctx.lineWidth=1/s.zoom;
    if(selection&&!selection.empty) { ctx.setLineDash([5/s.zoom,5/s.zoom]); ctx.strokeStyle='#fff'; ctx.stroke(selection.outline); ctx.lineDashOffset=5/s.zoom; ctx.strokeStyle='#111'; ctx.stroke(selection.outline); }
    ctx.setLineDash([]); ctx.strokeStyle='#d4ec98';
    if(pendingShape) {
      const {points,kind}=pendingShape; ctx.beginPath();
      if(kind==='polygon') { points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); }
      else {const a=points[0],b=points[1],x=Math.min(a.x,b.x),y=Math.min(a.y,b.y),w=Math.abs(b.x-a.x),h=Math.abs(b.y-a.y); if(kind==='ellipse') ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2); else ctx.rect(x,y,w,h);}
      ctx.stroke();
    }
    if(floating) {ctx.strokeStyle='#ffce7b'; const l=current(); ctx.strokeRect(floating.bounds.x+l.x,floating.bounds.y+l.y,floating.bounds.w,floating.bounds.h);}
    ctx.restore();
  }
  function chooseTool(name) { if(floating) commitFloating(); if(gesture)up();polygon=[]; pendingShape=null;cropRect=null; s.tool=name; refresh(); s.drawOverlay(); }
  const tools=$('tool-palette');
  for(const name of Object.keys(names)) {const button=document.createElement('button');button.dataset.tool=name;button.innerHTML=`<svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="${icons[name]}"/></svg>`;button.onclick=()=>chooseTool(name);tools.append(button);}
  function field(parent,key,en,zh,type,values) {
    const label=document.createElement('label'); label.append(text(en,zh)); const input=document.createElement(type==='select'?'select':'input'); input.dataset.option=key;
    if(type==='select') for(const [value,a,b] of values) input.add(new Option(text(a,b),value));
    else {input.type=type;if(type==='number'){input.min=values[0];input.max=values[1];input.step=values[2]||1;}}
    const value=options[s.tool][key]; if(type==='checkbox')input.checked=value;else input.value=value;
    input.onchange=()=>{let v=type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value;if(type==='number'){v=Number.isFinite(v)?Math.max(Number(input.min),Math.min(Number(input.max),v)):value;input.value=v;}options[s.tool][key]=v;syncBrush();};
    label.append(input);parent.append(label);return input;
  }
  function actionButton(parent,id) {const c=commands.get(id);const b=document.createElement('button');b.dataset.command=id;b.textContent=text(c.en,c.zh);b.disabled=!c.enabled();b.onclick=()=>execute(id);parent.append(b);}
  function syncBrush() {const o=options[s.tool];$('brush-size').value=o.size;$('brush-hardness').value=o.hardness;$('brush-flow').value=o.flow;$('color').value=o.color;}
  function refresh() {
    for(const button of tools.children){const name=button.dataset.tool,key=name==='ellipse'?'Shift+M':name==='polygon'?'Shift+L':name==='bucket'?'Shift+G':Object.keys(keys).find(k=>keys[k]===name)?.toUpperCase();button.title=text(...names[name])+(key?` (${key})`:'');button.setAttribute('aria-label',button.title);button.classList.toggle('active',name===s.tool);}
    $('tool-name').textContent=text(...names[s.tool]); const root=$('tool-options'); root.replaceChildren();
    if(s.tool==='move') {field(root,'autoSelect','Auto-select layer','自动选择图层','checkbox');actionButton(root,'float');actionButton(root,'commit-float');actionButton(root,'cancel-float');}
    if(selectionTools.includes(s.tool)) {field(root,'mode','Mode','模式','select',[['replace','New','新选区'],['add','Add','相加'],['subtract','Subtract','相减'],['intersect','Intersect','相交']]);field(root,'feather','Feather','羽化','number',[0,100]);if(['select','ellipse'].includes(s.tool))field(root,'ratio','Ratio','比例','select',[['free','Free','自由'],['1:1','1:1','1:1'],['4:3','4:3','4:3'],['16:9','16:9','16:9']]);actionButton(root,'invert-selection');actionButton(root,'selection-mask');}
    if(brushTools.includes(s.tool)){field(root,'size','Size','大小','number',[1,500]);field(root,'flow','Flow %','流量 %','number',[1,100]);if(s.tool!=='clone')field(root,'hardness','Hardness %','硬度 %','number',[0,100]);if(s.tool==='brush')field(root,'color','Color','颜色','color');}
    if(s.tool==='clone'){field(root,'aligned','Aligned','对齐','checkbox');field(root,'sample','Sample','取样','select',[['layer','Current layer','当前图层'],['merged','All visible','所有可见图层']]);}
    if(['wand','bucket'].includes(s.tool)){field(root,'tolerance','Tolerance','容差','number',[0,255]);field(root,'contiguous','Contiguous','连续','checkbox');}
    if(['bucket','gradient'].includes(s.tool))field(root,'color','Color','颜色','color');
    if(s.tool==='gradient'){field(root,'endColor','End','终点颜色','color');field(root,'gradient','Style','样式','select',[['linear','Linear','线性'],['radial','Radial','径向']]);}
    if(s.tool==='picker'){field(root,'radius','Sample size','取样大小','select',[['1','1 × 1','1 × 1'],['3','3 × 3','3 × 3'],['5','5 × 5','5 × 5']]);field(root,'sample','Source','来源','select',[['layer','Current layer','当前图层'],['merged','All visible','所有可见图层']]);}
    if(s.tool==='crop'){field(root,'ratio','Ratio','比例','select',[['free','Free','自由'],['1:1','1:1','1:1'],['4:3','4:3','4:3'],['16:9','16:9','16:9']]);actionButton(root,'apply-crop');actionButton(root,'cancel-crop');}
    if(['hand','zoom'].includes(s.tool)){actionButton(root,'fit');actionButton(root,'actual');}
    $('tool-hint').textContent=floating?text('Drag pixels · Enter apply · Esc cancel','拖动内容 · Enter 提交 · Esc 取消'):s.tool==='polygon'?text('Click vertices · double-click / Enter finish · Esc cancel','点击添加节点 · 双击 / Enter 完成 · Esc 取消'):s.tool==='clone'?text('Alt-click to sample','Alt 点击取样'):s.tool==='crop'?text('Drag crop bounds · Enter apply · Esc cancel','拖动裁剪范围 · Enter 提交 · Esc 取消'):s.selection?text('Selection active','选区已启用'):'';
    syncBrush();
  }
  function hit(nodes,p) {for(const l of nodes){if(!l.visible||!l.opacity)continue;if(l.children){const found=hit(l.children,p);if(found)return found;}else if(l.image){const q=localPoint(l,p),x=Math.floor(q.x),y=Math.floor(q.y);if(x>=0&&y>=0&&x<l.image.width&&y<l.image.height&&l.image.getContext('2d').getImageData(x,y,1,1).data[3]&&(!l.mask||!l.maskEnabled||l.mask.getContext('2d').getImageData(x,y,1,1).data[0]))return l;}}return null;}
  function paintDab(l,start,end) {
    const o=options[s.tool], target=surface(), scale=l.image?l.scale:1, radius=o.size/scale/2;
    const cover=gesture.coverage;
    const left=Math.max(0,Math.floor(Math.min(start.x,end.x)-radius-2)),top=Math.max(0,Math.floor(Math.min(start.y,end.y)-radius-2));
    const region={x:left,y:top,w:Math.ceil(Math.max(start.x,end.x)+radius+2)-left,h:Math.ceil(Math.max(start.y,end.y)+radius+2)-top};
    applyCoverage(target,cover,ctx=>{
      ctx.save();ctx.globalAlpha=o.flow/100;ctx.globalCompositeOperation=s.tool==='erase'&&s.target!=='mask'?'destination-out':'source-over';
      const distance=Math.hypot(end.x-start.x,end.y-start.y),steps=Math.max(1,Math.ceil(distance/Math.max(.5,radius*.2)));
      for(let i=distance?1:0;i<=(distance?steps:0);i++){
        const x=start.x+(end.x-start.x)*i/steps,y=start.y+(end.y-start.y)*i/steps;
        ctx.save();ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();
        if(s.tool==='clone'){ctx.drawImage(gesture.clone,-gesture.offset.x,-gesture.offset.y);}
        else {const color=s.target==='mask'?(s.tool==='erase'?'#ffffff':gray(o.color)):o.color;if(o.hardness===100)ctx.fillStyle=color;else{const g=ctx.createRadialGradient(x,y,radius*o.hardness/100,x,y,radius);g.addColorStop(0,color);g.addColorStop(1,'transparent');ctx.fillStyle=g;}ctx.fillRect(x-radius,y-radius,2*radius,2*radius);}
        ctx.restore();
      }
      ctx.restore();
    },region);invalidate(l);
  }
  function beginFloating() {
    const l=current(), selected=sel(); if(!l?.image||!selected||selected.empty||s.target==='mask')return;
    const original=s.doc, working=cloneDocument(original), source=findLayer(working,l.id);
    const image=composite({...original,layers:[{...l,opacity:1,blend:'normal'}]});
    const ctx=image.getContext('2d');ctx.globalCompositeOperation='destination-in';ctx.drawImage(selected.mask,0,0);
    const mask=source.maskEnabled&&source.mask?copy(source.mask):canvas(l.image.width,l.image.height),mctx=mask.getContext('2d');
    if(!source.maskEnabled||!source.mask){mctx.fillStyle='#fff';mctx.fillRect(0,0,mask.width,mask.height);}
    const cover=coverageInLayer(selected,l,l.image.width,l.image.height).getContext('2d').getImageData(0,0,l.image.width,l.image.height).data,data=mctx.getImageData(0,0,mask.width,mask.height);
    for(let i=0;i<data.data.length;i+=4)for(let c=0;c<3;c++)data.data[i+c]*=1-cover[i+3]/255;mctx.putImageData(data,0,0);source.mask=mask;source.maskEnabled=true;
    const moved=layer(text('Moved selection','移动的选区'),image,{opacity:l.opacity,blend:l.blend});const list=siblings(working,l.id);list.splice(list.indexOf(source),0,moved);
    floating={original,active:l.id,selection:s.selection,bounds:selected};s.doc=working;s.active=moved.id;s.target='image';s.selection=null;s.tool='move';s.render();
  }
  function commitFloating(){if(!floating)return;const working=s.doc,active=s.active,previous=floating;s.doc=previous.original;s.selection=previous.selection;remember();s.doc=working;s.active=active;s.selection=null;floating=null;s.render();}
  function cancelFloating(){if(!floating)return;s.doc=floating.original;s.active=floating.active;s.selection=floating.selection;floating=null;s.render();}
  async function pngBytes(image){return new Uint8Array(await (await new Promise(resolve=>image.toBlob(resolve,'image/png'))).arrayBuffer());}
  async function copyPixels(merged=false,cut=false){
    const l=current(), selection=sel(), document=s.doc, historyEntry=s.history.past.at(-1), active=s.active, target=s.target, selectionRef=s.selection; if(!l&&!merged)return;
    if(selection?.empty)return;
    let image,project=null,origin=null;
    if(!selection&&!merged){project=serializeProject({...s.doc,layers:[l]});image=composite({...s.doc,layers:[l]});}
    else{
      if(s.target==='mask'&&!merged){image=canvas(s.doc.width,s.doc.height);const ctx=image.getContext('2d');if(l.image){ctx.translate(l.x+l.image.width*l.scale/2,l.y+l.image.height*l.scale/2);ctx.rotate(l.rotation*Math.PI/180);ctx.scale(l.scale*(l.flip?-1:1),l.scale);ctx.drawImage(l.mask,-l.mask.width/2,-l.mask.height/2);}else ctx.drawImage(l.mask,0,0);}
      else image=composite({...s.doc,layers:merged?s.doc.layers:[l]});
      if(selection){const ctx=image.getContext('2d');ctx.globalCompositeOperation='destination-in';ctx.drawImage(selection.mask,0,0);const cropped=canvas(selection.w,selection.h);cropped.getContext('2d').drawImage(image,-selection.x,-selection.y);image=cropped;origin={x:selection.x,y:selection.y};}
    }
    await window.desktop.clipboardWrite({png:await pngBytes(image),project,origin});
    if(cut){
      if(s.doc!==document||s.history.past.at(-1)!==historyEntry||s.active!==active||s.target!==target||s.selection!==selectionRef)throw new Error(text('Copied. The document changed; cut was canceled.','已复制。文档发生变化，剪切已取消。'));
      if(selection)clearPixels();else execute('delete-layer');
    }
    message(cut?'Cut to clipboard':'Copied to clipboard',cut?'已剪切到剪贴板':'已复制到剪贴板');
  }
  async function paste(){
    const version=s.doc,historyEntry=s.history.past.at(-1),active=s.active,entry=await window.desktop.clipboardRead();if(!entry){message('The clipboard does not contain an image.','剪贴板中没有图片。');return;}
    let additions;
    if(entry.project){additions=(await parseProject(entry.project)).layers;walk(additions,n=>n.id=crypto.randomUUID());}
    else{const url=URL.createObjectURL(new Blob([entry.png],{type:'image/png'}));let image;try{image=await loadImage(url);}finally{URL.revokeObjectURL(url);}additions=[layer(text('Pasted image','粘贴的图片'),image,{x:entry.origin?.x??Math.round((s.doc.width-image.width)/2),y:entry.origin?.y??Math.round((s.doc.height-image.height)/2)})];}
    if(s.doc!==version||s.active!==active||s.history.past.at(-1)!==historyEntry)throw new Error(text('Document changed while reading clipboard. Paste again.','读取剪贴板时文档已变化，请重新粘贴。'));
    let count=0;walk([...s.doc.layers,...additions],()=>count++);
    if(count>500||pixelBytes(s.doc)+pixelBytes({layers:additions})>256000000)throw new Error(text('Paste exceeds the document pixel or layer limit.','粘贴将超出文档像素或图层数量限制。'));
    walk(additions,l=>{if(!l.image&&l.mask&&(l.mask.width!==s.doc.width||l.mask.height!==s.doc.height)){const mask=canvas(s.doc.width,s.doc.height),ctx=mask.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,mask.width,mask.height);ctx.drawImage(l.mask,0,0);l.mask=mask;}});
    change(()=>{const l=current(),list=l?siblings(s.doc,l.id):s.doc.layers;list.splice(l?list.indexOf(l):0,0,...additions);s.active=additions[0].id;s.target='image';s.selection=null;});
  }
  function clearPixels(){const l=current(),image=surface();if(!image)return;const cover=coverage(l);change(()=>{applyCoverage(image,cover,ctx=>{ctx.save();if(s.target==='mask'){ctx.fillStyle='#000';ctx.fillRect(0,0,image.width,image.height);}else ctx.clearRect(0,0,image.width,image.height);ctx.restore();});invalidate(l);});}
  function fill(){const l=current(),image=surface();if(!image)return;const cover=coverage(l),color=s.target==='mask'?gray(options.brush.color):options.brush.color;change(()=>{applyCoverage(image,cover,ctx=>{ctx.fillStyle=color;ctx.fillRect(0,0,image.width,image.height);});invalidate(l);});}
  function selectionMask(){const l=current();if(!l||!s.selection)return;const w=l.image?.width||s.doc.width,h=l.image?.height||s.doc.height,c=coverageInLayer(sel(),l,w,h),ctx=c.getContext('2d'),data=ctx.getImageData(0,0,w,h);for(let i=0;i<data.data.length;i+=4){const v=data.data[i+3];data.data[i]=data.data[i+1]=data.data[i+2]=v;data.data[i+3]=255;}ctx.putImageData(data,0,0);change(()=>{l.mask=c;l.maskEnabled=true;s.target='mask';});}
  let cropRect=null;
  function crop(){if(!cropRect)return;const x=Math.max(0,Math.floor(Math.min(cropRect[0].x,cropRect[1].x))),y=Math.max(0,Math.floor(Math.min(cropRect[0].y,cropRect[1].y))),right=Math.min(s.doc.width,Math.ceil(Math.max(cropRect[0].x,cropRect[1].x))),bottom=Math.min(s.doc.height,Math.ceil(Math.max(cropRect[0].y,cropRect[1].y)));if(right<=x||bottom<=y)return;change(()=>{walk(s.doc.layers,l=>{if(l.image){l.x-=x;l.y-=y;}else if(l.mask){const c=canvas(right-x,bottom-y);c.getContext('2d').drawImage(l.mask,-x,-y);l.mask=c;}});s.doc.width=right-x;s.doc.height=bottom-y;s.selection=null;cropRect=null;pendingShape=null;s.fit();});}
  for(const id of ['undo','redo','new','open','import','save','export-psd','export-png','export-jpg','duplicate','delete-layer','add-layer','add-mask','invert-mask','remove-mask','flip','reset-transform','fit','actual','zoom-in','zoom-out']){
    const button=$(id);oldActions[id]=button.onclick;register(id,button.title||button.textContent,button.title||button.textContent,()=>{
      const selection=id==='undo'?s.history.past.at(-1)?._selection:id==='redo'?s.history.future.at(-1)?._selection:undefined;
      if(['undo','redo'].includes(id))s.doc._selection=s.selection;
      const result=oldActions[id]?.();if(['undo','redo'].includes(id)){s.selection=selection||null;s.fit();s.render();}return result;
    },()=>id==='undo'?s.history.past.length>0:id==='redo'?s.history.future.length>0:['invert-mask','remove-mask'].includes(id)?!!current()?.mask:['flip','reset-transform'].includes(id)?!!current()?.image:['duplicate','delete-layer','add-mask'].includes(id)?!!current():true);button.onclick=()=>execute(id);
  }
  const pixelTarget=()=>!!surface();
  register('copy','Copy','复制',()=>copyPixels(),()=>!!current());register('cut','Cut','剪切',()=>copyPixels(false,true),()=>!!current()&&(!s.selection||pixelTarget()));register('copy-merged','Copy merged','合并复制',()=>copyPixels(true));register('paste','Paste','粘贴',paste);
  register('delete-pixels','Clear selected pixels','清除选区像素',clearPixels,pixelTarget);register('fill','Fill selection','填充选区',fill,pixelTarget);$('fill').onclick=()=>execute('fill');
  register('select-all','Select all','全选',()=>setSelection(invertSelection(null,s.doc.width,s.doc.height)));register('deselect','Deselect','取消选区',()=>setSelection(null));$('deselect').onclick=()=>execute('deselect');
  register('invert-selection','Invert selection','反选',()=>setSelection(invertSelection(sel(),s.doc.width,s.doc.height)));register('selection-mask','Selection to mask','选区转蒙版',selectionMask,()=>!!s.selection&&!!current());
  register('float','Move selection pixels','移动选区内容',beginFloating,()=>!!current()?.image&&!!s.selection&&!sel().empty&&s.target==='image');register('commit-float','Apply','提交',commitFloating,()=>!!floating);register('cancel-float','Cancel','取消',cancelFloating,()=>!!floating);
  register('apply-crop','Apply crop','应用裁剪',crop,()=>!!cropRect);register('cancel-crop','Cancel crop','取消裁剪',()=>{cropRect=null;pendingShape=null;s.drawOverlay();refresh();},()=>!!cropRect);
  register('group','Group layer','将图层编组',()=>change(()=>{const l=current(),list=siblings(s.doc,l.id),i=list.indexOf(l),group=layer(text('Group','图层组'),null,{children:[l],blend:'pass through'});list.splice(i,1,group);s.active=group.id;}),()=>!!current());
  register('new-group','New group','新建组',()=>change(()=>{const group=layer(text('Group','图层组'),null,{children:[],blend:'pass through'});s.doc.layers.unshift(group);s.active=group.id;}));
  register('rename','Rename','重命名',()=>{$('layer-name').focus();$('layer-name').select();},()=>!!current());
  register('merge-visible','Merge visible to new layer','合并可见图层到新层',()=>{const image=composite(s.doc);change(()=>{for(const l of s.doc.layers)l.visible=false;const result=layer(text('Merged visible','合并可见图层'),image);s.doc.layers.unshift(result);s.active=result.id;});});
  const translatedCommands={duplicate:['Duplicate layer','复制图层'],'delete-layer':['Delete layer','删除图层'],'add-mask':['Add / select mask','添加 / 选择蒙版'],'invert-mask':['Invert mask','反相蒙版'],'remove-mask':['Remove mask','移除蒙版'],flip:['Flip horizontal','水平翻转'],'reset-transform':['Reset transform','重置变换'],fit:['Fit','适应窗口'],actual:['Actual pixels','实际像素']};for(const [id,[en,zh]]of Object.entries(translatedCommands)){Object.assign(commands.get(id),{en,zh});}
  function context(event,layerId){event.preventDefault();if(layerId){s.active=layerId;s.target='image';s.render();}const menu=$('context-menu');menu.replaceChildren();
    const ids=layerId?['copy','cut','paste','duplicate','rename','group','new-group','add-mask','selection-mask','invert-mask','remove-mask','merge-visible','delete-layer']:['copy','copy-merged','cut','paste','fill','delete-pixels','select-all','deselect','invert-selection','selection-mask','float','flip','reset-transform'];
    for(const id of ids){const c=commands.get(id),button=document.createElement('button');button.dataset.command=id;button.textContent=text(c.en,c.zh);button.disabled=!c.enabled();if(button.disabled)button.title=text('Select a compatible target first','请先选择适用的目标');button.onclick=()=>{menu.hidden=true;execute(id);};menu.append(button);}
    menu.hidden=false;const rect=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(event.clientX,innerWidth-rect.width-4))+'px';menu.style.top=Math.max(4,Math.min(event.clientY,innerHeight-rect.height-4))+'px';
  }
  $('overlay').oncontextmenu=e=>context(e);$('layers').oncontextmenu=e=>{const row=e.target.closest('[data-layer]');context(e,row?.dataset.layer);};
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#context-menu'))$('context-menu').hidden=true;});
  function layerRows(){for(const row of $('layers').children){row.draggable=true;row.ondragstart=e=>{layerDrag=row.dataset.layer;dropped=false;e.dataTransfer.setData('text/plain',layerDrag);e.dataTransfer.effectAllowed='move';};row.ondragover=e=>{if(!layerDrag)return;e.preventDefault();for(const r of $('layers').children)r.classList.remove('drop-before','drop-after','drop-inside');const r=row.getBoundingClientRect(),fraction=(e.clientY-r.top)/r.height,group=findLayer(s.doc,row.dataset.layer)?.children;row.dataset.placement=group&&fraction>.25&&fraction<.75?'inside':fraction<.5?'before':'after';row.classList.add('drop-'+row.dataset.placement);};row.ondrop=e=>{e.preventDefault();e.stopPropagation();const id=layerDrag,dest=row.dataset.layer,placement=row.dataset.placement;layerDrag=null;dropped=true;if(moveLayer(s.doc,id,dest,placement,true))change(()=>{moveLayer(s.doc,id,dest,placement);s.active=id;});else message('Invalid move: group cycle or nesting limit.','无法移动：不能形成循环嵌套，也不能超过 32 层。');};row.ondragend=()=>{layerDrag=null;for(const r of $('layers').children)r.classList.remove('drop-before','drop-after','drop-inside');};}}
  $('layers').addEventListener('dragover',e=>{if(layerDrag)e.preventDefault();});$('layers').addEventListener('drop',e=>{if(!layerDrag||e.target.closest('[data-layer]'))return;e.preventDefault();const id=layerDrag;layerDrag=null;change(()=>moveLayer(s.doc,id,null,'after'));});
  function sourcePixels(){const l=current();return options[s.tool].sample==='merged'?composite(s.doc):l?.image?composite({...s.doc,layers:[{...l,opacity:1,blend:'normal'}]}):composite(s.doc);}
  function down(e){
    if(s.busy||operationBusy||e.button!==0||document.querySelector('dialog[open]'))return;const p=point(e),o=options[s.tool];
    if(s.tool==='hand'){gesture={kind:'hand',x:e.clientX,y:e.clientY,left:$('viewport').scrollLeft,top:$('viewport').scrollTop};}
    else if(s.tool==='zoom'){s.zoom=Math.max(.03,Math.min(8,s.zoom*(e.altKey?.8:1.25)));s.sizeView();s.drawOverlay();return;}
    else if(s.tool==='picker'){const image=sourcePixels(),radius=Number(o.radius),x=Math.max(0,Math.min(image.width-1,Math.floor(p.x-radius/2))),y=Math.max(0,Math.min(image.height-1,Math.floor(p.y-radius/2))),data=image.getContext('2d').getImageData(x,y,Math.min(radius,image.width-x),Math.min(radius,image.height-y)).data;const sums=[0,0,0];for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)sums[c]+=data[i+c];options.brush.color=options.bucket.color=options.gradient.color='#'+sums.map(n=>Math.round(n/(data.length/4)).toString(16).padStart(2,'0')).join('');syncBrush();return;}
    else if(s.tool==='polygon'){polygon.push(bounded(p));pendingShape={kind:'polygon',points:[...polygon]};s.drawOverlay();return;}
    else if(['select','ellipse','lasso','crop'].includes(s.tool)){gesture={kind:s.tool,start:bounded(p),points:[bounded(p)],mode:mode(e)};pendingShape={kind:s.tool==='lasso'?'polygon':s.tool==='ellipse'?'ellipse':'rectangle',points:[bounded(p),bounded(p)]};}
    else if(s.tool==='wand'){combine(featherSelection(floodMask(sourcePixels(),p.x,p.y,o.tolerance,o.contiguous),o.feather),mode(e));return;}
    else{
      if(s.tool==='move'&&o.autoSelect&&!floating){const hitLayer=hit(s.doc.layers,p);if(hitLayer){s.active=hitLayer.id;s.target='image';}}
      const l=current();if(!l)return;
      if(s.tool==='move'){
        if(!l.image&&!l.children)return;
        const positions=[],masks=[];walk([l],n=>{if(n.image)positions.push({l:n,x:n.x,y:n.y});else if(n.mask)masks.push({l:n,source:copy(n.mask)});});gesture={kind:'move',start:p,positions,masks,moved:false};
      }else{
        const image=surface();if(!image){message('Select pixels or a mask first.','请先选择像素图层或蒙版。');return;}const q=localPoint(l,p);
        if(s.tool==='clone'&&e.altKey){cloneSource={id:l.id,point:q,documentPoint:p};alignedOffset=null;message('Clone source set.','已设置仿制来源。');return;}
        if(s.tool==='clone'&&(!cloneSource||cloneSource.id!==l.id||s.target==='mask')){message('Alt-click to set a clone source first.','请先 Alt 点击设置仿制来源。');return;}
        if(s.tool==='gradient'){gesture={kind:'gradient',start:p,end:p};pendingShape={kind:'polygon',points:[p,p]};}
        else if(s.tool==='bucket'){
          const mask=floodMask(image,q.x,q.y,o.tolerance,o.contiguous).mask,existing=coverage(l);if(existing){const ctx=mask.getContext('2d');ctx.globalCompositeOperation='destination-in';ctx.drawImage(existing,0,0);}
          change(()=>{applyCoverage(image,mask,ctx=>{ctx.fillStyle=s.target==='mask'?gray(o.color):o.color;ctx.fillRect(0,0,image.width,image.height);});invalidate(l);});return;
        }else if(brushTools.includes(s.tool)){
          remember();gesture={kind:'paint',last:q,coverage:coverage(l)};
          if(s.tool==='clone'){
            gesture.offset=o.aligned&&alignedOffset?alignedOffset:{x:cloneSource.point.x-q.x,y:cloneSource.point.y-q.y};alignedOffset=gesture.offset;
            if(o.sample==='merged'){const merged=composite(s.doc),local=canvas(image.width,image.height),ctx=local.getContext('2d');ctx.translate(image.width/2,image.height/2);ctx.scale((l.flip?-1:1)/l.scale,1/l.scale);ctx.rotate(-l.rotation*Math.PI/180);ctx.translate(-l.x-image.width*l.scale/2,-l.y-image.height*l.scale/2);ctx.drawImage(merged,0,0);gesture.clone=local;}else gesture.clone=copy(image);
          }
          paintDab(l,q,q);
        }
      }
    }
    if(gesture&&e.isTrusted)$('overlay').setPointerCapture(e.pointerId);s.renderPixels();
  }
  function move(e){const p=point(e);if(!gesture){if(polygon.length){pendingShape={kind:'polygon',points:[...polygon,bounded(p)]};s.drawOverlay();}return;}
    if(gesture.kind==='hand'){$('viewport').scrollLeft=gesture.left-e.clientX+gesture.x;$('viewport').scrollTop=gesture.top-e.clientY+gesture.y;return;}
    if(['select','ellipse','crop'].includes(gesture.kind)){pendingShape.points=[gesture.start,shapeEnd(gesture.start,bounded(p))];s.drawOverlay();return;}
    if(gesture.kind==='lasso'){gesture.points.push(bounded(p));pendingShape.points=gesture.points;s.drawOverlay();return;}
    if(gesture.kind==='gradient'){gesture.end=p;pendingShape.points=[gesture.start,p];s.drawOverlay();return;}
    if(gesture.kind==='move'){const dx=Math.round(p.x-gesture.start.x),dy=Math.round(p.y-gesture.start.y);if(!gesture.moved&&(dx||dy)){if(!floating)remember();gesture.moved=true;}for(const a of gesture.positions){a.l.x=a.x+dx;a.l.y=a.y+dy;}for(const a of gesture.masks){const ctx=a.l.mask.getContext('2d');ctx.fillStyle='#000';ctx.fillRect(0,0,a.l.mask.width,a.l.mask.height);ctx.drawImage(a.source,dx,dy);}}
    if(gesture.kind==='paint'){const l=current(),q=localPoint(l,p);paintDab(l,gesture.last,q);gesture.last=q;}
    s.renderPixels();
  }
  function up(e){if(!gesture)return;const done=gesture;gesture=null;
    if(['select','ellipse','lasso'].includes(done.kind)){const points=done.kind==='lasso'?done.points:pendingShape.points;combine(shapeSelection(s.doc.width,s.doc.height,points,done.kind==='lasso'?'polygon':done.kind==='ellipse'?'ellipse':'rectangle',options[s.tool].feather),done.mode);pendingShape=null;}
    else if(done.kind==='crop'){cropRect=pendingShape.points;}
    else if(done.kind==='gradient'){const l=current(),image=surface(),a=localPoint(l,done.start),b=localPoint(l,done.end),o=options.gradient;if(Math.hypot(b.x-a.x,b.y-a.y)>0)change(()=>{applyCoverage(image,coverage(l),ctx=>{const g=o.gradient==='radial'?ctx.createRadialGradient(a.x,a.y,0,a.x,a.y,Math.hypot(b.x-a.x,b.y-a.y)):ctx.createLinearGradient(a.x,a.y,b.x,b.y);g.addColorStop(0,s.target==='mask'?gray(o.color):o.color);g.addColorStop(1,s.target==='mask'?gray(o.endColor):o.endColor);ctx.fillStyle=g;ctx.fillRect(0,0,image.width,image.height);});invalidate(l);});pendingShape=null;}
    s.render();
  }
  function finishPolygon(){if(polygon.length>=3)combine(shapeSelection(s.doc.width,s.doc.height,polygon,'polygon',options.polygon.feather),options.polygon.mode);polygon=[];pendingShape=null;s.drawOverlay();}
  $('overlay').onpointerdown=down;$('overlay').onpointermove=move;$('overlay').onpointerup=up;$('overlay').onpointercancel=up;$('overlay').ondblclick=()=>{if(s.tool==='polygon')finishPolygon();};
  $('viewport').addEventListener('pointerdown',e=>{if(e.target===$('viewport')&&s.tool==='hand')down(e);});
  document.addEventListener('keydown',e=>{
    if(!$('context-menu').hidden){
      const buttons=[...$('context-menu').querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next]?.focus();e.preventDefault();e.stopImmediatePropagation();return;}
      if(e.key==='Enter'&&index>=0){buttons[index].click();e.preventDefault();e.stopImmediatePropagation();return;}
    }
    if(e.isComposing||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)||e.target.isContentEditable)return;
    const k=e.key.toLowerCase();let action;
    if(e.ctrlKey||e.metaKey)action={c:e.shiftKey?'copy-merged':'copy',x:'cut',v:'paste',a:'select-all',d:e.shiftKey?'invert-selection':'deselect',z:e.shiftKey?'redo':'undo',y:'redo',j:'duplicate',o:'open',s:e.shiftKey?'export-psd':'save','0':'fit'}[k];
    else if(k==='delete'||k==='backspace')action=s.selection?'delete-pixels':'delete-layer';
    else if(k==='escape'){if(floating)cancelFloating();else{polygon=[];pendingShape=null;cropRect=null;gesture=null;$('context-menu').hidden=true;s.drawOverlay();refresh();}e.preventDefault();e.stopImmediatePropagation();return;}
    else if(k==='enter'){if(floating)commitFloating();else if(s.tool==='polygon')finishPolygon();else if(s.tool==='crop')crop();e.preventDefault();e.stopImmediatePropagation();return;}
    else if(k===' '&&!spaceTool){spaceTool=s.tool;s.tool='hand';refresh();e.preventDefault();e.stopImmediatePropagation();return;}
    else if(keys[k]){chooseTool(e.shiftKey&&k==='m'?'ellipse':e.shiftKey&&k==='l'?'polygon':e.shiftKey&&k==='g'?'bucket':keys[k]);e.preventDefault();e.stopImmediatePropagation();return;}
    if(action){e.preventDefault();e.stopImmediatePropagation();execute(action);}
  },true);
  document.addEventListener('keyup',e=>{if(e.key===' '&&spaceTool){s.tool=spaceTool;spaceTool=null;refresh();}});
  window.addEventListener('blur',()=>{if(gesture)up();if(spaceTool){s.tool=spaceTool;spaceTool=null;refresh();}});
  refresh();layerRows();
  return {refresh,drawOverlay,layerRows,execute,chooseTool,get pendingClipboard(){return pendingClipboard;},get options(){return options;},get floating(){return floating;},reset(){gesture=null;polygon=[];pendingShape=null;cropRect=null;floating=null;cloneSource=null;alignedOffset=null;},finishGesture:up};
}

