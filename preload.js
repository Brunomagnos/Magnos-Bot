// ./preload.js
const { contextBridge, ipcRenderer } = require('electron');

// Canais válidos que o Main pode enviar para o Renderer
const validReceiveChannels = [
    'update-status',
    'display-qr',
    'clear-qr',
    'log-message',
    'config-loaded' // Canal para enviar config carregada para UI
];

// Canais válidos que o Renderer pode enviar para o Main
const validSendChannels = [
    'start-bot',
    'check-for-update-request', // Verificar atualizações manualmente
    'save-config',              // Salvar nova configuração
    'load-config-request'       // Pedir configuração atual
];

contextBridge.exposeInMainWorld('electronAPI', {
    send: (channel, data) => {
        if (validSendChannels.includes(channel)) {
            ipcRenderer.send(channel, data);
        } else {
             console.warn(`Preload: Tentativa de envio em canal inválido: ${channel}`);
        }
    },
    on: (channel, func) => {
        if (validReceiveChannels.includes(channel)) {
            // Wrapper para garantir que o listener certo seja removido se for re-registrado
            const subscription = (event, ...args) => func(...args);
            ipcRenderer.on(channel, subscription);
            // Retorna uma função para remover este listener específico
            return () => {
                ipcRenderer.removeListener(channel, subscription);
            };
        } else {
             console.warn(`Preload: Tentativa de escuta em canal inválido: ${channel}`);
             return () => {}; // Retorna função vazia para evitar erros
        }
    },
    // Adicione removeListener ou similar se precisar de controle mais fino sobre listeners
     removeAllListeners: (channel) => {
         if (validReceiveChannels.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
         } else {
             console.warn(`Preload: Tentativa de remover listeners de canal inválido: ${channel}`);
        }
     }
});

console.log("Preload script executado e API exposta.");