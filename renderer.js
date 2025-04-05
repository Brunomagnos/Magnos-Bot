// ./renderer.js

// Referências
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status');
const logsElement = document.getElementById('logs');
const checkUpdateButton = document.getElementById('checkUpdateButton');
const configTextArea = document.getElementById('configTextArea');
const saveConfigButton = document.getElementById('saveConfigButton');
const pauseButton = document.getElementById('pauseButton');
const qrCodeContainer = document.getElementById('qr-code-container');
const qrCodeImage = document.getElementById('qr-code-image');
const qrPlaceholder = document.getElementById('qr-placeholder');
const connectedInfoPanel = document.getElementById('connected-info-panel');
const updateProgressContainer = document.getElementById('updateProgressContainer');
const updateProgressBar = document.getElementById('updateProgressBar');
const updateProgressLabel = document.getElementById('updateProgressLabel');

// Estados
let isBotStartingOrRunning = false;
let isBotConnected = false;
let isBotPaused = false;

// Funções Auxiliares UI
function updateStartButtonState(isStarting, isConnected = false) {
    isBotStartingOrRunning = isStarting || isConnected;
    startButton.disabled = isBotStartingOrRunning; // Desabilita se iniciando OU conectado
    startButton.textContent = isStarting ? 'Conectando...' : (isConnected ? 'Conectado' : 'Iniciar Bot');
}
function addLog(logMessage) { /* ... (igual anterior) ... */ const cleaned = logMessage.startsWith('[') && logMessage.includes(']') ? logMessage.substring(logMessage.indexOf(']') + 2) : logMessage; console.log("Renderer Log:", cleaned); const e = document.createElement('div'); e.className = 'log-entry'; e.textContent = `[${new Date().toLocaleTimeString()}] ${cleaned}`; logsElement.appendChild(e); logsElement.scrollTop = logsElement.scrollHeight; }
function showQrPanel(text = 'Gerando QR Code...') {
    qrCodeContainer.style.display = 'flex';
    qrCodeImage.style.display = 'none';
    qrPlaceholder.textContent = text;
    qrPlaceholder.style.display = 'block';
    connectedInfoPanel.style.display = 'none';
    pauseButton.style.display = 'none';
    isBotConnected = false;
    updateStartButtonState(true, false); // Mostra 'Conectando...'
}
function showConnectedPanel() {
    qrCodeContainer.style.display = 'none';
    connectedInfoPanel.style.display = 'flex';
    pauseButton.style.display = 'inline-block'; // Mostra botão pausa
    isBotConnected = true;
    updateStartButtonState(false, true); // Mostra 'Conectado' e desabilita Iniciar
    updatePauseButtonText();
}
function showDisconnectedState() {
     qrCodeContainer.style.display = 'flex';
     qrCodeImage.style.display = 'none';
     qrPlaceholder.textContent = 'Desconectado. Clique Iniciar.';
     qrPlaceholder.style.display = 'block';
     connectedInfoPanel.style.display = 'none';
     pauseButton.style.display = 'none';
     isBotConnected = false;
     updateStartButtonState(false, false); // Habilita 'Iniciar Bot'
}
function updatePauseButtonText() {
    pauseButton.textContent = isBotPaused ? '▶️ Continuar Bot' : '⏸️ Pausar Bot';
    if (isBotPaused) pauseButton.classList.add('paused');
    else pauseButton.classList.remove('paused');
}

// --- Event Listeners UI ---
startButton.addEventListener('click', () => {
    if (isBotStartingOrRunning) return; console.log("Renderer: Start");
    showQrPanel('Inicializando...'); updateStartButtonState(true);
    statusElement.textContent = 'Inicializando...'; statusElement.className = 'status status-initializing';
    addLog("Solicitando inicialização...");
    window.electronAPI.send('start-bot');
});
checkUpdateButton.addEventListener('click', () => {
    console.log("Renderer: Check Update"); addLog("Solicitando verificação de att...");
    window.electronAPI.send('check-for-update-request');
    updateProgressLabel.textContent = 'Verificando...'; updateProgressBar.value = 0; updateProgressBar.removeAttribute('value'); updateProgressContainer.style.display = 'block'; // Estado indeterminado
    checkUpdateButton.disabled = true; // Evita cliques múltiplos na verificação
});
saveConfigButton.addEventListener('click', () => {
    const configString = configTextArea.value; console.log("Renderer: Save Config");
    addLog("Tentando salvar configuração...");
    try {
        const configObj = JSON.parse(configString || "{}"); // Garante obj válido mesmo se vazio
        if (typeof configObj !== 'object' || configObj === null) throw new Error("Configuração deve ser um objeto JSON.");
        window.electronAPI.send('save-config', configObj); // Envia objeto
        saveConfigButton.textContent = 'Salvando...'; saveConfigButton.disabled = true;
        setTimeout(() => { saveConfigButton.textContent = 'Salvar Configuração'; saveConfigButton.disabled = false; addLog("Configuração enviada para salvar."); }, 1500);
    } catch (e) { addLog(`ERRO: JSON inválido: ${e.message}`); alert(`Erro na configuração JSON!\n${e.message}`); }
});
pauseButton.addEventListener('click', () => {
    console.log("Renderer: Toggle Pause"); addLog(isBotPaused ? "Solicitando continuar..." : "Solicitando pausar...");
    window.electronAPI.send('toggle-pause-bot');
});

