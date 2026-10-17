const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: value => ipcRenderer.invoke('update-settings', value),
  open: () => ipcRenderer.invoke('open-file'),
  save: request => ipcRenderer.invoke('save-file', request),
  dirty: value => ipcRenderer.send('dirty', value)
});
