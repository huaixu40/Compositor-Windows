import { canvas, copy } from './pixels.js';
export function layer(name, image, options = {}) { return { id: crypto.randomUUID(), name, image, x: 0, y: 0, scale: 1, rotation: 0, flip: false, opacity: 1, blend: 'normal', visible: true, filters: [], mask: null, maskEnabled: true, ...options }; }
export function newDocument(width, height, name = 'Untitled') { canvas(width, height); return { width, height, name, layers: [layer('Layer 1', canvas(width, height))] }; }
export function walk(layers, callback, depth = 0) { for (const l of layers) { callback(l, depth); if (l.children) walk(l.children, callback, depth + 1); } }
export function findLayer(doc, id) { let result; walk(doc.layers, l => { if (l.id === id) result = l; }); return result; }
export function siblings(doc, id, layers = doc.layers) { if (layers.some(l => l.id === id)) return layers; for (const l of layers) if (l.children) { const found = siblings(doc, id, l.children); if (found) return found; } }
export function cloneLayer(l) {
  const result={ ...l, image: copy(l.image), mask: copy(l.mask), filters: structuredClone(l.filters), adjustment: l.adjustment ? structuredClone(l.adjustment) : undefined, children: l.children?.map(cloneLayer) };
  for(const key of ['text','path','effects','warp'])if(l[key])result[key]=structuredClone(l[key]);
  // Original RAW/high-precision resource arrays are immutable. Development jobs
  // replace the resource rather than editing a shared history snapshot in place.
  if(l.highPrecision)result.highPrecision={...l.highPrecision};
  if(l.raw)result.raw={...l.raw,parameters:structuredClone(l.raw.parameters)};
  return result;
}
export function cloneDocument(doc) { return { ...doc, layers: doc.layers.map(cloneLayer) }; }
export function pixelBytes(doc) { let bytes = doc._selection?.mask ? doc._selection.mask.width * doc._selection.mask.height * 4 : 0; walk(doc.layers, l => { for (const c of [l.image, l.mask]) if (c) bytes += c.width * c.height * 4; bytes+=(l.highPrecision?.data?.byteLength||0)+(l.raw?.source?.byteLength||0); }); return bytes; }
export class History {
  constructor() { this.past = []; this.future = []; }
  push(doc) { this.past.push(cloneDocument(doc)); this.future = []; while (this.past.length > 20 || (this.past.length > 1 && this.past.reduce((n, d) => n + pixelBytes(d), 0) > 128 * 1024 * 1024)) this.past.shift(); }
  undo(doc) { if (!this.past.length) return doc; this.future.push(doc); return this.past.pop(); }
  redo(doc) { if (!this.future.length) return doc; this.past.push(doc); return this.future.pop(); }
}
