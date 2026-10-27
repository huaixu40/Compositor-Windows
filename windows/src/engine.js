import { canvas, copy } from './pixels.js';
import { layer, newDocument } from './document.js';
export { canvas, copy, LIMIT } from './pixels.js';
export { layer, newDocument, walk, findLayer, siblings, cloneLayer, cloneDocument, pixelBytes, History } from './document.js';
export const BLENDS = { normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
const clamp = n => Math.max(0, Math.min(255, n));
export function curveLut(points) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  return Uint8Array.from({ length: 256 }, (_, x) => { let i = 1; while (i < sorted.length - 1 && x > sorted[i][0]) i++; const a = sorted[i - 1], b = sorted[i]; return clamp(a[1] + (b[1] - a[1]) * (x - a[0]) / Math.max(1, b[0] - a[0])); });
}
export function applyFilter(source, f) {
  if (f.enabled === false) return copy(source);
  const out = copy(source), ctx = out.getContext('2d', { willReadFrequently: true });
  if (f.kind === 'blur') { ctx.clearRect(0, 0, out.width, out.height); ctx.filter = `blur(${f.radius}px)`; ctx.drawImage(source, 0, 0); ctx.filter = 'none'; return out; }
  const image = ctx.getImageData(0, 0, out.width, out.height), d = image.data;
  const curve = f.kind === 'curves' ? curveLut([[0, 0], [64, f.shadows], [128, f.midtones], [192, f.highlights], [255, 255]]) : null;
  const original = f.kind === 'sharpen' ? new Uint8ClampedArray(d) : null;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (f.kind === 'exposure') {
      const gain = 2 ** f.exposure, contrast = 1 + f.contrast / 100;
      r = (r * gain - 128) * contrast + 128; g = (g * gain - 128) * contrast + 128; b = (b * gain - 128) * contrast + 128;
    } else if (f.kind === 'levels') {
      const adjust = v => 255 * Math.max(0, Math.min(1, (v - f.black) / Math.max(1, f.white - f.black))) ** (1 / f.gamma);
      r = adjust(r); g = adjust(g); b = adjust(b);
    } else if (f.kind === 'curves') { r = curve[r]; g = curve[g]; b = curve[b]; }
    else if (f.kind === 'balance') { r += f.red; g += f.green; b += f.blue; }
    else if (f.kind === 'bw') { const gray = .2126 * r + .7152 * g + .0722 * b; r = g = b = gray; }
    else if (f.kind === 'hsl') {
      // Hue rotation in YIQ, with independent luminance and saturation controls.
      const y = .299 * r + .587 * g + .114 * b, u = .596 * r - .274 * g - .322 * b, v = .211 * r - .523 * g + .312 * b;
      const angle = f.hue * Math.PI / 180, sat = 1 + f.saturation / 100;
      const a = (u * Math.cos(angle) - v * Math.sin(angle)) * sat, z = (u * Math.sin(angle) + v * Math.cos(angle)) * sat;
      r = y + .956 * a + .621 * z + f.lightness * 2.55; g = y - .272 * a - .647 * z + f.lightness * 2.55; b = y - 1.106 * a + 1.703 * z + f.lightness * 2.55;
    } else if (f.kind === 'sharpen') {
      const x = i / 4 % out.width, y = Math.floor(i / 4 / out.width), amount = f.amount / 100;
      if (x > 0 && y > 0 && x < out.width - 1 && y < out.height - 1) {
        const sharp = c => original[i + c] * (1 + 4 * amount) - amount * (original[i - 4 + c] + original[i + 4 + c] + original[i - out.width * 4 + c] + original[i + out.width * 4 + c]);
        r = sharp(0); g = sharp(1); b = sharp(2);
      }
    }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(b);
  }
  ctx.putImageData(image, 0, 0); return out;
}
const cache = new WeakMap();
const revisions = new WeakMap();
export const pixelRevision=l=>revisions.get(l)||0;
export function invalidate(l) { cache.delete(l);revisions.set(l,pixelRevision(l)+1); }
export function filtered(l, extra) {
  if (!l.image) return null;
  const key = JSON.stringify(l.filters), found = cache.get(l);
  let image;
  if (found?.key === key) image = found.image;
  else { image = l.image; for (const f of l.filters) image = applyFilter(image, f); cache.set(l, { key, image }); }
  return extra ? applyFilter(image, extra) : image;
}
export function masked(image, mask) {
  if (!mask) return image;
  const out = copy(image), ctx = out.getContext('2d'), pixels = ctx.getImageData(0, 0, out.width, out.height);
  const coverage = mask.getContext('2d').getImageData(0, 0, mask.width, mask.height).data;
  for (let i = 0; i < pixels.data.length; i += 4) pixels.data[i + 3] = Math.round(pixels.data[i + 3] * coverage[i] / 255);
  ctx.putImageData(pixels, 0, 0); return out;
}
export const PSD_ADJUSTMENTS = ['levels', 'curves', 'exposure', 'invert'];
export function applyPsdAdjustment(source, adjustment) {
  const out = copy(source), ctx = out.getContext('2d'), data = ctx.getImageData(0, 0, out.width, out.height), d = data.data;
  const maps = ['rgb', 'red', 'green', 'blue'].map(key => {
    const channel = adjustment[key];
    if (!channel) return null;
    if (adjustment.type === 'curves') return curveLut(channel.map(p => [p.input, p.output]));
    if (adjustment.type === 'levels') return Uint8Array.from({ length: 256 }, (_, value) => clamp(channel.shadowOutput + (channel.highlightOutput - channel.shadowOutput) * Math.max(0, Math.min(1, (value - channel.shadowInput) / Math.max(1, channel.highlightInput - channel.shadowInput))) ** (1 / Math.max(.01, channel.midtoneInput))));
    return null;
  });
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
    let value = d[i + c];
    if (adjustment.type === 'invert') value = 255 - value;
    else if (adjustment.type === 'exposure') value = 255 * Math.max(0, value / 255 * 2 ** (adjustment.exposure || 0) + (adjustment.offset || 0)) ** (1 / Math.max(.01, adjustment.gamma || 1));
    else { if (maps[0]) value = maps[0][value]; if (maps[c + 1]) value = maps[c + 1][value]; }
    d[i + c] = clamp(value);
  }
  ctx.putImageData(data, 0, 0); return out;
}
export function drawTransformed(ctx, image, l) {
  ctx.save(); ctx.translate(l.x + image.width * l.scale / 2, l.y + image.height * l.scale / 2); ctx.rotate(l.rotation * Math.PI / 180); ctx.scale(l.scale * (l.flip ? -1 : 1), l.scale); ctx.drawImage(image, -image.width / 2, -image.height / 2); ctx.restore();
}
export function composite(doc, preview = null) {
  const out = canvas(doc.width, doc.height);
  function draw(layers, destination, inherited = 1) {
    const ctx = destination.getContext('2d');
    for (const l of [...layers].reverse()) {
      if (!l.visible) continue;
      if (l.adjustment) {
        const original = ctx.getImageData(0, 0, doc.width, doc.height), changed = applyPsdAdjustment(destination, preview?.id === l.id && preview.adjustment ? preview.adjustment : l.adjustment).getContext('2d').getImageData(0, 0, doc.width, doc.height);
        const mask = l.mask && l.maskEnabled ? l.mask.getContext('2d').getImageData(0, 0, doc.width, doc.height).data : null;
        const alpha = inherited * l.opacity;
        for (let i = 0; i < original.data.length; i += 4) { const weight = alpha * (mask ? mask[i] / 255 : 1); for (let c = 0; c < 3; c++) original.data[i + c] += (changed.data[i + c] - original.data[i + c]) * weight; }
        ctx.putImageData(original, 0, 0);
      } else if (l.children) {
        if (l.blend === 'pass through' && !l.mask) draw(l.children, destination, inherited * l.opacity);
        else { const group = canvas(doc.width, doc.height); draw(l.children, group); ctx.save(); ctx.globalAlpha = inherited * l.opacity; ctx.globalCompositeOperation = BLENDS[l.blend] || 'source-over'; ctx.drawImage(masked(group, l.maskEnabled ? l.mask : null), 0, 0); ctx.restore(); }
      } else if (l.image) {
        let image;
        if (preview?.id === l.id && preview.index >= 0) {
          const filters = l.filters.map((f, i) => i === preview.index ? preview.filter : f);
          image = filtered({ ...l, filters });
        } else image = filtered(l, preview?.id === l.id ? preview.filter : null);
        ctx.save(); ctx.globalAlpha = inherited * l.opacity; ctx.globalCompositeOperation = BLENDS[l.blend] || 'source-over'; drawTransformed(ctx, masked(image, l.maskEnabled ? l.mask : null), l); ctx.restore();
      }
    }
  }
  draw(doc.layers, out); return out;
}
export function localPoint(l, p) {
  if (!l.image) return { ...p };
  const cx = l.x + l.image.width * l.scale / 2, cy = l.y + l.image.height * l.scale / 2;
  const angle = -l.rotation * Math.PI / 180, dx = p.x - cx, dy = p.y - cy;
  return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / l.scale * (l.flip ? -1 : 1) + l.image.width / 2, y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / l.scale + l.image.height / 2 };
}
export function bakedLayer(doc, l, withMask = false) {
  const source = withMask ? masked(filtered(l), l.maskEnabled ? l.mask : null) : filtered(l);
  if (!l.rotation && l.scale === 1 && !l.flip) return { image: copy(source), x: Math.round(l.x), y: Math.round(l.y) };
  const radians = l.rotation * Math.PI / 180, w = source.width * l.scale, h = source.height * l.scale;
  const bw = Math.ceil(Math.abs(w * Math.cos(radians)) + Math.abs(h * Math.sin(radians))), bh = Math.ceil(Math.abs(w * Math.sin(radians)) + Math.abs(h * Math.cos(radians)));
  const x = Math.floor(l.x + w / 2 - bw / 2), y = Math.floor(l.y + h / 2 - bh / 2), image = canvas(bw, bh);
  const ctx = image.getContext('2d'); ctx.translate(-x, -y); drawTransformed(ctx, source, l); return { image, x, y };
}
export function demoDocument() {
  const doc = newDocument(1440, 960, 'Chromatic study'); doc.layers = [];
  const bg = canvas(1440, 960), b = bg.getContext('2d'), gradient = b.createLinearGradient(0, 0, 1440, 960);
  gradient.addColorStop(0, '#d7d7c5'); gradient.addColorStop(1, '#a8b7a7'); b.fillStyle = gradient; b.fillRect(0, 0, 1440, 960);
  doc.layers.push(layer('Paper / warm gray', bg));
  const orb = canvas(800, 800), o = orb.getContext('2d'), g = o.createRadialGradient(280, 230, 10, 410, 410, 380);
  g.addColorStop(0, '#f8ad50'); g.addColorStop(.45, '#d45728'); g.addColorStop(.8, '#673d4e'); g.addColorStop(1, '#253b47'); o.fillStyle = g; o.beginPath(); o.arc(400, 400, 370, 0, Math.PI * 2); o.fill();
  doc.layers.unshift(layer('Sculpture / light & color', orb, { x: 430, y: 90 }));
  const type = canvas(1440, 960), t = type.getContext('2d'); t.fillStyle = '#283b38'; t.font = '20px Segoe UI'; t.fillText('COMPOSITOR  /  MATERIAL STUDIES', 75, 95); t.font = '110px Georgia'; t.fillText('Shape', 70, 335); t.fillText('the light.', 70, 445); t.font = '20px Segoe UI'; t.fillText('A new perspective. An open canvas.', 78, 817); t.fillText('01 — WINDOWS EDITION', 78, 865);
  doc.layers.unshift(layer('Typography / raster sample', type)); return doc;
}
