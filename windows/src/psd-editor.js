import { validateAdjustment } from './formats.js';
import { t, message } from './i18n.js';
const $ = id => document.getElementById(id);
const identity = () => ({ shadowInput: 0, highlightInput: 255, shadowOutput: 0, highlightOutput: 255, midtoneInput: 1 });
export function defaultAdjustment(type) {
  if (type === 'levels') return { type, rgb: identity() };
  if (type === 'curves') return { type, rgb: [{ input: 0, output: 0 }, { input: 255, output: 255 }] };
  if (type === 'exposure') return { type, exposure: 0, offset: 0, gamma: 1 };
  return { type: 'invert' };
}
// Work on a deep copy. Cancel never mutates an imported descriptor or its other channels.
export function editAdjustment(original, commit, preview) {
  let draft = structuredClone(original), channel = 'rgb', collect = () => {};
  const error = text => $('psd-error').textContent = text;
  const validate = () => { try { collect(); validateAdjustment(draft); error(''); preview(structuredClone(draft)); return true; } catch (e) { error(message(e.message)); return false; } };
  function controls() {
    const root = $('psd-controls'); root.replaceChildren();
    const fields = [];
    if (['levels', 'curves'].includes(draft.type)) {
      const label = document.createElement('label'), select = document.createElement('select'); label.textContent = t('Channel');
      for (const [value, name] of [['rgb', 'RGB'], ['red', 'Red'], ['green', 'Green'], ['blue', 'Blue']]) { const option = new Option(t(name), value); select.add(option); }
      select.value = channel; select.onchange = () => { if (!validate()) { select.value = channel; return; } channel = select.value; controls(); }; label.append(select); root.append(label);
    }
    function number(key, title, min, max, step, initial) {
      const label = document.createElement('label'), input = document.createElement('input'); label.textContent = t(title);
      Object.assign(input, { type: 'number', min, max, step, value: initial }); input.dataset.parameter = key; input.oninput = validate; label.append(input); root.append(label); fields.push([key, input]);
    }
    if (draft.type === 'levels') {
      const values = draft[channel] || identity();
      for (const [key, title] of [['shadowInput', 'Input black'], ['highlightInput', 'Input white'], ['shadowOutput', 'Output black'], ['highlightOutput', 'Output white']]) number(key, title, 0, 255, 1, values[key]);
      number('midtoneInput', 'Gamma', .01, 10, .01, values.midtoneInput);
      collect = () => { const values = Object.fromEntries(fields.map(([key, input]) => [key, input.value === '' ? NaN : Number(input.value)])); draft[channel] = values; };
    } else if (draft.type === 'exposure') {
      number('exposure', 'Exposure / EV', -20, 20, .05, draft.exposure ?? 0); number('offset', 'Offset', -1, 1, .01, draft.offset ?? 0); number('gamma', 'Gamma', .01, 10, .01, draft.gamma ?? 1);
      collect = () => { for (const [key, input] of fields) draft[key] = input.value === '' ? NaN : Number(input.value); };
    } else if (draft.type === 'curves') {
      const label = document.createElement('label'), input = document.createElement('textarea'); label.textContent = t('Curve points (input,output; …)');
      input.value = (draft[channel] || defaultAdjustment('curves').rgb).map(p => `${p.input},${p.output}`).join('; '); input.rows = 4; input.oninput = validate; label.append(input); root.append(label);
      collect = () => { draft[channel] = input.value.split(';').map(pair => { const parts = pair.trim().split(','); return { input: parts.length === 2 && parts[0].trim() ? Number(parts[0]) : NaN, output: parts.length === 2 && parts[1].trim() ? Number(parts[1]) : NaN }; }); };
    } else { const p = document.createElement('p'); p.textContent = t('Invert has no parameters. Use opacity and masks to control its strength.'); root.append(p); collect = () => {}; }
  }
  controls(); error(''); $('psd-dialog').returnValue = 'cancel'; $('psd-dialog').showModal();
  $('psd-apply').onclick = event => { event.preventDefault(); if (validate()) { commit(structuredClone(draft)); $('psd-dialog').close('apply'); } };
  $('psd-dialog').onclose = () => preview(null);
}
