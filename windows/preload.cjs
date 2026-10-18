const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  clipboardWrite: request => ipcRenderer.invoke('clipboard-write', request),
  clipboardRead: () => ipcRenderer.invoke('clipboard-read'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: value => ipcRenderer.invoke('update-settings', value),
  open: () => ipcRenderer.invoke('open-file'),
  save: request => ipcRenderer.invoke('save-file', request),
  dirty: value => ipcRenderer.send('dirty', value)
});
