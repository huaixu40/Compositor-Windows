export const LIMIT = 16_000_000;
export function canvas(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > LIMIT) throw new Error('Image dimensions exceed this build’s 8192 px / 16 MP limit.');
  if(typeof document==='undefined')return new OffscreenCanvas(width,height);
  const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
}
export function copy(c) { if (!c) return null; const out = canvas(c.width, c.height); out.getContext('2d').drawImage(c, 0, 0); return out; }
