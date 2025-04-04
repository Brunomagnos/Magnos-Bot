const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { autoUpdater } = require('electron-updater'); // <--- Importe o autoUpdater

// ... (resto do seu código - constantes, userContext, etc.) ...

let mainWindow;
let client;

// Configure o logging do autoUpdater (opcional, mas útil)
autoUpdater.logger = require("electron-log");
autoUpdater.logger.transports.file.level = "info";
sendLogToWindow("[Updater] Logger configurado.");

function createWindow() {
    // ... (criação da mainWindow como antes) ...

    // Depois que a janela é criada, verifique por atualizações
    // Delay opcional para não impactar tanto o startup inicial
    setTimeout(() => {
        sendLogToWindow("[Updater] Verificando por atualizações...");
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
             sendLogToWindow(`[Updater ERRO] Falha ao verificar/notificar: ${err.message}`);
        });
    }, 5000); // Verifica 5 segundos após iniciar
}

// --- Eventos do AutoUpdater ---
autoUpdater.on('checking-for-update', () => {
    sendLogToWindow('[Updater] Verificando atualização...');
});
autoUpdater.on('update-available', (info) => {
    sendLogToWindow(`[Updater] Atualização disponível! Versão: ${info.version}`);
    // Opcional: Você pode notificar o usuário via IPC para mostrar um botão na interface
    // mainWindow.webContents.send('update-available-signal');
});
autoUpdater.on('update-not-available', (info) => {
    sendLogToWindow('[Updater] Nenhuma atualização disponível.');
});
autoUpdater.on('error', (err) => {
    sendLogToWindow(`[Updater ERRO] ${err.message}`);
    console.error('Erro no AutoUpdater:', err);
});
autoUpdater.on('download-progress', (progressObj) => {
    let log_message = `[Updater] Baixando: ${progressObj.percent.toFixed(2)}%`;
    log_message += ` (${(progressObj.bytesPerSecond / 1024).toFixed(2)} KB/s)`;
    sendLogToWindow(log_message);
    // Opcional: Atualizar barra de progresso na interface
    // mainWindow.webContents.send('update-download-progress', progressObj.percent);
});
autoUpdater.on('update-downloaded', (info) => {
    sendLogToWindow(`[Updater] Atualização baixada (Versão: ${info.version}). Pronta para instalar na próxima reinicialização.`);
    // Notifica o usuário que a atualização será instalada ao sair,
    // ou pergunta se ele quer reiniciar agora usando IPC e diálogos.
    // Exemplo simples: Informar na interface
    if(mainWindow) {
         mainWindow.webContents.send('log-message', "[Updater] ATUALIZAÇÃO PRONTA! Reinicie o aplicativo para instalar.");
        // Ou usar ipcRenderer.invoke e showMessageBox para perguntar:
         ipcMain.emit('show-update-restart-dialog'); // Você precisaria criar esse evento
    }
    // Exemplo de como perguntar ao usuário para reiniciar (requer mais código IPC)
    // dialog.showMessageBox({
    //     type: 'info',
    //     title: 'Atualização Pronta',
    //     message: 'Uma nova versão foi baixada. Reiniciar e instalar agora?',
    //     buttons: ['Reiniciar', 'Mais Tarde']
    // }).then(({ response }) => {
    //     if (response === 0) {
    //         autoUpdater.quitAndInstall();
    //     }
    // });
});

// --- (Resto do seu main.js: initializeWhatsApp, initializeMessageListener, IPC, Ciclo de Vida) ---

// Exemplo de handler para diálogo de reinício (precisa ser chamado de 'update-downloaded')
ipcMain.on('show-update-restart-dialog', async (event) => {
   const { dialog } = require('electron'); // Importar dialog aqui ou globalmente
   const result = await dialog.showMessageBox(mainWindow, { // Passa a janela como pai
        type: 'info',
        title: 'Atualização Pronta',
        message: 'Uma nova versão do Auto Wpp-Bot foi baixada. Deseja reiniciar o aplicativo e instalar agora?',
        buttons: ['Reiniciar Agora', 'Mais Tarde'],
        defaultId: 0, // Botão Reiniciar é o padrão
        cancelId: 1   // Botão Mais Tarde cancela
    });

   if (result.response === 0) {
        sendLogToWindow("[Updater] Usuário aceitou reiniciar. Encerrando e instalando...");
        autoUpdater.quitAndInstall();
    } else {
         sendLogToWindow("[Updater] Usuário optou por instalar mais tarde.");
     }
});


app.whenReady().then(() => {
    createWindow();
    sendLogToWindow("[SYS] Aplicação pronta. Verificando atualizações em breve...");
    // ... resto do whenReady
});

// ... (resto dos handlers app.on) ...