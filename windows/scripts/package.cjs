const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function build() {
  const destination = path.join(root, 'release', 'Compositor-Windows-' + require('../package.json').version);
  if (await fs.stat(destination).catch(() => null)) throw new Error('Release directory already exists. Preserve or rename it before rebuilding.');
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(path.join(root, 'node_modules', 'electron', 'dist'), destination, { recursive: true });
  await fs.rename(path.join(destination, 'electron.exe'), path.join(destination, 'Compositor-Windows.exe'));
  const app = path.join(destination, 'resources', 'app');
  await fs.mkdir(app, { recursive: true });
  for (const file of ['main.cjs', 'settings.cjs', 'clipboard.cjs', 'preload.cjs', 'index.html', 'style.css', 'package.json']) await fs.copyFile(path.join(root, file), path.join(app, file));
  await fs.cp(path.join(root, 'dist'), path.join(app, 'dist'), { recursive: true });
  await fs.cp(path.join(root, 'test'), path.join(app, 'test'), { recursive: true });
  await fs.copyFile(path.join(root, '..', 'LICENSE'), path.join(destination, 'COMPOSITOR-LICENSE.txt'));
  await fs.copyFile(path.join(root, '..', 'NOTICE.md'), path.join(destination, 'NOTICE.md'));
  await fs.copyFile(path.join(root, 'README-WINDOWS.md'), path.join(destination, 'README-WINDOWS.md'));
  const licenses = [];
  for (const name of ['ag-psd', 'pako', 'base64-js']) {
    const directory = path.join(root, 'node_modules', name);
    const files = await fs.readdir(directory);
    const file = files.find(n => /^licen[sc]e/i.test(n));
    if (file) licenses.push(`\n===== ${name} =====\n` + await fs.readFile(path.join(directory, file), 'utf8'));
  }
  await fs.writeFile(path.join(destination, 'THIRD-PARTY-NOTICES.txt'), licenses.join('\n'));
  await fs.writeFile(path.join(root, 'Start-Compositor.cmd'), `@echo off\r\nstart "" "%~dp0release\\${path.basename(destination)}\\Compositor-Windows.exe"\r\n`);
  console.log(destination);
}
build().catch(error => { console.error(error); process.exit(1); });
