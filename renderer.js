// ./renderer.js

// Referências aos Elementos HTML
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status');
const qrCodeImage = document.getElementById('qr-code-image');
const qrPlaceholder = document.getElementById('qr-placeholder');
const logsElement = document.getElementById('logs');
const checkUpdateButton = document.getElementById('checkUpdateButton');
// Novas referências para configuração
const configTextArea = document.getElementById('configTextArea');
const saveConfigButton = document.getElementById('saveConfigButton');


// Estado inicial
let isBotStartingOrRunning = false;

function updateButtonState(isStarting) {
    isBotStartingOrRunning = isStarting;
    startButton.disabled = isStarting;
    startButton.textContent = isStarting ? 'Iniciando...' : 'Iniciar Bot';
}

// Adiciona mensagens de log à área de logs
function addLog(logMessage) {
     console.log("Renderer: Log -", logMessage);
     const logEntry = document.createElement('div');
     logEntry.className = 'log-entry';
     logEntry.textContent = logMessage;
     logsElement.appendChild(logEntry);
     logsElement.scrollTop = logsElement.scrollHeight;
}

// --- Enviar Comandos para o Main Process ---

// Iniciar Bot
startButton.addEventListener('click', () => {
    if (isBotStartingOrRunning) return;
    console.log("Renderer: Botão Iniciar pressionado.");
    updateButtonState(true);
    qrCodeImage.src = '';
    qrCodeImage.style.display = 'none';
    qrPlaceholder.textContent = 'Inicializando...';
    qrPlaceholder.style.display = 'inline';
    statusElement.textContent = 'Inicializando...';
    statusElement.className = 'status status-initializing';
    addLog("Solicitando inicialização do bot...");
    window.electronAPI.send('start-bot');
});

// Verificar Atualizações
checkUpdateButton.addEventListener('click', () => {
    console.log("Renderer: Botão Verificar Atualizações pressionado.");
    addLog("Solicitando verificação de atualizações...");
    // Opcional: Desabilitar botão temporariamente
    // checkUpdateButton.disabled = true;
    window.electronAPI.send('check-for-update-request');
});

// Salvar Configuração
saveConfigButton.addEventListener('click', () => {
    const configString = configTextArea.value;
    console.log("Renderer: Botão Salvar Configuração pressionado.");
    addLog("Tentando salvar configuração...");
     try {
         // Tenta validar o JSON minimamente no lado do renderer
        JSON.parse(configString);
        window.electronAPI.send('save-config', configString);
        // Feedback visual temporário (opcional)
         saveConfigButton.textContent = 'Salvando...';
        setTimeout(() => { saveConfigButton.textContent = 'Salvar Configuração'; }, 1500);
    } catch (e) {
        addLog(`ERRO: Configuração inválida. Verifique o formato JSON. Detalhes: ${e.message}`);
        alert(`Erro na configuração!\nO texto inserido não é um JSON válido.\n\nDetalhe: ${e.message}\n\nVerifique chaves e valores entre aspas, vírgulas corretas, etc.`);
     }
});


// --- Receber Atualizações do Main Process ---

// Log
window.electronAPI.on('log-message', addLog);

// Status
window.electronAPI.on('update-status', (message) => {
    console.log("Renderer: Status recebido -", message);
    statusElement.textContent = message;
    const msgLower = message.toLowerCase();
    if (msgLower.includes('conectado')) statusElement.className = 'status status-connected';
    else if (msgLower.includes('autenticado')) statusElement.className = 'status status-authenticated';
    else if (msgLower.includes('inicializando') || msgLower.includes('carregando whatsapp')) statusElement.className = 'status status-initializing';
    else if (msgLower.includes('gerando qr') || msgLower.includes('qr code pronto')) statusElement.className = 'status status-generating-qr'; // ou status-scanning
    else if (msgLower.includes('qr code pronto')) statusElement.className = 'status status-scanning';
    else if (msgLower.includes('desconectado') || msgLower.includes('erro') || msgLower.includes('falha') || msgLower.includes('permission')) statusElement.className = 'status status-error';
    else if (msgLower.includes('já tem a versão mais recente') || msgLower.includes('aplicativo atualizado')) statusElement.className = 'status status-connected'; // Verde se não tem att nova
    else statusElement.className = 'status status-default';

    // Reabilitar botão de start/verifica update se ocorreu erro ou desconectou
     if (msgLower.includes('desconectado') || msgLower.includes('erro') || msgLower.includes('falha') || msgLower.includes('permission')) {
         updateButtonState(false);
         // checkUpdateButton.disabled = false; // Reabilitar se desabilitou antes
         qrCodeImage.src = '';
         qrCodeImage.style.display = 'none';
         qrPlaceholder.textContent = 'Erro ou desconectado. Tente iniciar novamente.';
         qrPlaceholder.style.display = 'inline';
     }

     // Reabilitar botão de check update em outros casos seguros também
     if (msgLower.includes('aplicativo atualizado') || msgLower.includes('já tem a versão mais recente') || msgLower.includes('atualização encontrada')) {
         // checkUpdateButton.disabled = false;
     }

});

// QR Code
window.electronAPI.on('display-qr', (imageDataUrl) => {
    console.log("Renderer: Recebido QR Data URL.");
    qrCodeImage.src = imageDataUrl;
    qrCodeImage.style.display = 'block';
    qrPlaceholder.style.display = 'none';
    addLog("QR Code recebido. Escaneie com o app WhatsApp no seu celular.");
});

// Limpar QR
window.electronAPI.on('clear-qr', () => {
    console.log("Renderer: Comando para limpar QR.");
    qrCodeImage.src = '';
    qrCodeImage.style.display = 'none';
    qrPlaceholder.textContent = 'Conectado!';
    qrPlaceholder.style.display = 'inline';
    addLog("Área do QR Code limpa (Conectado).");
});

// Carregar Configuração (Recebida do Main)
window.electronAPI.on('config-loaded', (configData) => {
    console.log("Renderer: Configuração recebida do Main.");
    try {
        // Formata o JSON para exibição indentada no textarea
        const configString = JSON.stringify(configData || {}, null, 2); // Usa 2 espaços para indentar
        configTextArea.value = configString;
        addLog("Configuração de respostas carregada na interface.");
    } catch (e) {
        addLog("ERRO: Falha ao formatar/exibir configuração recebida.");
        configTextArea.value = "Erro ao carregar configuração.";
    }
});

// --- Inicialização do Renderer ---
window.addEventListener('DOMContentLoaded', () => {
     addLog("Interface carregada. Aguardando ação.");
     // Solicita a configuração atual ao carregar a interface
     addLog("Solicitando configuração de respostas...");
     window.electronAPI.send('load-config-request');
});

console.log("Renderer script carregado e listeners ativos.");