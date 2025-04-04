// ./main.js

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log'); // Import electron-log

// --- Configuração do Logger ---
// Configura o logger do electron-log para também logar os eventos do autoUpdater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info'; // Loga informações, avisos e erros no arquivo
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log'); // Define onde o log principal será salvo
// Opcional: Logar também no console durante o desenvolvimento
// log.transports.console.level = 'info';

// --- Variáveis Globais ---
let mainWindow;
let client; // Variável para armazenar a instância do cliente WhatsApp

// --- Funções Auxiliares ---
/**
 * Envia uma mensagem de log formatada para a janela principal (renderer).
 * @param {string} message Mensagem a ser logada.
 */
function sendLogToWindow(message) {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMessage = `[${timestamp}] ${message}`;
    log.info(formattedMessage); // Loga no arquivo usando electron-log

    // Envia para a interface apenas se a janela existir
    if (mainWindow && mainWindow.webContents) {
        try {
            mainWindow.webContents.send('log-message', formattedMessage);
        } catch (error) {
            log.error('Erro ao enviar log para a janela:', error); // Loga erro no arquivo
        }
    }
}

/**
 * Atualiza o status exibido na janela principal (renderer).
 * @param {string} status Mensagem de status.
 */
function updateAppStatus(status) {
    sendLogToWindow(`Status: ${status}`); // Loga o status também
    if (mainWindow && mainWindow.webContents) {
        try {
            mainWindow.webContents.send('update-status', status);
        } catch (error) {
            log.error('Erro ao enviar status para a janela:', error);
        }
    }
}

// --- Criação da Janela Principal ---
function createWindow() {
    sendLogToWindow('[SYS] Criando janela principal...');
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 750,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true, // Importante para segurança com contextBridge
            nodeIntegration: false // Manter desabilitado por segurança
        }
    });

    mainWindow.loadFile('index.html');

    // Opcional: Abrir DevTools para depuração
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        sendLogToWindow('[SYS] Janela principal fechada.');
        mainWindow = null; // Limpa a referência
    });

    // --- Verificação de Atualizações (APÓS janela pronta) ---
    mainWindow.webContents.on('did-finish-load', () => {
        sendLogToWindow('[SYS] Conteúdo da janela carregado.');
        // Adiciona um delay para não impactar tanto a inicialização visual
        setTimeout(() => {
            sendLogToWindow('[Updater] Verificando por atualizações...');
            updateAppStatus('Verificando atualizações...');
            autoUpdater.checkForUpdatesAndNotify().catch(err => {
                sendLogToWindow(`[Updater ERRO] Falha ao verificar/notificar atualizações: ${err.message}`);
                updateAppStatus('Falha ao verificar atualizações.');
            });
        }, 5000); // Verifica 5 segundos após carregar a UI
    });
}

// --- Lógica do WhatsApp ---
function initializeWhatsApp() {
    if (client) {
        sendLogToWindow('[WA] Cliente já existe. Tentando destruir antes de recriar.');
        updateAppStatus('Reiniciando conexão...');
        client.destroy().then(() => {
             client = null;
             initializeWhatsAppInternal();
        }).catch(err => {
             sendLogToWindow('[WA ERRO] Falha ao destruir cliente existente: ' + err.message);
             client = null; // Tenta limpar mesmo com erro
             initializeWhatsAppInternal();
        });
    } else {
         initializeWhatsAppInternal();
    }
}

