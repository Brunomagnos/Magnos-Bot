// ./main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js'); // Adicionar MessageMedia se for enviar mídia
const qrcode = require('qrcode');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// Config Logger
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
const logsPath = path.join(app.getPath('userData'), 'logs/main.log');
log.transports.file.resolvePathFn = () => logsPath;

// Globais
let mainWindow;
let client;
const configPath = path.join(app.getPath('userData'), 'bot-config.json');
let botConfig = {};
let isBotPaused = false; // Estado de pausa

// Funções Auxiliares (Log e Status) - Sem mudanças significativas
function sendLogToWindow(message) { const t = new Date().toLocaleTimeString(); log.info(`[${t}] ${message}`); if (mainWindow && !mainWindow.isDestroyed()){ try {mainWindow.webContents.send('log-message', `[${t}] ${message}`);} catch(e){log.error('ERR Log UI:', e);} } }
function updateAppStatus(status) { sendLogToWindow(`Status: ${status}`); if (mainWindow && !mainWindow.isDestroyed()){ try {mainWindow.webContents.send('update-status', status);} catch(e){log.error('ERR Status UI:', e);} } }
function sendPauseStateToWindow() { if (mainWindow && !mainWindow.isDestroyed()){ mainWindow.webContents.send('pause-state-changed', isBotPaused); } }

// Funções Config (Load/Save) - Revisada saveConfig para aceitar objeto
async function loadConfig() { /* ... sem mudanças significativas ... */ sendLogToWindow('[Config] Carregando de ' + configPath); try { const data = await fs.readFile(configPath, 'utf8'); botConfig = JSON.parse(data); sendLogToWindow('[Config] Carregado com sucesso.'); } catch (error) { if (error.code === 'ENOENT') { sendLogToWindow('[Config] Não encontrado, usando vazio.'); botConfig = {}; await saveConfig({}).catch(e => sendLogToWindow("[Config ERR] Criar inicial: "+ e.message)); } else { sendLogToWindow(`[Config ERR] Ler/Parse: ${error.message}`); botConfig = {}; dialog.showErrorBox('Erro Configuração', `Falha carregar ${configPath}.\nJSON válido?\nErro: ${error.message}`); } } if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('config-loaded', botConfig); } }
async function saveConfig(newConfigObject) { sendLogToWindow('[Config] Salvando...'); try { await fs.writeFile(configPath, JSON.stringify(newConfigObject, null, 2), 'utf8'); botConfig = newConfigObject; sendLogToWindow('[Config] Salvo com sucesso em ' + configPath); updateAppStatus('Configuração salva.'); } catch (error) { sendLogToWindow(`[Config ERR] Salvar: ${error.message}`); updateAppStatus('Erro salvar config.'); dialog.showErrorBox('Erro ao Salvar', `Falha salvar config.\nErro: ${error.message}`); } }

// Criação da Janela Principal - Sem mudanças
function createWindow() { /* ... igual à versão anterior ... */ sendLogToWindow('[SYS] Criando janela...'); mainWindow = new BrowserWindow({ width: 1100, height: 800, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }); mainWindow.loadFile('index.html'); /* mainWindow.webContents.openDevTools(); */ mainWindow.on('closed', () => { mainWindow = null; }); mainWindow.webContents.on('did-finish-load', () => { sendLogToWindow('[SYS] UI Carregada.'); loadConfig().then(() => { setTimeout(() => { sendLogToWindow('[Updater] Verificando...'); updateAppStatus('Verificando att...'); autoUpdater.checkForUpdatesAndNotify().catch(err => { sendLogToWindow(`[Updater ERR] Check: ${err.message}`); /* updateAppStatus('Falha check att.'); */ }); }, 3000); }); }); }

