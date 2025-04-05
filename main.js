// ./main.js (VERSÃO FINAL - Completa com Login e Instance Lock)

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron'); // Adicionado 'dialog'
const path = require('path');
const fs = require('fs').promises;
const log = require('electron-log');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

// --- CONFIGURAÇÃO INICIAL ---
// Opcional: Configurar onde os logs são salvos
// log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log');
// log.transports.file.level = 'info';
// log.transports.console.level = 'debug';
// Object.assign(console, log.functions); // Redireciona console.log, etc., para electron-log

log.info('=======================================================');
log.info(`==== Iniciando MagnosBot v${app.getVersion()} ====`);
log.info(`Plataforma: ${process.platform}, Arquitetura: ${process.arch}`);
log.info(`Pasta de Dados: ${app.getPath('userData')}`);
log.info('=======================================================');


// --- GARANTIR INSTÂNCIA ÚNICA ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    log.warn('!!!!! Instância Duplicada Detectada. Encerrando. !!!!!');
    // Informa o usuário (opcional, mas recomendado)
    dialog.showErrorBox(
        'MagnosBot já está rodando',
        'Outra instância do MagnosBot já está aberta. Esta nova instância será fechada.'
      );
    app.quit();
} else {
    // Esta é a instância principal.
    log.info('>>> Bloqueio de instância única adquirido. Instância principal iniciando... <<<');

    // Handler para quando outra instância tenta abrir
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        log.info('Evento second-instance recebido.');
        if (mainWindow) {
            log.info('Janela principal existe. Trazendo para o foco.');
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        } else {
             // Se mainWindow for null, mas app ainda rodando (caso raro, talvez pós-crash?)
             log.warn('Segunda instância detectada, mas mainWindow era null. Tentando recriar.');
             createWindow();
        }
    });

    // --- Variáveis de Estado Globais ---
    let mainWindow = null;
    let client = null; // Instância do whatsapp-web.js
    let botReady = false; // Bot conectado e operacional?
    let isPaused = false; // Bot está pausado para novas mensagens?
    let currentRules = []; // Regras de resposta carregadas
    let isAuthenticated = false; // Usuário logou no *aplicativo*?
    const rulesFilePath = path.join(app.getPath('userData'), 'rules.json');
    const sessionPath = path.join(app.getPath('userData'), '.wwebjs_auth'); // Pasta da sessão WA


    // --- Funções Auxiliares ---

    // Envio seguro para o Renderer
    function sendToRenderer(channel, ...args) {
        if (mainWindow && mainWindow.webContents && !mainWindow.isDestroyed()) {
            log.debug(`=> Renderer [${channel}]${args.length ? ':' : ''}`, args.length ? (typeof args[0] === 'object' ? '<object>' : args[0]) : '');
            mainWindow.webContents.send(channel, ...args);
        } else {
            log.warn(`Ignorado envio para Renderer [${channel}]: Janela principal inválida/destruída.`);
        }
    }

    // Carregar Regras do JSON
    async function loadRules() {
        log.info(`Carregando regras de: ${rulesFilePath}`);
        try {
            await fs.mkdir(path.dirname(rulesFilePath), { recursive: true }); // Garante que a pasta exista
            try {
                 await fs.access(rulesFilePath);
            } catch {
                 log.warn('Arquivo rules.json não encontrado. Criando arquivo vazio [].');
                 await fs.writeFile(rulesFilePath, '[]', 'utf8');
            }
            const data = await fs.readFile(rulesFilePath, 'utf8');
            currentRules = data.trim() === '' ? [] : JSON.parse(data); // Trata arquivo vazio literal
            log.info(`Regras carregadas com sucesso (${currentRules.length}).`);
             // Só envia se a janela existe E o usuário está autenticado (significa que index.html carregou)
             if (isAuthenticated && mainWindow && !mainWindow.isDestroyed()) {
                sendToRenderer('rules-loaded', currentRules);
            }
        } catch (error) {
            log.error('ERRO CRÍTICO ao carregar/parsear rules.json:', error);
            currentRules = []; // Reseta para evitar problemas
             if (isAuthenticated && mainWindow && !mainWindow.isDestroyed()) {
                sendToRenderer('log-message', `ERRO ao carregar regras: ${error.message}. Verifique rules.json.`, 'error');
                sendToRenderer('rules-loaded', []); // Envia vazio para UI
            }
        }
    }

    // Salvar Regras no JSON
    async function saveRules() {
        log.info(`Salvando ${currentRules.length} regras em: ${rulesFilePath}`);
        try {
            await fs.writeFile(rulesFilePath, JSON.stringify(currentRules, null, 2), 'utf8'); // Indentado
            log.info(`Regras salvas com sucesso.`);
            return true;
        } catch (error) {
            log.error('Erro ao salvar rules.json:', error);
            sendToRenderer('log-message', `Falha ao salvar regras no disco: ${error.message}`, 'error');
            return false;
        }
    }

     // Limpar Pasta da Sessão WA
     async function clearSessionData() {
        log.warn(`Limpando pasta de sessão WA: ${sessionPath}`);
        try {
            await fs.rm(sessionPath, { recursive: true, force: true });
            log.info('Pasta de sessão WA limpa.');
            return true;
        } catch (error) {
            if (error.code === 'ENOENT') {
                log.info('Pasta de sessão não encontrada. Nada a limpar.');
                return true;
            }
            log.error('Erro ao limpar pasta de sessão:', error);
            sendToRenderer('log-message', `Erro ao limpar sessão WA: ${error.message}`, 'error');
            return false;
        }
    }

     // Destruir Cliente WA
     function destroyClient() {
         if (client) {
             log.warn('Destruindo instância do cliente WhatsApp...');
             // Evita esperar promise, apenas dispara a destruição
             client.destroy().catch(e => log.error("Erro (ignorado) ao chamar client.destroy():", e));
             client = null;
             botReady = false;
             isPaused = false; // Garante reset do estado
             log.info('Instância do cliente WA destruída e referências limpas.');
         }
     }

    // --- Criação da Janela Principal ---
    function createWindow() {
        log.info('Função createWindow chamada.');
        if (mainWindow && !mainWindow.isDestroyed()) {
            log.warn('createWindow chamada, mas janela já existe. Focando.');
            mainWindow.focus();
            return;
        }

        log.info('Criando nova BrowserWindow...');
        mainWindow = new BrowserWindow({
            width: 950,
            height: 700,
            minWidth: 800, // Define tamanhos mínimos se desejar
            minHeight: 600,
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'), // Crítico!
                contextIsolation: true,                     // Recomendado
                nodeIntegration: false,                    // Recomendado
                devTools: !app.isPackaged,                 // Habilita DevTools apenas em desenvolvimento
            },
            icon: path.join(__dirname, 'build/icon.ico')    // Verifique este caminho
        });

        // Carrega login.html SE o usuário ainda não está autenticado
        const initialFile = isAuthenticated ? 'index.html' : 'login.html';
        log.info(`Carregando arquivo inicial: ${initialFile}`);
        mainWindow.loadFile(initialFile)
            .then(() => { log.info(`${initialFile} carregado.`); })
            .catch(err => { log.error(`Erro ao carregar ${initialFile}:`, err); });

        // Handler para fechar a janela
        mainWindow.on('closed', () => {
            log.info('Janela principal fechada (evento closed). mainWindow definido para null.');
            mainWindow = null; // Muito importante para a lógica de recriação e envio
        });

        // Handler para links externos
        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (url.startsWith('http:') || url.startsWith('https:') || url.startsWith('mailto:')) {
                log.info(`Abrindo URL externa via shell: ${url}`);
                shell.openExternal(url);
            }
            return { action: 'deny' }; // Bloqueia novas janelas Electron
        });
    }

    // --- Lógica Principal do Bot WA ---
    function initializeWhatsAppClient() {
        if (!isAuthenticated) {
            log.error("BLOQUEADO: Tentativa de inicializar cliente WA sem autenticação do app.");
            sendToRenderer('log-message', "Erro interno: Falha de autenticação do app.", 'error');
            return;
        }
        if (client) {
            log.warn('Cliente WA já existe ou está inicializando. Ignorando nova inicialização.');
            sendToRenderer('log-message', 'Bot já em processo de inicialização ou conectado.', 'warn');
            return;
        }
        log.info('>>>> Iniciando Conexão WhatsApp <<<<');
        sendToRenderer('update-status', 'initializing');

        // Configura o cliente (semelhante ao anterior)
        client = new Client({
            authStrategy: new LocalAuth({ dataPath: sessionPath }),
            puppeteer: {
                headless: false, // 'new' ou true nas versões mais recentes
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu', // Importante para alguns sistemas/ambientes virtuais
                    '--no-zygote' // Pode ajudar em alguns casos de crash
                ],
            },
            // webVersion: '2.2412.54', // DESCOMENTE E TESTE UMA VERSÃO SE TIVER PROBLEMAS DE CONEXÃO
             restartOnAuthFail: true,
             takeoverOnConflict: true, // Importante se usar o WA em outro local
        });

        // --- LISTENERS DE EVENTOS DO CLIENTE WA ---

        client.on('qr', (qr) => {
            log.info('Evento QR recebido. Gerando Data URL.');
            qrcode.toDataURL(qr, { errorCorrectionLevel: 'L', margin: 2 }, (err, url) => { // Ajustes QR
                if (err) {
                    log.error('Erro ao gerar QR Code Data URL:', err);
                    sendToRenderer('update-status', 'error', 'Falha geração QR');
                    sendToRenderer('log-message', 'Erro ao processar QR Code.', 'error');
                } else {
                    log.info('QR Code pronto para exibição.');
                    sendToRenderer('display-qr', url);
                    sendToRenderer('update-status', 'scanning');
                }
            });
        });

        client.on('loading_screen', (percent, message) => {
            log.info(`WA Loading Screen: ${percent}% - ${message}`);
            sendToRenderer('update-status', 'connecting', `${message} (${percent}%)`);
            // Log menos verboso aqui se desejar
            if (percent % 20 === 0 || percent === 100) { // Loga a cada 20% ou no 100%
                sendToRenderer('log-message', `WhatsApp carregando: ${message} (${percent}%)`, 'debug');
            }
        });

        client.on('authenticated', () => {
            log.info('Evento AUTHENTICATED - Sessão validada.');
            sendToRenderer('log-message', 'Sessão autenticada com o WhatsApp.', 'info');
            // Não significa pronto para operar, espera 'ready'
        });

        client.on('auth_failure', (msg) => {
            log.error('!!!! Evento AUTH_FAILURE !!!! Mensagem:', msg);
            sendToRenderer('update-status', 'error', `Falha Autenticação WA: ${msg || 'Erro desconhecido'}`);
            sendToRenderer('log-message', `Falha grave na Autenticação do WhatsApp: ${msg || 'Verifique sessão ou conexão'}. Pode ser necessário limpar a sessão.`, 'error');
            destroyClient(); // Tentar limpar para próxima tentativa
        });

        client.on('ready', async () => {
            log.info('****** Evento READY - Cliente WA Operacional! ******');
            botReady = true;
            isPaused = false; // Estado inicial não pausado
            sendToRenderer('update-status', 'connected');
            sendToRenderer('clear-qr'); // Esconde QR da UI
            sendToRenderer('pause-state-changed', isPaused);
            sendToRenderer('log-message', '>>> Bot conectado e pronto para operar! <<<', 'success');
            // Garante que as regras estejam carregadas ou recarregadas
            await loadRules();
        });

        client.on('message_create', async (msg) => {
            // LÓGICA DE PROCESSAMENTO DE MENSAGENS (Inalterada)
            log.debug(`MSG Recebida: De=${msg.from}, Tipo=${msg.type}, Body=${msg.body.substring(0, 50)}`);
            if (!botReady || isPaused) { log.debug('Ignorada: Bot não pronto ou pausado.'); return; }
            if (msg.isStatus || msg.fromMe || !msg.id.remote.endsWith('@c.us')) { log.debug('Ignorada: Status, própria ou grupo.'); return; } // Somente @c.us (chats individuais)

            const senderId = msg.from;
            const messageBodyLower = msg.body.toLowerCase();
            try {
                let ruleMatched = false;
                for (const rule of currentRules) {
                    const triggersLower = (rule.triggers || []).map(t => t.toLowerCase());
                    if (triggersLower.some(trigger => messageBodyLower.includes(trigger))) {
                        ruleMatched = true;
                        log.info(`MATCH: Regra encontrada para ${senderId}. Gatilhos: [${rule.triggers.join(',')}]`);
                        // Enviar Resposta
                        if (rule.response) {
                             try { await client.sendMessage(senderId, rule.response); log.info(`-> Resposta enviada para ${senderId}`); sendToRenderer('log-message', `Resp -> ${senderId.split('@')[0]}: ${rule.response.substring(0,30)}...`, 'info');}
                             catch (e) { log.error(`X Erro envio RESPOSTA para ${senderId}:`, e); sendToRenderer('log-message', `ERRO envio Resp para ${senderId.split('@')[0]}`, 'error'); }
                        }
                        // Encaminhar Lead
                        if (rule.isLeadQualifier && rule.forwardTo) {
                            try {
                                const contact = await msg.getContact();
                                const contactName = contact.pushname || contact.name || senderId.split('@')[0];
                                let forwardMsg = `${rule.forwardMessagePrefix || '[Lead]'}\n👤 De: *${contactName}* (${senderId.split('@')[0]})\n💬 Msg:\n${msg.body}`;
                                 try { await client.sendMessage(rule.forwardTo, forwardMsg); log.info(`-> Lead de ${contactName} encaminhado para ${rule.forwardTo}`); sendToRenderer('log-message', `Lead de ${contactName} -> Encaminhado`, 'success');}
                                 catch (e) { log.error(`X Erro envio LEAD para ${rule.forwardTo}:`, e); sendToRenderer('log-message', `ERRO envio Lead para ${rule.forwardTo.split('@')[0]}`, 'error');}
                            } catch (e) { log.error(`X Erro getContact/formatação LEAD ${senderId}:`, e); sendToRenderer('log-message', `ERRO getContact ${senderId.split('@')[0]}`, 'error');}
                        }
                        return; // IMPORTANTE: Para após o primeiro match
                    }
                }
                 if (!ruleMatched) log.debug(`No match: Nenhuma regra encontrada para msg de ${senderId}.`);
            } catch (error) { log.error(`ERRO INESPERADO no processamento da msg de ${senderId}:`, error); sendToRenderer('log-message', `ERRO INTERNO processando msg ${senderId.split('@')[0]}`, 'error'); }
        });

        client.on('disconnected', (reason) => {
            log.warn(`!!!!! Evento DISCONNECTED !!!!! Razão: ${reason}`);
            botReady = false; // Marca como não pronto
            sendToRenderer('update-status', 'disconnected', `Desconectado WA: ${reason || '?'}`);
            sendToRenderer('log-message', `Bot WhatsApp Desconectado. Razão: ${reason || 'Desconhecida'}`, 'warn');
            destroyClient(); // Tenta limpar
        });

        client.on('change_state', (state) => {
            log.info(`Evento CHANGE_STATE: ${state}`);
            sendToRenderer('log-message', `Estado WA: ${state}`, 'debug');
             if (state === 'CONFLICT') { /* ... como antes ... */ }
             else if (state === 'UNPAIRED' || state === 'UNLAUNCHED') { /* ... como antes ... */ }
        });

        log.info('Iniciando client.initialize()...');
        client.initialize().catch(error => {
            log.error("!!!!! ERRO CRÍTICO AO INICIALIZAR O CLIENTE WA !!!!!", error);
            sendToRenderer('update-status', 'error', `Falha Init WA: ${error.message}`);
            sendToRenderer('log-message', `ERRO GRAVE ao iniciar WhatsApp: ${error.message}`, 'error');
            destroyClient();
        });
    }

    // --- Handlers IPC (Inter-Process Communication) ---

    ipcMain.on('login-attempt', (event, { username, password }) => {
        log.info(`IPC login-attempt: user=${username}`);
        // LOGIN SIMPLES - SUBSTITUA PELA SUA LÓGICA REAL SE NECESSÁRIO
        const USUARIO_VALIDO = "admin";
        const SENHA_VALIDA = "senha123";

        if (username === USUARIO_VALIDO && password === SENHA_VALIDA) {
            log.info(`Login BEM-SUCEDIDO para: ${username}`);
            isAuthenticated = true;
            if (mainWindow && !mainWindow.isDestroyed()) {
                 log.info('Carregando index.html após login...');
                 mainWindow.loadFile('index.html')
                    .then(async () => {
                        log.info('index.html carregado. Solicitando estado inicial e carregando regras...');
                        // Garante que as regras são carregadas e enviadas após a UI estar pronta
                        await loadRules();
                        // Informa a UI que o bot está 'disconnected' (ainda não foi iniciado)
                        // O handler get-initial-state também faz isso, pode ser redundante
                         sendToRenderer('get-initial-state'); // Pede estado à UI, q enviará 'disconnected'

                    })
                    .catch(err => {
                        log.error('FALHA ao carregar index.html pós-login:', err);
                         sendToRenderer('login-failed', 'Erro interno ao carregar a interface.');
                         isAuthenticated = false;
                     });
            } else log.error("Janela principal INEXISTENTE durante login bem-sucedido!");
        } else {
            log.warn(`Login FALHOU para usuário: ${username}`);
            isAuthenticated = false;
            sendToRenderer('login-failed', 'Usuário ou Senha Inválidos.');
        }
    });

    ipcMain.on('get-initial-state', async (event) => {
        log.info('IPC get-initial-state recebido.');
        if (!isAuthenticated) { log.warn('Ignorado: Usuário não autenticado.'); return; }

         // Força recarga das regras caso a janela tenha sido recarregada (F5)
         await loadRules();

         // Define o estado inicial da UI após o login
        let currentState = 'disconnected'; // Padrão pós-login
        if(client && botReady) { currentState = isPaused ? 'paused' : 'connected'; }
        else if (client) { currentState = 'initializing'; } // Se client existe mas não está pronto

         log.info(`Enviando estado inicial: ${currentState}, Pausado: ${isPaused}`);
         sendToRenderer('update-status', currentState);
         if (client && botReady) { sendToRenderer('pause-state-changed', isPaused); }
         // 'rules-loaded' já foi enviado pelo loadRules()
    });

    ipcMain.on('start-bot', () => {
        log.info('IPC start-bot.');
        if (!isAuthenticated) { log.error('Ignorado: Requer login.'); sendToRenderer('log-message','Login necessário!', 'error'); return; }
        initializeWhatsAppClient(); // Tenta iniciar
    });

    ipcMain.on('stop-bot', async () => {
        log.info('IPC stop-bot.');
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
         if (client) {
             sendToRenderer('log-message', 'Parando o bot...', 'warn');
             await client.logout().catch(e=>{log.warn('Erro (ignorado) no logout:', e)});
             destroyClient();
             sendToRenderer('update-status', 'disconnected', 'Bot parado');
         } else sendToRenderer('update-status', 'disconnected'); // Garante UI atualizada
    });

    ipcMain.on('toggle-pause-bot', () => {
        log.info(`IPC toggle-pause-bot. Estado atual: ${isPaused}`);
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
        if (client && botReady) {
            isPaused = !isPaused;
            log.info(`Novo estado de pausa: ${isPaused}`);
            sendToRenderer('pause-state-changed', isPaused);
            sendToRenderer('log-message', `Bot ${isPaused ? 'pausado' : 'retomado'}.`, 'info');
        } else {
            log.warn('Toggle-pause ignorado: Bot não conectado.');
            sendToRenderer('log-message', 'Bot não está conectado para pausar/continuar.', 'warn');
        }
    });

    ipcMain.on('load-rules-request', async () => {
        log.info('IPC load-rules-request.');
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
        await loadRules(); // Força recarregar e enviar para UI
    });

    ipcMain.on('save-rule', async (event, { index, rule }) => {
        log.info(`IPC save-rule. Index: ${index}`);
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
         let success = false, message = '';
        try { /* ... lógica de salvar regra ... */
            if (index === -1) { currentRules.push(rule); message = 'Regra adicionada!'; }
             else if (index >= 0 && index < currentRules.length) { currentRules[index] = rule; message = `Regra ${index} atualizada!`; }
             else throw new Error(`Índice ${index} inválido`);
            success = await saveRules();
            if (!success) message = 'Salvo na memória, mas erro ao gravar no disco!';
        } catch (e) { success = false; message = `Erro: ${e.message}`; log.error('Erro save-rule:', e); }
        sendToRenderer('rule-save-status', { success, message, updatedRules: currentRules });
    });

    ipcMain.on('delete-rule', async (event, index) => {
        log.info(`IPC delete-rule. Index: ${index}`);
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
         let success = false, message = '';
        try { /* ... lógica de deletar regra ... */
            if (index >= 0 && index < currentRules.length) {
                const delRule = currentRules.splice(index, 1); message = `Regra ${index} excluída!`;
                success = await saveRules();
                if (!success) message = 'Excluído da memória, mas erro ao gravar no disco!';
             } else throw new Error(`Índice ${index} inválido`);
        } catch (e) { success = false; message = `Erro: ${e.message}`; log.error('Erro delete-rule:', e); }
        sendToRenderer('rule-delete-status', { success, message, updatedRules: currentRules });
    });

    ipcMain.on('clear-session-request', async () => {
        log.info('IPC clear-session-request.');
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
        sendToRenderer('log-message', 'Limpando sessão WhatsApp...', 'warn');
        if (client) { await client.logout().catch(e=>{}); } // Tenta logout primeiro
        destroyClient(); // Para o bot e limpa cliente
        const cleaned = await clearSessionData(); // Limpa a pasta
        sendToRenderer('log-message', cleaned ? 'Sessão WA limpa! Escaneie o QR na próxima vez.' : 'Falha ao limpar sessão WA!', cleaned ? 'success' : 'error');
        sendToRenderer('update-status', 'disconnected', 'Sessão limpa'); // Atualiza UI
    });

    ipcMain.on('check-for-update-request', () => {
        log.info('IPC check-for-update-request.');
        if (!isAuthenticated) { log.warn('Ignorado: Requer login.'); return; }
         // (Lógica simulada ou real do autoUpdater aqui)
        log.info('Simulando verificação de atualização...');
         sendToRenderer('log-message', 'Verificando atualizações (simulado)...', 'info');
         setTimeout(() => {
             sendToRenderer('log-message', 'Nenhuma atualização encontrada (simulado).', 'info');
             sendToRenderer('update-download-progress', 100); // Sinaliza fim
         }, 2500);
    });

    // --- Configuração do Ciclo de Vida do App Electron ---

    app.whenReady().then(async () => {
        log.info('>>> Evento app.whenReady disparado. <<<');
         // Chama createWindow imediatamente (que agora carrega login.html)
        createWindow();
         // Carrega as regras em background. Elas serão enviadas para a UI principal
         // quando o login for bem-sucedido e o index.html carregar.
         await loadRules();

        app.on('activate', () => {
            log.info('Evento app.activate (macOS).');
            // Recria a janela se não houver nenhuma aberta (respeitará o estado de login)
            if (BrowserWindow.getAllWindows().length === 0) {
                 log.info('Nenhuma janela aberta, chamando createWindow().');
                createWindow(); // Recria a janela (carregará login se !isAuthenticated)
            }
        });
    });

    app.on('window-all-closed', () => {
        log.info('Evento window-all-closed.');
        // Encerra o app, exceto no macOS
        if (process.platform !== 'darwin') {
            log.info('Encerrando aplicação (não macOS).');
            if (client) client.destroy().catch(e=>{}).finally(() => app.quit()); // Garante limpeza do cliente WA
            else app.quit();
        } else {
            log.info('Aplicação continua rodando (macOS).');
        }
    });

    // Handler para erros não capturados (importante para estabilidade)
    process.on('uncaughtException', (error, origin) => {
        log.error('!!!!!!!!!! UNCAUGHT EXCEPTION !!!!!!!!!!');
        log.error(`Origem: ${origin}`);
        log.error(error);
         // Tentar informar a UI se possível
         sendToRenderer('log-message', `ERRO CRÍTICO INESPERADO: ${error.message}`, 'error');
         // Exibir diálogo nativo
         dialog.showErrorBox(
            'Erro Crítico - MagnosBot',
             `Ocorreu um erro inesperado que não foi tratado:\n\n${error.message}\n\nOrigem: ${origin}\n\nO aplicativo pode precisar ser reiniciado.`
         );
         // Considerar fechar o app em erros graves: app.quit();
    });

     log.info('<<< Configuração final do processo principal (main.js) concluída. >>>');

} // --- FIM DO BLOCO ELSE do gotTheLock ---

log.info('<<<<<<<<<< Script main.js totalmente processado. Aguardando eventos... >>>>>>>>>>');