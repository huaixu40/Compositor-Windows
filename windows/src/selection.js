import { canvas, copy, localPoint } from './engine.js';

export function selectionFromMask(mask) {
  const { width, height } = mask, bytes = mask.getContext('2d').getImageData(0, 0, width, height).data;
  let left = width, top = height, right = 0, bottom = 0;
  const outline = new Path2D();
  const covered = (x, y) => x >= 0 && y >= 0 && x < width && y < height && bytes[(y * width + x) * 4 + 3] >= 128;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (bytes[(y * width + x) * 4 + 3]) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1); }
    if (!covered(x, y)) continue;
    if (!covered(x - 1, y)) { outline.moveTo(x, y); outline.lineTo(x, y + 1); }
    if (!covered(x + 1, y)) { outline.moveTo(x + 1, y); outline.lineTo(x + 1, y + 1); }
    if (!covered(x, y - 1)) { outline.moveTo(x, y); outline.lineTo(x + 1, y); }
    if (!covered(x, y + 1)) { outline.moveTo(x, y + 1); outline.lineTo(x + 1, y + 1); }
  }
  return { mask, outline, x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top), empty: right <= left || bottom <= top };
}
export function shapeSelection(width, height, points, kind = 'rectangle', feather = 0) {
  const mask = canvas(width, height), ctx = mask.getContext('2d'); ctx.fillStyle = '#fff'; ctx.beginPath();
  if (kind === 'polygon') { points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); }
  else {
    const a = points[0], b = points[1], x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else ctx.rect(x, y, w, h);
  }
  ctx.fill();
  if (feather > 0) { const source = copy(mask); ctx.clearRect(0, 0, width, height); ctx.filter = `blur(${Math.min(100, feather)}px)`; ctx.drawImage(source, 0, 0); ctx.filter = 'none'; }
  return selectionFromMask(mask);
}
export function normalizedSelection(value, width, height) {
  if (!value || value.mask) return value;
  return shapeSelection(width, height, [{ x:value.x, y:value.y }, { x:value.x + value.w, y:value.y + value.h }]);
}
export function featherSelection(value, radius) {
  if (!radius) return value;
  const mask=canvas(value.mask.width,value.mask.height),ctx=mask.getContext('2d');
  ctx.filter=`blur(${Math.min(100,radius)}px)`;ctx.drawImage(value.mask,0,0);
  return selectionFromMask(mask);
}
export function combineSelections(previous, next, mode, width, height) {
  if (!previous || mode === 'replace') return next;
  previous = normalizedSelection(previous, width, height);
  const result = copy(previous.mask), ctx = result.getContext('2d');
  ctx.globalCompositeOperation = {add:'source-over',subtract:'destination-out',intersect:'destination-in'}[mode];
  ctx.drawImage(next.mask, 0, 0); return selectionFromMask(result);
}
export function invertSelection(value, width, height) {
  const mask = canvas(width, height), ctx = mask.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
  if (value) { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(normalizedSelection(value, width, height).mask, 0, 0); }
  return selectionFromMask(mask);
}
export function coverageInLayer(selection, l, width, height) {
  const out = canvas(width, height), ctx = out.getContext('2d');
  if (!selection) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); return out; }
  if (l.image) {
    ctx.translate(width / 2, height / 2); ctx.scale((l.flip ? -1 : 1) / l.scale, 1 / l.scale); ctx.rotate(-l.rotation * Math.PI / 180);
    ctx.translate(-l.x - width * l.scale / 2, -l.y - height * l.scale / 2);
  }
  ctx.drawImage(selection.mask, 0, 0); return out;
}
// Blend a completed operation against its previous pixels using soft selection coverage.
// Premultiplied interpolation preserves color at transparent edges.
export function applyCoverage(surface, coverage, operation, region) {
  if (!coverage) { operation(surface.getContext('2d')); return; }
  const x = Math.max(0, Math.floor(region?.x || 0)), y = Math.max(0, Math.floor(region?.y || 0));
  const w = Math.min(surface.width - x, Math.ceil(region?.w ?? surface.width)), h = Math.min(surface.height - y, Math.ceil(region?.h ?? surface.height));
  if (w <= 0 || h <= 0) return;
  const ctx = surface.getContext('2d'), before = ctx.getImageData(x, y, w, h), mask = coverage.getContext('2d').getImageData(x, y, w, h).data;
  operation(ctx); const after = ctx.getImageData(x, y, w, h), a = before.data, b = after.data;
  for (let i = 0; i < a.length; i += 4) {
    const weight = mask[i + 3] / 255, oldAlpha = a[i + 3] * (1 - weight), newAlpha = b[i + 3] * weight, alpha = oldAlpha + newAlpha;
    for (let c = 0; c < 3; c++) b[i + c] = alpha ? (a[i + c] * oldAlpha + b[i + c] * newAlpha) / alpha : 0;
    b[i + 3] = alpha;
  }
  ctx.putImageData(after, x, y);
}
export function floodMask(source, x, y, tolerance = 32, contiguous = true) {
  const {width:w,height:h} = source, data = source.getContext('2d').getImageData(0, 0, w, h).data;
  x = Math.floor(x); y = Math.floor(y); const mask = canvas(w, h), ctx = mask.getContext('2d'), result = ctx.createImageData(w, h);
  if (x < 0 || y < 0 || x >= w || y >= h) return selectionFromMask(mask);
  const index = (y * w + x) * 4, seed = data.slice(index, index + 4), seen = new Uint8Array(w * h);
  const matches = i => Math.max(...[0,1,2,3].map(c => Math.abs(data[i * 4 + c] - seed[c]))) <= tolerance;
  const mark = i => { result.data[i * 4] = result.data[i * 4 + 1] = result.data[i * 4 + 2] = result.data[i * 4 + 3] = 255; };
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (matches(i)) mark(i); }
  else {
    const queue = new Int32Array(w * h); let head = 0, tail = 0; queue[tail++] = y * w + x; seen[y * w + x] = 1;
    while (head < tail) {
      const i = queue[head++]; if (!matches(i)) continue; mark(i);
      const px = i % w, py = Math.floor(i / w);
      for (const n of [px ? i - 1 : -1, px < w - 1 ? i + 1 : -1, py ? i - w : -1, py < h - 1 ? i + w : -1]) if (n >= 0 && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
    }
  }
  ctx.putImageData(result, 0, 0); return selectionFromMask(mask);
}
export function moveLayer(doc, id, destinationId, placement, validateOnly = false) {
  let source, owner, destination, targetOwner, targetDepth=0;
  function visit(nodes,depth=0) { for (const n of nodes) { if (n.id === id) { source = n; owner = nodes; } if (n.id === destinationId) { destination = n; targetOwner = nodes;targetDepth=depth; } if (n.children) visit(n.children,depth+1); } }
  visit(doc.layers); if (!source || id === destinationId) return false;
  function contains(n, target) { return n.id === target || n.children?.some(c => contains(c, target)); }
  if (destination && contains(source, destination.id)) return false;
  if (destinationId && !destination) return false;
  if (placement === 'inside' && !destination?.children) return false;
  const subtreeDepth=n=>n.children?.length?1+Math.max(...n.children.map(subtreeDepth)):0;
  if((destination?targetDepth+(placement==='inside'?1:0):0)+subtreeDepth(source)>32)return false;
  if(validateOnly)return true;
  const list = !destination ? doc.layers : placement === 'inside' ? destination.children : targetOwner;
  owner.splice(owner.indexOf(source), 1);
  const index = !destination || placement === 'inside' ? list.length : list.indexOf(destination) + (placement === 'after' ? 1 : 0);
  list.splice(index, 0, source); return true;
}
