const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),{execFileSync}=require('node:child_process');
async function main(){
  const root=path.resolve(__dirname,'..'),output=path.join(root,'output','performance');await fs.mkdir(output,{recursive:true});
  const app=await _electron.launch({executablePath:process.env.COMPOSITOR_EXE||require('electron'),args:[root,'--interaction-test']});
  try{
    const page=await app.firstWindow();await page.waitForFunction(()=>window.appReady);await page.evaluate(()=>window.appReady);await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(2320,1290));
    await page.evaluate(async()=>{
      const a=window.editorTest;await a.renderer.ready;const d=a.newDocument(1920,1080);d.layers[0].image.getContext('2d').fillRect(0,0,1920,1080);
      for(let i=0;i<4;i++){const c=a.canvas(480,480),ctx=c.getContext('2d');ctx.fillStyle=['#ea9450','#799970','#566ba1','#ead9b0'][i];ctx.fillRect(0,0,480,480);d.layers.unshift(a.layer('Layer '+i,c,{x:200+i*230,y:170+i*80,opacity:.75,filters:[{kind:'exposure',exposure:.2,contrast:8}]}));}
      a.adopt(d);a.interactions.chooseTool('move');a.interactions.options.move.autoSelect=false;window.pointerMoves=0;document.getElementById('overlay').addEventListener('pointermove',()=>window.pointerMoves++);window.framesMeasured=[];window.measuring=false;
      let previous;function tick(time){if(window.measuring&&previous)window.framesMeasured.push(time-previous);previous=time;requestAnimationFrame(tick);}requestAnimationFrame(tick);
    });
    const viewport=await page.locator('#viewport').boundingBox(),box=await page.locator('#overlay').boundingBox();await page.mouse.move(box.x+1000,box.y+450);await page.mouse.down();await page.evaluate(()=>{window.pointerMoves=0;window.measuring=true;window.measureStart=performance.now();window.editorTest.renderer.samples=[];});
    for(let i=0;i<120;i++){await page.mouse.move(box.x+1000+i*2,box.y+450+Math.sin(i/12)*70);await page.waitForTimeout(10);}await page.mouse.up();await page.evaluate(()=>{window.measuring=false;window.measureEnd=performance.now();});
    await page.evaluate(()=>window.editorTest.renderer.gpu.device.queue.onSubmittedWorkDone());
    const report=await page.evaluate(()=>{const a=window.editorTest,r=a.renderer,values=window.framesMeasured.sort((a,b)=>a-b),mean=values.reduce((a,b)=>a+b,0)/values.length;const samples=r.samples,submission=samples.map(s=>s.submissionMs).sort((a,b)=>a-b),completion=samples.map(s=>s.completionMs).filter(Number.isFinite).sort((a,b)=>a-b),updatesPerSecond=samples.length*1000/(window.measureEnd-window.measureStart);return{pointerMoves:window.pointerMoves,renderedUpdates:samples.length,updatesPerSecond,p95SubmissionMs:submission[Math.floor(submission.length*.95)],p95GpuCompletionMs:completion[Math.floor(completion.length*.95)],backend:r.backend,viewport:{width:document.getElementById('viewport').clientWidth,height:document.getElementById('viewport').clientHeight,dpr:devicePixelRatio},document:[a.doc.width,a.doc.height],layers:5,frames:values.length,meanFrameMs:mean,p95FrameMs:values[Math.floor(values.length*.95)],maxFrameMs:values.at(-1),meanFPS:1000/mean,lastSubmissionMs:r.gpu?.lastFrameMs,estimatedEditorTextureBytes:r.gpu?.estimatedTextureBytes,passes30FPS:updatesPerSecond>=30&&values[Math.floor(values.length*.95)]<=1000/30};});
    report.timestamp=new Date().toISOString();report.processMemory=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,memory:p.memory})));
    try{report.systemGpuSnapshot=execFileSync('nvidia-smi',['--query-gpu=name,memory.used,memory.total','--format=csv,noheader'],{encoding:'utf8'}).trim();}catch{report.systemGpuSnapshot='Unavailable';}
    report.note='Changed GPU submissions and RAF intervals during actual mouse dragging. RAF is display cadence, not render throughput; GPU memory snapshot includes all applications. Editor texture bytes are an allocation estimate, not driver VRAM attribution.';
    await fs.writeFile(path.join(output,'drag-1080p.json'),JSON.stringify(report,null,2));await page.screenshot({path:path.join(output,'drag-1080p.png')});console.log(JSON.stringify(report,null,2));if(!report.passes30FPS)process.exitCode=1;
  }finally{await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

