import { readPsd, writePsd } from 'ag-psd';
import { canvas, layer, BLENDS, PSD_ADJUSTMENTS, composite, bakedLayer } from './engine.js';

export function checkPsd(bytes) {
  if (bytes.byteLength < 26) throw new Error('Truncated PSD header.');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '8BPS') throw new Error('Invalid PSD signature.');
  if (v.getUint16(4) !== 1) throw new Error('PSB is not supported in this Windows preview. Use an 8-bit RGB PSD copy.');
  if (v.getUint16(22) !== 8 || v.getUint16(24) !== 3) throw new Error('Only 8-bit RGB PSD is supported. Convert a copy in the source application first.');
  canvas(v.getUint32(18), v.getUint32(14));
}
export function importPsd(bytes, name) {
  checkPsd(bytes);
  const structure = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  let total = structure.width * structure.height, count = 0;
  const notes = [];
  function inspect(layers, depth = 0) {
    if (depth > 32) throw new Error('PSD nesting exceeds 32 levels.');
    for (const l of layers || []) {
      if (++count > 500) throw new Error('PSD exceeds this build’s 500-layer limit.');
      const note = message => notes.push(`${l.name || 'Unnamed layer'}: ${message}`);
      for (const rectangle of [l, l.mask]) if (rectangle) {
        const w = Math.max(0, (rectangle.right || 0) - (rectangle.left || 0)), h = Math.max(0, (rectangle.bottom || 0) - (rectangle.top || 0));
        if (w && h) { canvas(w, h); total += w * h; }
      }
      if ((l.children || l.adjustment) && l.mask) total += structure.width * structure.height * 2;
      if (l.children) inspect(l.children, depth + 1);
      if (l.blendMode && !BLENDS[l.blendMode] && l.blendMode !== 'pass through') note(`“${l.blendMode}” blend mode becomes Normal.`);
      if (l.text) note('Text becomes cached pixels; text will no longer be editable.');
      if (l.placedLayer) note('Smart object becomes cached pixels; embedded/linked source is not retained.');
      if (l.vectorMask || l.vectorFill || l.vectorStroke) note('Vector data becomes cached pixels; vector masks are not rendered.');
      if (l.effects && !l.effects.disabled) note('Layer styles are not rendered or retained in the editable copy.');
      if (l.adjustment) note(PSD_ADJUSTMENTS.includes(l.adjustment.type) ? `${l.adjustment.type} adjustment parameters are retained. Windows preview uses an approximation; Photoshop may render differently.` : 'Photoshop adjustment layer is skipped in the editable copy. Use merged preview for its original appearance.');
      if (l.adjustment && l.blendMode && l.blendMode !== 'normal') note('Adjustment layer blend mode becomes Normal.');
      if (l.clipping) note('Clipping relationship is removed in the editable copy.');
      if (l.fillOpacity !== undefined && l.fillOpacity < 1) note('Fill opacity is approximated by layer opacity.');
      if (l.mask?.userMaskFeather || (l.mask?.userMaskDensity !== undefined && l.mask.userMaskDensity < 1)) note('Mask feather/density is baked into the raster mask; preview is approximate.');
      if (l.children && l.mask && l.blendMode === 'pass through') note('Masked pass-through group becomes an isolated Normal group.');
      if (l.realMask || l.knockout || l.artboard || l.channelBlendingRestrictions?.length) note('Additional mask, knockout, artboard or channel restrictions are not retained.');
      if (l.blendingRanges) {
        const r = l.blendingRanges, ranges = [r.compositeGrayBlendSource, r.compositeGraphBlendDestinationRange, ...(r.ranges || []).flatMap(v => [v.sourceRange, v.destRange])];
        if (ranges.some(v => v && v.join(',') !== '0,0,255,255')) note('Custom Blend If ranges are not rendered or retained.');
      }
    }
  }
  inspect(structure.children);
  if (structure.imageResources?.iccProfile) notes.push('Document: the embedded ICC profile is not retained. This preview works in browser sRGB; color may differ.');
  if (total > 64_000_000) throw new Error('Combined layer and mask pixels exceed this preview’s 64 MP import limit.');
  const psd = readPsd(bytes, { skipThumbnail: true });
  function convert(nodes) {
    return (nodes || []).flatMap(n => {
      if (n.adjustment && !PSD_ADJUSTMENTS.includes(n.adjustment.type)) return [];
      const group = Boolean(n.children), image = n.adjustment ? null : n.canvas || (group ? null : canvas(1, 1));
      const l = layer(n.name || 'Layer', image, { x: n.left || 0, y: n.top || 0, opacity: (n.opacity ?? 1) * (n.fillOpacity ?? 1), visible: !n.hidden, blend: BLENDS[n.blendMode] || (group && n.blendMode === 'pass through') ? (n.blendMode || 'normal') : 'normal' });
      if (group) { l.children = convert(n.children); l.x = l.y = 0; }
      if (n.adjustment) { l.adjustment = structuredClone(n.adjustment); l.x = l.y = 0; l.blend = 'normal'; }
      if (n.mask) {
        const m = n.mask, mask = canvas(group || n.adjustment ? psd.width : image.width, group || n.adjustment ? psd.height : image.height), ctx = mask.getContext('2d');
        const value = m.defaultColor ?? 255; ctx.fillStyle = `rgb(${value},${value},${value})`; ctx.fillRect(0, 0, mask.width, mask.height);
        if (m.canvas) ctx.drawImage(m.canvas, (m.left || 0) - (m.positionRelativeToLayer ? 0 : l.x), (m.top || 0) - (m.positionRelativeToLayer ? 0 : l.y));
        // Bake effective mask coverage so export does not silently discard density/feather.
        if (m.userMaskFeather > 0) {
          const pad = Math.min(1024, Math.ceil(m.userMaskFeather * 3)), feathered = document.createElement('canvas');
          feathered.width = mask.width + pad * 2; feathered.height = mask.height + pad * 2;
          const fctx = feathered.getContext('2d'); fctx.fillStyle = `rgb(${value},${value},${value})`; fctx.fillRect(0, 0, feathered.width, feathered.height); fctx.drawImage(mask, pad, pad);
          ctx.filter = `blur(${Math.min(256, m.userMaskFeather)}px)`; ctx.drawImage(feathered, -pad, -pad); ctx.filter = 'none';
        }
        if (m.userMaskDensity !== undefined && m.userMaskDensity < 1) {
          const data = ctx.getImageData(0, 0, mask.width, mask.height), density = Math.max(0, m.userMaskDensity);
          for (let i = 0; i < data.data.length; i += 4) for (let c = 0; c < 3; c++) data.data[i + c] = 255 - (255 - data.data[i + c]) * density;
          ctx.putImageData(data, 0, 0);
        }
        l.mask = mask; l.maskEnabled = !m.disabled;
        if (group && l.blend === 'pass through') l.blend = 'normal';
      }
      return [l];
    });
  }
  const doc = { width: psd.width, height: psd.height, name: name.replace(/\.psd$/i, ''), layers: convert(psd.children) };
  if (!doc.layers.length && psd.canvas) doc.layers = [layer('Merged image', psd.canvas)];
  if (!doc.layers.length) throw new Error('No decodable pixels in this PSD.');
  return { doc, notes, preview: psd.canvas ? { ...doc, layers: [layer('Original PSD merged preview', psd.canvas)] } : null };
}
export function exportPsd(doc) {
  function convert(layers) {
    return layers.map(l => {
      const base = { name: l.name, opacity: l.opacity, hidden: !l.visible, blendMode: l.blend };
      if (l.adjustment) { base.adjustment = structuredClone(l.adjustment); if (l.mask) base.mask = { canvas: l.mask, left: 0, top: 0, defaultColor: 255, disabled: !l.maskEnabled }; return base; }
      if (l.children) {
        base.children = convert(l.children);
        if (l.mask) base.mask = { canvas: l.mask, left: 0, top: 0, defaultColor: 255, disabled: !l.maskEnabled };
        return base;
      }
      const baked = bakedLayer(doc, l); base.canvas = baked.image; base.left = baked.x; base.top = baked.y;
      if (l.mask) {
        const maskLayer = { ...l, image: l.mask, filters: [] }, bm = bakedLayer(doc, maskLayer);
        // Rotated mask corners must be black, not transparent white.
        const mask = canvas(bm.image.width, bm.image.height), ctx = mask.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, mask.width, mask.height); ctx.drawImage(bm.image, 0, 0);
        base.mask = { canvas: mask, left: bm.x, top: bm.y, defaultColor: 0, disabled: !l.maskEnabled };
      }
      return base;
    });
  }
  return new Uint8Array(writePsd({ width: doc.width, height: doc.height, canvas: composite(doc), children: convert(doc.layers) }, { generateThumbnail: false, noBackground: true }));
}
export function serializeProject(doc) {
  const serialize = l => ({ ...l, image: l.image?.toDataURL('image/png') || null, mask: l.mask?.toDataURL('image/png') || null, children: l.children?.map(serialize) });
  return new TextEncoder().encode(JSON.stringify({ format: 'com.compositor.windows', version: 1, width: doc.width, height: doc.height, name: doc.name, layers: doc.layers.map(serialize) }));
}
async function decodePng(url) {
  if (!/^data:image\/png;base64,/.test(url) || url.length > 100_000_000) throw new Error('Invalid project image.');
  const header = atob(url.split(',')[1].slice(0, 44)), bytes = Uint8Array.from(header, c => c.charCodeAt(0)), v = new DataView(bytes.buffer);
  if (v.byteLength < 24 || v.getUint32(0) !== 0x89504e47) throw new Error('Invalid PNG.');
  canvas(v.getUint32(16), v.getUint32(20));
  return loadImage(url);
}
export async function loadImage(url) {
  const img = new Image(); img.src = url; await img.decode();
  const c = canvas(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img, 0, 0); return c;
}
const filterFields = {
  exposure: { exposure: [-5, 5], contrast: [-100, 100] }, levels: { black: [0, 254], white: [1, 255], gamma: [.1, 5] },
  curves: { shadows: [0, 255], midtones: [0, 255], highlights: [0, 255] }, hsl: { hue: [-180, 180], saturation: [-100, 100], lightness: [-100, 100] },
  balance: { red: [-100, 100], green: [-100, 100], blue: [-100, 100] }, blur: { radius: [0, 50] }, sharpen: { amount: [0, 200] }, bw: {}
};
export async function parseProject(bytes) {
  const p = JSON.parse(new TextDecoder().decode(bytes));
  if (p.format !== 'com.compositor.windows' || p.version !== 1) throw new Error('Unsupported project format/version.');
  canvas(p.width, p.height);
  let count = 0, pixels = 0;
  async function parse(nodes, depth = 0) {
    if (!Array.isArray(nodes) || depth > 32) throw new Error('Invalid layer structure.');
    const layers = [];
    for (const n of nodes) {
      if (++count > 500) throw new Error('Too many layers.');
      for (const key of ['x', 'y', 'scale', 'rotation', 'opacity']) if (!Number.isFinite(n[key])) throw new Error(`Invalid ${key}.`);
      if (Math.abs(n.x) > 100000 || Math.abs(n.y) > 100000 || n.scale < .01 || n.scale > 10 || Math.abs(n.rotation) > 360 || n.opacity < 0 || n.opacity > 1) throw new Error('Layer properties out of range.');
      if (!BLENDS[n.blend] && n.blend !== 'pass through') throw new Error('Unsupported blend mode.');
      if (!Array.isArray(n.filters) || n.filters.length > 30) throw new Error('Invalid filters.');
      for (const f of n.filters) { if (!filterFields[f.kind]) throw new Error('Unknown filter.'); for (const [key, range] of Object.entries(filterFields[f.kind])) if (!Number.isFinite(f[key]) || f[key] < range[0] || f[key] > range[1]) throw new Error('Invalid filter parameter.'); }
      const image = n.image ? await decodePng(n.image) : null, mask = n.mask ? await decodePng(n.mask) : null;
      pixels += (image ? image.width * image.height : 0) + (mask ? mask.width * mask.height : 0);
      if (pixels > 64_000_000) throw new Error('Project exceeds 64 MP pixel budget.');
      if (mask && (mask.width !== (image?.width || p.width) || mask.height !== (image?.height || p.height))) throw new Error('Mask dimensions do not match layer.');
      const l = layer(String(n.name).slice(0, 200), image, { x: n.x, y: n.y, scale: n.scale, rotation: n.rotation, opacity: n.opacity, blend: n.blend, visible: Boolean(n.visible), flip: Boolean(n.flip), mask, maskEnabled: n.maskEnabled !== false, filters: structuredClone(n.filters) });
      if (n.adjustment) { validateAdjustment(n.adjustment); l.adjustment = structuredClone(n.adjustment); }
      if (n.children) l.children = await parse(n.children, depth + 1);
      else if (l.adjustment) { /* Adjustment layers have no pixel source. */ }
      else if (!image) throw new Error('Pixel layer is missing its image.');
      layers.push(l);
    }
    return layers;
  }
  return { width: p.width, height: p.height, name: String(p.name).slice(0, 200), layers: await parse(p.layers) };
}

