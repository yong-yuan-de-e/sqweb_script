'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('assistant', {
  command: (action, options) => ipcRenderer.invoke('assistant:command', action, options),
  onStatus: callback => ipcRenderer.on('assistant:status', (_event, status) => callback(status)),
});