// --- Receber Eventos do Main ---
window.electronAPI.on('log-message', addLog);

window.electronAPI.on('update-status', (message) => {
    console.log("Renderer: Status -", message); statusElement.textContent = message;
    const msgL = message.toLowerCase(); let statusC = 'status-default'; let reenableCheck = false;
    if (msgL.includes('conectado')) { statusC = 'status-connected'; showConnectedPanel(); }
    else if (msgL.includes('autenticado')) statusC = 'status-authenticated';
    else if (msgL.includes('inicializando')) { statusC = 'status-initializing'; updateStartButtonState(true); showQrPanel('Inicializando...'); }
    else if (msgL.includes('carregando wa')) { statusC = 'status-initializing'; updateStartButtonState(true); showQrPanel(message); } // Mostra progresso
    else if (msgL.includes('gerando qr')) statusC = 'status-generating-qr';
    else if (msgL.includes('escanear') || msgL.includes('qr code pronto')) { statusC = 'status-scanning'; showQrPanel('Escaneie o QR Code'); updateStartButtonState(true); }
    else if (msgL.includes('desconectado') || msgL.includes('erro') || msgL.includes('falha') || msgL.includes('permission') ) { statusC = 'status-error'; updateStartButtonState(false); showDisconnectedState(); reenableCheck = true; }
    else if (msgL.includes('pausado')) { statusC = 'status-paused'; }
    else if (msgL.includes('versão mais recente')) { statusC = isBotConnected ? 'status-connected' : 'status-default'; updateProgressContainer.style.display = 'none'; reenableCheck = true;}
    else if (msgL.includes('aplicativo atualizado')) { statusC = 'status-connected'; updateProgressContainer.style.display = 'none'; reenableCheck = true;} // Verde mesmo, indica sucesso
    else if (msgL.includes('verificando att') || msgL.includes('att encontrada')) statusC = 'status-scanning';
    else if (msgL.includes('baixando att')) statusC = 'status-loading';

    statusElement.className = 'status ' + statusC;
    if (statusC === 'status-error') updateStartButtonState(false);
    if (reenableCheck) checkUpdateButton.disabled = false; // Reabilita botão check update
});
window.electronAPI.on('display-qr', (imageDataUrl) => {
    console.log("Renderer: Display QR."); showQrPanel('Escaneie com WhatsApp');
    qrCodeImage.src = imageDataUrl; qrCodeImage.style.display = 'block'; qrPlaceholder.style.display = 'none';
    addLog("QR Code pronto.");
});
window.electronAPI.on('clear-qr', () => { console.log("Renderer: Clear QR."); showConnectedPanel(); addLog("Conectado."); });
window.electronAPI.on('config-loaded', (c) => { console.log("Renderer: Config recebida."); try { configTextArea.value = JSON.stringify(c || {}, null, 2); addLog("Configuração preenchida."); } catch (e) { addLog("ERRO Exibir config: "+e.message); configTextArea.value = "Erro ao carregar."; } });
window.electronAPI.on('update-download-progress', (percent) => {
    if (percent < 0) { // Sinal para esconder
        updateProgressContainer.style.display = 'none';
        checkUpdateButton.disabled = false;
    } else {
        updateProgressContainer.style.display = 'block';
        updateProgressBar.value = percent;
        updateProgressBar.removeAttribute('value'); // Fica indeterminado até ter valor
        if(percent > 0) updateProgressBar.value = percent; // Define valor se maior que 0
        updateProgressLabel.textContent = `Baixando atualização... ${percent.toFixed(0)}%`;
    }
});
window.electronAPI.on('pause-state-changed', (p) => { console.log("R: Pause state:", p); isBotPaused=p; updatePauseButtonText(); addLog(p?"Bot pausado.":"Bot continuado."); if(isBotConnected){statusElement.textContent = p?'Pausado':'Conectado'; statusElement.className = 'status '+(p?'status-paused':'status-connected');} });

// Inicialização UI
window.addEventListener('DOMContentLoaded', () => { addLog("Interface pronta."); addLog("Carregando config..."); window.electronAPI.send('load-config-request'); showDisconnectedState(); });
console.log("Renderer script carregado.");