const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output', 'interaction');
async function main() {
  await fs.mkdir(output, {recursive:true});
  const app = await electron.launch({args:[root,'--interaction-test'],executablePath:process.env.COMPOSITOR_EXE || require('electron'),timeout:30000});
  const page = await app.firstWindow(); await page.waitForFunction(()=>window.appReady); await page.evaluate(()=>window.appReady); await page.context().tracing.start({screenshots:true,snapshots:true});
  const errors=[],results=[]; page.on('pageerror',error=>errors.push(error.message));
  await app.evaluate(async({clipboard})=>{globalThis.__clipboardSnapshot=[];for(const item of await clipboard.read()){const values={};for(const type of item.types)values[type]=await item.getType(type);if(Object.keys(values).length)globalThis.__clipboardSnapshot.push(values);}});
  page.setDefaultTimeout(6000);
  const test=async(name,fn)=>{console.log('TEST '+name);try{await fn();results.push({name,passed:true});}catch(error){console.error(error.stack);results.push({name,passed:false,error:error.stack});await page.screenshot({path:path.join(output,`failure-${results.length}.png`)});}};
  const setup=async()=>page.evaluate(()=>{const api=window.editorTest,d=api.newDocument(160,120);d.name='Interaction fixture';const ctx=d.layers[0].image.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(10,10,80,70);api.adopt(d);window.trustedInputs=[];document.getElementById('overlay').addEventListener('pointerdown',e=>window.trustedInputs.push(e.isTrusted),{once:true});});
  const point=async(x,y)=>{const box=await page.locator('#overlay').boundingBox();const zoom=await page.evaluate(()=>window.editorTest.zoom);return{x:box.x+x*zoom,y:box.y+y*zoom};};
  const drag=async(x1,y1,x2,y2)=>{const a=await point(x1,y1),b=await point(x2,y2);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:8});await page.mouse.up();};
  const tool=name=>page.locator(`[data-tool="${name}"]`).click();
  const pixel=(x,y)=>page.evaluate(({x,y})=>Array.from(window.editorTest.selected().image.getContext('2d').getImageData(x,y,1,1).data),{x,y});
  const shortcut=key=>page.keyboard.press(key);
  try {
    await test('Trusted mouse rectangle selection, reverse drag, clipping, clear and undo',async()=>{
      await setup();await tool('select');await drag(70,60,20,20);
      assert.deepEqual(await page.evaluate(()=>{const a=window.editorTest.selection;return[a.x,a.y,a.w,a.h];}),[20,20,50,40]);
      assert.equal(await page.evaluate(()=>window.trustedInputs[0]),true);
      await shortcut('Delete');assert.equal((await pixel(30,30))[3],0);assert.equal((await pixel(15,15))[3],255);
      await shortcut('Control+z');assert.equal((await pixel(30,30))[3],255);
      await tool('select');await drag(130,90,-20,-10);const bounds=await page.evaluate(()=>{const a=window.editorTest.selection;return[a.x,a.y,a.w,a.h];});assert.deepEqual(bounds,[0,0,130,90]);
    });
    await test('Ellipse, additive and subtractive selections constrain edits',async()=>{
      await setup();await tool('ellipse');await drag(10,10,70,70);
      assert.equal(await page.evaluate(()=>window.editorTest.selection.mask.getContext('2d').getImageData(11,11,1,1).data[3]),0);
      await tool('select');await page.locator('[data-option="mode"]').selectOption('add');await drag(70,10,90,30);
      assert.equal(await page.evaluate(()=>window.editorTest.selection.mask.getContext('2d').getImageData(80,20,1,1).data[3]),255);
      await page.locator('[data-option="mode"]').selectOption('subtract');await drag(30,30,50,50);await shortcut('Delete');assert.equal((await pixel(40,40))[3],255);assert.equal((await pixel(60,40))[3],0);
    });
    await test('Windows clipboard selection copy, cut, paste and external image',async()=>{
      await setup();await tool('select');await page.locator('[data-option="mode"]').selectOption('replace');await drag(20,20,50,50);
      await shortcut('Control+c');await page.waitForFunction(()=>window.editorTest.interactions.pendingClipboard===0);assert.equal(await app.evaluate(async({clipboard,nativeImage})=>{const i=(await clipboard.read()).find(i=>i.types.includes('image/png'));return nativeImage.createFromBuffer(Buffer.from(await (await i.getType('image/png')).arrayBuffer())).getSize().width;}),30);
      await shortcut('Control+v');await page.waitForFunction(()=>window.editorTest.doc.layers.length===2);
      assert.deepEqual(await page.evaluate(()=>{const l=window.editorTest.selected();return[l.x,l.y,l.image.width,l.image.height];}),[20,20,30,30]);
      await shortcut('Control+z');assert.equal(await page.evaluate(()=>window.editorTest.doc.layers.length),1);
      await shortcut('Control+x');await page.waitForFunction(()=>window.editorTest.selected().image.getContext('2d').getImageData(30,30,1,1).data[3]===0);
      await shortcut('Control+z');assert.equal((await pixel(30,30))[3],255);
      await app.evaluate(async({clipboard,ClipboardItem})=>{const i=(await clipboard.read()).find(i=>i.types.includes('image/png'));await clipboard.write([new ClipboardItem({'image/png':await i.getType('image/png')})]);});
      await shortcut('Control+v');await page.waitForFunction(()=>window.editorTest.doc.layers.length===2);assert.equal(await page.evaluate(()=>window.editorTest.selected().image.width),30);
    });
    await test('No-selection copy preserves layer filters and mask',async()=>{
      await setup();await page.locator('#add-mask').click();await page.locator('#layers .thumb').first().click();await shortcut('Control+c');await page.waitForFunction(()=>window.editorTest.interactions.pendingClipboard===0);await shortcut('Control+v');await page.waitForFunction(()=>window.editorTest.doc.layers.length===2);
      assert.equal(await page.evaluate(()=>!!window.editorTest.selected().mask),true);
    });
    await test('Mouse layer movement and floating selection cancel/apply use one undo',async()=>{
      await setup();await tool('move');await drag(40,40,55,60);assert.deepEqual(await page.evaluate(()=>{const l=window.editorTest.selected();return[l.x,l.y];}),[15,20]);
      await shortcut('Control+z');assert.deepEqual(await page.evaluate(()=>{const l=window.editorTest.selected();return[l.x,l.y];}),[0,0]);
      await tool('select');await drag(20,20,50,50);await tool('move');await page.locator('[data-command="float"]').click();await drag(30,30,65,55);await shortcut('Escape');assert.equal(await page.evaluate(()=>window.editorTest.doc.layers.length),1);assert.equal((await pixel(30,30))[3],255);
      await page.locator('[data-command="float"]').click();await drag(30,30,65,55);await shortcut('Enter');assert.equal(await page.evaluate(()=>window.editorTest.doc.layers.length),2);await shortcut('Control+z');assert.equal(await page.evaluate(()=>window.editorTest.doc.layers.length),1);
    });
    await test('Right-click actions and HTML layer drag into/out of groups',async()=>{
      await setup();await page.locator('#add-layer').click();await page.locator('#layers [data-layer]').first().click({button:'right'});await page.locator('#context-menu [data-command="group"]').click();
      let ids=await page.evaluate(()=>window.editorTest.doc.layers.map(l=>l.id));const group=ids[0],base=ids[1];
      const from=page.locator(`[data-layer="${base}"]`),to=page.locator(`[data-layer="${group}"]`);
      await from.dragTo(to);await page.waitForFunction(()=>window.editorTest.doc.layers.length===1&&window.editorTest.doc.layers[0].children.length===2);
      await page.locator(`[data-layer="${base}"]`).dragTo(page.locator(`[data-layer="${group}"]`),{targetPosition:{x:40,y:2}});await page.waitForFunction(()=>window.editorTest.doc.layers.length===2);
      const before=await page.evaluate(()=>window.editorTest.history.past.length);await page.locator(`[data-layer="${group}"]`).dragTo(page.locator(`[data-layer="${group}"]`));assert.equal(await page.evaluate(()=>window.editorTest.history.past.length),before);
      const p=await point(50,50);await page.mouse.click(p.x,p.y,{button:'right'});assert.equal(await page.locator('#context-menu [data-command="paste"]').isVisible(),true);await shortcut('Escape');
    });
    await test('Per-tool properties, paint bucket, gradient, lasso, polygon and wand',async()=>{
      await setup();await tool('brush');await page.locator('[data-option="size"]').fill('17');await page.locator('[data-option="size"]').press('Tab');await tool('select');assert.equal(await page.locator('[data-option="size"]').count(),0);await tool('brush');assert.equal(await page.locator('[data-option="size"]').inputValue(),'17');
      await tool('lasso');let q=await point(20,20);await page.mouse.move(q.x,q.y);await page.mouse.down();for(const [x,y]of[[60,20],[60,60],[20,60],[20,20]]){q=await point(x,y);await page.mouse.move(q.x,q.y,{steps:3});}await page.mouse.up();assert.equal(await page.evaluate(()=>window.editorTest.selection.mask.getContext('2d').getImageData(40,40,1,1).data[3]),255);
      await shortcut('Control+d');await tool('polygon');for(const [x,y]of[[15,15],[65,15],[40,65]]){const p=await point(x,y);await page.mouse.click(p.x,p.y);}await shortcut('Enter');assert.ok(await page.evaluate(()=>window.editorTest.selection.w>0));
      await shortcut('Control+d');await tool('wand');const p=await point(30,30);await page.mouse.click(p.x,p.y);assert.deepEqual(await page.evaluate(()=>{const a=window.editorTest.selection;return[a.x,a.y,a.w,a.h];}),[10,10,80,70]);
      await tool('bucket');await page.locator('[data-option="color"]').fill('#0000ff');await page.locator('[data-option="color"]').dispatchEvent('change');await page.mouse.click(p.x,p.y);assert.equal((await pixel(30,30))[2],255);
      await shortcut('Control+d');await tool('gradient');await drag(0,0,159,119);assert.notDeepEqual(await pixel(1,1),await pixel(150,110));
    });
    await test('Crop cancel/apply and undo restore document coordinates',async()=>{
      await setup();await tool('crop');await drag(20,10,120,90);await shortcut('Escape');assert.equal(await page.evaluate(()=>window.editorTest.doc.width),160);await drag(20,10,120,90);await shortcut('Enter');assert.deepEqual(await page.evaluate(()=>[window.editorTest.doc.width,window.editorTest.doc.height,window.editorTest.selected().x]),[100,80,-20]);await shortcut('Control+z');assert.equal(await page.evaluate(()=>window.editorTest.doc.width),160);
    });
    await test('Text input shortcuts do not trigger canvas actions; Chinese input retained',async()=>{
      await setup();const input=page.locator('#layer-name');await input.fill('中文图层');await input.press('Control+a');await page.keyboard.insertText('中文输入测试');await input.press('Tab');assert.equal(await page.evaluate(()=>window.editorTest.selected().name),'中文输入测试');assert.equal(await page.evaluate(()=>window.editorTest.selection),null);
    });
    await test('Selection intersection, feather, invert, mask and selection undo/redo',async()=>{
      await setup();await tool('select');await page.locator('[data-option="mode"]').selectOption('replace');await drag(10,10,70,70);
      await page.locator('[data-option="mode"]').selectOption('intersect');await drag(40,40,100,100);
      assert.deepEqual(await page.evaluate(()=>{const s=window.editorTest.selection;return[s.x,s.y,s.w,s.h];}),[40,40,30,30]);
      await shortcut('Control+z');assert.equal(await page.evaluate(()=>window.editorTest.selection.w),60);await shortcut('Control+y');assert.equal(await page.evaluate(()=>window.editorTest.selection.w),30);
      await page.locator('[data-option="mode"]').selectOption('replace');await page.locator('[data-option="feather"]').fill('4');await page.locator('[data-option="feather"]').press('Tab');await drag(30,30,60,60);
      const edge=await page.evaluate(()=>window.editorTest.selection.mask.getContext('2d').getImageData(30,40,1,1).data[3]);assert.ok(edge>0&&edge<255);
      await page.locator('#tool-options [data-command="selection-mask"]').click();assert.equal(await page.evaluate(()=>window.editorTest.selected().mask.getContext('2d').getImageData(30,40,1,1).data[0]),edge);
      await shortcut('Control+Shift+d');const inverted=await page.evaluate(()=>window.editorTest.selection.mask.getContext('2d').getImageData(30,40,1,1).data[3]);assert.ok(Math.abs(inverted+edge-255)<=1);
      await tool('select');await page.locator('[data-option="feather"]').fill('0');await page.locator('[data-option="feather"]').press('Tab');
    });
    await test('Selection coordinates remain correct after zoom and actual wheel scrolling',async()=>{
      await page.evaluate(()=>window.editorTest.adopt(window.editorTest.newDocument(1600,1200)));await page.locator('#actual').click();await page.locator('#zoom-in').click();
      const viewport=await page.locator('#viewport').boundingBox();await page.mouse.move(viewport.x+viewport.width/2,viewport.y+viewport.height/2);await page.mouse.wheel(180,160);await page.waitForTimeout(150);
      await tool('select');const box=await page.locator('#overlay').boundingBox(),z=await page.evaluate(()=>window.editorTest.zoom),x=Math.ceil((viewport.x+90-box.x)/z),y=Math.ceil((viewport.y+90-box.y)/z);await drag(x,y,x+80,y+60);
      assert.deepEqual(await page.evaluate(()=>{const s=window.editorTest.selection;return[s.x,s.y,s.w,s.h];}),[x,y,80,60]);
    });
    await test('Mouse-created selection and edits survive actual project save and reopen',async()=>{
      await setup();await tool('select');await drag(20,20,50,50);await shortcut('Delete');
      const file=path.join(output,'selection-roundtrip.cwin');await fs.rm(file,{force:true});
      await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);
      await shortcut('Control+s');for(let i=0;i<50;i++){if(await fs.stat(file).catch(()=>null))break;await page.waitForTimeout(100);}assert.ok((await fs.stat(file)).size>0);
      await shortcut('Control+o');await page.waitForFunction(()=>window.editorTest.history.past.length===0);
      assert.equal((await pixel(30,30))[3],0);assert.deepEqual(await page.evaluate(()=>{const s=window.editorTest.selection;return[s.x,s.y,s.w,s.h];}),[20,20,30,30]);
    });
    await test('Real brush and eraser respect selection; clone and eyedropper sample pixels',async()=>{
      await setup();await tool('select');await drag(20,20,40,40);await tool('brush');await page.locator('[data-option="color"]').fill('#0000ff');await page.locator('[data-option="color"]').dispatchEvent('change');await page.locator('[data-option="size"]').fill('40');await page.locator('[data-option="size"]').press('Tab');await drag(29,30,31,30);
      assert.deepEqual((await pixel(30,30)).slice(0,3),[0,0,255]);assert.deepEqual(await pixel(15,30),[255,0,0,255]);
      await tool('erase');await drag(29,30,31,30);assert.equal((await pixel(30,30))[3],0);assert.equal((await pixel(15,30))[3],255);await shortcut('Control+d');
      await tool('clone');await page.locator('[data-option="size"]').fill('10');await page.locator('[data-option="size"]').press('Tab');let q=await point(15,15);await page.keyboard.down('Alt');await page.mouse.click(q.x,q.y);await page.keyboard.up('Alt');await drag(100,95,101,95);assert.deepEqual(await pixel(100,95),[255,0,0,255]);
      await tool('picker');q=await point(15,15);await page.mouse.click(q.x,q.y);await tool('brush');assert.equal(await page.locator('[data-option="color"]').inputValue(),'#ff0000');
    });
    await test('Group movement carries masks, uses one undo and prevents nested cycles',async()=>{
      await setup();await page.locator('#layers [data-layer]').first().click({button:'right'});await page.locator('#context-menu [data-command="group"]').click();await page.locator('#add-mask').click();await page.locator('#layers .thumb').first().click();await tool('move');await page.locator('[data-option="autoSelect"]').uncheck();
      const count=await page.evaluate(()=>window.editorTest.history.past.length);await drag(40,40,55,50);assert.equal(await page.evaluate(()=>window.editorTest.history.past.length),count+1);assert.equal(await page.evaluate(()=>window.editorTest.doc.layers[0].children[0].x),15);assert.equal(await page.evaluate(()=>window.editorTest.doc.layers[0].mask.getContext('2d').getImageData(0,0,1,1).data[0]),0);
      await shortcut('Control+z');assert.equal(await page.evaluate(()=>window.editorTest.doc.layers[0].mask.getContext('2d').getImageData(0,0,1,1).data[0]),255);await page.locator('[data-option="autoSelect"]').check();
      await page.locator('#layers [data-layer]').first().click({button:'right'});await page.locator('#context-menu [data-command="group"]').click();const ids=await page.evaluate(()=>[window.editorTest.doc.layers[0].id,window.editorTest.doc.layers[0].children[0].id]);await page.locator(`[data-layer="${ids[0]}"]`).dragTo(page.locator(`[data-layer="${ids[1]}"]`));assert.equal(await page.evaluate(()=>window.editorTest.doc.layers[0].children.length),1);assert.equal(await page.evaluate(()=>window.editorTest.doc.layers[0].id),ids[0]);
    });
    await page.evaluate(()=>{window.editorTest.adopt(window.editorTest.demoDocument());window.editorTest.interactions.chooseTool('select');});await page.mouse.move(10,10);await page.waitForTimeout(6100);await page.screenshot({path:path.join(output,'editor-03.png')});
  } finally {
    await app.evaluate(async({clipboard,ClipboardItem})=>{const items=globalThis.__clipboardSnapshot.map(values=>new ClipboardItem(values));if(items.length)await clipboard.write(items);else clipboard.clear();}).catch(error=>errors.push('Clipboard restore: '+error.message));
    await page.context().tracing.stop({path:path.join(output,'trace.zip')});await app.close();
  }
  const report={timestamp:new Date().toISOString(),passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results,rendererErrors:errors};await fs.writeFile(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(report.failed||errors.length)process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exit(1);});


