const { clipboard, ClipboardItem, nativeImage } = require('electron');
const { randomUUID, createHash } = require('node:crypto');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function registerClipboard(ipcMain, assertSender) {
  let internal = null;
  ipcMain.handle('clipboard-write', async (event, request) => {
    assertSender(event);
    const bytes = Buffer.from(request.png || []);
    if (bytes.length < 24 || bytes.length > 128 * 1024 * 1024 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('Invalid clipboard image.');
    const w = bytes.readUInt32BE(16), h = bytes.readUInt32BE(20);
    if (!w || !h || w > 8192 || h > 8192 || w * h > 16000000) throw new Error('Clipboard image is too large.');
    const project = request.project ? Buffer.from(request.project) : null;
    if (project?.length > 256 * 1024 * 1024) throw new Error('Clipboard layer is too large.');
    const image = nativeImage.createFromBuffer(bytes); if (image.isEmpty()) throw new Error('Invalid clipboard image.');
    const token = randomUUID();
    await clipboard.write([new ClipboardItem({'image/png': new Blob([bytes], {type:'image/png'}), 'web application/x-compositor-token': token})]);
    internal = { token, hash: digest(image.toPNG()), project, origin:request.origin || null };
    return true;
  });
  ipcMain.handle('clipboard-read', async event => {
    assertSender(event);
    const items = await clipboard.read(), item = items.find(i => i.types.includes('image/png'));
    if (!item) return null;
    const blob = await item.getType('image/png'); if (blob.size > 128 * 1024 * 1024) throw new Error('Clipboard image is too large.');
    const bytes = Buffer.from(await blob.arrayBuffer()), image = nativeImage.createFromBuffer(bytes);
    const {width,height} = image.getSize(); if (!width || !height || width * height > 16000000 || width > 8192 || height > 8192) throw new Error('Clipboard image is too large.');
    const tokenItem = items.find(i => i.types.includes('web application/x-compositor-token'));
    const token = tokenItem ? await (await tokenItem.getType('web application/x-compositor-token')).text() : null;
    const matches = internal && token === internal.token && digest(image.toPNG()) === internal.hash;
    return { png: new Uint8Array(bytes), project: matches && internal.project ? new Uint8Array(internal.project) : null, origin:matches ? internal.origin : null };
  });
}
module.exports = { registerClipboard };
