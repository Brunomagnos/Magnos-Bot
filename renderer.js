// ./renderer.js - VERSÃO REVISADA para API Unificada e Melhorias

// Helper para enviar logs ao main process via API exposta pelo preload
const log = (level, message) => {
    // Log no console do DevTools desta janela
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](`[UI ${level}] ${message}`);
    // Envia o log para o main process, que usará electron-log
    window.electronAPI?.log(level, `[Renderer] ${message}`);
};

// --- Verificação da API (essencial) ---
if (!window.electronAPI || typeof window.electronAPI.send !== 'function' || typeof window.electronAPI.on !== 'function') {
    const errorMsg = 'ERRO FATAL: API de comunicação (electronAPI) não está disponível! O preload.js falhou ou foi bloqueado.';
    log('error', `!!!!!! ${errorMsg} !!!!!! Verifique o console do processo principal (Main) e do Preload.`);
    // Tenta notificar o usuário na própria UI (pode falhar se DOM não carregou)
    try {
        document.body.innerHTML = `<div style="padding: 20px; background: #ffcccc; border: 2px solid red; text-align: center;">
            <h1>Erro Crítico</h1><p>${errorMsg}</p><p>O aplicativo não pode funcionar. Verifique os logs ou reinstale.</p></div>`;
    } catch(e) { /* ignora erro de DOM */ }
    alert(errorMsg + "\nO aplicativo não funcionará corretamente.");
    throw new Error(errorMsg); // Interrompe a execução deste script
} else {
    log('info', '==== renderer.js INICIADO com electronAPI disponível ====');
}

// --- Referências DOM (com verificação e log) ---
function getElement(id, required = true) {
    const element = document.getElementById(id);
    if (!element && required) {
        log('error', `!!!!!! ERRO CRÍTICO: Elemento UI obrigatório #${id} não encontrado no HTML! UI incompleta ou quebrada. !!!!!!`);
    } else if (!element && !required) {
         log('warn', `Elemento UI opcional #${id} não encontrado.`);
    }
    return element;
}

// Mapeia IDs para variáveis
const uiElements = {
    startButton: getElement('startButton'),
    pauseButton: getElement('pauseButton'),
    statusElement: getElement('status'),
    logsElement: getElement('logs'),
    checkUpdateButton: getElement('checkUpdateButton'),
    clearSessionButton: getElement('clearSessionButton'),
    qrCodeContainer: getElement('qr-code-container'),
    qrCodeImage: getElement('qr-code-image'),
    qrPlaceholder: getElement('qr-placeholder'),
    connectedInfoPanel: getElement('connected-info-panel'),
    errorInfoPanel: getElement('error-info-panel'),
    errorDetailsElement: getElement('error-details'),
    updateProgressContainer: getElement('updateProgressContainer'),
    updateProgressBar: getElement('updateProgressBar'),
    updateProgressLabel: getElement('updateProgressLabel'),
    // Regras
    rulesListElement: getElement('rulesList'),
    addNewRuleButton: getElement('addNewRuleButton'),
    // Form de Regras
    editRuleForm: getElement('editRuleForm'),
    formRuleTitle: getElement('formRuleTitle'),
    formRuleIndexInput: getElement('formRuleIndex'),
    formRuleTriggersInput: getElement('formRuleTriggers'),
    formRuleResponseInput: getElement('formRuleResponse'),
    formRuleIsLeadInput: getElement('formRuleIsLead'),
    formForwardingOptions: getElement('formForwardingOptions'),
    formRuleForwardToInput: getElement('formRuleForwardTo'),
    formRuleForwardPrefixInput: getElement('formRuleForwardPrefix'),
    saveRuleFormButton: getElement('saveRuleFormButton'),
    cancelRuleEditButton: getElement('cancelRuleEditButton'),
    formRuleStatus: getElement('formRuleStatus')
};

// --- Estados da UI ---
let isBotRunning = false;       // Botão Start/Stop ativo? (não necessariamente conectado)
let isBotConnected = false;     // Conectado ao WhatsApp?
let isBotPaused = false;        // Estado de pausa (vem do main)
let currentRules = [];          // Array de regras carregadas
let isUpdating = false;         // Verificando/Baixando update?
let isUpdateDownloaded = false; // Um update foi baixado e está pronto para instalar?

