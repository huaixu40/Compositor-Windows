const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path');
async function main(){
  const root=path.resolve(__dirname,'..'),out=path.join(root,'output','render-project');await fs.mkdir(out,{recursive:true});
  const app=await _electron.launch({executablePath:process.env.COMPOSITOR_EXE||require('electron'),args:[root,'--interaction-test']});
  let report;try{
    const page=await app.firstWindow();await page.waitForFunction(()=>window.appReady);await page.evaluate(()=>window.appReady);
    report=await page.evaluate(async()=>{
      const api=window.editorTest,r=api.renderer;await r.ready;const results=[];
      const assert=(v,m)=>{if(!v)throw new Error(m);};
      const test=async(name,fn)=>{try{const detail=await fn();results.push({name,passed:true,detail});}catch(e){results.push({name,passed:false,error:e.stack});}};
      const solid=(w,h,color)=>{const c=api.canvas(w,h),ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,h);return c;};
      const compare=async d=>{
        api.adopt(d);assert(r.backend==='webgpu','GPU fallback: '+r.reason);await r.gpu.device.queue.onSubmittedWorkDone();
        const gpu=await r.gpu.pixels(),cpu=api.composite(d).getContext('2d').getImageData(0,0,d.width,d.height).data;
        let max=0,sum=0,count=0;for(let i=0;i<gpu.length;i++){const alpha=cpu[(i&~3)+3]/255,expected=i%4===3?cpu[i]:cpu[i]*alpha,diff=Math.abs(gpu[i]-expected);max=Math.max(max,diff);sum+=diff;if(diff>3)count++;}if(d.width===160&&d.height===120)window.lastComparison={gpu:Array.from(gpu),cpu:Array.from(cpu),width:d.width,height:d.height};return{max,mean:sum/gpu.length,over3:count};
      };
      await test('Actual NVIDIA WebGPU device',()=>{assert(!!r.gpu,r.reason);return r.gpu.adapterInfo;});
      for(const blend of Object.keys(api.BLENDS))await test('GPU/CPU blend '+blend,async()=>{
        const d=api.newDocument(32,32);d.layers=[api.layer('top',solid(32,32,'rgba(210,84,36,.63)'),{blend,opacity:.72,mask:solid(32,32,'#b7b7b7')}),api.layer('back',solid(32,32,'rgba(40,120,201,.7)'))];const result=await compare(d);assert(result.max<=3,JSON.stringify(result));return result;
      });
      await test('GPU/CPU tiled group masks and pass-through',async()=>{
        const d=api.newDocument(620,540),child=api.layer('child',solid(300,250,'#f07b29'),{x:420,y:310,opacity:.6});d.layers=[api.layer('group',null,{children:[child],mask:solid(620,540,'#adadad'),blend:'multiply',opacity:.8}),api.layer('pass',null,{children:[api.layer('pixels',solid(620,540,'#5687a8'))],blend:'pass through',opacity:.8})];const result=await compare(d);assert(result.max<=3,JSON.stringify(result));return result;
      });
      await test('GPU/CPU rotated transformed alpha edges',async()=>{
        const d=api.newDocument(160,120);d.layers=[api.layer('rotated',solid(60,50,'#d07045'),{x:35,y:22,scale:1.23,rotation:23,opacity:.77,flip:true}),api.layer('back',solid(160,120,'#406387'))];const result=await compare(d);window.edgeComparison=window.lastComparison;assert(result.mean<.1&&result.max<=16,JSON.stringify(result));return result;
      });
      for(const filter of [{kind:'exposure',exposure:.4,contrast:12},{kind:'levels',black:15,white:234,gamma:1.2},{kind:'curves',shadows:48,midtones:160,highlights:218},{kind:'hsl',hue:24,saturation:13,lightness:5},{kind:'balance',red:14,green:-9,blue:2},{kind:'bw'},{kind:'sharpen',amount:40},{kind:'blur',radius:2}])await test('GPU/CPU filter '+filter.kind,async()=>{
        const d=api.newDocument(32,32),ctx=d.layers[0].image.getContext('2d'),pixels=ctx.createImageData(32,32);for(let i=0;i<1024;i++)pixels.data.set([(i*7)%256,(i*11)%256,(i*19)%256,64+(i%192)],i*4);ctx.putImageData(pixels,0,0);d.layers[0].filters=[filter];const result=await compare(d);assert(result.max<4,JSON.stringify(result));return result;
      });
      for(const adjustment of [{type:'levels',rgb:{shadowInput:12,highlightInput:242,shadowOutput:4,highlightOutput:248,midtoneInput:1.2}},{type:'curves',rgb:[{input:0,output:8},{input:128,output:160},{input:255,output:250}]},{type:'exposure',exposure:.4,offset:.02,gamma:1.1},{type:'invert'}])await test('GPU/CPU PSD adjustment '+adjustment.type,async()=>{
        const d=api.newDocument(48,48);d.layers=[api.layer('adjustment',null,{adjustment,opacity:.7,mask:solid(48,48,'#b8b8b8')}),api.layer('base',solid(48,48,'rgba(72,132,199,.75)'))];const result=await compare(d);assert(result.max<4,JSON.stringify(result));return result;
      });
      await test('Only changed tiles redraw; cached frames redraw zero tiles',async()=>{
        const d=api.newDocument(1920,1080);d.layers=[api.layer('movable',solid(80,80,'#f08040'),{x:30,y:30}),api.layer('base',solid(1920,1080,'#d0e0f0'))];await compare(d);r.render(d);assert(r.gpu.changedTiles===0,'Unchanged frame repainted');d.layers[0].x+=9;const result=await compare(d);assert(r.gpu.changedTiles<12,'Whole canvas repainted');assert(result.max<3,'Stale tile pixels');return{...result,tiles:r.gpu.changedTiles};
      });
      await test('ZIP v2 keeps original 16-bit and float pixels, RAW bytes and semantic data',async()=>{
        const d=api.newDocument(8,8),l=d.layers[0];l.highPrecision={width:8,height:8,channels:4,type:'uint16',data:Uint16Array.from({length:256},(_,i)=>i*257+13)};l.raw={name:'fixture.dng',decoder:'test-fixture',parameters:{exposure:.25},source:new Uint8Array([1,2,3,4])};l.text={content:'中文 editable',size:24};l.path={points:[[1,2],[3,4]]};
        const bytes=await api.serializeProjectV2(d);assert(bytes[0]===0x50&&bytes[1]===0x4b,'Not a ZIP');const back=await api.parseProject(bytes);assert(back.layers[0].highPrecision.data[7]===1812,'16-bit lost');assert(back.layers[0].raw.source[2]===3,'RAW original lost');assert(back.layers[0].text.content==='中文 editable','Metadata lost');
        l.highPrecision={width:8,height:8,channels:4,type:'float32',data:Float32Array.from({length:256},(_,i)=>i/17)};const float=await api.parseProject(await api.serializeProjectV2(d));assert(float.layers[0].highPrecision.data[255]===l.highPrecision.data[255],'Float precision lost');return {bytes:bytes.length};
      });
      await test('Legacy v1 upgrades to v2 without changing its pixels',async()=>{
        const d=api.newDocument(16,16);d.layers[0].image=solid(16,16,'#f08030');const v1=api.serializeProject(d),legacy=await api.parseProject(v1),upgraded=await api.parseProject(await api.serializeProjectV2(legacy));assert(upgraded.layers[0].image.getContext('2d').getImageData(0,0,1,1).data[0]===240,'Upgrade changed color');assert(v1[0]===123,'Original v1 buffer changed');
      });
      await test('Worker PSD export/import and PNG export preserve layers and pixels',async()=>{
        const d=api.newDocument(32,32);d.layers=[api.layer('masked',solid(32,32,'#dc7c3c'),{mask:solid(32,32,'#bcbcbc'),opacity:.8}),api.layer('base',solid(32,32,'#407080'))];
        const bytes=await api.exportJob(d,'psd'),back=await api.readPsdJob(bytes,'worker.psd');assert(back.doc.layers.length===2,'PSD layers lost');assert(!!back.doc.layers[0].mask,'PSD mask lost');
        const png=await api.exportJob(d,'png');assert(png[0]===137&&png[1]===80,'PNG export failed');const cpu=api.composite(d).getContext('2d').getImageData(0,0,1,1).data,round=api.composite(back.doc).getContext('2d').getImageData(0,0,1,1).data;assert(cpu.every((v,i)=>Math.abs(v-round[i])<3),'Worker pixel mismatch');return {psdBytes:bytes.length,pngBytes:png.length};
      });
      await test('Corrupt ZIP resource fails integrity check',async()=>{
        const bytes=await api.serializeProjectV2(api.newDocument(16,16));const broken=bytes.slice();let found=false;for(let i=0;i<broken.length-8;i++)if(broken[i]===137&&broken[i+1]===80&&broken[i+2]===78&&broken[i+3]===71){broken[i+30]^=1;found=true;break;}assert(found,'PNG missing');let rejected=false;try{await api.parseProject(broken);}catch(e){rejected=/checksum/i.test(e.message);}assert(rejected,'Corrupt resource accepted');
      });
      await test('Cancelable worker save never changes document',async()=>{
        const d=api.newDocument(512,512),before=d.layers[0].image.toDataURL(),controller=new AbortController();const task=api.serializeProjectV2(d,{signal:controller.signal,onProgress:()=>controller.abort()});let canceled=false;try{await task;}catch(e){canceled=e.name==='AbortError';}assert(canceled,'Cancel not honored');assert(d.layers[0].image.toDataURL()===before,'Canceled save changed pixels');
      });
      await test('Thirty-filter stack uses bounded ping-pong allocations',async()=>{
        const d=api.newDocument(32,32);d.layers[0].image=solid(32,32,'#405060');d.layers[0].filters=Array.from({length:30},()=>({kind:'exposure',exposure:.01,contrast:0}));
        let allocated=0;const texture=r.gpu.filters.texture;r.gpu.filters.texture=(...args)=>{allocated++;return texture(...args);};
        try{const result=await compare(d);assert(allocated===2,'Filter stack allocated '+allocated+' targets');assert(result.max<4,'Pixel mismatch');return{allocated,...result};}finally{r.gpu.filters.texture=texture;}
      });
      await test('GPU allocation failure falls back without changing history or pixels',async()=>{
        api.adopt(api.newDocument(64,64));api.history.push(api.doc);const before=api.serializeProject(api.doc),history=api.history;
        r.gpu.result.destroy();r.gpu.result=null;r.gpu.texture=()=>{throw new Error('Simulated GPU allocation failure');};const source=api.doc;r.render(source);
        assert(r.backend==='cpu'&&r.reason.includes('allocation'),'No allocation fallback');assert(source===api.doc&&api.history===history&&api.history.past.length===1,'Document/history replaced');assert(api.serializeProject(api.doc).every((v,i)=>v===before[i]),'Fallback changed pixels');
        r.setMode('auto');await r.ready;assert(r.backend==='webgpu','GPU retry failed');
        const current=api.serializeProject(api.doc);r.setMode('cpu');assert(r.backend==='cpu','CPU preference ignored');r.setMode('auto');assert(api.serializeProject(api.doc).every((v,i)=>v===current[i]),'Mode switch changed pixels');
      });
      await test('GPU device loss keeps pixels, history, and CPU rendering',async()=>{
        const d=api.demoDocument();api.adopt(d);const before=api.serializeProject(d);await r.loseDevice();await new Promise(resolve=>setTimeout(resolve,50));assert(r.backend==='cpu','No CPU fallback');assert(api.serializeProject(api.doc).every((v,i)=>v===before[i]),'Device loss changed document');
      });
      await test('Unavailable WebGPU starts in CPU and can recover',async()=>{
        const property=Object.getOwnPropertyDescriptor(navigator,'gpu');Object.defineProperty(navigator,'gpu',{value:undefined,configurable:true});
        try{r.setMode('auto');await r.ready;assert(r.backend==='cpu'&&!r.gpu,'Missing adapter did not fall back');}finally{if(property)Object.defineProperty(navigator,'gpu',property);else delete navigator.gpu;}
        r.setMode('auto');await r.ready;assert(r.backend==='webgpu','Adapter recovery failed');
      });
      return{timestamp:new Date().toISOString(),passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,results};
    });
    const test=async(name,fn)=>{try{await fn();report.results.push({name,passed:true});report.passed++;}catch(error){report.results.push({name,passed:false,error:error.stack});report.failed++;}};
    await test('Actual Cancel button aborts pending background work without a commit',async()=>{
      await page.evaluate(()=>{const a=window.editorTest;window.jobDocument=a.doc;window.jobResult=null;window.pendingJob=a.background('Cancellation test',({signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true}))).then(()=>window.jobResult='unexpected commit',e=>window.jobResult=e.name);});
      await page.locator('#job-cancel').click();await page.waitForFunction(()=>window.jobResult==='AbortError');
      if(!await page.evaluate(()=>window.editorTest.doc===window.jobDocument&&document.getElementById('job-progress').hidden))throw new Error('Cancel changed document or left progress visible');
    });
    await test('A completed stale job cannot overwrite newer document edits',async()=>{
      await page.evaluate(()=>{const a=window.editorTest;window.jobResult=null;window.pendingJob=a.background('Revision test',()=>new Promise(resolve=>window.finishJob=resolve)).then(()=>window.jobResult='unexpected commit',e=>window.jobResult=e.message);});
      // A real editable field changes the document while the controlled job waits.
      await page.locator('#layer-name').fill('Newer edit');await page.locator('#layer-name').press('Tab');
      await page.evaluate(()=>window.finishJob('stale result'));await page.waitForFunction(()=>window.jobResult!==null);
      if(!await page.evaluate(()=>window.jobResult!=='unexpected commit'&&window.editorTest.selected().name==='Newer edit'))throw new Error('Stale result was accepted');
    });
    const edge=await page.evaluate(()=>{
      const a=window.edgeComparison;if(!a)return null;const output=document.createElement('canvas');output.width=a.width*3;output.height=a.height+25;const ctx=output.getContext('2d');ctx.fillStyle='#202020';ctx.fillRect(0,0,output.width,output.height);ctx.fillStyle='#fff';ctx.font='12px sans-serif';['CPU','GPU','Difference x8'].forEach((name,i)=>ctx.fillText(name,i*a.width+5,17));
      for(let panel=0;panel<3;panel++){const image=ctx.createImageData(a.width,a.height);for(let i=0;i<image.data.length;i++)image.data[i]=panel===0?a.cpu[i]:panel===1?a.gpu[i]:i%4===3?255:Math.abs(a.cpu[i]-a.gpu[i])*8;ctx.putImageData(image,panel*a.width,25);}return output.toDataURL();
    });if(edge)await fs.writeFile(path.join(out,'rotated-edge-comparison.png'),Buffer.from(edge.split(',')[1],'base64'));
    await test('Rendering preference survives settings reload and mode switches',async()=>{
      await page.locator('#settings').click();await page.locator('#renderer-mode').selectOption('cpu');await page.waitForFunction(()=>window.editorTest.renderer.mode==='cpu');
      await page.reload();await page.waitForFunction(()=>window.appReady);await page.evaluate(()=>window.appReady);
      if(!await page.evaluate(()=>window.editorTest.renderer.mode==='cpu'))throw new Error('CPU preference lost');
      await page.locator('#settings').click();await page.locator('#renderer-mode').selectOption('auto');await page.waitForFunction(()=>window.editorTest.renderer.mode==='auto');await page.locator('#settings-dialog button').click();
    });
    await page.screenshot({path:path.join(out,'renderer.png')});
  }finally{await app.close();}
  await fs.writeFile(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