// --- Lógica WhatsApp (Revisada) ---
async function destroyWhatsAppClient() { if (client) { sendLogToWindow('[WA] Destruindo cliente...'); updateAppStatus("Desconectando..."); try { await client.destroy(); sendLogToWindow('[WA] Destruído.'); } catch (err) { sendLogToWindow('[WA ERR] Destruir: ' + err.message); } finally { client = null; isBotPaused = false; updateAppStatus("Desconectado"); sendPauseStateToWindow(); } } }
async function initializeWhatsApp() { await destroyWhatsAppClient(); initializeWhatsAppInternal(); }
function initializeWhatsAppInternal() {
    sendLogToWindow('[WA] Inicializando...'); updateAppStatus('Inicializando conexão...'); isBotPaused = false; // Reseta pausa ao iniciar
    sendPauseStateToWindow();

    client = new Client({ authStrategy: new LocalAuth({ dataPath: path.join(app.getPath('userData'), 'WhatsAppSession') }), puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu', '--disable-extensions' ], } });

    // --- Listeners WA ---
    client.on('qr', (qr) => { /* ... igual ... */ sendLogToWindow('[WA] QR Recebido.'); updateAppStatus('QR Code Pronto - Escanear'); qrcode.toDataURL(qr, (err, url) => { if (err) { sendLogToWindow('[WA ERR] QR Conv: '+err.message); updateAppStatus('Erro QR'); return; } if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('display-qr', url); } else { sendLogToWindow('[WA AVISO] Janela p/ QR fechada.'); } }); });
    client.on('ready', () => { sendLogToWindow('[WA] Pronto!'); updateAppStatus('Conectado'); if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('clear-qr'); } initializeMessageListener(); });
    client.on('authenticated', () => { sendLogToWindow('[WA] Autenticado.'); updateAppStatus('Autenticado'); });
    client.on('auth_failure', (msg) => { sendLogToWindow(`[WA ERR] Auth Falha: ${msg}`); updateAppStatus('Falha Autenticação'); if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('clear-qr'); } destroyWhatsAppClient(); });
    client.on('disconnected', (reason) => { sendLogToWindow(`[WA] Desconectado: ${reason}`); destroyWhatsAppClient(); /* Chama destroy para limpar e atualizar status*/ }); // Limpa tudo na desconexão
    client.on('loading_screen', (percent, message) => { updateAppStatus(`Carregando WA: ${percent}%`); }); // Status mais direto
    client.on('error', (err) => { sendLogToWindow(`[WA Client ERR] Erro inesperado no cliente: ${err.message}`); updateAppStatus('Erro no Cliente WA'); /* Considerar destroyWhatsAppClient()? */ });

    sendLogToWindow('[WA] Conectando...');
    client.initialize().catch(err => { const udPath = app.getPath('userData'); if(err.code === 'EPERM') { sendLogToWindow(`[WA FATAL] Permissão em ${udPath}: ${err.message}`); updateAppStatus(`Erro Permissão`); dialog.showErrorBox('Erro Permissão', `Permissão negada para ${udPath}.`); } else if (err.message.includes('browser')) { sendLogToWindow(`[WA FATAL] Browser/Puppeteer: ${err.message}`); updateAppStatus('Erro Browser'); dialog.showErrorBox('Erro do Navegador', `Falha ao iniciar processo do navegador:\n${err.message}\n\nVerifique se não há outro processo usando os dados ou se o antivírus está bloqueando.`); } else { sendLogToWindow(`[WA FATAL] Init: ${err.message}`); updateAppStatus('Erro Inicialização'); dialog.showErrorBox('Erro Inicialização', `Erro WhatsApp: ${err.message}`); } client = null; updateAppStatus('Erro Crítico Inicialização'); }); // Garante status de erro
}

// --- Listener Mensagens (USANDO PAUSA e botConfig) ---
function initializeMessageListener() {
    if (!client) { sendLogToWindow('[WA AVISO] Listener s/ cliente.'); return; }
    client.removeAllListeners('message'); // Limpa listeners antigos para evitar duplicação
    client.on('message_create', message => { /* Log enviado (opcional)*/ });
    client.on('message', async msg => {
        if (msg.fromMe || isBotPaused) return; // Ignora self e se pausado

        const sender = msg.from;
        const messageBody = msg.body;
        sendLogToWindow(`[WA Msg Recebida] De: ${sender} | Msg: ${messageBody.substring(0, 50)}...`);
        try {
             // VERIFICA CONFIGURAÇÃO -> Lógica chave-exata
             const exactMatchKey = Object.keys(botConfig).find(key => key === messageBody);
             if(exactMatchKey) {
                 const replyText = botConfig[exactMatchKey];
                 await client.sendMessage(sender, replyText); // Usar client.sendMessage é mais robusto que msg.reply às vezes
                 sendLogToWindow(`[Bot Resposta] (Exata) Gatilho: "${messageBody}" | Resposta: "${replyText}" | Para: ${sender}`);
                 return; // Evita verificar outras lógicas se achou match exato
             }

             // *** Adicione outras lógicas aqui se desejar ***
             // Ex: Verificar se começa com !, procurar por palavras-chave, etc.
             // Exemplo simples:
             if (messageBody.toLowerCase().includes("ajuda")) {
                  await client.sendMessage(sender, "Digite uma das opções que eu conheço ou !comandos.");
                 sendLogToWindow(`[Bot Resposta] (Ajuda) Para: ${sender}`);
             }

        } catch (error) { sendLogToWindow(`[Bot ERRO] Processar/Responder ${sender}: ${error.message}`); }
    });
    sendLogToWindow('[WA] Listener mensagens ativo.');
}

