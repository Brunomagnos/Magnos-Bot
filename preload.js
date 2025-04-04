const { contextBridge, ipcRenderer } = require('electron');

// Lista de canais seguros que o Main pode enviar para o Renderer
const validReceiveChannels = ['update-status', 'display-qr', 'clear-qr', 'log-message'];
// Lista de canais seguros que o Renderer pode enviar para o Main
const validSendChannels = ['start-bot']; // Adicione mais se criar outros comandos (ex: stop-bot)

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
            // Remove listener antigo para evitar duplicação se re-registrar
             // Cuidado: removeAllListeners pode ser muito agressivo se outros scripts usarem IPC.
             // Uma abordagem mais segura é manter uma referência ao listener e removê-lo especificamente.
             // Mas para este caso simples, vamos deixar assim por enquanto, assumindo que SÓ este script registra estes listeners.
             ipcRenderer.removeAllListeners(channel); // <-- Esteja ciente disso

             // Registra o novo listener
             ipcRenderer.on(channel, (event, ...args) => func(...args));
        } else {
             console.warn(`Preload: Tentativa de escuta em canal inválido: ${channel}`);
        }
    }
});

console.log("Preload script executado e API exposta.");