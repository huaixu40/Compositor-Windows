const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  open: () => ipcRenderer.invoke('open-file'),
  save: request => ipcRenderer.invoke('save-file', request),
  dirty: value => ipcRenderer.send('dirty', value)
});