// --- Handlers Updater (Adicionado log detalhado erro e hide progress)---
function hideProgress() { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('update-download-progress', -1); } } // Envia -1 para esconder
autoUpdater.on('checking-for-update', () => { sendLogToWindow('[Updater] Verificando...'); updateAppStatus('Verificando att...'); });
autoUpdater.on('update-available', (i) => { sendLogToWindow(`[Updater] Disponível: v${i.version}`); updateAppStatus(`Atualização v${i.version} encontrada`); }); // Avisa que encontrou
autoUpdater.on('update-not-available', (i) => { sendLogToWindow('[Updater] Não disponível.'); updateAppStatus('Versão mais recente.'); hideProgress(); });
autoUpdater.on('error', (err) => { sendLogToWindow(`[Updater ERRO] ${err.name}: ${err.message}`); updateAppStatus('Erro atualizador.'); hideProgress(); });
autoUpdater.on('download-progress', (p) => { updateAppStatus(`Baixando att: ${p.percent.toFixed(0)}%`); sendLogToWindow(`[Updater] Baixando: ${p.percent.toFixed(2)}%`); if(mainWindow && !mainWindow.isDestroyed()){mainWindow.webContents.send('update-download-progress', p.percent);} });
autoUpdater.on('update-downloaded', (i) => { sendLogToWindow(`[Updater] Baixada: v${i.version}`); updateAppStatus('Atualização pronta!'); hideProgress(); ipcMain.emit('show-update-restart-dialog'); });

// --- Handlers IPC (Adicionado 'toggle-pause-bot') ---
ipcMain.on('start-bot', initializeWhatsApp);
ipcMain.on('check-for-update-request', () => { sendLogToWindow('[IPC] Req check update.'); updateAppStatus('Verificando att...'); autoUpdater.checkForUpdates().catch(err => { sendLogToWindow(`[Updater ERRO] Check Manual: ${err.message}`); updateAppStatus('Erro check att.'); hideProgress(); }); });
ipcMain.on('load-config-request', (event) => { sendLogToWindow('[IPC] Req load config.'); event.reply('config-loaded', botConfig); });
ipcMain.on('save-config', (event, configObject) => { sendLogToWindow('[IPC] Req save config.'); saveConfig(configObject); }); // Salva objeto
ipcMain.on('toggle-pause-bot', () => {
    isBotPaused = !isBotPaused;
    const statusMsg = isBotPaused ? "Bot Pausado" : (client && client.info ? "Conectado" : "Pausado (Desconectado?)"); // Status melhorado
    sendLogToWindow(`[SYS] Pause Toggled. Novo estado: ${isBotPaused}`);
    updateAppStatus(statusMsg);
    sendPauseStateToWindow(); // Informa UI sobre novo estado
});
ipcMain.on('show-update-restart-dialog', async () => { /* ... igual ... */ sendLogToWindow('[Updater] Req reinício.'); if (!mainWindow || mainWindow.isDestroyed()) { sendLogToWindow('[Updater AVISO] Janela fechada.'); return; } try { const { response } = await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Atualização Pronta', message: 'Nova versão baixada. Reiniciar e instalar?', buttons: ['Reiniciar', 'Depois'], defaultId: 0, cancelId: 1 }); if (response === 0) { sendLogToWindow("[Updater] Aceito. Reiniciando..."); await destroyWhatsAppClient(); autoUpdater.quitAndInstall(); } else { sendLogToWindow("[Updater] Adiado."); updateAppStatus('Att instalará ao sair.'); } } catch(e) { sendLogToWindow(`[Updater ERR] Diálogo: ${e.message}`); } });

// --- Ciclo de Vida App (sem mudanças) ---
app.whenReady().then(() => { sendLogToWindow('====== [SYS] Iniciado ======'); loadConfig().finally(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); }); });
app.on('window-all-closed', async () => { await destroyWhatsAppClient(); if (process.platform !== 'darwin') { sendLogToWindow('[SYS] Encerrando.'); app.quit(); } else { sendLogToWindow('[SYS] App ativo (macOS).'); } });
app.on('before-quit', async () => { sendLogToWindow('[SYS] Saindo...'); await destroyWhatsAppClient(); sendLogToWindow('[SYS] Limpeza pré-saída OK.'); });

// --- Erros Globais (sem mudanças) ---
process.on('uncaughtException', (e, o) => { log.error('*** UNC EXCEPTION ***', e, o); sendLogToWindow(`[ERR CRIT] ${e.message}`); if(mainWindow && !mainWindow.isDestroyed()) dialog.showErrorBox('Erro Crítico', `Erro:\n${e.message}`);});
process.on('unhandledRejection', (r, p) => { log.error('*** UNH REJECTION ***', r); sendLogToWindow(`[ERR ASYNC] ${r}`);});

sendLogToWindow('[SYS] main.js carregado.');