function initializeWhatsAppInternal() {
    sendLogToWindow('[WA] Inicializando cliente WhatsApp...');
    updateAppStatus('Inicializando conexão WhatsApp...');

    client = new Client({
        authStrategy: new LocalAuth(), // Usa autenticação local para não precisar escanear toda vez
        puppeteer: {
             headless: true, // Mude para false se precisar ver o browser (para debug)
             args: [ // Otimizações e correções comuns
                 '--no-sandbox',
                 '--disable-setuid-sandbox',
                 '--disable-dev-shm-usage',
                 '--disable-accelerated-2d-canvas',
                 '--no-first-run',
                 '--no-zygote',
                 // '--single-process', // Descomente se tiver problemas em ambientes específicos (pode impactar performance)
                 '--disable-gpu'
             ],
         }
    });

    client.on('qr', (qr) => {
        sendLogToWindow('[WA] QR Code recebido. Convertendo para exibição.');
        updateAppStatus('QR Code Pronto - Escaneie no seu celular');
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                sendLogToWindow('[WA ERRO] Falha ao converter QR code: ' + err.message);
                updateAppStatus('Erro ao gerar QR Code');
                return;
            }
            if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send('display-qr', url);
                sendLogToWindow('[WA] QR Code enviado para a interface.');
            }
        });
    });

    client.on('ready', () => {
        sendLogToWindow('[WA] Cliente WhatsApp está pronto!');
        updateAppStatus('Conectado!');
        if (mainWindow && mainWindow.webContents) {
            mainWindow.webContents.send('clear-qr'); // Limpa o QR da tela
        }
        // --- Listener de Mensagens (Exemplo Básico) ---
        initializeMessageListener();
    });

    client.on('authenticated', () => {
        sendLogToWindow('[WA] Cliente autenticado com sucesso.');
        updateAppStatus('Autenticado');
        // O evento 'ready' geralmente vem logo depois, então limpamos o QR lá
    });

    client.on('auth_failure', (msg) => {
        sendLogToWindow(`[WA ERRO] Falha na autenticação: ${msg}`);
        updateAppStatus('Falha na Autenticação');
        if (mainWindow && mainWindow.webContents) {
             mainWindow.webContents.send('clear-qr');
         }
    });

    client.on('disconnected', (reason) => {
        sendLogToWindow(`[WA] Cliente desconectado: ${reason}`);
        updateAppStatus('Desconectado');
        if (mainWindow && mainWindow.webContents) {
             mainWindow.webContents.send('clear-qr');
        }
        // Tentar reconectar ou limpar estado, dependendo da 'reason'
        // Por exemplo, pode tentar chamar initializeWhatsApp() novamente
        client = null; // Limpa referência para poder reiniciar
    });

    client.on('loading_screen', (percent, message) => {
        sendLogToWindow(`[WA] Carregando: ${percent}% - ${message}`);
        updateAppStatus(`Carregando WhatsApp: ${percent}%`);
    });

    sendLogToWindow('[WA] Iniciando conexão do cliente...');
    client.initialize().catch(err => {
        sendLogToWindow(`[WA ERRO] Erro fatal ao inicializar cliente: ${err.message}`);
        updateAppStatus('Erro Crítico na Inicialização');
        client = null;
    });
}

// --- Listener de Mensagens de Exemplo ---
function initializeMessageListener() {
    if (!client) return;

    client.on('message_create', message => {
        // Ouve mensagens enviadas PELO BOT para log (útil para debug)
        if (message.fromMe) {
            sendLogToWindow(`[WA Msg Enviada] Para: ${message.to} | Msg: ${message.body.substring(0, 50)}...`);
        }
    });

    client.on('message', async msg => {
         sendLogToWindow(`[WA Msg Recebida] De: ${msg.from} | Msg: ${msg.body.substring(0, 50)}...`);
         // Exemplo: Responder a '!ping' com 'pong'
        if (msg.body === '!ping') {
             try {
                 await msg.reply('pong');
                 sendLogToWindow(`[WA AutoReply] Respondido 'pong' para ${msg.from}`);
             } catch (error) {
                sendLogToWindow(`[WA ERRO] Falha ao responder para ${msg.from}: ${error.message}`);
             }
         }

         // ADICIONE AQUI A LÓGICA PRINCIPAL DO SEU BOT
         // (analisar mensagem, consultar API, responder, etc.)
    });
     sendLogToWindow('[WA] Listener de mensagens ativado.');
}

// --- Handlers do AutoUpdater ---
autoUpdater.on('checking-for-update', () => {
    sendLogToWindow('[Updater] Verificando atualização...');
    updateAppStatus('Verificando atualizações...'); // Atualiza status na UI também
});

autoUpdater.on('update-available', (info) => {
    sendLogToWindow(`[Updater] Atualização disponível! Versão: ${info.version}`);
    updateAppStatus(`Atualização encontrada: v${info.version}`);
    // O download começará automaticamente por padrão com checkForUpdatesAndNotify
});

autoUpdater.on('update-not-available', (info) => {
    sendLogToWindow('[Updater] Nenhuma atualização disponível.');
    updateAppStatus('Aplicativo atualizado.'); // Informa ao usuário
});

autoUpdater.on('error', (err) => {
    sendLogToWindow(`[Updater ERRO] ${err.message}`);
    updateAppStatus('Erro no atualizador.');
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = `[Updater] Baixando: ${progressObj.percent.toFixed(2)}%`;
    log_message += ` (${(progressObj.bytesPerSecond / 1024).toFixed(2)} KB/s)`;
    sendLogToWindow(log_message);
    updateAppStatus(`Baixando atualização: ${progressObj.percent.toFixed(0)}%`); // Atualiza UI com progresso
    // Opcional: Enviar progresso para uma barra na UI
    // if (mainWindow && mainWindow.webContents) {
    //     mainWindow.webContents.send('update-download-progress', progressObj.percent);
    // }
});

autoUpdater.on('update-downloaded', (info) => {
    sendLogToWindow(`[Updater] Atualização baixada (Versão: ${info.version}). Pronta para instalar.`);
    updateAppStatus('Atualização pronta para instalar!');
    // Envia um sinal para a própria main thread (ou poderia enviar para o renderer) para mostrar o diálogo
    ipcMain.emit('show-update-restart-dialog');
});

