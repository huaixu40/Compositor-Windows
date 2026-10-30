import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { initializeCanvas } from 'ag-psd';
import { importPsd, exportPsd } from '../formats.js';
import { composite, canvas } from '../engine.js';
import { packDocument, unpackDocument } from './document-transfer.js';
import {warpImage} from '../warp.js';
initializeCanvas((w,h)=>new OffscreenCanvas(w,h));
const MAX=512*1024*1024;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
self.onmessage=async({data:{kind,payload}})=>{
  try{
    if(kind==='warp'){
      const image=canvas(payload.image.width,payload.image.height);image.getContext('2d').drawImage(payload.image,0,0);payload.image.close();
      const result=warpImage(image,payload.warp,value=>postMessage({progress:value})),bitmap=await createImageBitmap(result.image);
      postMessage({result:{image:bitmap,bounds:result.bounds}},[bitmap]);
    }else if(kind==='psd-read'){
      postMessage({progress:.1});const imported=importPsd(payload.bytes,payload.name);postMessage({progress:.65});
      const doc=await packDocument(imported.doc),preview=imported.preview?await packDocument(imported.preview):null;
      postMessage({result:{doc:doc.document,notes:imported.notes,preview:preview?.document||null}},[...doc.transfer,...(preview?.transfer||[])]);
    }else if(kind==='export'){
      const doc=unpackDocument(payload.document);postMessage({progress:.15});let bytes;
      if(payload.extension==='psd')bytes=exportPsd(doc);
      else{let image=composite(doc);if(payload.extension==='jpg'){const white=canvas(doc.width,doc.height),ctx=white.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,doc.width,doc.height);ctx.drawImage(image,0,0);image=white;}postMessage({progress:.7});bytes=new Uint8Array(await (await image.convertToBlob({type:payload.extension==='jpg'?'image/jpeg':'image/png',quality:.94})).arrayBuffer());}
      postMessage({result:bytes},[bytes.buffer]);
    }else if(kind==='zip'){
      const files={},manifest=payload.manifest,entries=Object.entries(payload.resources);manifest.assets={};let size=0;
      for(let i=0;i<entries.length;i++){
        const [name,bytes]=entries[i];size+=bytes.byteLength;if(size>MAX)throw new Error('Project resources exceed 512 MB.');
        files[name]=bytes;manifest.assets[name]={size:bytes.byteLength,sha256:await digest(bytes)};postMessage({progress:(i+1)/Math.max(1,entries.length)*.8});
      }
      files['manifest.json']=strToU8(JSON.stringify(manifest));const bytes=zipSync(files,{level:0});if(bytes.byteLength>MAX)throw new Error('Project exceeds 512 MB.');postMessage({result:bytes},[bytes.buffer]);
    }else if(kind==='unzip'){
      if(payload.byteLength>MAX)throw new Error('Project exceeds 512 MB.');let count=0,total=0;
      const files=unzipSync(payload,{filter:entry=>{
        if(++count>2500||!/^manifest\.json$|^assets\/[a-zA-Z0-9_-]+\.(png|bin)$/.test(entry.name))throw new Error('Invalid project resource path.');
        total+=entry.originalSize;if(total>MAX||entry.originalSize>256*1024*1024)throw new Error('Project resource limit exceeded.');return true;
      }});
      if(count!==Object.keys(files).length||!files['manifest.json']||files['manifest.json'].byteLength>8*1024*1024)throw new Error('Missing, duplicate or oversized project manifest.');
      const manifest=JSON.parse(strFromU8(files['manifest.json']));if(manifest.format!=='com.compositor.windows'||manifest.version!==2||!manifest.assets)throw new Error('Unsupported project format/version.');
      const entries=Object.entries(manifest.assets);if(entries.length+1!==Object.keys(files).length)throw new Error('Project contains unlisted resources.');
      for(let i=0;i<entries.length;i++){
        const [name,info]=entries[i],bytes=files[name];if(!bytes||bytes.byteLength!==info.size||await digest(bytes)!==info.sha256)throw new Error('Project resource checksum mismatch: '+name);
        postMessage({progress:(i+1)/Math.max(1,entries.length)});
      }
      delete files['manifest.json'];postMessage({result:{manifest,resources:files}},[...new Set(Object.values(files).map(b=>b.buffer))]);
    }else throw new Error('Unknown background task.');
  }catch(error){postMessage({error:error.message});}
};
