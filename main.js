// ./main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const { Client, LocalAuth } = require('whatsapp-web.js'); // MessageMedia removido por enquanto
const qrcode = require('qrcode');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// --- Configurações e Globais ---
autoUpdater.logger = log; autoUpdater.logger.transports.file.level = 'info';
const logsPath = path.join(app.getPath('userData'), 'logs/main.log');
log.transports.file.resolvePathFn = () => logsPath;
log.transports.file.level = "info"; // Loga tudo info ou superior no arquivo
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'; // Log debug no console só em dev

let mainWindow;
let client;
const configPath = path.join(app.getPath('userData'), 'bot-config.json');
let botConfig = {};
let isBotPaused = false; // Estado de pausa
let clientReady = false; // Flag para saber se o 'ready' foi emitido

// --- Funções Auxiliares ---
function sendLog(level, message) { const t = `[${new Date().toLocaleTimeString()}]`; log[level](`${t} ${message}`); if (mainWindow && !mainWindow.isDestroyed()){ try {mainWindow.webContents.send('log-message', `${t} ${message}`);} catch(e){log.error('ERR Log UI:', e);} } }
function updateStatus(status) { sendLog('info', `Status: ${status}`); if (mainWindow && !mainWindow.isDestroyed()){ try {mainWindow.webContents.send('update-status', status);} catch(e){log.error('ERR Status UI:', e);} } }
function sendPauseState() { if (mainWindow && !mainWindow.isDestroyed()){ mainWindow.webContents.send('pause-state-changed', isBotPaused); } }
function hideDownloadProgress() { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('update-download-progress', -1); } }

// --- Funções Config ---
async function loadConfig() { sendLog('info', '[Config] Carregando...'); try { const data = await fs.readFile(configPath, 'utf8'); botConfig = JSON.parse(data); sendLog('info', '[Config] Carregado com sucesso.'); } catch (error) { if (error.code === 'ENOENT') { sendLog('warn', '[Config] Não encontrado, criando vazio.'); botConfig = {}; await saveConfig({}).catch(e => sendLog('error', "[Config ERR] Criar inicial: "+ e.message)); } else { sendLog('error', `[Config ERR] Ler/Parse: ${error.message}`); botConfig = {}; dialog.showErrorBox('Erro Configuração', `Falha carregar ${configPath}.\nJSON válido?\nErro: ${error.message}`); } } if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('config-loaded', botConfig); } }
async function saveConfig(newConfigObject) { sendLog('info', '[Config] Salvando...'); try { if(typeof newConfigObject !== 'object' || newConfigObject === null) throw new Error("Tentativa de salvar config não-objeto"); await fs.writeFile(configPath, JSON.stringify(newConfigObject, null, 2), 'utf8'); botConfig = newConfigObject; sendLog('info', '[Config] Salvo com sucesso.'); updateStatus('Configuração salva.'); } catch (error) { sendLog('error', `[Config ERR] Salvar: ${error.message}`); updateStatus('Erro salvar config.'); dialog.showErrorBox('Erro ao Salvar', `Falha salvar config.\nErro: ${error.message}`); } }

// --- Criação Janela ---
function createWindow() { sendLog('info', '[SYS] Criando janela...'); mainWindow = new BrowserWindow({ width: 1150, height: 800, minWidth: 900, minHeight: 650, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } }); mainWindow.loadFile('index.html'); /*mainWindow.webContents.openDevTools();*/ mainWindow.on('closed', () => { mainWindow = null; }); mainWindow.webContents.on('did-finish-load', () => { sendLog('info', '[SYS] UI Carregada.'); loadConfig().then(() => { setTimeout(() => { autoUpdater.checkForUpdatesAndNotify().catch(err => { sendLog('error', `[Updater ERR] Check inicial: ${err.message}`); /* updateStatus('Falha check att.'); */ }); }, 3000); }); }); }

