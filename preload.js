// ./preload.js
const { contextBridge, ipcRenderer } = require('electron');

const validReceiveChannels = [ 'update-status', 'display-qr', 'clear-qr', 'log-message', 'config-loaded', 'update-download-progress', 'pause-state-changed' ];
const validSendChannels = [ 'start-bot', 'check-for-update-request', 'save-config', 'load-config-request', 'toggle-pause-bot' ];

contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => {
        if (validSendChannels.includes(channel)) ipcRenderer.send(channel, data);
        else console.warn(`Preload: Envio inválido: ${channel}`);
    },
    on: (channel, func) => {
        if (validReceiveChannels.includes(channel)) {
            const subscription = (event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);
            return () => ipcRenderer.removeListener(channel, subscription);
        } else { console.warn(`Preload: Escuta inválida: ${channel}`); return () => {}; }
    },
    removeAllListeners: (channel) => { if (validReceiveChannels.includes(channel)) ipcRenderer.removeAllListeners(channel); else console.warn(`Preload: Remover listeners inválido: ${channel}`); }
});
console.log("Preload script carregado.");