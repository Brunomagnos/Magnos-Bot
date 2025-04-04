// ./main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises; // Usando fs.promises para async/await
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

// --- Configuração do Logger ---
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
const logsPath = path.join(app.getPath('userData'), 'logs/main.log');
log.transports.file.resolvePathFn = () => logsPath;

// --- Variáveis Globais ---
let mainWindow;
let client;
const configPath = path.join(app.getPath('userData'), 'bot-config.json'); // Caminho para salvar config
let botConfig = {}; // Armazena a configuração carregada em memória

// --- Funções Auxiliares ---
function sendLogToWindow(message) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    log.info(formattedMessage);
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send('log-message', formattedMessage);
        } catch (error) { log.error('Erro ao enviar log para a janela:', error); }
    }
}
function updateAppStatus(status) {
    sendLogToWindow(`Status: ${status}`);
    if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send('update-status', status);
        } catch (error) { log.error('Erro ao enviar status para a janela:', error); }
    }
}

// --- Funções de Configuração ---
async function loadConfig() {
    sendLogToWindow('[Config] Tentando carregar configuração de ' + configPath);
    try {
        const data = await fs.readFile(configPath, 'utf8');
        botConfig = JSON.parse(data);
        sendLogToWindow('[Config] Configuração carregada com sucesso.');
    } catch (error) {
        if (error.code === 'ENOENT') { // Arquivo não existe (primeira execução)
            sendLogToWindow('[Config] Arquivo de configuração não encontrado. Usando configuração vazia.');
            botConfig = {}; // Inicia com objeto vazio
            // Opcional: Salvar um arquivo vazio para garantir que ele exista?
             await saveConfig("{}").catch(e => sendLogToWindow("[Config ERRO] Falha ao criar config inicial: "+ e.message));
        } else {
            sendLogToWindow(`[Config ERRO] Falha ao ler/parsear configuração: ${error.message}`);
            botConfig = {}; // Usa config vazia em caso de erro de parse
            // Poderia notificar o usuário sobre o erro no arquivo?
             dialog.showErrorBox('Erro de Configuração', `Não foi possível carregar o arquivo de configuração bot-config.json.\nVerifique se o formato JSON é válido.\n\nErro: ${error.message}`);
         }
    }
    // Envia a configuração carregada (ou vazia) para a interface
     if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
         mainWindow.webContents.send('config-loaded', botConfig);
    }
}

async function saveConfig(configString) {
    sendLogToWindow('[Config] Tentando salvar configuração...');
    try {
        const newConfig = JSON.parse(configString); // Valida se é JSON válido
        await fs.writeFile(configPath, JSON.stringify(newConfig, null, 2), 'utf8'); // Salva formatado
        botConfig = newConfig; // Atualiza a configuração em memória
        sendLogToWindow('[Config] Configuração salva com sucesso em ' + configPath);
        updateAppStatus('Configuração salva.');
         // Opcional: notificar sucesso na UI de forma mais clara?
    } catch (error) {
        sendLogToWindow(`[Config ERRO] Falha ao parsear/salvar configuração: ${error.message}`);
        updateAppStatus('Erro ao salvar configuração');
        // O erro de parse já deve ter sido mostrado no renderer, mas pode mostrar aqui também
         dialog.showErrorBox('Erro ao Salvar', `Não foi possível salvar a configuração.\nVerifique se o formato JSON é válido.\n\nErro: ${error.message}`);
    }
}


