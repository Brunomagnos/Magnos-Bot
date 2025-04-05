// ./preload.js (VERSÃO FINAL - Completa com Canais de Login)

const { contextBridge, ipcRenderer } = require('electron');

// --- Canais VÁLIDOS que o Renderer pode OUVIR (vindos do Main) ---
const validReceive = [
    // Status e Conexão
    'update-status',         // Atualiza o texto e a classe CSS do status geral (disconnected, initializing, scanning, connecting, connected, paused, error)
    'display-qr',            // Mostra o QR Code recebido como URL de dados
    'clear-qr',              // Sinaliza para limpar/esconder o QR Code (geralmente quando autenticado/pronto)

    // Logging e Regras
    'log-message',           // Recebe uma mensagem de log para exibir na UI (com nível opcional: info, warn, error, success, debug)
    'rules-loaded',          // Recebe a lista de regras carregadas do arquivo json

    // Atualizações
    'update-download-progress', // Progresso do download de atualização (-1 erro, 0-99 progresso, 100 concluído/sem att)

    // Controle do Bot
    'pause-state-changed',   // Informa se o bot foi pausado (true) ou continuado (false)

    // Feedback de Ações de Regras
    'rule-save-status',      // Resultado (sucesso/erro, mensagem, regras atualizadas) ao tentar salvar uma regra
    'rule-delete-status',    // Resultado (sucesso/erro, mensagem, regras atualizadas) ao tentar excluir uma regra

    // Feedback de Login (para a tela de login)
    'login-failed'           // Informa que a tentativa de login falhou (com mensagem de erro)
];

// --- Canais VÁLIDOS que o Renderer pode ENVIAR (para o Main) ---
const validSend = [
    // Controle do Bot
    'start-bot',             // Solicita iniciar a conexão com o WhatsApp (só funciona após login)
    'stop-bot',              // Solicita parar o bot e desconectar
    'toggle-pause-bot',      // Solicita alternar o estado de pausa do bot
    'clear-session-request', // Solicita limpar os dados da sessão salva (exige escanear QR de novo)
    'get-initial-state',     // Pede o estado atual do bot e regras ao carregar a UI principal (depois do login)

    // Gerenciamento de Regras
    'load-rules-request',    // Pede ao main para (re)carregar e enviar as regras atuais
    'save-rule',             // Envia uma nova regra ou uma regra editada para salvar ({ index, rule })
    'delete-rule',           // Solicita a exclusão de uma regra pelo índice (envia o index)

    // Atualizações
    'check-for-update-request', // Pede para verificar se há atualizações

    // Autenticação
    'login-attempt'          // Envia as credenciais ({ username, password }) para validação
];

// --- Expondo a API Segura ---
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Envia um comando/dados para o processo principal.
     * @param {string} channel - O canal de comunicação (deve estar em validSend).
     * @param {any} [data] - Os dados a serem enviados (opcional).
     */
    send: (channel, data) => {
        if (validSend.includes(channel)) {
            ipcRenderer.send(channel, data);
        } else {
            console.warn(`[Preload WARN] Bloqueado: Tentativa de envio pelo canal inválido "${channel}"`);
        }
    },

    /**
     * Registra uma função para ouvir eventos do processo principal.
     * @param {string} channel - O canal de comunicação (deve estar em validReceive).
     * @param {function} listener - A função callback (recebe ...args enviados pelo Main).
     * @returns {function} Uma função para remover o listener registrado.
     */
    on: (channel, listener) => {
        if (validReceive.includes(channel)) {
            const safeListener = (event, ...args) => listener(...args); // Evita expor o objeto 'event'
            ipcRenderer.on(channel, safeListener);
            return () => ipcRenderer.removeListener(channel, safeListener); // Permite cancelamento
        } else {
            console.warn(`[Preload WARN] Bloqueado: Tentativa de escuta no canal inválido "${channel}"`);
            return () => {}; // Retorna função vazia para evitar erros no Renderer
        }
    },

    /**
     * Remove todos os listeners para um canal específico (se necessário).
     * @param {string} channel - O canal (deve estar em validReceive).
     */
    removeAllListeners: (channel) => {
        if (validReceive.includes(channel)) {
            ipcRenderer.removeAllListeners(channel);
        } else {
            console.warn(`[Preload WARN] Bloqueado: Tentativa de remover listeners do canal inválido "${channel}"`);
        }
    }
});

console.log("[Preload] electronAPI exposta com sucesso (incluindo canais de login).");