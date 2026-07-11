const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPorts: (params) => ipcRenderer.invoke('get-ports', params),
  killProcess: (pid) => ipcRenderer.invoke('kill-process', pid),
  getStats: () => ipcRenderer.invoke('get-stats'),
  refreshData: () => ipcRenderer.invoke('refresh-data'),
  onPortsUpdated: (callback) => {
    ipcRenderer.on('ports-updated', callback);
    return () => ipcRenderer.removeListener('ports-updated', callback);
  }
});