// --- Criação da Janela Principal ---
function createWindow() {
    sendLogToWindow('[SYS] Criando janela principal...');
    mainWindow = new BrowserWindow({ width: 1000, height: 750, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
    mainWindow.loadFile('index.html');
    // mainWindow.webContents.openDevTools(); // Para debug
    mainWindow.on('closed', () => { mainWindow = null; });

    mainWindow.webContents.on('did-finish-load', () => {
        sendLogToWindow('[SYS] Conteúdo da janela carregado.');
        // Carrega a configuração ANTES de verificar atualizações
         loadConfig().then(() => {
             // Verifica atualizações APÓS carregar UI e config
            setTimeout(() => {
                 sendLogToWindow('[Updater] Verificando por atualizações...');
                 updateAppStatus('Verificando atualizações...');
                 autoUpdater.checkForUpdatesAndNotify().catch(err => {
                     sendLogToWindow(`[Updater ERRO] Falha ao verificar/notificar atualizações: ${err.message}`);
                     updateAppStatus('Falha ao verificar atualizações.');
                 });
            }, 3000); // Delay menor agora que loadConfig é async
        });
    });
}

// --- Lógica do WhatsApp (com loadConfig e saveConfig) ---
async function destroyWhatsAppClient() { /* ... código igual ao anterior ... */
    if (client) {
        sendLogToWindow('[WA] Tentando destruir cliente WhatsApp existente...');
        try { await client.destroy(); sendLogToWindow('[WA] Cliente WhatsApp destruído.'); }
        catch (err) { sendLogToWindow('[WA ERRO] Falha ao destruir: ' + err.message); }
        finally { client = null; }
    }
}
async function initializeWhatsApp() { /* ... código igual ao anterior ... */
    await destroyWhatsAppClient();
    initializeWhatsAppInternal();
}
function initializeWhatsAppInternal() { /* ... código quase igual, apenas a parte authStrategy foi mostrada antes ... */
    sendLogToWindow('[WA] Inicializando cliente WhatsApp...');
    updateAppStatus('Inicializando conexão WhatsApp...');
    client = new Client({
        authStrategy: new LocalAuth({ dataPath: path.join(app.getPath('userData'), 'WhatsAppSession') }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas', '--no-first-run', '--no-zygote', '--disable-gpu' ], }
    });

    // --- Listeners do Cliente WA (qr, ready, authenticated, etc.) ---
    // (Estes listeners são os mesmos do main.js anterior)
    client.on('qr', (qr) => { /* ... código anterior ... */
        sendLogToWindow('[WA] QR Code recebido.'); updateAppStatus('QR Code Pronto - Escaneie no seu celular');
        qrcode.toDataURL(qr, (err, url) => {
            if (err) { sendLogToWindow('[WA ERRO] QR Conv: '+err.message); updateAppStatus('Erro QR'); return; }
            if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('display-qr', url); }
            else { sendLogToWindow('[WA AVISO] Janela indisponível p/ QR.'); }
        });
    });
    client.on('ready', () => { /* ... código anterior ... */
        sendLogToWindow('[WA] Cliente WhatsApp pronto!'); updateAppStatus('Conectado!');
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('clear-qr'); }
        initializeMessageListener();
    });
    client.on('authenticated', () => { sendLogToWindow('[WA] Autenticado.'); updateAppStatus('Autenticado'); });
    client.on('auth_failure', (msg) => { /* ... código anterior ... */
        sendLogToWindow(`[WA ERRO] Auth Falha: ${msg}`); updateAppStatus('Falha Autenticação');
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('clear-qr'); }
        destroyWhatsAppClient(); // Destroi cliente em falha de auth
    });
    client.on('disconnected', (reason) => { /* ... código anterior ... */
        sendLogToWindow(`[WA] Desconectado: ${reason}`); updateAppStatus('Desconectado');
        if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.webContents.send('clear-qr'); }
        client = null;
    });
     client.on('loading_screen', (percent, message) => { sendLogToWindow(`[WA] Carregando: ${percent}% - ${message}`); updateAppStatus(`Carregando WA: ${percent}%`); });


    // --- Inicialização ---
    sendLogToWindow('[WA] Iniciando conexão do cliente...');
    client.initialize().catch(err => { /* ... código anterior, tratando EPERM e outros erros ... */
        const userDataPath = app.getPath('userData');
        if(err.code === 'EPERM') { sendLogToWindow(`[WA ERRO FATAL] Permissão negada em ${userDataPath}: ${err.message}`); updateAppStatus(`Erro de Permissão`); dialog.showErrorBox('Erro de Permissão', `Permissão negada para escrever em ${userDataPath}.\nVerifique permissões ou antivirus.`); }
        else { sendLogToWindow(`[WA ERRO FATAL] Inicialização: ${err.message}`); updateAppStatus('Erro Inicialização'); dialog.showErrorBox('Erro na Inicialização', `Erro ao iniciar WhatsApp: ${err.message}`); }
        client = null;
    });
}

// --- Listener de Mensagens (USANDO botConfig) ---
function initializeMessageListener() {
    if (!client) { sendLogToWindow('[WA AVISO] Tentativa listener s/ cliente.'); return; }

    // Log de mensagens enviadas (debug)
     client.on('message_create', message => { if (message.fromMe) { sendLogToWindow(`[WA Msg Enviada] Para: ${message.to} | Msg: ${message.body.substring(0,50)}...`); } });

    // Processamento de mensagens recebidas
    client.on('message', async msg => {
        if (msg.fromMe) return; // Ignora mensagens do próprio bot

        const sender = msg.from;
        const messageBody = msg.body;
        sendLogToWindow(`[WA Msg Recebida] De: ${sender} | Msg: ${messageBody.substring(0, 50)}...`);

        // **** LÓGICA DE RESPOSTA BASEADA NA CONFIGURAÇÃO ****
        try {
            // Verifica se a mensagem *exata* é uma chave na configuração
            if (botConfig && typeof botConfig === 'object' && botConfig[messageBody]) {
                const replyText = botConfig[messageBody];
                await msg.reply(replyText);
                sendLogToWindow(`[Bot Resposta] De: ${messageBody} | Para: ${replyText} (Destino: ${sender})`);
            } else {
                // Mensagem não encontrada na configuração, fazer outra coisa? Logar? Ignorar?
                 // Ex: logar que não houve resposta configurada
                 // sendLogToWindow(`[Bot Info] Nenhuma resposta configurada para: ${messageBody.substring(0, 30)}...`);
            }
        } catch (error) {
            sendLogToWindow(`[Bot ERRO] Falha ao processar/responder msg de ${sender}: ${error.message}`);
        }
        // **** FIM DA LÓGICA DE RESPOSTA ****
    });
    sendLogToWindow('[WA] Listener de mensagens ativado.');
}

