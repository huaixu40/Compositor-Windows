import { canvas, copy, layer, newDocument, walk, findLayer, siblings, cloneLayer, History, invalidate, composite, localPoint, demoDocument, BLENDS, curveLut, applyFilter, pixelBytes } from './engine.js';
import { importPsd, exportPsd, serializeProject, parseProject, loadImage, checkPsd, readPsd, writePsd } from './formats.js';
const $ = id => document.getElementById(id);
let doc = newDocument(1600, 1000), active = doc.layers[0].id, history = new History(), dirty = false, welcome = true, zoom = .5, tool = 'move', target = 'image', selection = null, preview = null, cloneSource = null, drag = null, busy = false;
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').style.display = 'none', 6000); }
function status(message) { $('status').textContent = message; }
function selected() { return findLayer(doc, active); }
function markDirty() { dirty = true; window.desktop?.dirty(true); }
function checkpoint() { history.push(doc); markDirty(); }
function edit(action) { if (busy) return; try { checkpoint(); action(); render(); } catch (error) { toast(error.message); } }
function editable() { const l = selected(); if (!l?.image) { toast('Select a pixel layer first.'); return null; } return l; }
function discard() { return !dirty || confirm('Discard unsaved changes? Save a .cwin project to keep your editable layers and filters.'); }
function adopt(next, modified = false) { doc = next; history = new History(); active = doc.layers[0]?.id; dirty = modified; window.desktop?.dirty(dirty); selection = null; target = 'image'; preview = null; cloneSource = null; welcome = false; $('welcome').style.display = 'none'; $('canvas-wrap').style.display = 'block'; fit(); render(); }
function fit() { const box = $('viewport'); zoom = Math.min(1, (box.clientWidth - 90) / doc.width, (box.clientHeight - 90) / doc.height); zoom = Math.max(.03, zoom); sizeView(); }
function sizeView() { const wrap = $('canvas-wrap'); wrap.style.width = `${doc.width * zoom}px`; wrap.style.height = `${doc.height * zoom}px`; for (const id of ['canvas', 'overlay']) { $(id).style.width = `${doc.width * zoom}px`; $(id).style.height = `${doc.height * zoom}px`; } $('zoom-value').textContent = `${Math.round(zoom * 100)}%`; }
function renderPixels() {
  const c = $('canvas'); if (c.width !== doc.width || c.height !== doc.height) { c.width = doc.width; c.height = doc.height; $('overlay').width = doc.width; $('overlay').height = doc.height; }
  const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(composite(doc, preview), 0, 0); drawOverlay();
}
function drawOverlay() {
  const ctx = $('overlay').getContext('2d'); ctx.clearRect(0, 0, doc.width, doc.height); ctx.lineWidth = 1 / zoom;
  const l = selected();
  if (l?.image && tool === 'move') { ctx.save(); ctx.strokeStyle = '#d4ec98'; ctx.translate(l.x + l.image.width * l.scale / 2, l.y + l.image.height * l.scale / 2); ctx.rotate(l.rotation * Math.PI / 180); ctx.strokeRect(-l.image.width * l.scale / 2, -l.image.height * l.scale / 2, l.image.width * l.scale, l.image.height * l.scale); ctx.restore(); }
  if (selection) { ctx.strokeStyle = '#fff'; ctx.setLineDash([5 / zoom, 5 / zoom]); ctx.strokeRect(selection.x, selection.y, selection.w, selection.h); ctx.lineDashOffset = 5 / zoom; ctx.strokeStyle = '#111'; ctx.strokeRect(selection.x, selection.y, selection.w, selection.h); ctx.setLineDash([]); }
}
function render() {
  renderPixels(); sizeView(); renderLayers(); renderProperties(); updateTool();
  $('doc-title').textContent = doc.name + (dirty ? ' •' : ''); $('doc-mode').textContent = `${doc.width} × ${doc.height}  ·  RGB / 8`;
  $('undo').disabled = !history.past.length; $('redo').disabled = !history.future.length;
  let count = 0; walk(doc.layers, () => count++); $('layer-count').textContent = `${count} layers`;
  status(`${doc.width} × ${doc.height} px   ·   ${target === 'mask' ? 'MASK · black hides / white reveals' : tool === 'clone' ? 'Alt-click the layer to choose a clone source' : 'Local editing · source file protected'}`);
}
function thumb(image, isTarget) { const img = document.createElement('img'); img.className = 'thumb' + (isTarget ? ' target' : ''); const c = canvas(40, 32); if (image) c.getContext('2d').drawImage(image, 0, 0, 40, 32); img.src = c.toDataURL(); return img; }
function renderLayers() {
  const root = $('layers'); root.replaceChildren();
  walk(doc.layers, (l, depth) => {
    const row = document.createElement('div'); row.className = 'layer' + (l.id === active ? ' active' : ''); row.style.paddingLeft = `${8 + depth * 15}px`; row.setAttribute('data-layer', l.id);
    const eye = document.createElement('button'); eye.className = 'visibility'; eye.textContent = l.visible ? '◉' : '○'; eye.title = 'Toggle visibility'; eye.onclick = event => { event.stopPropagation(); edit(() => l.visible = !l.visible); }; row.append(eye);
    const image = thumb(l.image, l.id === active && target === 'image'); image.title = l.children ? 'Layer group' : 'Edit pixels'; image.onclick = event => { event.stopPropagation(); active = l.id; target = 'image'; render(); }; row.append(image);
    if (l.mask) { const mask = thumb(l.mask, l.id === active && target === 'mask'); mask.title = 'Edit mask; Shift-click enables/disables'; mask.style.opacity = l.maskEnabled ? 1 : .4; mask.onclick = event => { event.stopPropagation(); active = l.id; if (event.shiftKey) edit(() => l.maskEnabled = !l.maskEnabled); else { target = 'mask'; tool = 'brush'; $('color').value = '#000000'; updateTool(); render(); } }; row.append(mask); }
    const name = document.createElement('span'); name.className = 'name'; name.textContent = (l.children ? '▸ ' : l.adjustment ? '◐ ' : '') + l.name; row.append(name);
    if (l.filters.length) { const fx = document.createElement('span'); fx.className = 'kind'; fx.textContent = 'fx'; row.append(fx); }
    row.onclick = () => { active = l.id; target = 'image'; render(); }; root.append(row);
  });
}
function renderProperties() {
  const l = selected(); $('layer-name').value = l?.name || ''; $('layer-x').value = Math.round(l?.x || 0); $('layer-y').value = Math.round(l?.y || 0); $('layer-scale').value = Math.round((l?.scale || 1) * 100); $('layer-rotation').value = l?.rotation || 0;
  $('blend').value = l?.blend || 'normal'; $('opacity').value = Math.round((l?.opacity ?? 1) * 100); $('opacity-label').textContent = $('opacity').value + '%';
  for (const id of ['layer-x', 'layer-y', 'layer-scale', 'layer-rotation', 'flip', 'reset-transform']) $(id).disabled = !l?.image;
  $('filter-list').replaceChildren();
  (l?.filters || []).forEach((f, index) => {
    const row = document.createElement('div'); row.className = 'filter-row'; const toggle = document.createElement('button'); toggle.textContent = f.enabled === false ? '○' : '◉'; toggle.title = 'Toggle filter'; toggle.onclick = () => edit(() => f.enabled = f.enabled === false);
    const name = document.createElement('span'); name.textContent = filterDefinitions[f.kind].title; name.title = 'Double-click to edit'; name.ondblclick = () => adjust(f.kind, index);
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = 'Remove filter'; remove.onclick = () => edit(() => l.filters.splice(index, 1)); row.append(toggle, name, remove); $('filter-list').append(row);
  });
}
async function run(action) { if (busy) return; busy = true; document.body.style.cursor = 'wait'; try { await action(); } catch (error) { console.error(error); toast(error.message); status(error.message); } finally { busy = false; document.body.style.cursor = ''; } }
async function readFile(add = false) {
  if (!add && !discard()) return;
  await run(async () => {
    const file = await window.desktop.open(); if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase(); let next;
    if (ext === 'psd') {
      if (add) throw new Error('Use Open to load a PSD document. Add image accepts PNG, JPEG and WebP.');
      status('Decoding PSD…'); await new Promise(resolve => requestAnimationFrame(resolve));
      const result = importPsd(file.bytes, file.name);
      if (result.notes.length) { const choice = await report(result.notes, Boolean(result.preview)); if (choice === 'cancel') return; next = choice === 'preview' ? result.preview : result.doc; } else next = result.doc;
    } else if (ext === 'cwin') { if (add) throw new Error('Use Open to load a project.'); next = await parseProject(file.bytes); }
    else {
      const url = URL.createObjectURL(new Blob([file.bytes])); let image; try { image = await loadImage(url); } finally { URL.revokeObjectURL(url); }
      if (add) { if (pixelBytes(doc) / 4 + image.width * image.height > 64_000_000) throw new Error('Document exceeds 64 MP pixel budget.'); history.push(doc); const l = layer(file.name, image); doc.layers.unshift(l); active = l.id; markDirty(); render(); return; }
      next = { width: image.width, height: image.height, name: file.name.replace(/\.[^.]+$/, ''), layers: [layer(file.name, image)] };
    }
    adopt(next); toast(`Opened ${file.name}`);
  });
}
function report(notes, hasPreview) {
  $('report-content').replaceChildren(); const p = document.createElement('p'); p.className = 'warning'; p.textContent = 'This PSD contains features that this preview cannot reproduce exactly. The editable copy converts or drops the items below. Your original file is protected; use the merged preview to retain the stored appearance as one layer.'; $('report-content').append(p);
  const ul = document.createElement('ul'); for (const note of notes) { const li = document.createElement('li'); li.textContent = note; ul.append(li); } $('report-content').append(ul);
  $('report-preview').disabled = !hasPreview; $('report-dialog').showModal();
  return new Promise(resolve => { const finish = value => { $('report-dialog').close(); resolve(value); }; $('report-cancel').onclick = () => finish('cancel'); $('report-preview').onclick = () => finish('preview'); $('report-accept').onclick = () => finish('edit'); $('report-dialog').oncancel = event => { event.preventDefault(); finish('cancel'); }; });
}
async function save(extension) {
  await run(async () => {
    if (extension === 'psd' && !confirm('Export a layered PSD copy?\n\nWindows filters and transforms are baked into each pixel layer. Masks, groups, visibility, opacity and supported blend modes remain editable. Save a .cwin project as well to retain the filter stack.')) return;
    let bytes;
    if (extension === 'psd') bytes = exportPsd(doc);
    else if (extension === 'cwin') bytes = serializeProject(doc);
    else { let c = composite(doc); if (extension === 'jpg') { const white = canvas(doc.width, doc.height), ctx = white.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, doc.width, doc.height); ctx.drawImage(c, 0, 0); c = white; } const blob = await new Promise(resolve => c.toBlob(resolve, extension === 'jpg' ? 'image/jpeg' : 'image/png', .94)); bytes = new Uint8Array(await blob.arrayBuffer()); }
    const saved = await window.desktop.save({ name: doc.name.replace(/[<>:"/\\|?*]/g, '_') + (extension === 'psd' ? '-windows' : '') + '.' + extension, extension, bytes });
    if (saved) { if (extension === 'cwin') { dirty = false; window.desktop.dirty(false); render(); } toast(`Saved ${saved}`); }
  });
}

const filterDefinitions = {
  exposure: { title: 'Exposure & contrast', fields: [['exposure', 'Exposure / EV', -5, 5, .05, 0], ['contrast', 'Contrast', -100, 100, 1, 0]] },
  levels: { title: 'Levels', fields: [['black', 'Black point', 0, 254, 1, 0], ['gamma', 'Midtone gamma', .1, 5, .01, 1], ['white', 'White point', 1, 255, 1, 255]] },
  curves: { title: 'RGB tone curve', fields: [['shadows', 'Shadows / 64', 0, 255, 1, 64], ['midtones', 'Midtones / 128', 0, 255, 1, 128], ['highlights', 'Highlights / 192', 0, 255, 1, 192]] },
  hsl: { title: 'Hue / Saturation', fields: [['hue', 'Hue rotation', -180, 180, 1, 0], ['saturation', 'Saturation', -100, 100, 1, 0], ['lightness', 'Lightness', -100, 100, 1, 0]] },
  balance: { title: 'Color balance', fields: [['red', 'Cyan ↔ Red', -100, 100, 1, 0], ['green', 'Magenta ↔ Green', -100, 100, 1, 0], ['blue', 'Yellow ↔ Blue', -100, 100, 1, 0]] },
  blur: { title: 'Gaussian blur', fields: [['radius', 'Radius / px', 0, 50, .5, 5]] },
  sharpen: { title: 'Sharpen', fields: [['amount', 'Amount', 0, 200, 1, 40]] },
  bw: { title: 'Black & white', fields: [] }
};
function adjust(kind, index = -1) {
  const l = editable(); if (!l) return;
  if (l.filters.length >= 30 && index < 0) { toast('Maximum 30 filters per layer.'); return; }
  const definition = filterDefinitions[kind], filter = index >= 0 ? { ...l.filters[index] } : { kind, enabled: true };
  $('adjust-title').textContent = definition.title; $('adjust-controls').replaceChildren();
  for (const [key, title, min, max, step, initial] of definition.fields) {
    filter[key] ??= initial;
    const label = document.createElement('label'), text = document.createElement('span'), input = document.createElement('input'), output = document.createElement('output');
    text.textContent = title; Object.assign(input, { type: 'range', min, max, step, value: filter[key] }); input.setAttribute('aria-label', title); output.textContent = filter[key];
    input.oninput = () => { filter[key] = Number(input.value); output.textContent = input.value; update(); }; label.append(text, input, output); $('adjust-controls').append(label);
  }
  function update() {
    preview = { id: l.id, filter, index }; renderPixels();
    $('curve-preview').style.display = kind === 'curves' ? 'block' : 'none';
    if (kind === 'curves') {
      const ctx = $('curve-preview').getContext('2d'), lut = curveLut([[0, 0], [64, filter.shadows], [128, filter.midtones], [192, filter.highlights], [255, 255]]); ctx.clearRect(0, 0, 320, 130); ctx.strokeStyle = '#454b55'; ctx.beginPath(); ctx.moveTo(0, 130); ctx.lineTo(320, 0); ctx.stroke(); ctx.strokeStyle = '#d4ec98'; ctx.beginPath(); for (let i = 0; i < 256; i++) ctx.lineTo(i / 255 * 320, 130 - lut[i] / 255 * 130); ctx.stroke();
    }
  }
  $('adjust-dialog').returnValue = 'cancel'; $('adjust-dialog').showModal(); update();
  $('adjust-dialog').onclose = () => { preview = null; if ($('adjust-dialog').returnValue === 'apply') { if (kind === 'levels' && filter.black >= filter.white) { toast('Black point must be below white point.'); render(); return; } edit(() => { if (index < 0) l.filters.push(filter); else l.filters[index] = filter; }); } else render(); };
}
function updateTool() {
  document.querySelectorAll('[data-tool]').forEach(button => button.classList.toggle('active', button.dataset.tool === tool));
  $('tool-name').textContent = ({ move: 'Move', brush: 'Brush', erase: 'Eraser', clone: 'Clone', select: 'Selection', picker: 'Eyedropper' })[tool];
  $('tool-hint').textContent = tool === 'clone' ? 'Alt-click to set source. Paint to clone pixels.' : target === 'mask' ? 'Mask: black hides, white reveals. Eraser reveals.' : 'B brush · E eraser · S clone · M select · V move';
  drawOverlay();
}
function point(event) { const rect = $('overlay').getBoundingClientRect(); return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom }; }
function clipSelection(ctx, l) { if (!selection) return; ctx.beginPath(); const points = [[selection.x, selection.y], [selection.x + selection.w, selection.y], [selection.x + selection.w, selection.y + selection.h], [selection.x, selection.y + selection.h]]; points.forEach(([x, y], i) => { const p = localPoint(l, { x, y }); if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }); ctx.closePath(); ctx.clip(); }
function paint(l, start, end) {
  const surface = target === 'mask' ? l.mask : l.image; if (!surface) return;
  const ctx = surface.getContext('2d'), size = Math.max(1, Math.min(500, Number($('brush-size').value) || 1)) / l.scale;
  ctx.save(); clipSelection(ctx, l); ctx.globalAlpha = Number($('brush-flow').value) / 100;
  if (tool === 'clone') {
    const dx = cloneSource.x - drag.origin.x, dy = cloneSource.y - drag.origin.y;
    ctx.beginPath(); ctx.arc(end.x, end.y, size / 2, 0, 2 * Math.PI); ctx.clip(); ctx.drawImage(drag.source, -dx, -dy);
  } else {
    ctx.globalCompositeOperation = tool === 'erase' && target !== 'mask' ? 'destination-out' : 'source-over';
    let color = $('color').value;
    if (target === 'mask') { const rgb = color.slice(1).match(/../g).map(x => parseInt(x, 16)); const gray = tool === 'erase' ? 255 : Math.round(.2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]); color = `rgb(${gray},${gray},${gray})`; }
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke(); if (start.x === end.x && start.y === end.y) { ctx.beginPath(); ctx.arc(end.x, end.y, size / 2, 0, 2 * Math.PI); ctx.fill(); }
  }
  ctx.restore(); invalidate(l);
}
$('overlay').onpointerdown = event => {
  if (busy || event.button !== 0) return;
  const p = point(event), l = selected();
  if (tool === 'picker') { const x = Math.max(0, Math.min(doc.width - 1, Math.floor(p.x))), y = Math.max(0, Math.min(doc.height - 1, Math.floor(p.y))); const rgb = $('canvas').getContext('2d').getImageData(x, y, 1, 1).data; $('color').value = '#' + [...rgb].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join(''); return; }
  if (tool === 'select') { drag = { start: p }; selection = { x: p.x, y: p.y, w: 0, h: 0 }; }
  else {
    if (!l?.image) { toast('Select a pixel layer for this tool.'); return; }
    const local = localPoint(l, p);
    if (tool === 'clone' && event.altKey) { cloneSource = { ...local, id: l.id }; toast('Clone source set.'); return; }
    if (tool === 'clone' && (!cloneSource || cloneSource.id !== l.id || target === 'mask')) { toast('Select pixels and Alt-click this layer to set the clone source.'); return; }
    if (target === 'mask' && !l.mask) return;
    checkpoint(); drag = { start: p, x: l.x, y: l.y, last: local, origin: local, source: tool === 'clone' ? copy(l.image) : null };
    if (tool !== 'move') paint(l, local, local);
  }
  if (event.isTrusted) $('overlay').setPointerCapture(event.pointerId); renderPixels();
};
$('overlay').onpointermove = event => {
  if (!drag) return; const p = point(event), l = selected();
  if (tool === 'select') selection = { x: Math.max(0, Math.min(drag.start.x, p.x)), y: Math.max(0, Math.min(drag.start.y, p.y)), w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) };
  else if (tool === 'move') { l.x = Math.round(drag.x + p.x - drag.start.x); l.y = Math.round(drag.y + p.y - drag.start.y); }
  else { const local = localPoint(l, p); const distance = Math.hypot(local.x - drag.last.x, local.y - drag.last.y), steps = tool === 'clone' ? Math.ceil(distance / Math.max(1, Number($('brush-size').value) / l.scale / 5)) : 1; for (let i = 1; i <= Math.max(1, steps); i++) { const next = { x: drag.last.x + (local.x - drag.last.x) * i / Math.max(1, steps), y: drag.last.y + (local.y - drag.last.y) * i / Math.max(1, steps) }; paint(l, drag.last, next); } drag.last = local; }
  renderPixels();
};
function endDrag() { if (!drag) return; drag = null; render(); }
$('overlay').onpointerup = endDrag; $('overlay').onpointercancel = endDrag;

