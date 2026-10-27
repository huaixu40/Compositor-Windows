import shader from './composite.wgsl';
import { BLENDS, filtered, walk, canvas, applyPsdAdjustment } from '../engine.js';
import { GpuFilters } from './filters.js';
const TILE=512, BUDGET=384*1024*1024;
const modes=Object.keys(BLENDS);
const present=`@group(0) @binding(0) var image:texture_2d<f32>;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f{return textureLoad(image,vec2i(p.xy),0);}`;
// Tiled GPU compositor. CPU canvases remain authoritative, so device loss or a
// failed allocation can always render the same document without recovery edits.
export class WebGpuBackend {
  constructor(canvas,{lost=()=>{}}={}){
    this.canvas=canvas;this.onLost=lost;this.textures=new Map();this.buffers=[];this.scratch=[];this.frame=0;this.bytes=0;this.invalid=false;this.lastFrameMs=0;this.adjustments=new Map();
  }
  async initialize(){
    const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw new Error('WebGPU unavailable.');
    this.adapterInfo={vendor:adapter.info.vendor,architecture:adapter.info.architecture};this.device=await adapter.requestDevice();
    this.device.lost.then(info=>{this.invalid=true;if(!this.disposed)this.onLost(info.message||'GPU device lost.');});
    this.device.addEventListener('uncapturederror',event=>{this.invalid=true;this.onLost(event.error.message);});
    const module=this.device.createShaderModule({code:shader}),format=navigator.gpu.getPreferredCanvasFormat();
    const messages=await module.getCompilationInfo();if(messages.messages.some(m=>m.type==='error'))throw new Error(messages.messages.map(m=>m.message).join('\n'));
    this.pipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
    const display=this.device.createShaderModule({code:present});this.presentPipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module:display,entryPoint:'vertex'},fragment:{module:display,entryPoint:'fragment',targets:[{format}]}});
    this.context=this.canvas.getContext('webgpu');this.context.configure({device:this.device,format,alphaMode:'premultiplied'});
    this.white=this.texture(1,1);this.device.queue.writeTexture({texture:this.white},new Uint8Array([255,255,255,255]),{bytesPerRow:4},{width:1,height:1});
    this.filters=await new GpuFilters(this.device,(w,h)=>this.texture(w,h)).initialize();
    return this;
  }
  texture(w,h){return this.device.createTexture({size:[w,h],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.COPY_SRC|GPUTextureUsage.RENDER_ATTACHMENT});}
  upload(image,revision=0){
    let entry=this.textures.get(image);if(!entry){entry={texture:this.texture(image.width,image.height),size:image.width*image.height*4,revision:null};this.textures.set(image,entry);this.bytes+=entry.size;}
    entry.used=this.frame;
    if(entry.revision!==revision){image.getContext('2d');this.device.queue.copyExternalImageToTexture({source:image},{texture:entry.texture,premultipliedAlpha:false},[image.width,image.height]);entry.revision=revision;}
    return entry.texture;
  }
  pair(depth){if(!this.scratch[depth])this.scratch[depth]=[this.texture(TILE,TILE),this.texture(TILE,TILE)];return this.scratch[depth];}
  supports(doc){return true;}
  adjustment(l,preview){
    const value=preview?.id===l.id&&preview.adjustment?preview.adjustment:l.adjustment,key=JSON.stringify(value);let entry=this.adjustments.get(l);
    if(!entry||entry.key!==key){const c=canvas(256,1),ctx=c.getContext('2d'),pixels=ctx.createImageData(256,1);for(let i=0;i<256;i++)pixels.data.set([i,i,i,255],i*4);ctx.putImageData(pixels,0,0);entry={key,image:applyPsdAdjustment(c,value)};this.adjustments.set(l,entry);}
    entry.frame=this.frame;return this.upload(entry.image);
  }
  dirtyTiles(doc,preview,revisions){
    const scene=[];let complex=false;walk(doc.layers,l=>{if(l.children||l.adjustment)complex=true;const w=(l.image?.width||doc.width)*l.scale,h=(l.image?.height||doc.height)*l.scale,a=l.rotation*Math.PI/180,bw=Math.abs(w*Math.cos(a))+Math.abs(h*Math.sin(a)),bh=Math.abs(w*Math.sin(a))+Math.abs(h*Math.cos(a));scene.push({id:l.id,image:l.image,mask:l.mask,key:JSON.stringify([l.x,l.y,l.scale,l.rotation,l.flip,l.visible,l.opacity,l.blend,l.maskEnabled,l.filters,l.adjustment,revisions(l),preview?.id===l.id?preview:null]),bounds:{x:l.x+w/2-bw/2-2,y:l.y+h/2-bh/2-2,w:bw+4,h:bh+4}});});
    const old=this.scene;this.scene=scene;
    if(!old||this.width!==doc.width||this.height!==doc.height||old.length!==scene.length||scene.some((n,i)=>n.id!==old[i].id))return null;
    const regions=[];for(let i=0;i<scene.length;i++){const n=scene[i],p=old[i];if(n.key!==p.key||n.image!==p.image||n.mask!==p.mask){if(complex)return null;regions.push(p.bounds,n.bounds);}}
    return regions;
  }
  render(doc,preview,revisions){
    if(this.invalid)throw new Error('GPU unavailable.');if(!this.supports(doc))return false;
    const start=performance.now();this.frame++;this.bufferIndex=0;
    const regions=this.dirtyTiles(doc,preview,revisions);
    const projected=doc.width*doc.height*4;let sources=0;walk(doc.layers,l=>{for(const c of [l.image,l.mask])if(c)sources+=c.width*c.height*4;if(l.image&&l.filters.some(f=>f.enabled!==false))sources+=l.image.width*l.image.height*8;});
    if(projected+sources+this.scratch.length*TILE*TILE*8>BUDGET)throw new Error('GPU texture budget exceeded.');
    if(!this.result||this.width!==doc.width||this.height!==doc.height){this.result?.destroy();this.result=this.texture(doc.width,doc.height);this.width=doc.width;this.height=doc.height;this.canvas.width=doc.width;this.canvas.height=doc.height;}
    const layers=new Map();walk(doc.layers,l=>{
      const mask=l.mask&&l.maskEnabled?this.upload(l.mask,revisions(l)):this.white;
      if(l.image){
        let filters=l.filters;if(preview?.id===l.id&&preview.filter)filters=preview.index>=0?l.filters.map((f,i)=>i===preview.index?preview.filter:f):[...l.filters,preview.filter];
        let texture;if(this.filters.supports(filters))texture=this.filters.prepare(l,this.upload(l.image,revisions(l)),filters,revisions(l),this.frame);
        else texture=this.upload(filtered(filters===l.filters?l:{...l,filters}),revisions(l));
        layers.set(l,{texture,mask});
      }else if(l.adjustment)layers.set(l,{texture:this.adjustment(l,preview),mask});else layers.set(l,{mask});
    });
    const encoder=this.device.createCommandEncoder();
    const clear=target=>{const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.end();};
    const draw=(source,mask,back,target,l,opacity,tx,ty,maskOffset=[0,0])=>{
      let buffer=this.buffers[this.bufferIndex++];if(!buffer){buffer=this.device.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.buffers.push(buffer);}
      const w=source.width,h=source.height,a=-l.rotation*Math.PI/180;
      const values=new Float32Array([l.x+w*l.scale/2,l.y+h*l.scale/2,(l.flip?-1:1)/l.scale,1/l.scale,Math.cos(a),Math.sin(a),opacity,l.adjustment?100:Math.max(0,modes.indexOf(l.blend)),tx,ty,...maskOffset,mask===this.white?0:1,0,0,0]);this.device.queue.writeBuffer(buffer,0,values);
      const bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:mask.createView()},{binding:2,resource:back.createView()},{binding:3,resource:{buffer}}]});
      const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();
    };
    this.changedTiles=0;
    for(let ty=0;ty<doc.height;ty+=TILE)for(let tx=0;tx<doc.width;tx+=TILE){
      if(regions&&!regions.some(r=>r.x<tx+TILE&&r.x+r.w>tx&&r.y<ty+TILE&&r.y+r.h>ty))continue;
      this.changedTiles++;
      const compose=(nodes,depth=0,inherited=1)=>{
        const targets=this.pair(depth);let index=0;clear(targets[0]);
        const stack=(items,alpha)=>{for(const l of [...items].reverse()){
          if(!l.visible)continue;
          if(l.children&&l.blend==='pass through'&&!l.mask){stack(l.children,alpha*l.opacity);continue;}
          let image,mask=layers.get(l)?.mask||this.white,transform=l;
          if(l.children){image=compose(l.children,depth+1);transform={...l,x:tx,y:ty,scale:1,rotation:0,flip:false};}
          else image=layers.get(l)?.texture;
          if(!image)continue;
          // Group intermediates are premultiplied. Convert once before they are
          // sampled by the common layer path, which expects straight input.
          if(l.children)image=this.unpremultiply(encoder,image,depth);
          draw(image,mask,targets[index],targets[1-index],transform,alpha*l.opacity,tx,ty,l.children?[tx,ty]:[0,0]);index=1-index;
        }};stack(nodes,inherited);return targets[index];
      };
      const result=compose(doc.layers);encoder.copyTextureToTexture({texture:result},{texture:this.result,origin:[tx,ty]},[Math.min(TILE,doc.width-tx),Math.min(TILE,doc.height-ty)]);
    }
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.setPipeline(this.presentPipeline);pass.setBindGroup(0,this.device.createBindGroup({layout:this.presentPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.result.createView()}]}));pass.draw(3);pass.end();this.device.queue.submit([encoder.finish()]);
    for(const [image,entry]of this.textures)if(entry.used!==this.frame){entry.texture.destroy();this.textures.delete(image);this.bytes-=entry.size;}
    this.filters.prune(this.frame);for(const [l,entry]of this.adjustments)if(entry.frame!==this.frame)this.adjustments.delete(l);
    this.estimatedTextureBytes=this.bytes+projected+this.scratch.length*TILE*TILE*8+(this.groupTextures?.length||0)*TILE*TILE*4+[...this.filters.cache.values()].reduce((sum,e)=>sum+e.texture.width*e.texture.height*4,0);
    this.lastFrameMs=performance.now()-start;return true;
  }
  unpremultiply(encoder,image,depth){
    if(!this.unpremultiplyPipeline){const module=this.device.createShaderModule({code:present.replace('return textureLoad(image,vec2i(p.xy),0);','let c=textureLoad(image,vec2i(p.xy),0);return vec4f(select(vec3f(0),c.rgb/max(c.a,.000001),c.a>0),c.a);')});this.unpremultiplyPipeline=this.device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:'rgba8unorm'}]}});this.groupTextures=[];}
    const target=this.groupTextures[depth]||(this.groupTextures[depth]=this.texture(TILE,TILE));const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.setPipeline(this.unpremultiplyPipeline);pass.setBindGroup(0,this.device.createBindGroup({layout:this.unpremultiplyPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:image.createView()}]}));pass.draw(3);pass.end();return target;
  }
  async pixels(){
    const row=Math.ceil(this.width*4/256)*256,buffer=this.device.createBuffer({size:row*this.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}),encoder=this.device.createCommandEncoder();encoder.copyTextureToBuffer({texture:this.result},{buffer,bytesPerRow:row},[this.width,this.height]);this.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const source=new Uint8Array(buffer.getMappedRange()),result=new Uint8ClampedArray(this.width*this.height*4);for(let y=0;y<this.height;y++)result.set(source.subarray(y*row,y*row+this.width*4),y*this.width*4);buffer.unmap();buffer.destroy();return result;
  }
  dispose(){this.disposed=true;this.invalid=true;this.filters?.dispose();this.adjustments.clear();for(const e of this.textures.values())e.texture.destroy();this.textures.clear();for(const p of this.scratch)for(const t of p)t.destroy();for(const t of this.groupTextures||[])t.destroy();for(const b of this.buffers)b.destroy();this.result?.destroy();this.white?.destroy();this.device?.destroy();}
}
