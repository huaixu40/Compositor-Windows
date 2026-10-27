const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createSettingsStore } = require('./settings.cjs');
let settingsStore;
const ui = (en, zh) => settingsStore?.get().language === 'zh-CN' ? zh : en;
const selfTest = process.argv.includes('--self-test');
const interactionTest = process.argv.includes('--interaction-test');
const testMode = selfTest || interactionTest;
app.setName('Compositor Windows');
// Keep this adaptation's profile separate from the original app.
app.setPath('userData', testMode ? path.join(__dirname, 'output', interactionTest ? 'interaction-profile' : 'test-profile') : path.join(app.getPath('appData'), 'Compositor-Windows'));
let window, dirty = false;
const sourcePaths = new Set();
const filters = [{ name: 'Images and projects', extensions: ['psd', 'png', 'jpg', 'jpeg', 'webp', 'cwin'] }];
function assertSender(event) { if (event.sender !== window.webContents) throw new Error('Unknown sender'); }
require('./clipboard.cjs').registerClipboard(ipcMain, assertSender);
ipcMain.handle('get-settings', event => { assertSender(event); return settingsStore.get(); });
ipcMain.handle('update-settings', (event, value) => { assertSender(event); return settingsStore.save(value); });
ipcMain.handle('open-file', async event => {
  assertSender(event);
  const result = await dialog.showOpenDialog(window, { title: ui('Open image or project', '打开图片或项目'), properties: ['openFile'], filters: [{...filters[0], name: ui(filters[0].name, '图片与项目')}] });
  if (result.canceled) return null;
  const file = result.filePaths[0], stat = await fs.stat(file);
  if (stat.size > (path.extname(file).toLowerCase()==='.cwin'?512:256) * 1024 * 1024) throw new Error('File exceeds the input size limit (projects: 512 MB, images: 256 MB).');
  const bytes = await fs.readFile(file);
  sourcePaths.add(path.resolve(file).toLowerCase());
  return { name: path.basename(file), bytes: new Uint8Array(bytes) };
});
ipcMain.handle('save-file', async (event, request) => {
  assertSender(event);
  const allowed = { psd: 'Photoshop document', cwin: 'Compositor Windows project', png: 'PNG image', jpg: 'JPEG image' };
  if (!allowed[request.extension]) throw new Error('Unsupported format');
  const result = await dialog.showSaveDialog(window, { title: ui('Save a copy', '另存副本'), defaultPath: request.name, filters: [{ name: allowed[request.extension], extensions: [request.extension] }] });
  if (result.canceled) return null;
  let file = result.filePath;
  if (!file.toLowerCase().endsWith('.' + request.extension)) file += '.' + request.extension;
  if (sourcePaths.has(path.resolve(file).toLowerCase())) {
    throw new Error('Please save a separate copy. This preview build protects the imported source file.');
  }
  const bytes = Buffer.from(request.bytes);
  if (bytes.length > 512 * 1024 * 1024) throw new Error('Output exceeds 512 MB.');
  const temp = file + '.' + Date.now() + '.tmp';
  try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); }
  catch (error) { await fs.rm(temp, { force: true }); throw error; }
  return path.basename(file);
});
ipcMain.on('dirty', (event, value) => { assertSender(event); dirty = Boolean(value); });
app.whenReady().then(async () => {
  settingsStore = createSettingsStore(path.join(app.getPath('userData'), 'settings.json'), app.getLocale().startsWith('zh') ? 'zh-CN' : 'en');
  await settingsStore.load();
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({ width: 1480, height: 960, minWidth: 1080, minHeight: 720, show: !selfTest, backgroundColor: '#17191d', title: 'Compositor Windows', webPreferences: { backgroundThrottling: !testMode, preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (dirty && !testMode && dialog.showMessageBoxSync(window, { type: 'question', message: ui('Discard unsaved changes?', '放弃未保存的修改？'), detail: ui('Save a .cwin project to keep your editable filters and layers.', '保存 .cwin 项目可保留可编辑滤镜和图层。'), buttons: [ui('Keep editing', '继续编辑'), ui('Discard', '放弃修改')], defaultId: 0, cancelId: 0 }) === 0) event.preventDefault();
  });
  await window.loadFile(path.join(__dirname, 'index.html'), { query: { demo: process.argv.includes('--demo') ? '1' : '0' } });
  if (selfTest) {
    try {
      const fixtures = [];
      for (const name of ['external-test.psd', 'external-text.psd']) {
        const bytes = await fs.readFile(path.join(__dirname, 'test', 'fixtures', name)).catch(() => null);
        if (bytes) fixtures.push({ name, bytes: Array.from(bytes) });
      }
      await window.webContents.executeJavaScript('window.appReady');
      const report = await window.webContents.executeJavaScript(`window.runSelfTest(${JSON.stringify(fixtures)})`);
      await fs.mkdir(path.join(__dirname, 'output'), { recursive: true });
      const testPath = path.join(__dirname, 'output', 'io-test.psd');
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: testPath });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [testPath] });
      try { report.results.push(await window.webContents.executeJavaScript('window.desktopIOTest()')); report.passed++; }
      catch (error) { report.results.push({ name: 'Desktop IPC file pipeline', passed: false, error: error.message }); report.failed++; }
      try {
        const reloaded = await createSettingsStore(path.join(app.getPath('userData'), 'settings.json'), 'en').load();
        if (reloaded.language !== 'zh-CN') throw new Error('Settings were not persisted');
        report.results.push({name: 'Language persists when settings store is recreated', passed: true}); report.passed++;
      } catch (error) { report.results.push({name: 'Language persistence', passed:false,error:error.message}); report.failed++; }
      await fs.writeFile(path.join(__dirname, 'output', 'test-results.json'), JSON.stringify(report, null, 2));
      const screenshot = await window.webContents.capturePage();
      await fs.writeFile(path.join(__dirname, 'output', 'editor.png'), screenshot.toPNG());
      await window.webContents.executeJavaScript("window.captureLocale('en', true)");
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(__dirname, 'output', 'settings-en.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript("window.captureLocale('zh-CN', true)");
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(__dirname, 'output', 'settings-zh.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript('window.captureAdjustment()');
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(__dirname, 'output', 'adjustment-zh.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(1080, 720);
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(__dirname, 'output', 'minimum-window.png'), (await window.webContents.capturePage()).toPNG());
      console.log(JSON.stringify(report, null, 2));
      app.exit(report.failed ? 1 : 0);
    } catch (error) { console.error(error); app.exit(1); }
  }
});
app.on('window-all-closed', () => app.quit());