// --- Lógica WhatsApp ---
async function destroyWhatsAppClient(reason = "Solicitado") { if (client) { sendLog('warn', `[WA] Destruindo cliente (${reason})...`); client.removeAllListeners(); try { await client.destroy(); sendLog('info','[WA] Cliente destruído.'); } catch (err) { sendLog('error','[WA ERR] Destruir: ' + err.message); } finally { client = null; clientReady = false; isBotPaused = false; updateStatus("Desconectado"); sendPauseState(); } } else { /* Ja estava desconectado */ if (!mainWindow || mainWindow.isDestroyed()) updateStatus("Desconectado"); } } // Garante status "Desconectado" mesmo se client ja for null
async function initializeWhatsApp() { await destroyWhatsAppClient("Reiniciando"); initializeWhatsAppInternal(); }
function initializeWhatsAppInternal() {
    sendLog('info','[WA] Inicializando...'); updateStatus('Inicializando conexão...'); clientReady = false; isBotPaused = false; sendPauseState();
    client = new Client({ authStrategy: new LocalAuth({ dataPath: path.join(app.getPath('userData'), 'WhatsAppSession') }), puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-extensions','--no-first-run','--no-zygote' ], }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36' });

    client.on('qr', (qr) => { sendLog('info', '[WA] QR Recebido.'); updateStatus('Escaneie o QR Code'); qrcode.toDataURL(qr, (err, url) => { if (err) { sendLog('error', '[WA ERR] QR Conv: '+err.message); updateStatus('Erro QR'); return; } if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('display-qr', url); } }); });
    client.on('ready', () => { sendLog('info', '[WA] Pronto!'); updateStatus('Conectado'); clientReady = true; if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('clear-qr'); } initializeMessageListener(); });
    client.on('authenticated', () => { sendLog('info', '[WA] Autenticado.'); updateStatus('Autenticado'); });
    client.on('auth_failure', (msg) => { sendLog('error', `[WA ERR] Auth Falha: ${msg}`); updateStatus('Falha Autenticação'); destroyWhatsAppClient('Auth Failure'); });
    client.on('disconnected', (reason) => { sendLog('warn', `[WA] Desconectado: ${reason}`); destroyWhatsAppClient(reason); });
    client.on('loading_screen', (percent, msg) => { updateStatus(`Carregando WA: ${percent}%`); });
    client.on('error', (err) => { sendLog('error', `[WA Client ERR]: ${err.message}`); updateStatus('Erro no Cliente WA'); });

    sendLog('info', '[WA] Conectando...');
    client.initialize().catch(err => { const msg = err.message || String(err); sendLog('error', `[WA FATAL] Init: ${msg}`); let userMsg = `Erro Inicialização WA: ${msg}`; if(msg.includes('browser') || msg.includes('ENOENT') || msg.includes('Target closed')) { userMsg = `Falha Puppeteer/Browser:\n${msg}\n\nTente fechar outros processos ou verifique antivirus.`; } updateStatus('Erro Inicialização'); if (mainWindow && !mainWindow.isDestroyed()){ dialog.showErrorBox('Erro Inicialização', userMsg); } destroyWhatsAppClient('Init Failed'); });
}

// --- Listener Mensagens ---
function initializeMessageListener() {
    if (!client || !clientReady) { sendLog('warn', '[WA AVISO] Listener s/ cliente pronto.'); return; }
    client.removeAllListeners('message'); // Evita duplicados em reinicialização
    client.on('message', async msg => {
        if (msg.fromMe || isBotPaused || !clientReady) return; // Ignora se pausado, self, ou não pronto
        const sender = msg.from; const body = msg.body;
        sendLog('debug', `[WA Msg In] De: ${sender} | Body: ${body.substring(0, 50)}...`);
        try {
            const replyText = botConfig ? botConfig[body] : undefined;
            if (replyText && typeof replyText === 'string') {
                 await client.sendMessage(sender, replyText); // Usar sendMessage é mais geral
                 sendLog('info', `[Bot Resp (Exata)] Para ${sender}: "${replyText}"`);
                 return;
             }
        } catch (error) { sendLog('error', `[Bot ERR] Responder ${sender}: ${error.message}`); }
    });
    sendLog('info', '[WA] Listener mensagens pronto.');
}

