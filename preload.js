// ./preload.js (UNIFICADO E MAIS SEGURO)

const { contextBridge, ipcRenderer } = require('electron');

// É seguro usar console.log aqui para debug durante o desenvolvimento.
console.log('[Preload] INICIADO.');

// Canais permitidos: Renderer -> Main
const allowedSendChannels = [
    'login-attempt',
    'start-bot',
    'stop-bot',
    'toggle-pause-bot',
    'clear-session-request',
    'load-rules-request',
    'save-rule',
    'delete-rule',
    'check-for-update-request',
    'get-initial-state',
    'open-external-link', // Exemplo: Para abrir links em navegador externo
    'renderer-log', // Canal para enviar logs do renderer para o main
    'quit-and-install-update',
    'preload-error', // Para notificar main sobre erros críticos aqui
    // Adicione outros canais que o Renderer PRECISA ENVIAR para o Main
];

// Canais permitidos: Main -> Renderer
const allowedReceiveChannels = [
    'login-failed',
    'update-status', // Status geral (disconnected, scanning, connected, error, paused...)
    'display-qr',
    'clear-qr', // Para limpar QR após conectar
    'log-message', // Mensagens de log do Main para exibir na UI
    'rules-loaded',
    'rule-save-status',
    'rule-delete-status',
    'pause-state-changed', // Informa a UI se o bot foi pausado/continuado
    // -- Canais de Update --
    'update-available',
    'update-not-available',
    'update-downloaded',
    'update-download-progress',
    'update-error',
    // Adicione outros canais que o Renderer PRECISA OUVIR do Main
];

try {
    contextBridge.exposeInMainWorld('electronAPI', {
        /**
         * Envia dados do Renderer para o Main de forma segura.
         * @param {string} channel - O nome do canal IPC (deve estar em allowedSendChannels).
         * @param {*} data - Os dados a serem enviados.
         */
        send: (channel, data) => {
            if (allowedSendChannels.includes(channel)) {
                ipcRenderer.send(channel, data);
            } else {
                console.warn(`[Preload WARN] Tentativa bloqueada de enviar pelo canal "${channel}". Canal não permitido.`);
            }
        },

        /**
         * Registra um listener para receber dados do Main no Renderer de forma segura.
         * @param {string} channel - O nome do canal IPC (deve estar em allowedReceiveChannels).
         * @param {function} listener - A função callback a ser executada quando dados chegarem. (event, ...args) => listener(...args)
         * @returns {function} - Uma função para remover o listener.
         */
        on: (channel, listener) => {
            if (allowedReceiveChannels.includes(channel)) {
                // Wrapper para segurança e consistência, removendo o objeto 'event'
                const safeListener = (event, ...args) => listener(...args);
                ipcRenderer.on(channel, safeListener);
                // Retorna uma função para desregistrar o listener específico
                return () => {
                    ipcRenderer.removeListener(channel, safeListener);
                };
            } else {
                console.warn(`[Preload WARN] Tentativa bloqueada de ouvir o canal "${channel}". Canal não permitido.`);
                return () => {}; // Retorna função no-op se não permitido
            }
        },

        /**
         * Remove todos os listeners para um canal específico.
         * Útil ao desmontar componentes ou trocar de view.
         * @param {string} channel - O nome do canal IPC.
         */
        removeAllListeners: (channel) => {
             if (allowedReceiveChannels.includes(channel)) {
                ipcRenderer.removeAllListeners(channel);
             } else {
                 console.warn(`[Preload WARN] Tentativa bloqueada de remover listeners do canal "${channel}". Canal não permitido.`);
             }
        },

         // Função explícita para enviar logs do Renderer para o Main
        log: (level, message) => {
             if (allowedSendChannels.includes('renderer-log')) {
                 ipcRenderer.send('renderer-log', { level, message });
             } else {
                 console.warn(`[Preload Log Fallback - Canal 'renderer-log' não permitido] ${level}: ${message}`);
             }
        }
    });
    console.log('✅ [Preload] CONCLUÍDO: electronAPI exposta com sucesso.');

} catch (error) {
    console.error('❌❌❌ [Preload] ERRO CRÍTICO ao expor API:', error);
    try {
        // Tenta notificar o processo principal sobre o erro grave no preload
         if (allowedSendChannels.includes('preload-error')) {
             ipcRenderer.send('preload-error', `Erro ao expor API: ${error.message}`);
         } else {
             console.error("❌ [Preload] Não é possível enviar erro para o Main: canal 'preload-error' não permitido.");
         }
    } catch (sendError) {
        console.error('❌ [Preload] Falha crítica ao tentar enviar erro para o main:', sendError);
    }
}