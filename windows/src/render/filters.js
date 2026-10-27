import code from './filters.wgsl';
const parameters={exposure:f=>[0,f.exposure,f.contrast,0],levels:f=>[1,f.black,f.white,f.gamma],curves:f=>[2,f.shadows,f.midtones,f.highlights],hsl:f=>[3,f.hue,f.saturation,f.lightness],balance:f=>[4,f.red,f.green,f.blue],bw:()=>[5,0,0,0],sharpen:f=>[6,f.amount,0,0]};
export class GpuFilters {
  constructor(device,texture){this.device=device;this.texture=texture;this.cache=new Map();}
  async initialize(){const module=this.device.createShaderModule({code});this.pipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vertex'},fragment:{module,entryPoint:'fragment',targets:[{format:'rgba8unorm'}]}});return this;}
  supports(filters){return filters.every(f=>f.enabled===false||parameters[f.kind]);}
  prepare(layer,source,filters,revision,frame){
    const enabled=filters.filter(f=>f.enabled!==false);if(!enabled.length)return source;
    const key=JSON.stringify([revision,filters]),old=this.cache.get(layer);
    if(old&&old.key===key&&old.source===source){old.frame=frame;return old.texture;}
    old?.texture.destroy();this.cache.delete(layer);const encoder=this.device.createCommandEncoder(),textures=[],buffers=[];let current=source;
    for(const filter of enabled){
      // Ping-pong between two targets: a 30-filter stack must not allocate 30
      // full-size images before submission and exceed the renderer's budget.
      const index=buffers.length%2,target=textures[index]||(textures[index]=this.texture(source.width,source.height)),buffer=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(buffer,0,new Float32Array(parameters[filter.kind](filter)));buffers.push(buffer);
      const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,0]}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:current.createView()},{binding:1,resource:{buffer}}]}));pass.draw(3);pass.end();current=target;
    }
    this.device.queue.submit([encoder.finish()]);for(const buffer of buffers)buffer.destroy();for(const texture of textures)if(texture!==current)texture.destroy();this.cache.set(layer,{key,source,texture:current,frame});return current;
  }
  prune(frame){for(const [layer,entry]of this.cache)if(entry.frame!==frame){entry.texture.destroy();this.cache.delete(layer);}}
  dispose(){for(const entry of this.cache.values())entry.texture.destroy();this.cache.clear();}
}