// --- Handlers do AutoUpdater (iguais ao main.js anterior) ---
autoUpdater.on('checking-for-update', () => { sendLogToWindow('[Updater] Verificando...'); updateAppStatus('Verificando atualizações...'); });
autoUpdater.on('update-available', (info) => { sendLogToWindow(`[Updater] Disponível: v${info.version}`); updateAppStatus(`Atualização encontrada: v${info.version}`); });
autoUpdater.on('update-not-available', (info) => { sendLogToWindow('[Updater] Não disponível.'); updateAppStatus('Você já tem a versão mais recente.'); });
autoUpdater.on('error', (err) => { sendLogToWindow(`[Updater ERRO] ${err.message}`); updateAppStatus('Erro no atualizador.'); });
autoUpdater.on('download-progress', (p) => { updateAppStatus(`Baixando atualização: ${p.percent.toFixed(0)}%`); sendLogToWindow(`[Updater] Baixando: ${p.percent.toFixed(2)}% (${(p.bytesPerSecond / 1024).toFixed(2)} KB/s)`); });
autoUpdater.on('update-downloaded', (info) => { sendLogToWindow(`[Updater] Baixada: v${info.version}`); updateAppStatus('Atualização pronta!'); ipcMain.emit('show-update-restart-dialog'); });

// --- Handlers IPC (Adicionados 'save-config' e 'load-config-request') ---
ipcMain.on('start-bot', initializeWhatsApp); // Atalho

ipcMain.on('check-for-update-request', () => { /* ... código anterior para check manual ... */
    sendLogToWindow('[IPC] Comando "check-for-update-request" recebido.');
    autoUpdater.checkForUpdates()
    .catch(err => { sendLogToWindow(`[Updater ERRO] Manual Check: ${err.message}`); updateAppStatus('Erro check att.'); });
});

ipcMain.on('load-config-request', (event) => {
    sendLogToWindow('[IPC] Comando "load-config-request" recebido.');
    // Reenvia a configuração já carregada (ou recarrega se quiser forçar)
     event.reply('config-loaded', botConfig);
});

ipcMain.on('save-config', (event, configString) => {
    sendLogToWindow('[IPC] Comando "save-config" recebido.');
    saveConfig(configString); // Chama a função para salvar no disco e memória
});


ipcMain.on('show-update-restart-dialog', async (event) => { /* ... código do diálogo igual ao anterior ... */
    sendLogToWindow('[Updater] Solicitando reinício.');
    if (!mainWindow || mainWindow.isDestroyed()) { sendLogToWindow('[Updater AVISO] Janela não existe p/ diálogo.'); return; }
    try {
        const { response } = await dialog.showMessageBox(mainWindow, { type: 'info', title: 'Atualização Pronta', message: 'Nova versão baixada. Reiniciar e instalar agora?', buttons: ['Reiniciar Agora', 'Mais Tarde'], defaultId: 0, cancelId: 1 });
        if (response === 0) { sendLogToWindow("[Updater] Usuário aceitou. Reiniciando..."); await destroyWhatsAppClient(); autoUpdater.quitAndInstall(); }
        else { sendLogToWindow("[Updater] Usuário adiou."); updateAppStatus('Att será instalada ao sair.'); }
    } catch(error) { sendLogToWindow(`[Updater ERRO] Diálogo: ${error.message}`); }
});


// --- Ciclo de Vida App (Com loadConfig no início) ---
app.whenReady().then(() => {
    sendLogToWindow('=============== [SYS] Aplicação Iniciada ===============');
     // Carrega a config ANTES de criar a janela, para já estar disponível
    loadConfig().finally(() => {
         createWindow(); // Cria janela após carregar config (ou falhar)
        app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
     });
});

app.on('window-all-closed', async () => { /* ... código anterior para fechar WA e app ... */
    sendLogToWindow('[SYS] Todas janelas fechadas.'); await destroyWhatsAppClient();
    if (process.platform !== 'darwin') { sendLogToWindow('[SYS] Encerrando.'); app.quit(); }
    else { sendLogToWindow('[SYS] App ativo (macOS).'); }
});
app.on('before-quit', async () => { /* ... código anterior para limpar antes de sair ... */
    sendLogToWindow('[SYS] Evento before-quit.'); await destroyWhatsAppClient(); sendLogToWindow('[SYS] Limpeza concluída.');
});


// --- Tratamento de Erros (igual anterior) ---
process.on('uncaughtException', (error, origin) => { /* ... código anterior ... */ log.error('!!!!!!!!!!!!!! UNC EXCEPTION !!!!!!!!!!!!!!', error, origin); sendLogToWindow(`[ERR CRIT] ${error.message}`); if(mainWindow && !mainWindow.isDestroyed()) dialog.showErrorBox('Erro Crítico', `Erro:\n${error.message}\n\nRecomendamos fechar e reabrir.`);});
process.on('unhandledRejection', (reason, promise) => { /* ... código anterior ... */ log.error('!!!!!!!!!!!!!! UNH REJECTION !!!!!!!!!!!!!!', reason); sendLogToWindow(`[ERR ASYNC] ${reason}`);});

sendLogToWindow('[SYS] main.js carregado.');