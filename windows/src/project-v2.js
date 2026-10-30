import {validateText,validatePath} from './semantic.js';
import {validateWarp} from './warp.js';
import { canvas } from './pixels.js';
import { walk } from './document.js';
import { normalizedSelection, selectionFromMask } from './selection.js';
import { workerTask } from './jobs/runner.js';
const encoder=new TextEncoder();
function checkAbort(signal){if(signal?.aborted)throw new DOMException('Canceled','AbortError');}
async function png(image){const blob=await new Promise(resolve=>image.toBlob(resolve,'image/png'));if(!blob)throw new Error('Image encoding failed.');return new Uint8Array(await blob.arrayBuffer());}
// PNG previews and original high-precision/RAW resources are independent ZIP
// entries. The preview is never substituted for an original during a save.
export async function serializeProjectV2(doc,{signal,onProgress=()=>{}}={}){
  const resources={},manifest={format:'com.compositor.windows',version:2,colorSpace:'legacy-srgb',width:doc.width,height:doc.height,name:doc.name,layers:[]};
  let counter=0,done=0,count=0;walk(doc.layers,()=>count++);
  const resource=(bytes,extension)=>{const name=`assets/r${++counter}.${extension}`;resources[name]=bytes;return name;};
  async function encode(nodes){const result=[];for(const l of nodes){
    checkAbort(signal);const {image,mask,originalImage,originalMask,children,highPrecision,raw,...properties}=l;
    const n={...properties,image:image?resource(await png(image),'png'):null,mask:mask?resource(await png(mask),'png'):null,originalImage:originalImage?resource(await png(originalImage),'png'):null,originalMask:originalMask?resource(await png(originalMask),'png'):null};
    if(highPrecision){const {data,...metadata}=highPrecision;n.highPrecision={...metadata,byteOrder:'little-endian',resource:resource(new Uint8Array(data.buffer,data.byteOffset,data.byteLength).slice(),'bin')};}
    if(raw){const {source,...metadata}=raw;n.raw={...metadata,resource:source?resource(source.slice(),'bin'):null};}
    if(children)n.children=await encode(children);result.push(n);onProgress(++done/Math.max(1,count)*.5);
  }return result;}
  manifest.layers=await encode(doc.layers);
  const selection=normalizedSelection(doc._selection,doc.width,doc.height);if(selection)manifest.selection=resource(await png(selection.mask),'png');
  checkAbort(signal);return workerTask('zip',{manifest,resources},{signal,onProgress:v=>onProgress(.5+v*.5)});
}
export async function parseProjectV2(bytes,parseLegacy,{signal,onProgress=()=>{}}={}){
  const {manifest:m,resources}=await workerTask('unzip',bytes,{signal,onProgress:v=>onProgress(v*.6)});
  canvas(m.width,m.height);if(m.colorSpace!=='legacy-srgb')throw new Error('Unsupported project color space.');
  const load=async name=>{
    checkAbort(signal);const bytes=resources[name];if(!bytes||!name.endsWith('.png')||bytes.byteLength<24)throw new Error('Missing project image.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);if(view.getUint32(0)!==0x89504e47)throw new Error('Invalid project PNG.');canvas(view.getUint32(16),view.getUint32(20));
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));try{const img=new Image();img.src=url;await img.decode();const result=canvas(img.naturalWidth,img.naturalHeight);result.getContext('2d').drawImage(img,0,0);return result;}finally{URL.revokeObjectURL(url);}
  };
  const doc=await parseLegacy(encoder.encode(JSON.stringify({...m,version:1,selection:undefined})),{decodeImage:load});
  let originalPixels=0;
  async function restore(nodes,source){for(let i=0;i<nodes.length;i++){
    const l=nodes[i],n=source[i];
    for(const key of ['text','path','vectorMask','effects','warp'])if(n[key]!==undefined){if(JSON.stringify(n[key]).length>1000000)throw new Error('Oversized layer metadata.');l[key]=structuredClone(n[key]);}
    for(const key of ['originalImage','originalMask'])if(n[key]){l[key]=await load(n[key]);originalPixels+=l[key].width*l[key].height;if(originalPixels>64000000)throw new Error('Project exceeds 64 MP original resource budget.');}
    if(l.text?.version===1)validateText(l.text);if(l.path?.version===1)validatePath(l.path);if(l.vectorMask?.version===1)validatePath(l.vectorMask);
    if(l.warp?.version===1){
      validateWarp(l.warp);const b=l.warp.bounds;
      if(!l.originalImage||!b||!Number.isSafeInteger(b.x)||!Number.isSafeInteger(b.y)||b.width!==l.image?.width||b.height!==l.image?.height)throw new Error('Invalid deformation original or bounds.');
      if(l.originalMask&&(l.originalMask.width!==l.originalImage.width||l.originalMask.height!==l.originalImage.height))throw new Error('Invalid deformation original mask dimensions.');
    }
    if(n.highPrecision){
      const p=n.highPrecision,bytes=resources[p.resource],Type=p.type==='uint16'?Uint16Array:p.type==='float32'?Float32Array:null;
      canvas(p.width,p.height);if(!Type||p.channels!==4||(p.byteOrder&&p.byteOrder!=='little-endian')||!bytes||bytes.byteLength!==p.width*p.height*4*Type.BYTES_PER_ELEMENT)throw new Error('Invalid high precision resource.');
      l.highPrecision={width:p.width,height:p.height,channels:4,type:p.type,data:new Type(bytes.slice().buffer)};
      if(p.type==='float32'&&l.highPrecision.data.some(v=>!Number.isFinite(v)))throw new Error('Non-finite high precision pixels.');
    }
    if(n.raw){const {resource,...metadata}=n.raw;if(resource&&!resources[resource])throw new Error('Missing original RAW resource.');l.raw={...metadata,source:resource?resources[resource].slice():null};}
    if(l.children)await restore(l.children,n.children);
  }}
  await restore(doc.layers,m.layers);if(m.selection)doc._selection=selectionFromMask(await load(m.selection));
  if(doc._selection&&(doc._selection.mask.width!==doc.width||doc._selection.mask.height!==doc.height))throw new Error('Invalid selection dimensions.');
  checkAbort(signal);doc.projectVersion=2;onProgress(1);return doc;
}
