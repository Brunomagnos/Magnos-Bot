// ./renderer.js

// Referências a TODOS os elementos
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status');
const logsElement = document.getElementById('logs');
const checkUpdateButton = document.getElementById('checkUpdateButton');
const configTextArea = document.getElementById('configTextArea');
const saveConfigButton = document.getElementById('saveConfigButton');
const pauseButton = document.getElementById('pauseButton');
// Painel QR/Conectado
const connectionDisplayArea = document.getElementById('connection-display-area');
const qrCodeContainer = document.getElementById('qr-code-container');
const qrCodeImage = document.getElementById('qr-code-image');
const qrPlaceholder = document.getElementById('qr-placeholder');
const connectedInfoPanel = document.getElementById('connected-info-panel');
// Progresso Update
const updateProgressContainer = document.getElementById('updateProgressContainer');
const updateProgressBar = document.getElementById('updateProgressBar');
const updateProgressLabel = document.getElementById('updateProgressLabel');

// Estados
let isBotStartingOrRunning = false;
let isBotConnected = false;
let isBotPaused = false; // Assumir que começa não pausado

// Funções Auxiliares
function updateStartButtonState(isStarting) {
    isBotStartingOrRunning = isStarting;
    startButton.disabled = isStarting;
    startButton.textContent = isStarting ? 'Iniciando/Conectando...' : 'Iniciar Bot';
}
function addLog(logMessage) {
    // Remove timestamp duplicado se já vier formatado do main
    const cleanedMessage = logMessage.startsWith('[') && logMessage.includes(']') ? logMessage.substring(logMessage.indexOf(']') + 2) : logMessage;

    console.log("Renderer Log:", cleanedMessage);
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${cleanedMessage}`; // Adiciona timestamp aqui
    logsElement.appendChild(logEntry);
    logsElement.scrollTop = logsElement.scrollHeight;
}
function showQrPanel() {
    qrCodeContainer.style.display = 'flex'; // Usa flexbox para centralizar
    qrCodeImage.style.display = 'none';
    qrPlaceholder.textContent = 'Gerando QR Code...';
    qrPlaceholder.style.display = 'inline';
    connectedInfoPanel.style.display = 'none';
    connectionDisplayArea.style.borderColor = '#f0ad4e'; // Borda amarela
    pauseButton.style.display = 'none'; // Esconde botão pausa
    isBotConnected = false;
}
function showConnectedPanel() {
    qrCodeContainer.style.display = 'none';
    connectedInfoPanel.style.display = 'flex'; // Usa flexbox
    connectionDisplayArea.style.borderColor = '#2ecc71'; // Borda verde
    pauseButton.style.display = 'inline-block'; // Mostra botão pausa
    isBotConnected = true;
    updatePauseButtonText(); // Atualiza texto do botão pausa
}
function showDisconnectedState() {
     qrCodeContainer.style.display = 'flex';
     qrCodeImage.style.display = 'none';
     qrPlaceholder.textContent = 'Desconectado ou Erro. Clique Iniciar.';
     qrPlaceholder.style.display = 'inline';
     connectedInfoPanel.style.display = 'none';
     connectionDisplayArea.style.borderColor = '#dee2e6'; // Borda padrão
     pauseButton.style.display = 'none';
     isBotConnected = false;
}
function updatePauseButtonText() {
    pauseButton.textContent = isBotPaused ? 'Continuar Bot (Pausado)' : 'Pausar Bot (Ativo)';
    if (isBotPaused) {
        pauseButton.classList.add('paused'); // Adiciona classe para estilo laranja
    } else {
        pauseButton.classList.remove('paused'); // Remove classe
    }
}

// --- Enviar Comandos para Main ---
startButton.addEventListener('click', () => {
    if (isBotStartingOrRunning) return;
    console.log("Renderer: Start"); updateStartButtonState(true);
    showQrPanel(); // Mostra área do QR e placeholder inicial
    statusElement.textContent = 'Inicializando...'; statusElement.className = 'status status-initializing';
    addLog("Solicitando inicialização do bot...");
    window.electronAPI.send('start-bot');
});
checkUpdateButton.addEventListener('click', () => {
    console.log("Renderer: Check Update"); addLog("Solicitando verificação de atualizações...");
    window.electronAPI.send('check-for-update-request');
    updateProgressLabel.textContent = 'Verificando...';
    updateProgressBar.value = 0;
    updateProgressContainer.style.display = 'block'; // Mostra barra (sem valor ainda)
});
saveConfigButton.addEventListener('click', () => {
    const configString = configTextArea.value; console.log("Renderer: Save Config");
    addLog("Tentando salvar configuração...");
     try {
        const configObj = JSON.parse(configString); // Valida se é JSON
        window.electronAPI.send('save-config', configObj); // Envia objeto parsed
        saveConfigButton.textContent = 'Salvando...'; saveConfigButton.disabled = true;
        setTimeout(() => { saveConfigButton.textContent = 'Salvar Configuração'; saveConfigButton.disabled = false; }, 1500);
    } catch (e) {
        addLog(`ERRO: Configuração inválida. JSON? Detalhes: ${e.message}`);
        alert(`Erro na configuração JSON!\n${e.message}`);
     }
});
pauseButton.addEventListener('click', () => {
    console.log("Renderer: Toggle Pause");
    addLog(isBotPaused ? "Solicitando continuar o bot..." : "Solicitando pausar o bot...");
    window.electronAPI.send('toggle-pause-bot');
});

// --- Receber Atualizações do Main ---
window.electronAPI.on('log-message', addLog);

window.electronAPI.on('update-status', (message) => {
    console.log("Renderer: Status -", message); statusElement.textContent = message;
    const msgLower = message.toLowerCase();
    let statusClass = 'status-default'; // Começa com padrão
    if (msgLower.includes('conectado')) { statusClass = 'status-connected'; updateStartButtonState(false); showConnectedPanel();}
    else if (msgLower.includes('autenticado')) statusClass = 'status-authenticated';
    else if (msgLower.includes('inicializando') || msgLower.includes('carregando whatsapp')) { statusClass = 'status-initializing'; updateStartButtonState(true);}
    else if (msgLower.includes('gerando qr') || msgLower.includes('qr code pronto')) statusClass = 'status-generating-qr';
    else if (msgLower.includes('escanear') || msgLower.includes('qr code pronto')) { statusClass = 'status-scanning'; showQrPanel(); updateStartButtonState(true); }
    else if (msgLower.includes('desconectado') || msgLower.includes('erro') || msgLower.includes('falha') || msgLower.includes('permission')) { statusClass = 'status-error'; updateStartButtonState(false); showDisconnectedState(); }
    else if (msgLower.includes('pausado')) { statusClass = 'status-paused'; } // Status visual para pausado
    else if (msgLower.includes('versão mais recente') || msgLower.includes('aplicativo atualizado')) { statusClass = isBotConnected ? 'status-connected' : 'status-default'; updateProgressContainer.style.display = 'none'; } // Esconde barra se up-to-date
    else if (msgLower.includes('verificando atualiza') || msgLower.includes('atualização encontrada')) statusClass = 'status-scanning'; // Azul para att
    else if (msgLower.includes('baixando atualiza')) statusClass = 'status-loading';

    statusElement.className = 'status ' + statusClass;
    // Se estado for de erro, garante que botão esteja habilitado
    if (statusClass === 'status-error') updateStartButtonState(false);
});

window.electronAPI.on('display-qr', (imageDataUrl) => {
    console.log("Renderer: Display QR.");
    showQrPanel(); // Garante que o painel QR está visível
    qrCodeImage.src = imageDataUrl; qrCodeImage.style.display = 'block';
    qrPlaceholder.style.display = 'none';
    addLog("QR Code pronto. Escaneie com WhatsApp.");
});

window.electronAPI.on('clear-qr', () => {
    console.log("Renderer: Clear QR."); showConnectedPanel();
    addLog("Conectado ao WhatsApp.");
});

window.electronAPI.on('config-loaded', (configData) => {
    console.log("Renderer: Config carregada.");
    try {
        configTextArea.value = JSON.stringify(configData || {}, null, 2);
        addLog("Configuração de respostas preenchida.");
    } catch (e) { addLog("ERRO: Exibir config: " + e.message); configTextArea.value = "Erro ao carregar config."; }
});

window.electronAPI.on('update-download-progress', (percent) => {
    // console.log("Renderer: Update Progress -", percent); // Muito verbose, só no main
    updateProgressContainer.style.display = 'block';
    updateProgressBar.value = percent;
    updateProgressLabel.textContent = `Baixando atualização... ${percent.toFixed(0)}%`;
});

window.electronAPI.on('pause-state-changed', (paused) => {
    console.log("Renderer: Pause state changed -", paused);
    isBotPaused = paused; // Atualiza estado local
    updatePauseButtonText(); // Atualiza texto/cor do botão
    addLog(paused ? "Bot pausado." : "Bot continuado.");
    // Atualiza status principal também
    if(isBotConnected) {
         statusElement.textContent = paused ? 'Pausado' : 'Conectado';
        statusElement.className = 'status ' + (paused ? 'status-paused' : 'status-connected');
    }
});


// --- Inicialização ---
window.addEventListener('DOMContentLoaded', () => {
     addLog("Interface carregada.");
     addLog("Solicitando configuração...");
     window.electronAPI.send('load-config-request');
     showDisconnectedState(); // Estado inicial visual
});
console.log("Renderer script carregado.");