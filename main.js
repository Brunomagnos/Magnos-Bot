// ./main.js (VERSÃO MELHORADA E MAIS COMPLETA - CORRIGIDA DEFINITIVAMENTE)

const { app, BrowserWindow, ipcMain, shell, dialog, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs-extra'); // Usar fs-extra para facilidade
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode'); // Importa qrcode

// --- Configuração de Log ---
const logsPath = path.join(app.getPath('userData'), 'logs');
try {
    fs.ensureDirSync(logsPath);
    log.transports.file.resolvePathFn = () => path.join(logsPath, 'main.log');
} catch (err) {
    console.error("Erro ao configurar diretório de log:", err);
    log.transports.file.resolvePathFn = () => path.join(__dirname, 'logs', 'main.log'); // Fallback
}
const isDev = process.env.NODE_ENV === 'development';
log.transports.file.level = 'info';
log.transports.console.level = isDev ? 'debug' : 'info';
Object.assign(console, log.functions);

log.info('=============================================================');
log.info(`====              INICIANDO MagnosBot v${app.getVersion()}             ====`);
log.info('=============================================================');
log.info(`Diretório UserData: ${app.getPath('userData')}`);
log.info(`Modo: ${isDev ? 'Desenvolvimento' : 'Produção'}`);
log.info(`Electron v${process.versions.electron}, Chrome v${process.versions.chrome}, Node v${process.versions.node}`);

// --- Configuração do AutoUpdater ---
autoUpdater.logger = log;
autoUpdater.autoDownload = false;

// --- Singleton Instance Lock ---
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    log.warn('Aplicação já está em execução. Encerrando.');
    app.quit();
} else {
    log.info('>>> Lock de Instância Única OK <<<');
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        log.info('Tentativa de abrir segunda instância.');
        const win = mainWindow || loginWindow;
        if (win && !win.isDestroyed()) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    // --- Variáveis Globais ---
    let loginWindow = null;
    let mainWindow = null;
    let client = null;
    let currentStatus = 'disconnected';
    let currentStatusDetails = '';
    let rules = [];
    let isPaused = false;
    let qrCodeDataUrl = null;
    let isAuthenticated = false;
    let isUpdating = false;
    const rulesFilePath = path.join(app.getPath('userData'), 'rules.json');
    const sessionPath = path.join(app.getPath('userData'), 'wwebjs_auth');

    // --- Credenciais ---
    const VALID_USERNAME = process.env.APP_USERNAME || "admin";
    const VALID_PASSWORD = process.env.APP_PASSWORD || "senha123";
    log.info(`Credenciais configuradas para usuário: ${VALID_USERNAME}`);

    // --- Funções Auxiliares ---
    function sendToRenderer(channel, ...args) {
        const targetWindow = mainWindow || loginWindow;
        if (targetWindow && !targetWindow.isDestroyed() && targetWindow.webContents && !targetWindow.webContents.isDestroyed()) {
            try { targetWindow.webContents.send(channel, ...args); }
            catch (error) { log.error(`Erro envio IPC (${channel}): ${error.message}`); }
        }
    }

    function updateAppStatus(newStatus, details = '') {
        if (currentStatus === newStatus && currentStatusDetails === details) return;
        log.info(`Status: ${currentStatus} -> ${newStatus}${details ? ` (${details})` : ''}`);
        currentStatus = newStatus; currentStatusDetails = details;
        isPaused = currentStatus === 'paused';
        isUpdating = currentStatus === 'updating'; // Atualiza flag se status for 'updating'
        sendToRenderer('update-status', currentStatus, currentStatusDetails);
        updateMenu();
    }

    async function loadRules() {
        try {
            if (await fs.pathExists(rulesFilePath)) {
                const rulesData = await fs.readJson(rulesFilePath);
                rules = Array.isArray(rulesData) ? rulesData.filter(r => r && Array.isArray(r.triggers)) : [];
                if (!Array.isArray(rulesData)) await saveRules(); // Corrige arquivo se inválido
            } else rules = [];
            log.info(`Regras carregadas (${rules.length}) de ${rulesFilePath}`);
        } catch (error) {
            log.error(`Erro ao carregar/ler regras: ${error.message}`); rules = [];
            sendToRenderer('log-message', `Erro crítico ao ler regras: ${error.message}`, 'error');
        }
        sendToRenderer('rules-loaded', [...rules]); // Envia cópia
    }

    async function saveRules() {
        try { await fs.writeJson(rulesFilePath, rules, { spaces: 2 }); log.info(`Regras salvas (${rules.length})`); return true; }
        catch (error) { log.error(`Erro ao salvar regras: ${error.message}`); sendToRenderer('log-message', `Erro ao salvar regras: ${error.message}`, 'error'); return false; }
    }

    function findMatchingRule(messageText) {
        if (!messageText || !Array.isArray(rules) || rules.length === 0) return null;
        const lowerMsg = messageText.toLowerCase().trim();
        if (!lowerMsg) return null;
        for (const rule of rules) {
            if (Array.isArray(rule.triggers) && rule.triggers.length > 0) {
                for (const trigger of rule.triggers) {
                    const lowerTrig = typeof trigger === 'string' ? trigger.toLowerCase().trim() : null;
                    if (lowerTrig && lowerMsg.includes(lowerTrig)) { log.debug(`Regra encontrada por gatilho: "${trigger}"`); return rule; }
                }
            }
            // Lógica opcional regra sem gatilho removida
        } return null;
    }

    async function clearSessionData() {
        log.warn("===== INICIANDO LIMPEZA DE SESSÃO =====");
        if (client) await destroyWhatsAppClient(); // Garante destruição
        try {
            log.info(`Removendo ${sessionPath}`); await fs.remove(sessionPath); log.info("Pasta WA removida.");
            if (session.defaultSession) { log.info("Limpando sessão Electron..."); await session.defaultSession.clearStorageData(); log.info("Sessão Electron limpa."); }
        } catch (error) { log.error(`Erro limpeza de sessão/dirs: ${error.message}`); updateAppStatus('error', `Falha limpeza: ${error.message}`); }
        finally {
            updateAppStatus('disconnected', 'Sessão limpa.'); sendToRenderer('log-message', 'Sessão limpa. Escaneie QR novamente.', 'success');
            isAuthenticated = false; updateMenu();
            if(mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
            if(!loginWindow || loginWindow.isDestroyed()) createLoginWindow();
        }
    }

    // --- Criação Janelas ---
    const commonWebPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, devTools: isDev, spellcheck: false, webSecurity: true, allowRunningInsecureContent: false };

    function createLoginWindow() {
        log.info('Criando/Focando janela Login...');
        if (loginWindow && !loginWindow.isDestroyed()) { if (loginWindow.isMinimized()) loginWindow.restore(); loginWindow.focus(); return; }
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close(); // Fecha principal se existir

        loginWindow = new BrowserWindow({ width: 500, height: 480, resizable: false, maximizable: false, fullscreenable: false, show: false, center: true, title: "Login - MagnosBot", webPreferences: commonWebPreferences });
        loginWindow.setMenu(null);
        loginWindow.loadFile(path.join(__dirname, 'login.html'))
            .then(() => { log.info("login.html carregado."); loginWindow.show(); if (isDev) loginWindow.webContents.openDevTools({ mode: 'detach' }); })
            .catch(err => { log.error('Erro load login.html:', err); dialog.showErrorBox('Erro Crítico', `Não carrego login:\n ${err.message}`); app.quit(); });
        loginWindow.on('closed', () => { log.info('Janela Login fechada.'); loginWindow = null; if (!isAuthenticated && !app.isQuitting) { log.info("Saindo: Login fechado sem auth."); app.quit(); }});
    }

    function createMainWindow() {
        log.info('Criando/Focando janela Principal...');
        if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); return; }
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();

        mainWindow = new BrowserWindow({ width: 1200, height: 800, minWidth: 940, minHeight: 600, show: false, title: "MagnosBot - Assistente WhatsApp", icon: path.join(__dirname, (process.platform === 'win32' ? 'build/icon.ico' : 'build/icon.png')), webPreferences: commonWebPreferences });
        setupMenu(); // Menu antes de carregar

        mainWindow.loadFile(path.join(__dirname, 'index.html'))
            .then(() => {
                log.info("index.html carregado."); mainWindow.show(); if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
                loadRules().then(() => { // Envia estado inicial pós loadRules
                    sendToRenderer('update-status', currentStatus, currentStatusDetails);
                    sendToRenderer('pause-state-changed', isPaused);
                    if (currentStatus === 'scanning' && qrCodeDataUrl) sendToRenderer('display-qr', qrCodeDataUrl);
                    else if (isBotConnected) sendToRenderer('clear-qr');
                });
            })
            .catch(err => {
                log.error('Erro load index.html:', err); dialog.showErrorBox('Erro Interface', `Não carrego principal:\n ${err.message}`);
                isAuthenticated = false; if(mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy(); mainWindow = null; createLoginWindow(); // Volta pro login
            });

        mainWindow.webContents.setWindowOpenHandler(({ url }) => { if (url?.startsWith('http')) { shell.openExternal(url); return { action: 'deny' }; } return { action: 'deny' }; });
        mainWindow.on('closed', () => { log.info('Janela Principal fechada.'); mainWindow = null; if (process.platform !== 'darwin') { log.info("Saindo..."); app.quit(); }});
    }

    // --- Cliente WhatsApp ---
    async function initializeWhatsAppClient() {
        if (client || currentStatus === 'initializing' || currentStatus === 'connecting') { log.warn(`Ignorado: Init já em progresso ou cliente ativo (${currentStatus}).`); sendToRenderer('update-status', currentStatus, currentStatusDetails); return; }
        log.info("===== INICIALIZANDO CLIENTE WHATSAPP =====");
        updateAppStatus('initializing', 'Configurando...'); qrCodeDataUrl = null; isPaused = false;

        const clientOptions = {
             authStrategy: new LocalAuth({ dataPath: sessionPath }),
             puppeteer: { headless: true, args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage','--unhandled-rejections=strict','--disable-extensions','--disable-component-extensions-with-background-pages','--window-size=800,600'], handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
             webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' },
        };
        log.info('Opções Cliente WA:', JSON.stringify({...clientOptions, authStrategy:'LocalAuth', puppeteer: {...clientOptions.puppeteer, executablePath: clientOptions.puppeteer.executablePath ||'(default)'}}, null, 2));

        try {
            client = new Client(clientOptions);
            setupClientEventListeners();
            updateAppStatus('connecting', 'Inicializando conexão...');
            await client.initialize();
            log.info("client.initialize() OK. Aguardando eventos...");
        } catch (err) { log.error('!!!! FALHA CRÍTICA INIT CLIENT !!!!', err); updateAppStatus('error', `Erro init: ${err.message}.`); if(client){try{await client.destroy();}catch(_){}} client=null; }
    }

    function setupClientEventListeners() {
        if (!client) { log.error("No client to attach listeners to."); return; }
        log.info("Configurando listeners cliente WA...");
        client.removeAllListeners();

        client.on('qr', async (qr) => {
            log.info('Evento QR recebido...'); updateAppStatus('scanning', 'Escaneie o QR Code');
            try { qrCodeDataUrl = await qrcode.toDataURL(qr, { errorCorrectionLevel: 'L', margin: 2 }); sendToRenderer('display-qr', qrCodeDataUrl); }
            catch (err) { log.error("Erro gerar QR URL:", err); updateAppStatus('error', `Falha QR: ${err.message}`); qrCodeDataUrl=null; sendToRenderer('clear-qr'); }
        });
        client.on('ready', () => { const u = client.info?.pushname || client.info?.wid?.user||'?'; log.info(`<<<< CLIENT READY! (${u}) >>>>`); qrCodeDataUrl=null; sendToRenderer('clear-qr'); updateAppStatus('connected', `Conectado: ${u}`); sendToRenderer('pause-state-changed', isPaused); });
        client.on('authenticated', () => { log.info('Autenticado! Aguardando ready...'); qrCodeDataUrl=null; sendToRenderer('clear-qr'); updateAppStatus('connecting', 'Autenticado...'); });
        client.on('auth_failure', (msg) => { log.error('FALHA Auth:', msg); qrCodeDataUrl=null; sendToRenderer('clear-qr'); updateAppStatus('error', `Falha Auth: ${msg}. Limpe a sessão.`); });
        client.on('loading_screen', (p, m) => { if(currentStatus === 'connecting') updateAppStatus('connecting', `Carregando WA: ${m} (${p}%)`); });
        client.on('message', handleIncomingMessage);
        client.on('message_create', (m) => { if(m?.fromMe) handleOutgoingMessage(m); });
        client.on('disconnected', (reason) => { log.warn(`Cliente WA Desconectado. Razão: ${reason}`); qrCodeDataUrl=null; const wc = (currentStatus==='connected'||currentStatus==='paused'); let d=`Desconectado(${reason}).`; updateAppStatus(wc ? 'error' : 'disconnected', d); if(client){const c=client;client=null; c.destroy().catch(e=>log.error(e.message)); } isPaused=false; sendToRenderer('pause-state-changed', isPaused); sendToRenderer('clear-qr'); });
            client.on('state_changed', (state) => {
        log.info(`WA State Changed: ${state}`);
        if (state === 'CONFLICT') {
            updateAppStatus('error', 'Conflito! WA aberto em outro local?');
            if(client) { const c=client; client=null; c.destroy().catch(e=>log.error(e.message)); }
        } else if (state === 'UNPAIRED' && currentStatus !== 'disconnected') {
             updateAppStatus('error', `Sessão inválida(${state})? Limpe.`); // Corrigido 'Sessão inválida'
        } else if (state === 'CONNECTED' && currentStatus !== 'connected' && currentStatus !== 'paused') { // Corrigido '&& currentStatus !== ...'
            log.info("Estado interno 'CONNECTED', forçando status UI para 'connected' se necessário."); // Log adicional para clareza
            updateAppStatus('connected'); // Força o status
        }
    });
    }

    async function handleIncomingMessage(message) {
        if (!message || !message.from || typeof message.body === 'undefined' || message.fromMe || !message.from.endsWith('@c.us') || message.isStatus) return;
        if (isPaused || currentStatus !== 'connected') { /*log.info(`Ignorando msg (${currentStatus}/${isPaused})`);*/ return; }

        const from = message.from; const body = message.body || ""; const ts = message.timestamp; let chat; let senderName = from.replace('@c.us',''); let isGroup=false;
        try { chat = await message.getChat(); if(chat){isGroup=chat.isGroup; const contact = await message.getContact(); senderName = contact?.pushname||contact?.name||senderName;} } catch(e){ log.error(`Erro getChat/Contact msg ${from}: ${e.message}`);}
        if (isGroup) return; // Ignora grupos

        log.info(`[MSG In < ${senderName}]: "${body.substring(0,50)}..."`); sendToRenderer('log-message', `[${senderName}]: ${body}`, 'info');
        try {
            const rule = findMatchingRule(body);
            if(rule){
                log.info(`Regra [${rule.triggers?.join(',')}] p/ ${senderName}`); if(chat) try{await chat.sendSeen();}catch(_){}
                if (rule.response) await sendMessageSafely(client, from, rule.response, "Resposta Auto");
                if (rule.isLeadQualifier && rule.forwardTo) { let fb=`*Lead:* ${senderName} (${from.replace('@c.us','')})\n*Msg:* ${body}`; if(rule.forwardMessagePrefix) fb=`_${rule.forwardMessagePrefix}_\n${fb}`; await sendMessageSafely(client, rule.forwardTo, fb, "Lead Fwd"); sendToRenderer('log-message', `Lead ${senderName} -> ${rule.forwardTo}`, 'success');}
            }
        } catch(err) { log.error(`Erro proc msg ${from}:`, err); sendToRenderer('log-message',`ERRO proc msg ${senderName}: ${err.message}`,'error');}
    }

    async function handleOutgoingMessage(message) {
        if(!message?.to || !message.fromMe) return; const to = message.to; let name=to.replace('@c.us',''); try{ const contact=await client?.getContactById(to); name=contact?.pushname||contact?.name||name;} catch(_){}
        const body = message.body||""; const short = body.substring(0,60).replace(/\n/g,' ')+(body.length>60?'...':''); log.info(`[MSG Out > ${name}]: "${short}"`);
        const isLeadFwd = rules.some(r => r.isLeadQualifier && r.forwardTo === to && body.includes('*Lead:*'));
        if(!isLeadFwd) sendToRenderer('log-message', `[Enviado p/ ${name}]: ${body}`, 'success');
    }

    async function sendMessageSafely(waClient, recipient, message, logContext="Msg") {
        if(!waClient||!recipient||!message) return false; log.info(`Enviando ${logContext} p/ ${recipient}...`);
        try{ await waClient.sendMessage(recipient, message); return true; }
        catch(err){ log.error(`ERRO envio ${logContext} p/ ${recipient}:`,err); sendToRenderer('log-message', `ERRO envio p/ ${recipient}: ${err.message}`,'error'); return false;}
    }

    async function destroyWhatsAppClient() {
        if (!client) { if (currentStatus !== 'disconnected') { log.info("Cliente já nulo, garantindo status desconectado."); updateAppStatus('disconnected'); isPaused=false; } return; }
        log.warn("Iniciando destruição cliente WA..."); updateAppStatus('disconnected', 'Desconectando...');
        const c=client; client=null; // Remove ref global
        try{ await c.destroy(); log.info("Cliente WA destruído."); }
        catch(e){ log.error("Erro ao destruir cliente WA:",e.message); }
        finally{ if(currentStatus !== 'disconnected') updateAppStatus('disconnected', 'Desconectado.'); isPaused=false; sendToRenderer('pause-state-changed',isPaused); sendToRenderer('clear-qr'); log.info("Destruição cliente finalizada."); }
    }

    // --- Handlers IPC ---
    ipcMain.on('login-attempt', (event, { username, password }) => {
        log.info(`IPC 'login-attempt' User: ${username}`);
        if (username === VALID_USERNAME && password === VALID_PASSWORD) { log.info('Login OK!'); isAuthenticated=true; updateMenu(); sendToRenderer('log-message','Login OK!','success'); createMainWindow(); }
        else { log.warn(`Login FALHOU: ${username}`); isAuthenticated=false; updateMenu(); setTimeout(() => sendToRenderer('login-failed','Usuário/senha inválido.'), 600); }
    });
    ipcMain.on('get-initial-state', (event) => { const w=BrowserWindow.fromWebContents(event.sender); if(w&&!w.isDestroyed()){ log.debug(`Enviando estado(${currentStatus})/regras(${rules.length}) p/Win${w.id}`); w.webContents.send('update-status',currentStatus,currentStatusDetails); w.webContents.send('pause-state-changed',isPaused); w.webContents.send('rules-loaded',[...rules]); if(currentStatus==='scanning'&&qrCodeDataUrl) w.webContents.send('display-qr',qrCodeDataUrl); } });
    ipcMain.on('start-bot', async () => { if (!isAuthenticated) return denyUnauthenticatedAccess('iniciar'); await initializeWhatsAppClient(); });
    ipcMain.on('stop-bot', async () => { if (!isAuthenticated) return denyUnauthenticatedAccess('parar'); await destroyWhatsAppClient(); });
    ipcMain.on('toggle-pause-bot', () => { if (!isAuthenticated) return denyUnauthenticatedAccess('pausar'); if (currentStatus !== 'connected' && currentStatus !== 'paused') return sendToRenderer('log-message','Só pausa/continua conectado.','warn'); isPaused=!isPaused; updateAppStatus(isPaused?'paused':'connected',`Trocado usuário`); sendToRenderer('pause-state-changed',isPaused); sendToRenderer('log-message', `Bot ${isPaused?'pausado':'retomado'}.`, 'info'); });
    ipcMain.on('clear-session-request', async () => { if (!isAuthenticated) return denyUnauthenticatedAccess('limpar'); if (client) return sendToRenderer('log-message','Pare o bot antes.','warn'); await clearSessionData(); updateMenu(); });
    ipcMain.on('load-rules-request', async () => { if (!isAuthenticated) return denyUnauthenticatedAccess('regras'); await loadRules(); });
    ipcMain.on('save-rule', async (event, { index, rule }) => { if (!isAuthenticated) return denyUnauthenticatedAccess('salvar regra'); await handleSaveRule(index, rule); });
    ipcMain.on('delete-rule', async (event, index) => { if (!isAuthenticated) return denyUnauthenticatedAccess('excluir regra'); await handleDeleteRule(index); });
    ipcMain.on('check-for-update-request', () => { if(isDev){log.warn('Ignorando check update DEV.'); setTimeout(()=>{sendToRenderer('update-not-available',{version:app.getVersion()}); sendToRenderer('update-download-progress',-1);},1000); return;} if(isUpdating){log.warn("Updater já ativo."); return;} log.info("Verificando updates..."); isUpdating=true; updateMenu(); autoUpdater.checkForUpdates().catch(err=>{log.error(err); sendToRenderer('update-error',`Falha check: ${err.message}`); isUpdating=false; updateMenu();}); });
    ipcMain.on('quit-and-install-update', () => { log.warn("AUTORIZANDO REINICIO P/ UPDATE"); app.isQuitting = true; setImmediate(() => { try{autoUpdater.quitAndInstall(true,true);}catch(e){log.error(e); app.quit();} }); });
    ipcMain.on('renderer-log', (event, {level, message}) => { (log[level]||log.info)(`[Renderer] ${message}`); });
    ipcMain.on('preload-error', (event, errorMessage) => { log.fatal(`ERRO PRELOAD:\n${errorMessage}`); dialog.showErrorBox("Erro Interface",`Erro interno(${errorMessage}).`); });

    async function handleSaveRule(index, rule) {
        let success = false; let message = '';
        try { const clean = sanitizeRule(rule); if(!clean.isValid) throw new Error(clean.error||"Regra inválida."); if(typeof index!=='number') throw new Error("Índice inválido.");
            if (index === -1) { if(rules.length>=1000) throw new Error("Limite regras."); rules.push(clean.data); message = 'Nova regra adicionada!'; }
            else if (index >= 0 && index < rules.length) { rules[index] = clean.data; message = `Regra ${index+1} atualizada!`; }
            else throw new Error(`Índice(${index}) fora do intervalo.`);
            success = await saveRules(); if (!success) message += ' (Falha ao salvar!)';
        } catch (error) { success=false; message = `Erro: ${error.message}`; log.error(message, rule); }
        sendToRenderer('rule-save-status', { success, message, updatedRules: [...rules] });
    }
    async function handleDeleteRule(index) {
        let success=false; let message='';
        try { if (typeof index!=='number'||index<0||index>=rules.length) throw new Error(`Índice(${index})inválido.`); const deleted=rules.splice(index, 1)[0]; log.info(`Regra ${index+1} removida memória.`); success=await saveRules();
            if(success) message = `Regra excluída.`; else { message = 'Falha ao salvar exclusão!'; rules.splice(index, 0, deleted); success=false; } // Restaura
        } catch(error){ success=false; message=`Erro excluir: ${error.message}`; log.error(message); }
        sendToRenderer('rule-delete-status', { success, message, updatedRules: [...rules] });
    }
    function sanitizeRule(r) { if(!r||typeof r!=='object') return{isValid:false,error:"Dados inválidos."}; let tr=(Array.isArray(r.triggers)?r.triggers:[]).map(t=>typeof t==='string'?t.trim():'').filter(t=>t); let rsp=(typeof r.response==='string'?r.response.trim():'')||null; let iL=!!r.isLeadQualifier; let fTo=(iL&&typeof r.forwardTo==='string')?r.forwardTo.trim().toLowerCase():null; let pfx=(iL&&fTo&&typeof r.forwardMessagePrefix==='string')?r.forwardMessagePrefix.trim():null; if(pfx==='') pfx=null;
        if(tr.length===0&&!iL) return{isValid:false,error:"Precisa gatilhos se não for lead."}; if(!rsp&&!fTo) return{isValid:false,error:"Precisa resposta OU fwd."}; if(iL&&(!fTo||!/^\+?\d{10,15}@c\.us$/.test(fTo))) return{isValid:false,error:"Número fwd inválido."}; return { isValid: true, data: { triggers:tr, response:rsp, isLeadQualifier:iL, forwardTo:fTo, forwardMessagePrefix:pfx } }; }
    function denyUnauthenticatedAccess(action) { log.error(`NEGADO: ${action}-Não auth.`); sendToRenderer('log-message','Acesso negado.','error'); if(mainWindow) mainWindow.close(); if(!loginWindow||loginWindow.isDestroyed()) createLoginWindow(); else loginWindow.focus(); return true; }


    // -------------------------------------------------------------
    // ---  FUNÇÃO escapeHtml DEFINITIVA E CORRETA ---
    // -------------------------------------------------------------
    /** Função auxiliar para escapar HTML antes de exibir na UI (Prevenir XSS) */
function escapeHtml(unsafe) {
    // Retorna o valor original se não for uma string válida
    if (typeof unsafe !== 'string' || unsafe === null || unsafe === '') return unsafe;
    // Executa as substituições das entidades HTML
    return unsafe
         .replace(/&/g, "&")   // & para & (DEVE ser o primeiro)
         .replace(/</g, "<")    // < para <
         .replace(/>/g, ">")    // > para >
         .replace(/"/g, "") // " para " (LINHA IMPORTANTE)
         .replace(/'/g, "'"); // ' para '
}
    // -------------------------------------------------------------
    // --- FIM da função escapeHtml ---
    // -------------------------------------------------------------


    // --- Auto Updater Event Handlers ---
    autoUpdater.on('checking-for-update', () => { log.info('[Updater] Verificando...'); sendToRenderer('log-message', 'Verificando atualizações...', 'info'); isUpdating=true; updateMenu();});
    autoUpdater.on('update-available', (info) => { log.warn(`[Updater] Update v${info.version} encontrado.`); isUpdating=false; updateMenu(); sendToRenderer('update-available', info); dialog.showMessageBox({ type:'info',title:'Update Disponível',message:`Versão ${info.version} disponível!`, detail:`Notas: ${info.releaseNotes||'-'}\n\nBaixar agora?`, buttons:['Sim','Não'], defaultId:0, cancelId:1 }).then(({response})=>{ if(response===0){ log.info('User aceitou download.'); sendToRenderer('log-message','Iniciando download...','info'); autoUpdater.downloadUpdate().catch(e=>{log.error('Erro download:',e); sendToRenderer('update-error',`Erro download: ${e.message}`); isUpdating=false;updateMenu();});} else log.info('User adiou download.');}).catch(e=>log.error(e)); });
    autoUpdater.on('update-not-available', (info) => { log.info('[Updater] Sem updates.'); isUpdating=false; updateMenu(); sendToRenderer('update-not-available', info); sendToRenderer('log-message','Versão atualizada.','info'); sendToRenderer('update-download-progress',-1); });
    autoUpdater.on('error', (err) => { log.error('[Updater] Erro:',err.message||err); isUpdating=false; updateMenu(); sendToRenderer('update-error',`Erro Updater: ${err.message||err}`); sendToRenderer('update-download-progress',-1); });
    autoUpdater.on('download-progress', (p) => { if(!isUpdating){ isUpdating=true; updateMenu(); } sendToRenderer('update-download-progress', p.percent||0); });
    autoUpdater.on('update-downloaded', (info) => { log.warn(`[Updater] Update v${info.version} BAIXADO!`); isUpdating=false; updateMenu(); /* isUpdateDownloaded=true no renderer */ sendToRenderer('update-downloaded', info); sendToRenderer('log-message','Update pronto! Reinicie para instalar.','success'); dialog.showMessageBox({ type:'info',title:'Update Pronto',message:`Versão ${info.version} baixada!`, detail:'Reiniciar e instalar agora?', buttons:['Reiniciar','Depois'], defaultId:0, cancelId:1}).then(({response})=>{ if(response===0){log.warn('User aceitou reiniciar.'); app.isQuitting=true; setImmediate(()=>autoUpdater.quitAndInstall(true,true)); } else log.info('User instalará depois.');}).catch(e=>log.error(e)); });

    // --- Menu ---
    let appMenu = null;
    function setupMenu(){ // Use IDs para fácil acesso
        const template = [ { label: 'Arquivo', submenu: [ { id:'clearSession', label:'Limpar Sessão/Cookies', /* enabled setado por updateMenu */ click: async () => { const{response}=await dialog.showMessageBox({type:'warning',title:'Limpar Sessão?',message:'Limpar dados exigirá novo QR Code. Continuar?', buttons:['Sim','Cancelar'],cancelId:1}); if(response===0)await clearSessionData();}}, {type:'separator'}, {id:'checkUpdates', label:'Verificar Updates', /* enabled por updateMenu */ click:()=>ipcMain.emit('check-for-update-request')}, {type:'separator'}, {id:'logout', label:'Deslogar', /* visible por updateMenu */ click:async()=>{await destroyWhatsAppClient();isAuthenticated=false;if(mainWindow)mainWindow.close();createLoginWindow();}}, { role: 'quit', label: `Sair` } ] }, { label: 'Editar', submenu: [ { role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' } ] }, { label: 'Exibir', submenu: [ { role: 'reload' }, { role: 'forceReload' }, { id:'devTools', role: 'toggleDevTools', visible: isDev}, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' } ] }, { label: 'Ajuda', submenu: [ { id:'openLogs', label:'Logs Aplicação', click:()=>{shell.openPath(log.transports.file.getFile().path).catch(e=>log.error(e))} }, { id:'openUserData', label:'Pasta Dados', click:()=>{shell.openPath(app.getPath('userData')).catch(e=>log.error(e))} }, {type:'separator'}, { id: 'about', label: `Sobre ${app.name}`, click: () => dialog.showMessageBox({type:'info',title:`Sobre ${app.name}`,message:`${app.name} v${app.getVersion()}`,detail:`Electron v${process.versions.electron}\nNode v${process.versions.node}\nChromium v${process.versions.chrome}`,buttons:['OK']}) } ] } ];
        if (process.platform === 'darwin') { template.unshift({label:app.name,submenu:[{role:'about',label:`Sobre ${app.name}`},{type:'separator'},{role:'services'},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}); template[1].submenu = template[1].submenu.filter(i=>i.role!=='quit'); template.splice(3,0,{label:'Janela',submenu:[{role:'minimize'},{role:'zoom'},{type:'separator'},{role:'front'},{type:'separator'},{role:'window'}]}); }
        appMenu = Menu.buildFromTemplate(template); Menu.setApplicationMenu(appMenu); log.info("Menu Configurado."); updateMenu();
    }
        function updateMenu() { // Atualiza estado enable/visible dos itens pelo ID
        if (!appMenu) {
            // log.debug("updateMenu: Menu ainda não construído."); // Log opcional
            return; // Sai se o menu ainda não foi criado
        }
        try {
            const clearSessionItem = appMenu.getMenuItemById('clearSession');
            if (clearSessionItem) {
                clearSessionItem.enabled = !client || currentStatus === 'error';
                // log.debug(`updateMenu: clearSession enabled = ${clearSessionItem.enabled}`); // Log debug
            }

            const logoutItem = appMenu.getMenuItemById('logout');
            if (logoutItem) {
                logoutItem.visible = isAuthenticated;
                // log.debug(`updateMenu: logout visible = ${logoutItem.visible}`); // Log debug
            }

            const checkUpdatesItem = appMenu.getMenuItemById('checkUpdates');
            if (checkUpdatesItem) {
                checkUpdatesItem.enabled = !isUpdating; // Desabilita se estiver atualizando
                // log.debug(`updateMenu: checkUpdates enabled = ${checkUpdatesItem.enabled}`); // Log debug
            }

        } catch (err) {
            log.error("Erro crítico ao atualizar estado do menu:", err);
        }
    }

    // --- Ciclo de Vida App ---
    app.whenReady().then(async () => { log.info(`>>> app.whenReady <<<`); if (process.defaultApp && process.argv.length>=2) app.setAsDefaultProtocolClient('magnosbot', process.execPath,[path.resolve(process.argv[1])]); else app.setAsDefaultProtocolClient('magnosbot'); await loadRules(); createLoginWindow(); /* Sempre inicia pelo login */ app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0){if(isAuthenticated)createMainWindow();else createLoginWindow();}else{(mainWindow||loginWindow)?.focus();}}); });
    app.on('before-quit', async (event) => { if (app.isQuitting) return; log.warn(">>> before-quit: Limpeza..."); app.isQuitting=true; event.preventDefault(); await destroyWhatsAppClient(); log.info("Limpeza OK. Saindo..."); app.quit(); });
    app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); else log.info('macOS: App continua ativo.'); });
    app.on('open-url', (event, url) => { log.info(`Protocol URL: ${url}`); /* Tratar URL */ });

    // --- Erros Globais ---
    process.on('uncaughtException', (error, origin) => { log.fatal(`\n!!!!!! UNCAUGHT (${origin}) !!!!!!\n`, error, `\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`); try{dialog.showErrorBox('Erro Crítico',`(${origin}) ${error.message}\nApp será encerrado.`);}catch(_){} app.quit(); });
    process.on('unhandledRejection', (reason, promise) => { log.error('!!!! UNHANDLED REJECTION !!!!', reason); });

    log.info('<<< Config main.js concluída. Aguardando eventos... >>>');

} // Fim do else do Lock