// --- Funções Auxiliares da UI ---

function addLogToUI(message, level = 'info') {
    if (!uiElements.logsElement) return;
    const timestamp = new Date().toLocaleTimeString();
    // Limpa prefixos para clareza na UI
     const cleanMessage = typeof message === 'string'
         ? message.replace(/^\[(Main Log|Renderer|UI|WARN|ERROR|SUCCESS|INFO|DEBUG)\]\s*/i, '').trim()
         : String(message); // Converte não-strings

    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${level}`; // Usa classe para cor

    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `[${timestamp}]`;

    const msgSpan = document.createElement('span');
    msgSpan.className = 'message';
    msgSpan.textContent = cleanMessage; // Usa textContent para segurança

    logEntry.appendChild(timeSpan);
    logEntry.appendChild(msgSpan);
    uiElements.logsElement.appendChild(logEntry);

    // Scroll inteligente para baixo
    const shouldScroll = uiElements.logsElement.scrollHeight - uiElements.logsElement.clientHeight <= uiElements.logsElement.scrollTop + 50; // Tolerância
    if (shouldScroll) {
         uiElements.logsElement.scrollTop = uiElements.logsElement.scrollHeight;
    }
}

function showConnectionPanel(panelToShow, details = '') {
    if (!uiElements.qrCodeContainer || !uiElements.connectedInfoPanel || !uiElements.errorInfoPanel || !uiElements.errorDetailsElement) {
        log('error', "Elementos de painel de conexão ausentes em showConnectionPanel.");
        return;
    }
    uiElements.qrCodeContainer.style.display = panelToShow === 'qr' ? 'flex' : 'none';
    uiElements.connectedInfoPanel.style.display = panelToShow === 'connected' ? 'flex' : 'none';
    uiElements.errorInfoPanel.style.display = panelToShow === 'error' ? 'flex' : 'none';
    if (panelToShow === 'error' && uiElements.errorDetailsElement) {
        uiElements.errorDetailsElement.textContent = details || 'Verifique os logs para mais detalhes.';
    }
}

function getStatusMessage(state) { // Mapeia estado interno para texto na UI
    switch (state) {
        case 'disconnected': return 'Desconectado';
        case 'initializing': return 'Inicializando...';
        case 'scanning': return 'Escaneie o QR Code';
        case 'connecting': return 'Conectando ao WhatsApp...';
        case 'connected': return 'Conectado';
        case 'paused': return 'Pausado';
        case 'error': return 'Erro';
        default: log('warn', `Status desconhecido para mensagem UI: ${state}`); return 'Indefinido';
    }
}

// Atualiza a interface com base no estado recebido do Main
function setUIState(botState, details = '') {
    log('info', `Atualizando Estado UI para: ${botState}${details ? ` (${details})` : ''}`);

    // Atualiza flags internas
    isBotRunning = !['disconnected', 'error'].includes(botState);
    isBotConnected = botState === 'connected' || botState === 'paused';
    isUpdating = botState === 'updating'; // Se tiver um estado 'updating'
    // `isBotPaused` é atualizado pelo evento específico `pause-state-changed`

    // --- Atualização dos Botões ---
    if (uiElements.startButton) {
         const isLoading = botState === 'initializing' || botState === 'connecting';
         uiElements.startButton.disabled = isLoading;
         uiElements.startButton.classList.remove('running'); // Remove sempre e readiciona se necessário

        if (isLoading) {
             uiElements.startButton.textContent = getStatusMessage(botState);
             uiElements.startButton.onclick = null; // Nenhuma ação enquanto carrega
         } else if (isBotRunning && botState !== 'error') { // Bot ativo (connected, paused)
             uiElements.startButton.textContent = '🔌 Parar Bot';
             uiElements.startButton.classList.add('running');
             uiElements.startButton.onclick = stopBot;
         } else { // disconnected ou error
            uiElements.startButton.textContent = '🚀 Iniciar Bot';
            uiElements.startButton.onclick = startBot;
        }
    }

    if (uiElements.pauseButton) {
        const showPauseButton = (botState === 'connected' || botState === 'paused');
        uiElements.pauseButton.style.display = showPauseButton ? 'inline-block' : 'none';
         // Desabilita se não estiver conectado/pausado ou se estiver atualizando
        uiElements.pauseButton.disabled = !showPauseButton || isUpdating;
         uiElements.pauseButton.onclick = togglePause; // Garante handler
         // O texto/estilo será atualizado por `updatePauseButtonVisualState`
    }

    if (uiElements.clearSessionButton) {
         // Permite limpar APENAS se desconectado ou em erro
         uiElements.clearSessionButton.disabled = !(['disconnected', 'error'].includes(botState));
         uiElements.clearSessionButton.onclick = clearSession; // Garante handler
    }

    if (uiElements.checkUpdateButton) {
        if (isUpdateDownloaded) { // Estado: Update baixado, pronto para instalar
            uiElements.checkUpdateButton.textContent = '✅ Reiniciar p/ Atualizar';
            uiElements.checkUpdateButton.classList.add('btn-success'); // Assume .btn-success no CSS
            uiElements.checkUpdateButton.classList.remove('btn-secondary');
            uiElements.checkUpdateButton.disabled = false; // Habilitado
            uiElements.checkUpdateButton.onclick = () => {
                log('info', 'Clicado: Reiniciar para Atualizar.');
                addLogToUI('Reiniciando para instalar...', 'warn');
                window.electronAPI.send('quit-and-install-update');
                uiElements.checkUpdateButton.disabled = true;
                uiElements.checkUpdateButton.textContent = 'Reiniciando...';
            };
         } else { // Estado normal ou baixando
            uiElements.checkUpdateButton.textContent = isUpdating ? 'Verificando/Baixando...' : '🔄 Verificar Atualizações';
            uiElements.checkUpdateButton.classList.remove('btn-success');
            uiElements.checkUpdateButton.classList.add('btn-secondary');
            uiElements.checkUpdateButton.disabled = isUpdating;
            uiElements.checkUpdateButton.onclick = checkForUpdate; // Handler padrão
        }
    }

    // --- Status Visível ---
    if (uiElements.statusElement) {
        uiElements.statusElement.textContent = isBotPaused ? 'Pausado' : getStatusMessage(botState);
        const statusClass = isBotPaused ? 'paused' : botState;
        uiElements.statusElement.className = `status status-${statusClass}`;
    }

    // --- Painéis de Conexão ---
    if (botState === 'scanning') { showConnectionPanel('qr'); if (uiElements.qrPlaceholder) uiElements.qrPlaceholder.textContent = 'Aguardando QR Code...'; }
    else if (botState === 'connected' || botState === 'paused') { showConnectionPanel('connected'); displayQrCode(null); }
    else if (botState === 'error') { showConnectionPanel('error', details); displayQrCode(null); if(uiElements.qrPlaceholder) uiElements.qrPlaceholder.textContent = 'Erro'; }
    else if (botState === 'disconnected') { showConnectionPanel('qr'); displayQrCode(null); if(uiElements.qrPlaceholder) uiElements.qrPlaceholder.textContent = 'Clique em Iniciar Bot'; }
    else if (botState === 'initializing' || botState === 'connecting') { showConnectionPanel('qr'); displayQrCode(null); if(uiElements.qrPlaceholder) uiElements.qrPlaceholder.textContent = getStatusMessage(botState); }
    else { showConnectionPanel('qr'); displayQrCode(null); if(uiElements.qrPlaceholder) uiElements.qrPlaceholder.textContent = ''; } // Estado desconhecido, mostra QR vazio

     // --- Barra de Progresso de Update ---
    if (uiElements.updateProgressContainer) {
         uiElements.updateProgressContainer.style.display = (isUpdating && !isUpdateDownloaded) ? 'block' : 'none';
    }
}

// Atualiza APENAS o botão e o status principal baseado no estado de pausa
function updatePauseButtonVisualState(pausedState) {
    isBotPaused = pausedState; // Atualiza flag local
    log('info', `Atualizando visual de Pausa. Novo estado é ${isBotPaused ? 'PAUSADO' : 'ATIVO'}`);

    if (uiElements.pauseButton) {
        uiElements.pauseButton.textContent = isBotPaused ? '▶️ Continuar' : '⏸️ Pausar';
        uiElements.pauseButton.title = isBotPaused ? 'Continuar o recebimento de mensagens' : 'Pausar o recebimento de novas mensagens';
        uiElements.pauseButton.classList.toggle('paused-state', isBotPaused); // Classe CSS opcional
        uiElements.pauseButton.disabled = !isBotConnected || isUpdating; // Só habilita se conectado E não atualizando
    }

    // Atualiza o status principal na barra superior também, se o bot estiver conectado
    if (uiElements.statusElement && isBotConnected) {
         uiElements.statusElement.textContent = isBotPaused ? 'Pausado' : 'Conectado';
         uiElements.statusElement.className = `status status-${isBotPaused ? 'paused' : 'connected'}`;
    }
}

function displayQrCode(qrDataUrl) {
    if (!uiElements.qrCodeImage || !uiElements.qrPlaceholder || !uiElements.qrCodeContainer) {
        log('error', "Elementos QR ausentes em displayQrCode.");
        return;
    }
    if (qrDataUrl) {
        uiElements.qrCodeImage.src = qrDataUrl;
        uiElements.qrCodeImage.style.display = 'block';
        uiElements.qrPlaceholder.textContent = 'Aponte a câmera do WhatsApp aqui';
        uiElements.qrPlaceholder.style.display = 'block';
    } else { // Limpar QR
        uiElements.qrCodeImage.src = '';
        uiElements.qrCodeImage.style.display = 'none';
        // O texto do placeholder (se container visível) é controlado por setUIState
        uiElements.qrPlaceholder.style.display = uiElements.qrCodeContainer.style.display === 'flex' ? 'block' : 'none';
    }
}


// --- Funções de Regras ---

function renderRules(rules) {
    if (!uiElements.rulesListElement) {
        log('error', 'Elemento #rulesList não encontrado para renderizar regras.');
        return;
    }
    currentRules = Array.isArray(rules) ? rules : []; // Garante que seja array
    log('info', `Renderizando ${currentRules.length} regra(s) na lista.`);
    uiElements.rulesListElement.innerHTML = ''; // Limpa lista anterior

    if (currentRules.length === 0) {
        uiElements.rulesListElement.innerHTML = '<li class="rule-item-placeholder">Nenhuma regra configurada. Clique em "Adicionar Nova Regra".</li>';
        return;
    }

    const fragment = document.createDocumentFragment(); // Otimiza manipulação do DOM
    currentRules.forEach((rule, index) => {
        const li = document.createElement('li');
        li.className = 'rule-item';
        li.dataset.index = index; // Referência fácil

        // Container principal da regra (layout flex)
        const contentDiv = document.createElement('div');
        contentDiv.className = 'rule-content';

        // Detalhes da regra (à esquerda)
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'rule-details';
        detailsDiv.innerHTML = `
            <div class="rule-info triggers"><strong>Gatilhos: </strong>${
                (rule.triggers && rule.triggers.length > 0)
                ? rule.triggers.map(t => `<span class="trigger-tag">${escapeHtml(t)}</span>`).join(' ')
                : '<span><em>(Qualquer mensagem)</em></span>' // Ou (Nenhum) se preferir
            }</div>
            <div class="rule-info response"><strong>Resposta: </strong><span style="font-style:${rule.response ? 'normal' : 'italic'}">${escapeHtml(rule.response || '(Sem resposta)')}</span></div>
            ${rule.isLeadQualifier && rule.forwardTo ? `
                <div class="rule-info forwarding"><strong>↪ Encaminhar p/: </strong><span>${escapeHtml(rule.forwardTo.split('@')[0] ?? '???')} ${rule.forwardMessagePrefix ? `(Prefixo: "${escapeHtml(rule.forwardMessagePrefix)}")` : ''}</span></div>
            ` : ''}
        `;
        contentDiv.appendChild(detailsDiv);

        // Ações da regra (à direita)
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'rule-actions';
        actionsDiv.innerHTML = `
            <button class="btn-icon rule-edit-button" title="Editar Regra" data-index="${index}">✏️</button>
            <button class="btn-icon rule-delete-button" title="Excluir Regra" data-index="${index}">❌</button>
        `;
        // Adiciona listeners diretamente aqui (ou usa delegação de eventos)
        actionsDiv.querySelector('.rule-edit-button').addEventListener('click', handleEditRuleClick);
        actionsDiv.querySelector('.rule-delete-button').addEventListener('click', handleDeleteRuleClick);

        contentDiv.appendChild(actionsDiv);
        li.appendChild(contentDiv);
        fragment.appendChild(li);
    });

    uiElements.rulesListElement.appendChild(fragment); // Adiciona tudo ao DOM de uma vez
}

function handleEditRuleClick(event) {
    event.stopPropagation(); // Evita acionar outros listeners
    const index = parseInt(event.currentTarget.dataset.index, 10);
    if (!isNaN(index) && currentRules[index]) {
        showEditForm(currentRules[index], index);
        // Marca item como 'editando'
        document.querySelectorAll('.rule-item.editing').forEach(el => el.classList.remove('editing'));
        event.currentTarget.closest('.rule-item')?.classList.add('editing');
    } else {
        log('error', `Índice inválido ou regra não encontrada para editar: ${index}`);
    }
}

function handleDeleteRuleClick(event) {
    event.stopPropagation();
    const index = parseInt(event.currentTarget.dataset.index, 10);
    if (isNaN(index) || !currentRules[index]) {
        log('error', `Índice inválido ou regra não encontrada para excluir: ${index}`);
        return;
    }
    const rule = currentRules[index];
    const confirmMsg = `Excluir esta regra?\n\nGatilhos: ${rule.triggers?.join(', ') || '-'}\nResposta: ${rule.response || '-'}`;
    if (confirm(confirmMsg)) {
        log('warn', `Solicitando exclusão da regra índice ${index}...`);
        addLogToUI(`Excluindo regra ${index + 1}...`, 'warn');
        event.currentTarget.closest('.rule-actions')?.querySelectorAll('button').forEach(b => b.disabled = true); // Desabilita botões
        window.electronAPI.send('delete-rule', index);
    }
}

function showEditForm(rule = null, index = -1) {
    // Verifica elementos do form
    if (!uiElements.editRuleForm || !uiElements.addNewRuleButton || !uiElements.formRuleTitle /* ...etc */) {
        log('error', 'Formulário de regras incompleto, impossível abrir.');
        addLogToUI('Erro: Formulário de regras quebrado.', 'error'); return;
    }
    hideEditForm(); // Limpa estado anterior
    uiElements.formRuleIndexInput.value = index;

    if (rule) { // Edição
        log('info', `Abrindo form para editar regra ${index}`);
        uiElements.formRuleTitle.textContent = 'Editar Regra';
        uiElements.formRuleTriggersInput.value = (rule.triggers || []).join(', ');
        uiElements.formRuleResponseInput.value = rule.response || '';
        uiElements.formRuleIsLeadInput.checked = !!rule.isLeadQualifier;
        uiElements.formRuleForwardToInput.value = rule.forwardTo || '';
        uiElements.formRuleForwardPrefixInput.value = rule.forwardMessagePrefix || '';
    } else { // Adição
        log('info', 'Abrindo form para nova regra.');
        uiElements.formRuleTitle.textContent = 'Adicionar Nova Regra';
        // Limpa campos
        ['formRuleTriggersInput', 'formRuleResponseInput', 'formRuleForwardToInput', 'formRuleForwardPrefixInput'].forEach(key => uiElements[key].value = '');
        uiElements.formRuleIsLeadInput.checked = false;
    }

    // Visibilidade das opções de lead
    uiElements.formForwardingOptions.style.display = uiElements.formRuleIsLeadInput.checked ? 'block' : 'none';
    uiElements.editRuleForm.style.display = 'block';
    uiElements.addNewRuleButton.style.display = 'none'; // Esconde botão Adicionar
    uiElements.formRuleTriggersInput.focus();
    if(uiElements.formRuleStatus) { uiElements.formRuleStatus.textContent = ''; uiElements.formRuleStatus.className = 'form-status'; }
    if(uiElements.saveRuleFormButton) { uiElements.saveRuleFormButton.disabled = false; uiElements.saveRuleFormButton.textContent = 'Salvar Regra'; }
    if(uiElements.cancelRuleEditButton) { uiElements.cancelRuleEditButton.disabled = false; }
}

function hideEditForm() {
    if (uiElements.editRuleForm) uiElements.editRuleForm.style.display = 'none';
    if (uiElements.addNewRuleButton) uiElements.addNewRuleButton.style.display = 'block';
    // Limpa marcação de edição na lista
    document.querySelectorAll('.rule-item.editing').forEach(el => el.classList.remove('editing'));
}

function handleSaveRule() {
    // Validação inicial dos elementos do form
    if (!uiElements.formRuleStatus || !uiElements.formRuleTriggersInput || !uiElements.formRuleResponseInput || !uiElements.formRuleIsLeadInput ||
         !uiElements.formRuleForwardToInput || !uiElements.formRuleForwardPrefixInput || !uiElements.formRuleIndexInput || !uiElements.saveRuleFormButton || !uiElements.cancelRuleEditButton) {
         log('error', "Formulário de regra incompleto ao tentar salvar.");
         addLogToUI("Erro: Falha ao acessar campos do formulário.", "error");
         return;
     }
     uiElements.formRuleStatus.textContent = ''; uiElements.formRuleStatus.className = 'form-status';

    // Coleta e limpeza
    const triggers = uiElements.formRuleTriggersInput.value.split(',').map(t => t.trim()).filter(t => t);
    const response = uiElements.formRuleResponseInput.value.trim();
    const isLead = uiElements.formRuleIsLeadInput.checked;
    const forwardToRaw = uiElements.formRuleForwardToInput.value.trim();
    const forwardTo = isLead ? forwardToRaw.toLowerCase() : null;
    const prefix = (isLead && forwardTo) ? uiElements.formRuleForwardPrefixInput.value.trim() : null;
    const index = parseInt(uiElements.formRuleIndexInput.value, 10);

    // Validação Lógica (Renderer-side, main também valida)
    let errors = [];
    if (triggers.length === 0 && !isLead) errors.push("Gatilhos são necessários.");
    if (!response && !forwardTo) errors.push("É necessário Resposta OU Encaminhamento de Lead com número.");
    if (isLead && (!forwardTo || !/^\+?\d{10,15}@c\.us$/.test(forwardTo))) errors.push("Número p/ encaminhar inválido (ex: +5511.. ou 5511..@c.us).");
    if (triggers.length === 0 && !response && !isLead) errors.push("Regra está vazia.");

    if (errors.length > 0) {
        const errorMsg = errors.join(' ');
        uiElements.formRuleStatus.textContent = errorMsg; uiElements.formRuleStatus.classList.add('error');
        log('warn', `Validação falhou: ${errorMsg}`); addLogToUI(`Falha ao salvar: ${errorMsg}`, 'warn');
        return; // Não envia
    }

    // Prepara dados e envia
    const ruleData = { triggers, response: response || null, isLeadQualifier: isLead, forwardTo, forwardMessagePrefix: prefix || null };
    log('info', `Enviando regra para salvar (Índice: ${index})...`, ruleData);
    addLogToUI('Salvando regra...', 'info');

    // Desabilita botões do form
    uiElements.saveRuleFormButton.disabled = true; uiElements.saveRuleFormButton.textContent = 'Salvando...';
    uiElements.cancelRuleEditButton.disabled = true;

    window.electronAPI.send('save-rule', { index, rule: ruleData });
}

// Função para escapar HTML (simples, para evitar XSS básico)
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;
    const div = document.createElement('div');
    div.textContent = unsafe;
    return div.innerHTML;
}


// --- Funções de Controle do Bot (Comunicação com Main) ---
function startBot() { log("info", "UI: Clicado Iniciar Bot"); addLogToUI("Solicitando inicialização...", "info"); window.electronAPI.send('start-bot'); }
function stopBot() { if (confirm("Parar o bot e desconectar?")) { log("warn", "UI: Clicado Parar Bot"); addLogToUI("Solicitando parada...", "warn"); window.electronAPI.send('stop-bot'); }}
function togglePause() { const action = isBotPaused ? 'Continuar' : 'Pausar'; log('info', `UI: Clicado ${action}`); addLogToUI(`Solicitando ${action.toLowerCase()}...`, "info"); window.electronAPI.send('toggle-pause-bot'); }
function clearSession() { if (confirm("ATENÇÃO:\nLimpar a sessão exigirá novo scan de QR Code!\n\nContinuar?")) { log('warn', "UI: Clicado Limpar Sessão"); addLogToUI("Solicitando limpeza de sessão...", "warn"); window.electronAPI.send('clear-session-request'); }}
function checkForUpdate() { if(isUpdating || isUpdateDownloaded) return; log('info', 'UI: Clicado Verificar Updates'); addLogToUI("Verificando atualizações...", "info"); isUpdating = true; setUIState(currentStatus); /* Atualiza botão */ window.electronAPI.send('check-for-update-request'); }

// --- Event Listeners da UI ---
document.addEventListener('DOMContentLoaded', () => {
    log("info", "DOM Carregado. Configurando listeners da UI...");

    // Adiciona listeners aos botões principais, se existirem
    if (uiElements.startButton) uiElements.startButton.onclick = startBot; // Define inicial
    if (uiElements.pauseButton) uiElements.pauseButton.onclick = togglePause;
    if (uiElements.checkUpdateButton) uiElements.checkUpdateButton.onclick = checkForUpdate;
    if (uiElements.clearSessionButton) uiElements.clearSessionButton.onclick = clearSession;

    // Listeners do formulário de regras
    if (uiElements.addNewRuleButton) uiElements.addNewRuleButton.onclick = () => showEditForm(null, -1); // Passa -1 explicitamente
    if (uiElements.cancelRuleEditButton) uiElements.cancelRuleEditButton.onclick = hideEditForm;
    if (uiElements.saveRuleFormButton) uiElements.saveRuleFormButton.onclick = handleSaveRule;
    if (uiElements.formRuleIsLeadInput && uiElements.formForwardingOptions) {
        uiElements.formRuleIsLeadInput.addEventListener('change', () => {
            uiElements.formForwardingOptions.style.display = uiElements.formRuleIsLeadInput.checked ? 'block' : 'none';
        });
    }

    // --- Listeners do Processo Principal (IPC) ---
    log("info", "Configurando listeners IPC (Main -> Renderer)...");

    window.electronAPI.on('log-message', (message, level = 'info') => addLogToUI(message, level));
    window.electronAPI.on('update-status', (newState, details = '') => setUIState(newState, details));
    window.electronAPI.on('display-qr', (qrUrl) => { log('info', 'QR Recebido.'); displayQrCode(qrUrl); if(uiElements.qrPlaceholder) uiElements.qrPlaceholder.textContent = 'Aponte a câmera do WhatsApp aqui';});
    window.electronAPI.on('clear-qr', () => { log('info', 'Limpando QR.'); displayQrCode(null); if (isBotConnected && uiElements.connectedInfoPanel) showConnectionPanel('connected'); });
    window.electronAPI.on('rules-loaded', (rules) => { log('info', `Regras (${rules?.length ?? 0}) recebidas.`); renderRules(rules); });

    window.electronAPI.on('rule-save-status', ({ success, message, updatedRules }) => {
        log(success ? 'info' : 'error', `Salvar regra: ${message}`);
        if(uiElements.saveRuleFormButton) { uiElements.saveRuleFormButton.disabled = false; uiElements.saveRuleFormButton.textContent = 'Salvar Regra'; }
        if(uiElements.cancelRuleEditButton) { uiElements.cancelRuleEditButton.disabled = false; }
        if(uiElements.formRuleStatus) { uiElements.formRuleStatus.textContent = message; uiElements.formRuleStatus.className = `form-status ${success ? 'success' : 'error'}`; }
        if (success) { renderRules(updatedRules); setTimeout(hideEditForm, 1500); } // Fecha form após sucesso
        else { addLogToUI(`Falha ao salvar: ${message}`, 'error'); } // Loga erro na UI
    });

    window.electronAPI.on('rule-delete-status', ({ success, message, updatedRules }) => {
        log(success ? 'info' : 'error', `Excluir regra: ${message}`);
        renderRules(updatedRules); // Atualiza lista sempre
        addLogToUI(message, success ? 'success' : 'error');
        if(!success) alert("Erro ao excluir regra: " + message); // Alerta em caso de falha
         // Reabilita botões na linha correspondente (mais complexo - re-render já resolve visualmente)
         // const actionButtons = uiElements.rulesListElement?.querySelector(`.rule-item[data-index="?"] .rule-actions button`);
    });

    window.electronAPI.on('pause-state-changed', (paused) => { log('info','Estado de pausa mudou.'); updatePauseButtonVisualState(paused); });

    // -- Handlers de Update (Revisados) --
    window.electronAPI.on('update-available', (info) => {
        log('warn', `Update Disponível: v${info.version}`); isUpdating = false; isUpdateDownloaded = false; // Permite baixar
        addLogToUI(`Nova versão (${info.version}) disponível! Download iniciado automaticamente ou aguardando confirmação.`, 'warn');
         setUIState(currentStatus); // Reabilita botão "Verificar" se não baixar auto
    });
    window.electronAPI.on('update-not-available', () => {
        log('info', 'Nenhum update encontrado.'); isUpdating = false; isUpdateDownloaded = false;
        addLogToUI('Você já tem a versão mais recente.', 'info'); setUIState(currentStatus); // Atualiza UI
         // Esconde progresso se estava visível
        if(uiElements.updateProgressContainer) uiElements.updateProgressContainer.style.display = 'none';
    });
    window.electronAPI.on('update-download-progress', (percent) => {
        isUpdating = true; isUpdateDownloaded = false; // Está baixando
         if (uiElements.updateProgressContainer && uiElements.updateProgressBar && uiElements.updateProgressLabel) {
             uiElements.updateProgressContainer.style.display = 'block';
             uiElements.updateProgressBar.value = percent;
             if (!uiElements.updateProgressBar.hasAttribute('value')) uiElements.updateProgressBar.setAttribute('value', percent);
             uiElements.updateProgressLabel.textContent = `Baixando... ${percent.toFixed(0)}%`;
         }
        setUIState(currentStatus); // Mantém botão "Verificar" desabilitado e com texto "Baixando"
    });
    window.electronAPI.on('update-downloaded', (info) => {
        log('warn', `Update v${info.version} BAIXADO!`); isUpdating = false; isUpdateDownloaded = true; // Pronto para instalar
        addLogToUI(`Atualização (${info.version}) baixada! Clique em 'Reiniciar p/ Atualizar'.`, 'success');
        setUIState(currentStatus); // Chama para atualizar o botão "Verificar" para "Reiniciar"
    });
    window.electronAPI.on('update-error', (errorMessage) => {
        log('error', `Erro Update: ${errorMessage}`); isUpdating = false; isUpdateDownloaded = false;
        addLogToUI(`Erro na atualização: ${errorMessage}`, 'error'); setUIState(currentStatus); // Atualiza UI
        if(uiElements.updateProgressContainer) uiElements.updateProgressContainer.style.display = 'none';
    });

    // --- Inicialização ---
    addLogToUI("Interface pronta. Solicitando estado e regras...", "info");
    window.electronAPI.send('get-initial-state'); // Pede estado ao Main
    // load-rules é chamado dentro do get-initial-state/main window creation agora

    // Define estado inicial visualmente (será corrigido pelo get-initial-state)
    setUIState('disconnected');

    log("info", "Renderer: Configuração de Listeners e Inicialização completa.");

}); // Fim DOMContentLoaded


// --- Limpeza (Opcional, mas boa prática) ---
window.addEventListener('beforeunload', () => {
     log('info', 'Renderer: Descarregando janela. Removendo listeners IPC...');
     // Tentar remover todos os listeners configurados via .on()
     // window.electronAPI?.removeAllListeners('log-message');
     // window.electronAPI?.removeAllListeners('update-status');
     // ... etc para todos os canais ouvidos ...
     // Nota: A API precisa ser projetada para que removeAllListeners funcione corretamente ou retornar as funções de unsubscribe do .on() e chamá-las aqui.
});