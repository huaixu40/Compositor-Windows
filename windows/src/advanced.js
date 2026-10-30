import {canvas,copy,layer,cloneDocument,findLayer,siblings,invalidate,localPoint,pixelBytes} from './engine.js';
import {defaultText,renderText,fontAvailable,renderPath,normalizePath,shapePath,nodeAt,worldPoint,worldPath,tracePath,splitSegment} from './semantic.js';
import {selectionFromMask} from './selection.js';
import {warpJob} from './jobs/warp.js';
import {getLanguage} from './i18n.js';
const $=id=>document.getElementById(id),tr=(en,zh)=>getLanguage()==='zh-CN'?zh:en;
const advancedTools=['text','pen','shape','transform'];
export function installAdvanced(s,{register,execute,chooseTool,setSelection,enabled}){
  let draft=null,drag=null,session=null,work=null,controller=null,generation=0;
  const style={kind:'rectangle',fill:'#d4ec98',stroke:'#ffffff',strokeWidth:2,fillEnabled:true,sides:5,closed:true},transform={mode:'free',ratio:true};
  const current=()=>findLayer(s.doc,s.active),fail=e=>s.toast(e.message),editable=()=>current()?.path||current()?.vectorMask;
  const button=(root,id)=>{const b=document.createElement('button');b.dataset.command=id;b.textContent=tr(...labels[id]);b.disabled=!enabled(id);if(b.disabled)b.title=tr('Select a compatible target first','请先选择适用的目标');b.onclick=()=>execute(id);root.append(b);return b;};
  const labels={ 'edit-text':['Edit text','编辑文字'],'edit-path':['Edit path / vector mask','编辑路径 / 矢量蒙版'],'apply-path':['Apply path','提交路径'],'cancel-advanced':['Cancel','取消'],'path-insert':['Insert anchor','插入节点'],'path-delete':['Delete anchor','删除节点'],'path-selection':['Path to selection','路径转选区'],'path-mask':['Mask layer below','作为下一层矢量蒙版'],'begin-transform':['Free transform','自由变换'],'apply-transform':['Apply transform','提交变换'],'reset-warp':['Reset deformation','重置变形'],rasterize:['Rasterize','栅格化']};
  function field(root,key,en,zh,object,type,values){const label=document.createElement('label');label.textContent=tr(en,zh);const input=document.createElement(type==='select'?'select':'input');input.dataset.advanced=key;
    if(type==='select')for(const [value,en,zh]of values)input.add(new Option(tr(en,zh),value));else{input.type=type;if(type==='number'){input.min=values[0];input.max=values[1];input.step=values[2]||1;}}
    if(type==='checkbox')input.checked=object[key];else input.value=object[key];input.onchange=()=>{const value=type==='checkbox'?input.checked:type==='number'?Number(input.value):input.value;if(type==='number'&&(!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max))){input.value=object[key];return;}object[key]=value;if(draft){Object.assign(draft.path,style);s.drawOverlay();}if(key==='mode'&&session)beginTransform(true);};label.append(input);root.append(label);return input;
  }
  function add(l){let count=0;const countLayers=nodes=>nodes.forEach(n=>{count++;if(n.children)countLayers(n.children);});countLayers(s.doc.layers);if(count>=500||pixelBytes(s.doc)+pixelBytes({layers:[l]})>256000000)throw new Error(tr('Document resource limit exceeded.','超过文档资源限制。'));s.checkpoint();const anchor=current(),list=anchor?siblings(s.doc,anchor.id):s.doc.layers;list.splice(anchor?list.indexOf(anchor):0,0,l);s.active=l.id;s.target='image';s.reveal();s.render();}
  function cancel(){generation++;controller?.abort();controller=null;session=work=draft=drag=null;s.render();}
  function checkSession(){if(session&&(session.document!==s.doc||session.history!==s.history.past.at(-1)||session.id!==s.active)){cancel();throw new Error(tr('Document changed; preview was canceled.','文档已更改，预览已取消。'));}}
  function createText(p,width=0,height=0,existing=null){
    if(existing?.warp){s.toast(tr('Reset deformation before editing text.','请先重置变形，再编辑文字。'));return;}
    const t=existing?structuredClone(existing.text):defaultText();if(width>8&&height>8)Object.assign(t,{mode:'box',width:Math.max(16,Math.round(width)),height:Math.max(16,Math.round(height))});
    const dialog=document.createElement('dialog');dialog.id='text-dialog';dialog.className='semantic-dialog';const title=document.createElement('h2');title.textContent=tr('Editable text','可编辑文字');dialog.append(title);
    const input=document.createElement('textarea');input.id='text-content';input.value=t.content;input.maxLength=4000;input.spellcheck=false;input.rows=4;dialog.append(input);
    const controls=document.createElement('div');controls.className='semantic-controls';dialog.append(controls);
    field(controls,'font','Font','字体',t,'text');field(controls,'size','Size','字号',t,'number',[1,512]);field(controls,'color','Color','颜色',t,'color');field(controls,'tracking','Tracking px','字距 px',t,'number',[-20,100,.1]);field(controls,'leading','Line spacing','行距倍数',t,'number',[.5,5,.05]);field(controls,'align','Alignment','对齐',t,'select',[['left','Left','左'],['center','Center','中'],['right','Right','右']]);field(controls,'mode','Type','类型',t,'select',[['point','Point','点文字'],['box','Paragraph','段落文字']]);field(controls,'width','Box width','框宽',t,'number',[16,8192]);field(controls,'height','Box height','框高',t,'number',[16,8192]);field(controls,'bold','Bold','粗体',t,'checkbox');field(controls,'italic','Italic','斜体',t,'checkbox');
    const preview=document.createElement('canvas');preview.id='text-preview';const notice=document.createElement('p');notice.id='text-warning';notice.setAttribute('role','status');dialog.append(preview,notice);
    const actions=document.createElement('div');actions.className='dialog-actions';const cancelButton=document.createElement('button'),apply=document.createElement('button');cancelButton.textContent=tr('Cancel','取消');apply.textContent=tr('Apply text','应用文字');apply.id='apply-text';apply.className='accent';actions.append(cancelButton,apply);dialog.append(actions);document.body.append(dialog);
    let rendered=null,composing=false;const refresh=()=>{if(composing)return;t.content=input.value;try{rendered=renderText(t);preview.width=rendered.image.width;preview.height=rendered.image.height;preview.getContext('2d').drawImage(rendered.image,0,0);notice.textContent=(!fontAvailable(t.font)?tr('Font unavailable; system fallback is shown. ','字体不可用，当前显示系统替代字体。 '):'')+(rendered.overflow?tr('Text overflows the paragraph box and is clipped.','文字超过段落框，超出部分被裁切。'):'');apply.disabled=false;}catch(e){notice.textContent=e.message;rendered=null;apply.disabled=true;}};
    input.addEventListener('compositionstart',()=>{composing=true;apply.disabled=true;});input.addEventListener('compositionend',()=>{composing=false;refresh();});input.oninput=refresh;controls.addEventListener('change',refresh);cancelButton.onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
    apply.onclick=()=>{if(composing||!rendered)return;try{delete t.psdSource;delete t.psdOrigin;const l=existing?findLayer(s.doc,existing.id):null;if(existing&&!l)throw new Error('Layer no longer exists.');if(l){s.checkpoint();l.text=structuredClone(t);l.image=rendered.image;if(l.vectorMask)l.mask=coverageMask(l.vectorMask,l.image.width,l.image.height);else if(l.mask){const mask=canvas(l.image.width,l.image.height),ctx=mask.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,mask.width,mask.height);ctx.drawImage(l.mask,0,0);l.mask=mask;}invalidate(l);s.render();}else add(layer(t.content.split('\n')[0].slice(0,50)||tr('Text','文字'),rendered.image,{x:p.x,y:p.y,text:structuredClone(t)}));dialog.close();}catch(e){notice.textContent=e.message;}};
    dialog.addEventListener('keydown',e=>{if(e.isComposing||composing){if(e.key==='Escape')e.preventDefault();return;}if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();apply.click();}});dialog.showModal();refresh();input.focus();input.select();
  }
  function editPath(){const l=current();if(!editable())return;if(l.warp){s.toast(tr('Reset deformation before editing paths.','请先重置变形，再编辑路径。'));return;}draft={id:l.id,mask:!l.path,path:worldPath({...l,path:l.path||l.vectorMask}),selected:0,history:s.history.past.at(-1),document:s.doc};for(const key of ['fill','fillEnabled','stroke','strokeWidth','closed'])style[key]=draft.path[key];s.tool='pen';s.render();}
  function applyPath(){if(!draft||draft.path.nodes.length<2)return;try{if(draft.document&& (draft.document!==s.doc||draft.history!==s.history.past.at(-1)))throw new Error(tr('Document changed; path was canceled.','文档已更改，路径已取消。'));const p=draft.path,l=draft.id?findLayer(s.doc,draft.id):null;
    if(l&&draft.mask){const path=structuredClone(p);path.nodes=path.nodes.map(n=>({...localPoint(l,n),in:localPoint(l,n.in),out:localPoint(l,n.out),linked:n.linked}));const mask=coverageMask(path,l.image.width,l.image.height);s.checkpoint();l.vectorMask=path;l.mask=mask;invalidate(l);}
    else{const result=normalizePath(p);if(l){if(l.mask)throw new Error(tr('Remove the raster mask before reshaping this path.','请先移除栅格蒙版，再修改此路径形状。'));s.checkpoint();Object.assign(l,result,{scale:1,rotation:0,flip:false});invalidate(l);}else add(layer(tr('Path','路径'),result.image,{x:result.x,y:result.y,path:result.path}));}
    draft=drag=null;s.render();}catch(e){fail(e);}}
  function coverageMask(path,w,h){const c=renderPath({...path,fillEnabled:true,closed:true},w,h,true),ctx=c.getContext('2d'),data=ctx.getImageData(0,0,w,h);for(let i=0;i<data.data.length;i+=4){data.data[i]=data.data[i+1]=data.data[i+2]=data.data[i+3];data.data[i+3]=255;}ctx.putImageData(data,0,0);return c;}
  function pathSelection(){const l=current();if(!l?.path)return;const p=worldPath(l),image=renderPath({...p,closed:true,fillEnabled:true},s.doc.width,s.doc.height,true);setSelection(selectionFromMask(image));}
  function pathMask(){const l=current(),list=l?siblings(s.doc,l.id):null,target=list?.[list.indexOf(l)+1];if(!l?.path||!target?.image||target.warp){s.toast(tr('Place a pixel layer directly below this path.','请在路径下方紧邻放置未变形的像素层。'));return;}const p=worldPath(l);p.nodes=p.nodes.map(n=>({...localPoint(target,n),in:localPoint(target,n.in),out:localPoint(target,n.out),linked:n.linked}));p.closed=p.fillEnabled=true;const mask=coverageMask(p,target.image.width,target.image.height);s.checkpoint();target.vectorMask=p;target.mask=mask;target.maskEnabled=true;l.visible=false;s.active=target.id;s.target='mask';invalidate(target);s.render();}
  function rasterize(){const l=current();if(!l)return;s.checkpoint();if(s.target==='mask'&&l.vectorMask&&!l.warp)delete l.vectorMask;else for(const key of ['text','path','vectorMask','warp','originalImage','originalMask'])delete l[key];invalidate(l);s.render();}
  function beginTransform(keepMode=false){
    const l=current();if(!l?.image)return;controller?.abort();generation++;if(!keepMode&&l.warp)transform.mode=l.warp.mode==='mesh'?'mesh':'perspective';
    const source=l.originalImage||l.image,W=source.width,H=source.height;let points;
    if(l.warp){points=l.warp.points.map(p=>worldPoint(l,{x:p.x*W-l.warp.bounds.x,y:p.y*H-l.warp.bounds.y}));if(points.length===9&&transform.mode!=='mesh')points=[points[0],points[2],points[8],points[6]];}
    else points=[{x:0,y:0},{x:l.image.width,y:0},{x:l.image.width,y:l.image.height},{x:0,y:l.image.height}].map(p=>worldPoint(l,p));
    if(transform.mode==='mesh'&&points.length===4){const[a,b,c,d]=points;points=Array.from({length:9},(_,i)=>{const u=i%3/2,v=Math.floor(i/3)/2;return{x:a.x*(1-u)*(1-v)+b.x*u*(1-v)+c.x*u*v+d.x*(1-u)*v,y:a.y*(1-u)*(1-v)+b.y*u*(1-v)+c.y*u*v+d.y*(1-u)*v};});}
    session={document:s.doc,id:l.id,history:s.history.past.at(-1),source,mask:l.originalMask||l.mask,points};work=cloneDocument(s.doc);s.tool='transform';s.render();
  }
  async function previewTransform(){if(!session)return;try{checkSession();const job=++generation;controller?.abort();controller=new AbortController();const saved=session,warp={version:1,mode:transform.mode==='mesh'?'mesh':'perspective',points:saved.points.map(p=>({x:p.x/saved.source.width,y:p.y/saved.source.height}))};
    const result=await warpJob(saved.source,warp,{signal:controller.signal});let mask=null;if(saved.mask)mask=(await warpJob(saved.mask,warp,{signal:controller.signal})).image;
    if(job!==generation||saved!==session)return;checkSession();const l=findLayer(work,saved.id);Object.assign(l,{image:result.image,mask,originalImage:saved.source,originalMask:saved.mask,warp:{...warp,bounds:result.bounds},x:result.bounds.x,y:result.bounds.y,scale:1,rotation:0,flip:false});invalidate(l);session.ready=true;s.renderPixels();
  }catch(e){if(e.name!=='AbortError'){if(session)session.ready=false;fail(e);}}}
  async function applyTransform(){if(!session)return;await previewTransform();if(!session?.ready)return;try{checkSession();const result=work,id=session.id;s.checkpoint();session=work=drag=null;s.doc=result;s.active=id;s.render();}catch(e){fail(e);}}
  function resetWarp(){const l=current();if(!l?.originalImage)return;s.checkpoint();const original=l.originalImage;l.image=original;l.mask=l.originalMask||null;for(const key of ['warp','originalImage','originalMask'])delete l[key];invalidate(l);s.render();}
  register('edit-text',...labels['edit-text'],()=>createText(null,0,0,current()),()=>!!current()?.text);register('edit-path',...labels['edit-path'],editPath,()=>!!editable());register('apply-path',...labels['apply-path'],applyPath,()=>!!draft&&draft.path.nodes.length>=2);register('cancel-advanced',...labels['cancel-advanced'],cancel,()=>!!(draft||session));
  register('path-insert',...labels['path-insert'],()=>{if(!draft)return;const index=draft.selected;if(index===draft.path.nodes.length-1&&!draft.path.closed)return;splitSegment(draft.path,index);draft.selected++;s.drawOverlay();},()=>!!draft);
  register('path-delete',...labels['path-delete'],()=>{if(draft?.path.nodes.length>2){draft.path.nodes.splice(draft.selected,1);draft.selected=Math.max(0,draft.selected-1);s.drawOverlay();}},()=>!!draft&&draft.path.nodes.length>2);
  register('path-selection',...labels['path-selection'],pathSelection,()=>!!current()?.path&&!current()?.warp);register('path-mask',...labels['path-mask'],pathMask,()=>!!current()?.path&&!current()?.warp);register('begin-transform',...labels['begin-transform'],()=>beginTransform(),()=>!!current()?.image);register('apply-transform',...labels['apply-transform'],applyTransform,()=>!!session);register('reset-warp',...labels['reset-warp'],resetWarp,()=>!!current()?.warp);register('rasterize',...labels.rasterize,rasterize,()=>!!(current()?.text||current()?.path||current()?.vectorMask||current()?.warp));
  function refresh(root){
    if(!advancedTools.includes(s.tool))return;const l=current();
    if(s.tool==='text'){button(root,'edit-text').disabled=!l?.text;button(root,'rasterize');$('tool-hint').textContent=tr('Click for point text · drag for paragraph','点击创建点文字 · 拖动创建段落');}
    if(['pen','shape'].includes(s.tool)){
      if(s.tool==='shape'){field(root,'kind','Shape','形状',style,'select',[['rectangle','Rectangle','矩形'],['ellipse','Ellipse','椭圆'],['line','Line','直线'],['polygon','Polygon','多边形']]);field(root,'sides','Sides','边数',style,'number',[3,12]);}
      field(root,'fill','Fill','填充',style,'color');field(root,'fillEnabled','Fill','填充',style,'checkbox');field(root,'stroke','Stroke','描边',style,'color');field(root,'strokeWidth','Width','线宽',style,'number',[0,200]);field(root,'closed','Closed','闭合',style,'checkbox');
      for(const id of ['edit-path','apply-path','path-insert','path-delete','path-selection','path-mask','cancel-advanced','rasterize'])button(root,id);
      $('tool-hint').textContent=tr('Drag handles · Alt breaks linkage · Enter applies','拖动方向手柄 · Alt 断开联动 · Enter 提交');
    }
    if(s.tool==='transform'){
      field(root,'mode','Mode','模式',transform,'select',[['free','Scale / rotate','缩放 / 旋转'],['perspective','Perspective / skew','透视 / 倾斜'],['mesh','3 × 3 mesh','3 × 3 网格']]);field(root,'ratio','Keep ratio','保持比例',transform,'checkbox');
      if(session){const p=session.points,minX=Math.min(...p.map(n=>n.x)),minY=Math.min(...p.map(n=>n.y)),width=Math.max(...p.map(n=>n.x))-minX,height=Math.max(...p.map(n=>n.y))-minY,values={width:Math.round(width),height:Math.round(height),angle:0,skew:0};
        for(const [key,en,zh,range]of [['width','Width','宽',[1,8192]],['height','Height','高',[1,8192]],['angle','Rotate Δ','旋转 Δ',[-180,180]],['skew','Skew Δ','倾斜 Δ',[-75,75]]]){const input=field(root,key,en,zh,values,'number',range);input.onchange=()=>{const v=Number(input.value);if(!Number.isFinite(v)||v<range[0]||v>range[1])return;const cx=minX+width/2,cy=minY+height/2,a=v*Math.PI/180;session.points=p.map(n=>{let x=n.x-cx,y=n.y-cy;if(key==='width'){x*=v/width;if(transform.ratio)y*=v/width;}if(key==='height'){y*=v/height;if(transform.ratio)x*=v/height;}if(key==='skew')x+=y*Math.tan(a);if(key==='angle')[x,y]=[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)];return{x:cx+x,y:cy+y};});previewTransform();s.render();};}
      }
      for(const id of ['begin-transform','apply-transform','cancel-advanced','reset-warp','rasterize'])button(root,id);$('tool-hint').textContent=tr('Drag handles · Enter applies · Esc cancels','拖动控制点 · Enter 提交 · Esc 取消');
    }
  }
  function down(p,e){if(!advancedTools.includes(s.tool))return false;
    if(s.tool==='text'||s.tool==='shape'){const l=current(),q=l?.text?localPoint(l,p):null;drag={start:p,end:p,kind:s.tool,existing:q&&q.x>=0&&q.y>=0&&q.x<l.image.width&&q.y<l.image.height?l:null};return true;}
    if(s.tool==='pen'){
      if(!draft)draft={path:{version:1,nodes:[],...style},selected:0};
      let hit=null;draft.path.nodes.forEach((n,i)=>{for(const key of ['in','out','anchor']){const a=key==='anchor'?n:n[key];if(Math.hypot(p.x-a.x,p.y-a.y)<8/s.zoom)hit={i,key};}});
      if(hit){draft.selected=hit.i;drag={kind:'node',...hit,start:p,original:structuredClone(draft.path.nodes[hit.i])};}
      else{const n=nodeAt(p.x,p.y);draft.path.nodes.push(n);draft.selected=draft.path.nodes.length-1;drag={kind:'node',i:draft.selected,key:'out',start:p,original:structuredClone(n)};}
      s.drawOverlay();return true;
    }
    if(s.tool==='transform'){
      if(!session)beginTransform();if(!session)return true;let index=session.points.findIndex(a=>Math.hypot(a.x-p.x,a.y-p.y)<10/s.zoom);const top=rotationHandle();
      if(top&&Math.hypot(top.x-p.x,top.y-p.y)<10/s.zoom)index=-2;
      drag={kind:'transform',index,start:p,points:structuredClone(session.points)};return true;
    }return true;
  }
  function move(p,e){if(!drag)return false;
    if(drag.kind==='text'||drag.kind==='shape'){drag.end=p;s.drawOverlay();return true;}
    if(drag.kind==='node'){const n=draft.path.nodes[drag.i],o=drag.original,dx=p.x-drag.start.x,dy=p.y-drag.start.y;if(drag.key==='anchor'){for(const a of [n,n.in,n.out]){const b=a===n?o:a===n.in?o.in:o.out;a.x=b.x+dx;a.y=b.y+dy;}}else{n[drag.key]={x:p.x,y:p.y};if(!e.altKey&&n.linked!==false){const other=drag.key==='in'?'out':'in';n[other]={x:2*n.x-p.x,y:2*n.y-p.y};}if(e.altKey)n.linked=false;}s.drawOverlay();return true;}
    if(drag.kind==='transform'&&session){const points=structuredClone(drag.points),i=drag.index;
      if(i===-1){for(const n of points){n.x+=p.x-drag.start.x;n.y+=p.y-drag.start.y;}}
      else if(i===-2){const cx=points.reduce((sum,n)=>sum+n.x,0)/points.length,cy=points.reduce((sum,n)=>sum+n.y,0)/points.length,a=Math.atan2(p.y-cy,p.x-cx)-Math.atan2(drag.start.y-cy,drag.start.x-cx);for(const n of points){const x=n.x-cx,y=n.y-cy;n.x=cx+x*Math.cos(a)-y*Math.sin(a);n.y=cy+x*Math.sin(a)+y*Math.cos(a);}}
      else if(transform.mode!=='free')points[i]=p;
      else{const o=points[0],u={x:points[1].x-o.x,y:points[1].y-o.y},v={x:points[3].x-o.x,y:points[3].y-o.y},det=u.x*v.y-u.y*v.x;if(Math.abs(det)<.0001)return true;let a=((p.x-o.x)*v.y-(p.y-o.y)*v.x)/det,b=(u.x*(p.y-o.y)-u.y*(p.x-o.x))/det;let left=[0,3].includes(i)?a:0,right=[1,2].includes(i)?a:1,top=[0,1].includes(i)?b:0,bottom=[2,3].includes(i)?b:1;
        if(transform.ratio||e.shiftKey){const factor=Math.max(.01,Math.abs(right-left));if([0,1].includes(i))top=bottom-factor;else bottom=top+factor;}if(right-left<.01||bottom-top<.01)return true;
        [[left,top],[right,top],[right,bottom],[left,bottom]].forEach(([a,b],j)=>points[j]={x:o.x+u.x*a+v.x*b,y:o.y+u.y*a+v.y*b});}
      session.points=points;session.ready=false;s.drawOverlay();return true;
    }return false;
  }
  function up(){if(!drag)return false;const finished=drag;drag=null;
    if(finished.kind==='text'){const a=finished.start,b=finished.end;createText({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y)},Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.hypot(b.x-a.x,b.y-a.y)<8?finished.existing:null);}
    if(finished.kind==='shape'&&Math.hypot(finished.end.x-finished.start.x,finished.end.y-finished.start.y)>2){try{const result=normalizePath(shapePath(style.kind,finished.start,finished.end,style));add(layer(tr('Shape','形状'),result.image,{x:result.x,y:result.y,path:result.path}));}catch(e){fail(e);}}
    if(finished.kind==='transform')previewTransform();s.render();return true;
  }
  function rotationHandle(){if(!session||session.points.length!==4)return null;const[a,b]=session.points;return{x:(a.x+b.x)/2,y:(a.y+b.y)/2-30/s.zoom};}
  function draw(ctx){ctx.save();ctx.lineWidth=1/s.zoom;ctx.strokeStyle='#d4ec98';ctx.fillStyle='#161a20';
    const handle=(p,color='#d4ec98')=>{ctx.strokeStyle=color;ctx.beginPath();ctx.rect(p.x-4/s.zoom,p.y-4/s.zoom,8/s.zoom,8/s.zoom);ctx.fill();ctx.stroke();};
    if(drag&&['text','shape'].includes(drag.kind)){const a=drag.start,b=drag.end;if(drag.kind==='shape'){const p=shapePath(style.kind,a,b,style);tracePath(ctx,p);ctx.stroke();}else ctx.strokeRect(a.x,a.y,b.x-a.x,b.y-a.y);}
    if(draft?.path.nodes.length){tracePath(ctx,draft.path);ctx.stroke();draft.path.nodes.forEach((n,i)=>{ctx.beginPath();ctx.moveTo(n.in.x,n.in.y);ctx.lineTo(n.x,n.y);ctx.lineTo(n.out.x,n.out.y);ctx.stroke();handle(n.in,'#93bbfa');handle(n.out,'#93bbfa');handle(n,i===draft.selected?'#ffba65':'#d4ec98');});}
    if(session){const p=session.points,lines=p.length===4?[[0,1,2,3,0]]:[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8]];for(const indices of lines){ctx.beginPath();indices.forEach((i,j)=>j?ctx.lineTo(p[i].x,p[i].y):ctx.moveTo(p[i].x,p[i].y));ctx.stroke();}p.forEach(n=>handle(n));const h=rotationHandle();if(h)handle(h,'#ffba65');}
    ctx.restore();
  }
  function key(e){if(!advancedTools.includes(s.tool))return false;if(e.key==='Escape'&&(draft||session)){cancel();return true;}if(e.key==='Enter'){if(session)execute('apply-transform');else if(draft)execute('apply-path');return true;}if(['Delete','Backspace'].includes(e.key)&&draft){execute('path-delete');return true;}return false;}
  return{refresh,down,move,up,draw,key,editText:()=>current()?.text&&createText(null,0,0,current()),get previewDoc(){return session&&work&&session.document===s.doc?work:null;},get pending(){return!!(draft||session);},cancel,reset(){generation++;controller?.abort();session=work=draft=drag=null;},leave(){if(session||draft)cancel();},isTool:()=>advancedTools.includes(s.tool)};
}
