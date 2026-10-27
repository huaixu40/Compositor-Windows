const fs = require('node:fs/promises');
const path = require('node:path');
function createSettingsStore(file, defaultLanguage) {
  let current = { language: defaultLanguage === 'zh-CN' ? 'zh-CN' : 'en', renderer:'auto' };
  return {
    async load() {
      try { const saved = JSON.parse(await fs.readFile(file, 'utf8')); if (['en', 'zh-CN'].includes(saved.language)) current = { language: saved.language,renderer:['auto','cpu'].includes(saved.renderer)?saved.renderer:'auto' }; }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) console.warn('Unable to read settings:', error.code); }
      return { ...current };
    },
    get() { return { ...current }; },
    async save(value) {
      if (!value || !['en', 'zh-CN'].includes(value.language)) throw new Error('Unsupported language');
      if(value.renderer!==undefined&&!['auto','cpu'].includes(value.renderer))throw new Error('Unsupported renderer');
      const next = { language: value.language,renderer:value.renderer??current.renderer }, temp = file + '.tmp';
      await fs.mkdir(path.dirname(file), { recursive: true });
      try { await fs.writeFile(temp, JSON.stringify(next, null, 2), 'utf8'); await fs.rename(temp, file); }
      catch (error) { await fs.rm(temp, { force: true }).catch(() => {}); throw error; }
      current = next; return { ...current };
    }
  };
}
module.exports = { createSettingsStore };