export function validateAdjustment(a) {
  if (!PSD_ADJUSTMENTS.includes(a.type)) throw new Error('Unsupported adjustment layer.');
  if (a.type === 'levels' || a.type === 'curves') for (const key of ['rgb', 'red', 'green', 'blue']) {
    if (!a[key]) continue;
    if (a.type === 'curves') {
      const points = a[key];
      if (!Array.isArray(points) || points.length < 2 || points.length > 256 || points.some((p, i) => !Number.isFinite(p.input) || !Number.isFinite(p.output) || p.input < 0 || p.input > 255 || p.output < 0 || p.output > 255 || (i && p.input <= points[i - 1].input))) throw new Error('Invalid curve points.');
    } else {
      const p = a[key]; for (const field of ['shadowInput', 'highlightInput', 'shadowOutput', 'highlightOutput']) if (!Number.isFinite(p[field]) || p[field] < 0 || p[field] > 255) throw new Error('Invalid level range.');
      if (!Number.isFinite(p.midtoneInput) || p.midtoneInput <= 0 || p.midtoneInput > 10 || p.shadowInput >= p.highlightInput) throw new Error('Invalid levels gamma.');
    }
  }
  if (a.type === 'exposure') { for (const key of ['exposure', 'offset', 'gamma']) if (a[key] !== undefined && (!Number.isFinite(a[key]) || Math.abs(a[key]) > 100)) throw new Error('Invalid exposure.'); if (a.gamma !== undefined && a.gamma <= 0) throw new Error('Invalid exposure.'); }
}

export { readPsd, writePsd };
