// Referências aos Elementos HTML
const startButton = document.getElementById('startButton');
const statusElement = document.getElementById('status');
const qrCodeImage = document.getElementById('qr-code-image');
const qrPlaceholder = document.getElementById('qr-placeholder');
const logsElement = document.getElementById('logs');

// Estado inicial do botão
let isBotStartingOrRunning = false;

function updateButtonState(isStarting) {
    isBotStartingOrRunning = isStarting;
    startButton.disabled = isStarting;
    startButton.textContent = isStarting ? 'Iniciando...' : 'Iniciar Bot';
}

// --- Envia Comando para Iniciar o Bot ---
startButton.addEventListener('click', () => {
    if (isBotStartingOrRunning) return; // Previne cliques múltiplos

    console.log("Renderer: Botão Iniciar pressionado.");
    updateButtonState(true); // Desabilita o botão e muda texto

    // Limpa área do QR e status inicial
    qrCodeImage.src = '';
    qrCodeImage.style.display = 'none';
    qrPlaceholder.textContent = 'Inicializando...';
    qrPlaceholder.style.display = 'inline';
    statusElement.textContent = 'Inicializando...';
    statusElement.className = 'status status-initializing'; // Classe CSS para status
    addLog("Solicitando inicialização do bot...");

    // Envia comando para o Main Process via API do preload
    window.electronAPI.send('start-bot');
});

// --- Recebe Atualizações do Main Process ---

// Atualiza o texto e a cor do Status
window.electronAPI.on('update-status', (message) => {
    console.log("Renderer: Status recebido -", message);
    statusElement.textContent = message;

    // Atualiza a classe CSS para mudar a cor do background/texto do status
    const msgLower = message.toLowerCase();
    if (msgLower.includes('conectado')) {
        statusElement.className = 'status status-connected';
        updateButtonState(false); // Habilita botão se conectado (talvez não queira?)
    } else if (msgLower.includes('autenticado')) {
        statusElement.className = 'status status-authenticated';
    } else if (msgLower.includes('inicializando')) {
        statusElement.className = 'status status-initializing';
        updateButtonState(true); // Mantem botão desabilitado
    } else if (msgLower.includes('gerando qr')) {
         statusElement.className = 'status status-generating-qr';
         updateButtonState(true);
     } else if (msgLower.includes('qr code pronto')) {
          statusElement.className = 'status status-scanning';
          updateButtonState(true);
    } else if (msgLower.includes('desconectado') || msgLower.includes('erro') || msgLower.includes('falha')) {
        statusElement.className = 'status status-error'; // Ou .status-disconnected
        updateButtonState(false); // Permite tentar iniciar novamente
        // Resetar QR se desconectar
        qrCodeImage.src = '';
        qrCodeImage.style.display = 'none';
        qrPlaceholder.textContent = 'Desconectado. Clique para tentar novamente.';
        qrPlaceholder.style.display = 'inline';
    } else {
        statusElement.className = 'status status-default'; // Um estado padrão
    }
});

// Exibe a IMAGEM QR Code recebida (como Data URL)
window.electronAPI.on('display-qr', (imageDataUrl) => {
    console.log("Renderer: Recebido QR Data URL para exibição.");
    qrCodeImage.src = imageDataUrl;         // <-- Define o src da TAG IMG!
    qrCodeImage.style.display = 'block';    // <-- Mostra a imagem
    qrPlaceholder.style.display = 'none'; // <-- Esconde o texto placeholder
    addLog("QR Code recebido e exibido.");
});

// Limpa a área do QR Code (quando conecta ou deslogga)
window.electronAPI.on('clear-qr', () => {
    console.log("Renderer: Comando para limpar QR recebido.");
    qrCodeImage.src = '';                    // Limpa o src da imagem
    qrCodeImage.style.display = 'none';    // Esconde a imagem
    qrPlaceholder.textContent = 'Conectado!'; // Muda texto placeholder
    qrPlaceholder.style.display = 'inline';// Mostra placeholder
    addLog("Área do QR Code limpa (provavelmente conectado).");
});

// Adiciona mensagens de log à área de logs
function addLog(logMessage) {
     console.log("Renderer: Log -", logMessage); // Log no console do devtools tb
     const logEntry = document.createElement('div');
     logEntry.className = 'log-entry';
     logEntry.textContent = logMessage; // Timestamp já vem do main.js
     logsElement.appendChild(logEntry);
     // Auto-scroll para a última mensagem
     logsElement.scrollTop = logsElement.scrollHeight;
}
window.electronAPI.on('log-message', addLog);


// Mensagem inicial para o usuário
window.addEventListener('DOMContentLoaded', () => {
     addLog("Interface carregada. Aguardando ação.");
})

console.log("Renderer script carregado e listeners ativos.");