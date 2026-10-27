import { composite, pixelRevision } from '../engine.js';
import { WebGpuBackend } from './webgpu.js';
export class Renderer {
  constructor(cpuCanvas,gpuCanvas,onStatus=()=>{}){
    this.cpuCanvas=cpuCanvas;this.gpuCanvas=gpuCanvas;this.onStatus=onStatus;this.mode='auto';this.backend='cpu';this.reason='Initializing';this.latest=null;this.samples=[];
    this.ready=this.initialize();
  }
  async initialize(){
    this.initializing=true;
    const gpu=new WebGpuBackend(this.gpuCanvas,{lost:reason=>this.fallback(reason)});
    try{this.gpu=await gpu.initialize();this.reason='';if(this.latest)this.render(...this.latest);}
    catch(error){gpu.dispose();this.fallback(error.message);}
    finally{this.initializing=false;}
  }
  fallback(reason){this.reason=reason;const gpu=this.gpu;this.gpu=null;gpu?.dispose();this.backend='cpu';this.gpuCanvas.hidden=true;this.cpuCanvas.hidden=false;this.onStatus(this);if(this.latest)this.renderCpu(...this.latest);}
  renderCpu(doc,preview){const c=this.cpuCanvas;if(c.width!==doc.width||c.height!==doc.height){c.width=doc.width;c.height=doc.height;}const ctx=c.getContext('2d');ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(composite(doc,preview),0,0);this.backend='cpu';this.gpuCanvas.hidden=true;c.hidden=false;}
  render(doc,preview){
    this.latest=[doc,preview];
    if(this.mode!=='cpu'&&this.gpu){try{if(this.gpu.render(doc,preview,pixelRevision)){this.backend='webgpu';this.gpuCanvas.hidden=false;this.cpuCanvas.hidden=true;if(this.gpu.changedTiles){const start=performance.now(),sample={submissionMs:this.gpu.lastFrameMs,tiles:this.gpu.changedTiles};this.samples.push(sample);if(this.samples.length>1000)this.samples.shift();this.gpu.device.queue.onSubmittedWorkDone().then(()=>sample.completionMs=performance.now()-start).catch(()=>{});}this.onStatus(this);return;}this.reason='Compatibility renderer required.';}catch(error){this.fallback(error.message);return;}}
    this.renderCpu(doc,preview);this.onStatus(this);
  }
  setMode(mode){this.mode=mode;if(mode==='auto'&&!this.gpu&&!this.initializing)this.ready=this.initialize();if(this.latest)this.render(...this.latest);}
  async loseDevice(){const gpu=this.gpu;if(gpu){gpu.device.destroy();await gpu.device.lost;}else this.fallback('No GPU device.');}
}