for (const [id, fn] of Object.entries({ open: () => readFile(), 'welcome-open': () => readFile(), import: () => readFile(true), save: () => save('cwin'), 'export-psd': () => save('psd'), 'export-png': () => save('png'), 'export-jpg': () => save('jpg'), demo: () => { if (discard()) adopt(demoDocument(), true); }, help: () => $('help-dialog').showModal(), fit, actual: () => { zoom = 1; sizeView(); drawOverlay(); }, 'zoom-in': () => { zoom = Math.min(8, zoom * 1.25); sizeView(); drawOverlay(); }, 'zoom-out': () => { zoom = Math.max(.03, zoom / 1.25); sizeView(); drawOverlay(); }, deselect: () => { selection = null; drawOverlay(); }, undo: () => { if (history.past.length) { doc = history.undo(doc); active = findLayer(doc, active)?.id || doc.layers[0]?.id; target = 'image'; markDirty(); render(); } }, redo: () => { if (history.future.length) { doc = history.redo(doc); active = findLayer(doc, active)?.id || doc.layers[0]?.id; markDirty(); render(); } }, 'add-layer': () => edit(() => { const l = layer('Layer ' + (doc.layers.length + 1), canvas(doc.width, doc.height)); doc.layers.unshift(l); active = l.id; target = 'image'; }), duplicate: () => { const l = selected(); if (l) edit(() => { const duplicated = cloneLayer(l); walk([duplicated], n => n.id = crypto.randomUUID()); duplicated.name += ' copy'; const list = siblings(doc, l.id); list.splice(list.indexOf(l), 0, duplicated); active = duplicated.id; }); }, 'delete-layer': () => { const l = selected(); if (l) edit(() => { const list = siblings(doc, l.id); list.splice(list.indexOf(l), 1); active = doc.layers[0]?.id; }); }, 'add-mask': () => { const l = editable(); if (l) { if (l.mask) { target = 'mask'; tool = 'brush'; render(); } else edit(() => { l.mask = canvas(l.image.width, l.image.height); const ctx = l.mask.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, l.mask.width, l.mask.height); target = 'mask'; tool = 'brush'; }); $('color').value = '#000000'; updateTool(); } }, flip: () => { const l = editable(); if (l) edit(() => l.flip = !l.flip); }, 'reset-transform': () => { const l = editable(); if (l) edit(() => { l.scale = 1; l.rotation = 0; l.flip = false; }); }, fill: () => { const l = editable(); if (l) edit(() => { const surface = target === 'mask' ? l.mask : l.image, ctx = surface.getContext('2d'); ctx.save(); clipSelection(ctx, l); ctx.fillStyle = target === 'mask' ? ($('color').value === '#ffffff' ? '#fff' : '#000') : $('color').value; ctx.fillRect(0, 0, surface.width, surface.height); ctx.restore(); invalidate(l); }); } })) $(id).onclick = fn;
$('new').onclick = () => { if (!discard()) return; $('new-dialog').returnValue = 'cancel'; $('new-dialog').showModal(); };
$('new-dialog').onclose = () => { if ($('new-dialog').returnValue === 'create') { try { adopt(newDocument(Number($('new-width').value), Number($('new-height').value)), true); } catch (error) { toast(error.message); } } };
for (const [id, direction] of [['layer-up', -1], ['layer-down', 1]]) $(id).onclick = () => { const l = selected(); if (!l) return; const list = siblings(doc, l.id), i = list.indexOf(l), j = i + direction; if (j >= 0 && j < list.length) edit(() => [list[i], list[j]] = [list[j], list[i]]); };
for (const [id, key, multiplier, min, max] of [['layer-x', 'x', 1, -100000, 100000], ['layer-y', 'y', 1, -100000, 100000], ['layer-scale', 'scale', .01, 1, 1000], ['layer-rotation', 'rotation', 1, -360, 360]]) $(id).onchange = () => { const l = editable(), value = Number($(id).value); if (l && Number.isFinite(value)) edit(() => l[key] = Math.max(min, Math.min(max, value)) * multiplier); };
$('layer-name').onchange = () => { const l = selected(); if (l) edit(() => l.name = $('layer-name').value.slice(0, 200) || 'Layer'); };
for (const blend of [...Object.keys(BLENDS), 'pass through']) { const option = document.createElement('option'); option.value = blend; option.textContent = blend[0].toUpperCase() + blend.slice(1); $('blend').append(option); }
$('blend').onchange = () => { const l = selected(); if (l) { const value = $('blend').value; if (value === 'pass through' && !l.children) { toast('Pass through is only available for groups.'); renderProperties(); return; } edit(() => l.blend = value); } };
$('opacity').oninput = () => $('opacity-label').textContent = $('opacity').value + '%'; $('opacity').onchange = () => { const l = selected(), value = Number($('opacity').value); if (l) edit(() => l.opacity = value / 100); };
document.querySelectorAll('[data-tool]').forEach(button => button.onclick = () => { tool = button.dataset.tool; updateTool(); });
document.querySelectorAll('[data-adjust]').forEach(button => button.onclick = () => adjust(button.dataset.adjust));
document.addEventListener('keydown', event => {
  if (document.querySelector('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (event.ctrlKey || event.metaKey) { const action = { o: 'open', s: event.shiftKey ? 'export-psd' : 'save', z: event.shiftKey ? 'redo' : 'undo', y: 'redo', j: 'duplicate', d: 'deselect', '0': 'fit' }[key]; if (action) { event.preventDefault(); $(action).click(); } }
  else if ({ v: 'move', b: 'brush', e: 'erase', s: 'clone', m: 'select', i: 'picker' }[key]) { tool = { v: 'move', b: 'brush', e: 'erase', s: 'clone', m: 'select', i: 'picker' }[key]; updateTool(); }
});
window.addEventListener('resize', () => { if (!welcome) { fit(); drawOverlay(); } });
render();
if (new URLSearchParams(location.search).get('demo') === '1') adopt(demoDocument());

// Exercised in the real Electron renderer; no DOM/canvas mocks.
window.runSelfTest = async (externalFixtures = []) => {
  const results = [], conversionReports = [], test = async (name, fn) => { try { await fn(); results.push({ name, passed: true }); } catch (error) { results.push({ name, passed: false, error: error.stack }); } };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const solid = (w, h, color) => { const c = canvas(w, h), ctx = c.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, w, h); return c; };
  const pixel = (c, x = 0, y = 0) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
  const equalPixels = (a, b, tolerance = 1) => { const x = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, y = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; assert(x.length === y.length, 'Pixel count changed'); let max = 0; for (let i = 0; i < x.length; i++) max = Math.max(max, Math.abs(x[i] - y[i])); assert(max <= tolerance, `Pixel difference ${max} > ${tolerance}`); };
  const fixture = { width: 32, height: 24, name: 'Round trip fixture', layers: [layer('Masked color', solid(12, 10, '#e06030'), { x: 4, y: 3, opacity: .8, mask: solid(12, 10, '#808080'), blend: 'multiply' }), layer('Folder', null, { children: [layer('Hidden', solid(4, 4, '#ff00ff'), { visible: false }), layer('Background', solid(32, 24, '#6090c0'))], blend: 'pass through' })] };
  await test('PSD binary round trip: groups, offsets, visibility, blend and mask', () => { const bytes = exportPsd(fixture), result = importPsd(bytes, 'fixture.psd'); assert(result.notes.length === 0, result.notes.join('\n')); assert(result.doc.layers.length === 2, 'Top-level count'); assert(result.doc.layers[1].children.length === 2, 'Group children'); assert(!result.doc.layers[1].children[0].visible, 'Hidden state'); assert(result.doc.layers[0].x === 4 && result.doc.layers[0].y === 3, 'Position'); assert(result.doc.layers[0].blend === 'multiply', 'Blend'); equalPixels(composite(fixture), composite(result.doc), 2); });
  await test('PSD rejects CMYK / 16 bit / PSB before decoding', () => { const bytes = exportPsd(fixture); for (const [offset, value] of [[4, 2], [22, 16], [24, 4]]) { const c = bytes.slice(), view = new DataView(c.buffer); view.setUint16(offset, value); let rejected = false; try { checkPsd(c); } catch { rejected = true; } assert(rejected, `Accepted ${offset}:${value}`); } });
  await test('PSD unsupported clipping has explicit conversion report', () => { const bytes = new Uint8Array(writePsd({ width: 8, height: 8, canvas: solid(8, 8, '#fff'), children: [{ name: 'Clipped', clipping: true, canvas: solid(8, 8, '#f00') }] })); const result = importPsd(bytes, 'clipping.psd'); assert(result.notes.some(n => n.includes('Clipping')), 'No clipping warning'); assert(result.preview, 'Missing merged fallback'); });
  await test('PSD disabled mask and transformed layer round trip', () => { const l = layer('Rotated', solid(10, 6, '#aaee88'), { x: 7, y: 9, rotation: 90, mask: solid(10, 6, '#000'), maskEnabled: false }); const d = { width: 32, height: 32, name: 'Rotate', layers: [l] }; const result = importPsd(exportPsd(d), 'rotate.psd'); assert(!result.doc.layers[0].maskEnabled, 'Mask enabled unexpectedly'); equalPixels(composite(d), composite(result.doc), 2); });
  await test('PSD Levels adjustment and mask retain parameters across PSD and project saves', async () => { const rgb = { shadowInput: 12, highlightInput: 235, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1.25 }; const d = { width: 8, height: 8, name: 'Levels', layers: [layer('Levels', null, { adjustment: { type: 'levels', rgb }, mask: solid(8, 8, '#808080'), opacity: .7 }), layer('Base', solid(8, 8, '#7090a0'))] }; const imported = importPsd(exportPsd(d), 'levels.psd'); assert(imported.doc.layers[0].adjustment.rgb.shadowInput === 12, 'Adjustment lost'); equalPixels(composite(d), composite(imported.doc), 2); const project = await parseProject(serializeProject(d)); assert(project.layers[0].adjustment.rgb.midtoneInput === 1.25, 'Project adjustment lost'); });
  for (const fixture of externalFixtures) await test(`External PSD: ${fixture.name}`, () => { const imported = importPsd(Uint8Array.from(fixture.bytes), fixture.name); assert(imported.doc.layers.length > 0, 'No layers'); if (fixture.name.includes('text')) assert(imported.notes.some(n => n.includes('Text')), 'Text conversion not reported'); const reopened = importPsd(exportPsd(imported.doc), 'roundtrip.psd'); equalPixels(composite(imported.doc), composite(reopened.doc), 3); conversionReports.push({ name: fixture.name, notes: imported.notes }); });
  await test('Project round trip retains editable filters, mask and groups', async () => { const d = { ...fixture, layers: fixture.layers.map(cloneLayer) }; d.layers[0].filters.push({ kind: 'exposure', exposure: .5, contrast: 8 }); const reopened = await parseProject(serializeProject(d)); assert(reopened.layers[0].filters[0].exposure === .5, 'Filter dropped'); equalPixels(composite(d), composite(reopened)); });
  await test('Project rejects unsupported version and invalid transform', async () => { for (const mutation of [p => p.version = 99, p => p.layers[0].scale = -1]) { const p = JSON.parse(new TextDecoder().decode(serializeProject(fixture))); mutation(p); let rejected = false; try { await parseProject(new TextEncoder().encode(JSON.stringify(p))); } catch { rejected = true; } assert(rejected, 'Malformed project accepted'); } });
  await test('Exposure, levels, curves, grayscale, sharpen and alpha invariance', () => { const c = solid(4, 4, 'rgba(80,120,160,0.5)'); const a = pixel(c); const e = pixel(applyFilter(c, { kind: 'exposure', exposure: 1, contrast: 0 })); assert(e[0] > a[0] * 1.8 && e[3] === a[3], 'Exposure/alpha incorrect'); const bw = pixel(applyFilter(c, { kind: 'bw' })); assert(Math.abs(bw[0] - bw[2]) <= 1, 'Not grayscale'); equalPixels(c, applyFilter(c, { kind: 'levels', black: 0, white: 255, gamma: 1 })); equalPixels(c, applyFilter(c, { kind: 'curves', shadows: 64, midtones: 128, highlights: 192 })); equalPixels(c, applyFilter(c, { kind: 'sharpen', amount: 0 })); });
  await test('Undo / redo restores image pixels and layer properties', () => { const h = new History(), d = newDocument(4, 4); h.push(d); d.layers[0].image.getContext('2d').fillRect(0, 0, 4, 4); d.layers[0].name = 'Changed'; const previous = h.undo(d); assert(pixel(previous.layers[0].image)[3] === 0, 'Undo pixels'); assert(previous.layers[0].name === 'Layer 1', 'Undo metadata'); assert(h.redo(previous).layers[0].name === 'Changed', 'Redo'); });
  await test('UI brush, selection fill, mask, undo and layer duplication', () => { adopt(newDocument(80, 60)); tool = 'brush'; $('color').value = '#ff0000'; $('brush-size').value = '10'; const rect = $('overlay').getBoundingClientRect(), x = rect.left + 20 * zoom, y = rect.top + 20 * zoom; $('overlay').dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, pointerId: 1 })); endDrag(); assert(pixel(selected().image, 20, 20)[0] === 255, 'Brush did not paint'); selection = { x: 0, y: 0, w: 5, h: 5 }; $('fill').click(); assert(pixel(selected().image, 0, 0)[3] === 255, 'Fill'); $('add-mask').click(); assert(selected().mask, 'Mask missing'); $('duplicate').click(); assert(doc.layers.length === 2, 'Duplicate'); $('undo').click(); assert(doc.layers.length === 1, 'UI undo'); });
  await test('Adjustment dialog preview cancels without mutation', () => { adopt(newDocument(20, 20)); adjust('exposure'); const input = $('adjust-controls').querySelector('input'); input.value = '2'; input.dispatchEvent(new Event('input')); assert(selected().filters.length === 0, 'Preview mutated filters'); $('adjust-dialog').close('cancel'); preview = null; });
  // Wait for dialog close events before rendering the review screenshot.
  await new Promise(resolve => setTimeout(resolve, 50));
  adopt(demoDocument(), true); active = doc.layers[1].id; tool = 'move'; selected().filters.push({ kind: 'exposure', exposure: .15, contrast: 6 }); render();
  return { timestamp: new Date().toISOString(), environment: navigator.userAgent, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results, conversionReports };
};
window.desktopIOTest = async () => {
  const bytes = exportPsd(demoDocument());
  const saved = await window.desktop.save({ name: 'io-test.psd', extension: 'psd', bytes });
  if (!saved) throw new Error('Save canceled unexpectedly');
  const opened = await window.desktop.open();
  const imported = importPsd(opened.bytes, opened.name);
  if (imported.doc.layers.length !== 3 || imported.doc.width !== 1440) throw new Error('Desktop file pipeline changed document');
  let protectedSource = false;
  try { await window.desktop.save({ name: 'io-test.psd', extension: 'psd', bytes }); } catch (error) { protectedSource = error.message.includes('separate copy'); }
  if (!protectedSource) throw new Error('Source overwrite protection failed');
  return { name: 'Desktop IPC file save / reopen / source overwrite protection', passed: true };
};