// --- Handlers IPC (Comunicação Renderer -> Main) ---

// Ouve o comando do botão "Iniciar Bot" vindo do renderer
ipcMain.on('start-bot', (event) => {
    sendLogToWindow('[IPC] Comando "start-bot" recebido do renderer.');
    initializeWhatsApp(); // Chama a função para iniciar ou reiniciar o WhatsApp
});

// Handler para mostrar diálogo de reinicialização (chamado pelo evento 'update-downloaded')
ipcMain.on('show-update-restart-dialog', async (event) => {
   sendLogToWindow('[Updater] Solicitando confirmação do usuário para reiniciar.');
   try {
       const result = await dialog.showMessageBox(mainWindow, { // Associa à janela principal
            type: 'info',
            title: 'Atualização Pronta',
            message: 'Uma nova versão do Auto Wpp-Bot foi baixada. Deseja reiniciar o aplicativo e instalar agora?',
            buttons: ['Reiniciar Agora', 'Mais Tarde'],
            defaultId: 0, // Botão Reiniciar é o padrão
            cancelId: 1   // Botão Mais Tarde cancela
        });

       if (result.response === 0) {
            sendLogToWindow("[Updater] Usuário aceitou reiniciar. Encerrando e instalando...");
            // Fecha o cliente WA de forma graciosa se possível antes de sair
            if (client) {
                await client.destroy().catch(e => sendLogToWindow("[WA ERRO] Falha ao destruir cliente antes de atualizar: "+e.message));
            }
            autoUpdater.quitAndInstall();
        } else {
             sendLogToWindow("[Updater] Usuário optou por instalar mais tarde.");
             updateAppStatus('Atualização será instalada na próxima vez que fechar o app.');
         }
   } catch(error) {
       sendLogToWindow(`[Updater ERRO] Falha ao mostrar diálogo de reinício: ${error.message}`);
   }
});


// --- Ciclo de Vida da Aplicação Electron ---

// Este método será chamado quando Electron terminar de inicializar
// e estiver pronto para criar janelas do navegador.
// Algumas APIs só podem ser usadas depois que este evento ocorre.
app.whenReady().then(() => {
    sendLogToWindow('=============== [SYS] Aplicação Iniciada ===============');
    createWindow();

    // Lida com ativação no macOS (se não houver janelas, cria uma)
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            sendLogToWindow('[SYS] Aplicação ativada (macOS) - recriando janela.');
            createWindow();
        }
    });
});

// Encerrar quando todas as janelas forem fechadas, exceto no macOS.
app.on('window-all-closed', () => {
    // No macOS, é comum aplicações e suas barras de menu
    // continuarem ativas até que o usuário explicitamente encerre com Cmd + Q
    if (process.platform !== 'darwin') {
        sendLogToWindow('[SYS] Todas as janelas fechadas. Encerrando aplicação.');
        if (client) {
             client.destroy().catch(e => sendLogToWindow("[WA ERRO] Falha ao destruir cliente ao fechar app: "+e.message))
            .finally(() => app.quit()); // Garante que o app saia mesmo se destroy falhar
        } else {
             app.quit();
        }
    } else {
        sendLogToWindow('[SYS] Todas as janelas fechadas (macOS) - aplicação continua ativa.');
         // No mac talvez ainda queira desconectar o whatsapp?
         if (client) {
            client.destroy().catch(e => sendLogToWindow("[WA ERRO] Falha ao destruir cliente ao fechar janelas no macOS: "+e.message));
            client = null;
        }
    }
});

// --- Tratamento de Erros Não Capturados (Opcional mas recomendado) ---
process.on('uncaughtException', (error, origin) => {
   log.error('!!!!!!!!!!!!!! EXCEÇÃO NÃO TRATADA !!!!!!!!!!!!!!');
   log.error('Erro:', error);
   log.error('Origem:', origin);
   sendLogToWindow(`[ERRO CRÍTICO] ${error.message} (Origem: ${origin}). Verifique main.log.`);
   // Em produção, você pode querer mostrar um diálogo mais amigável e/ou tentar reiniciar o app.
   // Cuidado ao continuar após um erro não tratado, o estado pode estar inconsistente.
});
process.on('unhandledRejection', (reason, promise) => {
    log.error('!!!!!!!!!!!!!! REJEIÇÃO NÃO TRATADA !!!!!!!!!!!!!!');
    log.error('Razão:', reason);
    sendLogToWindow(`[ERRO ASSÍNCRONO] ${reason}. Verifique main.log.`);
});


sendLogToWindow('[SYS] main.js carregado.'); // Log inicial para saber que o script foi lido