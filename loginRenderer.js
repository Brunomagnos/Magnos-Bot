// ./loginRenderer.js (REVISADO para usar Preload API Unificada)

// Função wrapper para enviar logs ao main via preload (se disponível)
const log = (level, message) => {
    if (window.electronAPI && typeof window.electronAPI.log === 'function') {
        window.electronAPI.log(level, `[LoginUI] ${message}`); // Adiciona prefixo para diferenciar
    } else {
        console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[Login UI - API Indisponível] ${message}`);
    }
};

// --- Verificação da API e Elementos Essenciais ---
let isApiAvailable = false;
let formElements = {};

document.addEventListener('DOMContentLoaded', () => {
    log('info', '==== loginRenderer.js: DOMContentLoaded ====');

    // Verifica API
    isApiAvailable = !!(window.electronAPI && typeof window.electronAPI.send === 'function' && typeof window.electronAPI.on === 'function');
    if(isApiAvailable) {
        log('info', 'electronAPI está disponível.');
    } else {
        const errorMsg = 'ERRO FATAL: API de comunicação (electronAPI) não disponível! O preload falhou.';
        displayError(errorMsg, true);
        log('error', `!!!!!! ${errorMsg} Verifique console do Main/Preload.`);
    }

    // Obtém Referências DOM
    formElements.loginForm = document.getElementById('loginForm');
    formElements.usernameInput = document.getElementById('username');
    formElements.passwordInput = document.getElementById('password');
    formElements.errorMessageDiv = document.getElementById('error-message');
    formElements.submitButton = formElements.loginForm?.querySelector('button[type="submit"]');

    // Verifica Elementos Essenciais
    const missingElements = Object.entries(formElements)
        .filter(([key, el]) => !el && key !== 'submitButton') // submitButton pode estar dentro do form
        .map(([key]) => `#${key.replace(/([A-Z])/g, '-$1').toLowerCase().replace('login-form','loginForm').replace('-div','')}`);
    if(missingElements.length > 0 || !formElements.submitButton) { // Checa submit button separadamente
        if(!formElements.submitButton) missingElements.push('button[type="submit"]');
        const errorMsg = `ERRO FATAL: Elemento(s) não encontrado(s): ${missingElements.join(', ')}!`;
        log('error', `!!!!!! ${errorMsg} Verifique login.html.`);
        displayError(errorMsg, true);
        if (formElements.loginForm) formElements.loginForm.classList.add('form-invalid');
    }

    // Se API e elementos OK, inicializa listeners
    if (isApiAvailable && missingElements.length === 0 && formElements.submitButton) {
        initializeLogin();
    } else {
        // Trava form se algo falhou
        setLoadingState(true); // Usa setLoading para desabilitar
        if(isApiAvailable && missingElements.length > 0) displayError("Erro interno: Falha ao carregar interface de login.", true); // Se API ok, mas DOM falhou
        if (!isApiAvailable && formElements.errorMessageDiv) { displayError("Falha na comunicação interna. Recarregue (F5) ou reinstale.", true); } // Se API falhou
    }
     log('info', '==== loginRenderer.js: Inicialização concluída ====');
});

// --- Funções ---

function displayError(message, isFatal = false) {
    if (formElements.errorMessageDiv) {
        formElements.errorMessageDiv.textContent = message;
        formElements.errorMessageDiv.className = isFatal ? 'error-message fatal' : 'error-message';
        log(isFatal ? 'error' : 'warn', `[UI Error] ${message}`);
    } else {
        console[isFatal ? 'error' : 'warn'](`[UI Error - Div Ausente] ${message}`);
        // alert(`Erro${isFatal ? ' Fatal' : ''}: ${message}`); // Evitar alert se possível
    }
}

function clearError() {
    if (formElements.errorMessageDiv) {
        formElements.errorMessageDiv.textContent = '';
        formElements.errorMessageDiv.className = 'error-message';
    }
}

function initializeLogin() {
    log('info', 'Inicializando listeners do formulário...');

    formElements.loginForm.addEventListener('submit', (event) => {
        event.preventDefault(); log('info', '>>> SUBMIT <<<');
        clearError();
        const username = formElements.usernameInput.value.trim();
        const password = formElements.passwordInput.value; // Não faz trim na senha
        if (!username || !password) { displayError('Usuário e Senha são obrigatórios.'); return; }

        log('info', `Tentando login para: ${username}`);
        setLoadingState(true);
        window.electronAPI.send('login-attempt', { username, password });
    });

    // Listener para falha vinda do Main
    const unsubscribeLoginFailed = window.electronAPI.on('login-failed', (message) => {
        log('warn', `<<< login-failed recebido: ${message} >>>`);
        displayError(message || 'Usuário ou senha inválidos.');
        setLoadingState(false);
    });

    // Listener para logs gerais do Main (opcional)
    const unsubscribeLogMessage = window.electronAPI.on('log-message', (message, level) => {
        log(level, `[Main] ${message}`);
        // Poderia exibir erros graves do Main na tela de login, se fizer sentido
        // if (level === 'error' && message.includes('CRÍTICO')) { displayError(`[Erro Sistema] ${message}`); setLoadingState(false); }
    });

    log('info', 'Listeners IPC configurados.');

    // Foco inicial
    formElements.usernameInput.focus();

     // Limpeza ao descarregar (exemplo, pode não ser necessário se janela fecha)
     // window.addEventListener('beforeunload', () => {
     //    log('info', 'Login page unloading. Cleaning up listeners.');
     //    unsubscribeLoginFailed();
     //    unsubscribeLogMessage();
     // });
}


function setLoadingState(isLoading) {
    if (formElements.submitButton) {
        formElements.submitButton.disabled = isLoading;
        formElements.submitButton.textContent = isLoading ? 'Entrando...' : 'Entrar';
    }
    // Desabilita inputs também
    if (formElements.usernameInput) formElements.usernameInput.disabled = isLoading;
    if (formElements.passwordInput) formElements.passwordInput.disabled = isLoading;
    // Classe CSS para feedback visual (adicione no <style> do login.html)
    // Ex: .login-container form.loading { opacity: 0.7; }
    formElements.loginForm?.classList.toggle('loading', isLoading);
}