// --- Handlers Updater ---
autoUpdater.on('checking-for-update', () => { updateStatus('Verificando att...'); });
autoUpdater.on('update-available', (i) => { updateStatus(`Atualização v${i.version} encontrada`); sendLog('info', `[Updater] Disponível: v${i.version}`) });
autoUpdater.on('update-not-available', (i) => { updateStatus('Versão mais recente.'); sendLog('info', '[Updater] Não disponível.'); hideDownloadProgress(); });
autoUpdater.on('error', (err) => { updateStatus('Erro atualizador.'); sendLog('error', `[Updater ERR] ${err.message}`); hideDownloadProgress(); });
autoUpdater.on('download-progress', (p) => { updateStatus(`Baixando att: ${p.percent.toFixed(0)}%`); if(mainWindow && !mainWindow.isDestroyed()){mainWindow.webContents.send('update-download-progress', p.percent);} });
autoUpdater.on('update-downloaded', (i) => { updateStatus('Atualização pronta!'); sendLog('info', `[Updater] Baixada: v${i.version}`); hideDownloadProgress(); ipcMain.emit('show-update-restart-dialog'); });

// --- Handlers IPC ---
ipcMain.on('start-bot', initializeWhatsApp);
ipcMain.on('check-for-update-request', () => { sendLog('info', '[IPC] Req check update.'); updateStatus('Verificando att...'); autoUpdater.checkForUpdates().catch(err => { sendLog('error', `[Updater ERR] Check Manual: ${err.message}`); updateStatus('Erro check att.'); hideDownloadProgress(); }); });
ipcMain.on('load-config-request', (event) => { sendLog('debug', '[IPC] Req load config.'); event.reply('config-loaded', botConfig); });
ipcMain.on('save-config', (event, configObject) => { sendLog('info', '[IPC] Req save config.'); saveConfig(configObject); });
ipcMain.on('toggle-pause-bot', () => { isBotPaused = !isBotPaused; const statusMsg = isBotPaused ? "Pausado" : (clientReady ? "Conectado" : "Pausado (Desconectado?)"); sendLog('info', `[SYS] Pause: ${isBotPaused}`); updateStatus(statusMsg); sendPauseState(); });
ipcMain.on('show-update-restart-dialog', async () => { sendLog('info','[Updater] Req reinício.'); if (!mainWindow || mainWindow.isDestroyed()) return; try { const { response } = await dialog.showMessageBox(mainWindow, { type:'info',title:'Att Pronta', message:'Reiniciar e instalar?', buttons: ['Reiniciar', 'Depois'], defaultId: 0, cancelId: 1 }); if (response===0) { sendLog('info',"[Updater] Aceito."); await destroyWhatsAppClient("Atualizando"); autoUpdater.quitAndInstall(); } else { sendLog('info',"[Updater] Adiado."); updateStatus('Att instalará ao sair.'); } } catch(e) { sendLog('error',`[Updater ERR] Diálogo: ${e.message}`); } });

// --- Ciclo de Vida App ---
app.whenReady().then(() => { sendLog('info', '====== [SYS] Iniciado ======'); loadConfig().finally(() => { createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); }); });
app.on('window-all-closed', async () => { await destroyWhatsAppClient("Fechando Janelas"); if (process.platform !== 'darwin') { sendLog('info','[SYS] Encerrando.'); app.quit(); } else { sendLog('info','[SYS] App ativo (macOS).'); } });
app.on('before-quit', async () => { sendLog('info', '[SYS] Saindo...'); await destroyWhatsAppClient("Saindo do App"); });

// --- Erros Globais ---
process.on('uncaughtException', (e, o) => { log.error('*** UNC EXCEPTION ***', e, o); sendLog('error',`[ERR CRIT] ${e.message}`); if(mainWindow && !mainWindow.isDestroyed()) dialog.showErrorBox('Erro Crítico',`Erro:\n${e.message}`);});
process.on('unhandledRejection', (r, p) => { log.error('*** UNH REJECTION ***', r); sendLog('error',`[ERR ASYNC] ${r}`);});

// Linha final
sendLog('info', '[SYS] main.js processado.');