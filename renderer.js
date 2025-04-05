// ./renderer.js - VERSÃO MELHORADA (Continuação e Finalização)

// --- Referências DOM (Confirmar IDs com o HTML atualizado) ---
const startButton = document.getElementById('startButton');
const pauseButton = document.getElementById('pauseButton');
const statusElement = document.getElementById('status');
const logsElement = document.getElementById('logs');
const checkUpdateButton = document.getElementById('checkUpdateButton');
const clearSessionButton = document.getElementById('clearSessionButton');
const qrCodeContainer = document.getElementById('qr-code-container');
const qrCodeImage = document.getElementById('qr-code-image');
const qrPlaceholder = document.getElementById('qr-placeholder');
const connectedInfoPanel = document.getElementById('connected-info-panel');
const errorInfoPanel = document.getElementById('error-info-panel'); // Novo painel de erro
const errorDetailsElement = document.getElementById('error-details'); // Para detalhes do erro
const updateProgressContainer = document.getElementById('updateProgressContainer');
const updateProgressBar = document.getElementById('updateProgressBar');
const updateProgressLabel = document.getElementById('updateProgressLabel');
const rulesListElement = document.getElementById('rulesList');
const addNewRuleButton = document.getElementById('addNewRuleButton');
const editRuleForm = document.getElementById('editRuleForm');
const formRuleTitle = document.getElementById('formRuleTitle');
const formRuleIndexInput = document.getElementById('formRuleIndex');
const formRuleTriggersInput = document.getElementById('formRuleTriggers');
const formRuleResponseInput = document.getElementById('formRuleResponse');
const formRuleIsLeadInput = document.getElementById('formRuleIsLead');
const formForwardingOptions = document.getElementById('formForwardingOptions');
const formRuleForwardToInput = document.getElementById('formRuleForwardTo');
const formRuleForwardPrefixInput = document.getElementById('formRuleForwardPrefix');
const saveRuleFormButton = document.getElementById('saveRuleFormButton');
const cancelRuleEditButton = document.getElementById('cancelRuleEditButton');
const formRuleStatus = document.getElementById('formRuleStatus');

// --- Estados UI ---
let isBotRunning = false;
let isBotConnected = false;
let isBotPaused = false;
let currentRules = [];
let isUpdating = false;

// --- Funções Auxiliares UI ---

// Log melhorado com timestamp e tipo
function addLog(message, level = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const cleanMessage = message.startsWith('[') && message.includes(']') ? message.substring(message.indexOf(']') + 2) : message;
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${level}`;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp';
    timeSpan.textContent = `[${timestamp}]`;
    const msgSpan = document.createElement('span');
    msgSpan.className = 'message';
    msgSpan.textContent = cleanMessage;
    logEntry.appendChild(timeSpan);
    logEntry.appendChild(msgSpan);
    logsElement.appendChild(logEntry);
    logsElement.scrollTo({ top: logsElement.scrollHeight, behavior: 'smooth' });

    switch (level) {
        case 'error': console.error(`UI Log: ${cleanMessage}`); break;
        case 'warn': console.warn(`UI Log: ${cleanMessage}`); break;
        default: console.log(`UI Log: ${cleanMessage}`); break;
    }
}

// Controla a visibilidade dos painéis de status de conexão
function showConnectionPanel(panelToShow, details = 'Verifique os logs.') {
    qrCodeContainer.style.display = panelToShow === 'qr' ? 'flex' : 'none';
    connectedInfoPanel.style.display = panelToShow === 'connected' ? 'flex' : 'none';
    errorInfoPanel.style.display = panelToShow === 'error' ? 'flex' : 'none';
    if (panelToShow === 'error') {
        errorDetailsElement.textContent = details;
    }
}

// Define o estado geral da interface
function setUIState(botState, details = '') {
    console.log(`UI State Change Requested: ${botState}`, details);
    isBotRunning = !['disconnected', 'error'].includes(botState);
    isBotConnected = botState === 'connected' || botState === 'paused';

    // Botão Iniciar / Parar
    if (startButton) {
        startButton.disabled = botState === 'initializing' || botState === 'connecting';
        if (isBotRunning && botState !== 'initializing' && botState !== 'connecting') {
            startButton.textContent = '🔌 Parar Bot';
            startButton.classList.add('running');
            startButton.onclick = stopBot;
        } else if (botState === 'initializing' || botState === 'connecting') {
            startButton.textContent = '⏳ Conectando...';
            startButton.classList.remove('running');
            startButton.onclick = null;
        } else {
            startButton.textContent = '🚀 Iniciar Bot';
            startButton.classList.remove('running');
            startButton.onclick = startBot;
        }
    } else { console.error("startButton not found in setUIState");}

    // Botão Pausar / Continuar
     if(pauseButton) {
        pauseButton.style.display = isBotConnected ? 'inline-block' : 'none';
        // Não permitir pausar/continuar durante a inicialização/conexão
        pauseButton.disabled = !isBotConnected || botState === 'initializing' || botState === 'connecting';
         // Sincroniza estado do botão com o estado real do bot (isBotPaused)
         // A atualização visual específica (texto/cor) será feita pelo `pause-state-changed`
     } else { console.error("pauseButton not found in setUIState");}


    // Botão Limpar Sessão
     if(clearSessionButton) clearSessionButton.disabled = isBotRunning;
     else { console.error("clearSessionButton not found in setUIState"); }


    // Botão Verificar Update
    if (checkUpdateButton) checkUpdateButton.disabled = isUpdating;
     else { console.error("checkUpdateButton not found in setUIState"); }

     // Atualiza Status Visível
    if (statusElement) {
        statusElement.textContent = getStatusMessage(botState);
        statusElement.className = `status status-${botState}`;
    } else { console.error("statusElement not found in setUIState"); }


    // Controla painéis de conexão e placeholder QR
    if (botState === 'scanning') {
        showConnectionPanel('qr');
        qrPlaceholder.textContent = 'Aponte a câmera do WhatsApp aqui'; // Instrução clara
    } else if (botState === 'connected' || botState === 'paused') {
        showConnectionPanel('connected');
        displayQrCode(null); // Limpa QR e placeholder
        qrPlaceholder.textContent = '';
    } else if (botState === 'error') {
        showConnectionPanel('error', details || "Ocorreu um erro.");
        displayQrCode(null);
        qrPlaceholder.textContent = 'Erro na conexão';
    } else if (botState === 'disconnected') {
        showConnectionPanel('qr'); // Mostrar container QR
        displayQrCode(null); // Sem imagem QR
        qrPlaceholder.textContent = 'Clique em Iniciar Bot';
    } else if (botState === 'initializing' || botState === 'connecting') {
         showConnectionPanel('qr');
         displayQrCode(null);
         qrPlaceholder.textContent = getStatusMessage(botState); // Exibe "Inicializando..." ou "Conectando..."
    }
}

// Gera mensagens de status mais descritivas
function getStatusMessage(state) {
    switch (state) {
        case 'disconnected': return 'Desconectado';
        case 'initializing': return 'Inicializando...';
        case 'scanning': return 'Escaneie o QR Code';
        case 'connecting': return 'Conectando ao WhatsApp...';
        case 'connected': return 'Conectado';
        case 'paused': return 'Pausado';
        case 'error': return 'Erro na Conexão';
        default: return 'Indefinido';
    }
}

// Atualiza o botão de pausa
function updatePauseButtonVisualState(paused) {
    isBotPaused = paused; // Atualiza estado global
     if (pauseButton) {
         pauseButton.textContent = isBotPaused ? '▶️ Continuar' : '⏸️ Pausar';
         pauseButton.classList.toggle('paused', isBotPaused);
         pauseButton.title = isBotPaused ? 'Continuar o recebimento de mensagens' : 'Pausar o recebimento de novas mensagens';
         // Se conectado, atualiza status principal também
         if (isBotConnected) {
              statusElement.textContent = isBotPaused ? 'Pausado' : 'Conectado';
              statusElement.className = `status ${isBotPaused ? 'status-paused' : 'status-connected'}`;
         }
     } else {
        console.error("Pause button not found during visual update");
     }
}


// Atualiza painel de QR Code
function displayQrCode(qrDataUrl) {
     if (!qrCodeImage || !qrPlaceholder) {
        console.error("QR Code elements not found");
        return;
     }
    if (qrDataUrl) {
        qrCodeImage.src = qrDataUrl;
        qrCodeImage.style.display = 'block';
        qrPlaceholder.style.display = 'none';
    } else {
        qrCodeImage.src = '';
        qrCodeImage.style.display = 'none';
        qrPlaceholder.style.display = 'block'; // Mostra placeholder se não há QR
    }
}

// Renderiza a lista de regras (código anterior estava correto, colado aqui para completude)
function renderRules(rules) {
    currentRules = Array.isArray(rules) ? rules : [];
    rulesListElement.innerHTML = ''; // Limpa a lista
    if (currentRules.length === 0) {
        rulesListElement.innerHTML = '<li class="rule-item-placeholder">Nenhuma regra configurada. Clique em "Adicionar Nova Regra".</li>';
        return;
    }

    currentRules.forEach((rule, index) => {
        const li = document.createElement('li');
        li.className = 'rule-item';
        li.dataset.index = index;

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'rule-details';

        const triggersDiv = document.createElement('div');
        triggersDiv.className = 'triggers';
        (rule.triggers || []).forEach(trigger => {
            const span = document.createElement('span');
            span.textContent = trigger;
            triggersDiv.appendChild(span);
        });
        detailsDiv.appendChild(triggersDiv);

        const responseSpan = document.createElement('span');
        responseSpan.className = 'response';
        responseSpan.textContent = rule.response || '(Sem resposta definida)';
        detailsDiv.appendChild(responseSpan);

        if (rule.isLeadQualifier && rule.forwardTo) {
            const forwardSpan = document.createElement('span');
            forwardSpan.className = 'forwarding';
            const targetNumber = rule.forwardTo.split('@')[0];
            let forwardText = `Lead p/ ${targetNumber}`;
            if (rule.forwardMessagePrefix) {
                forwardText += ` (Prefixo: "${rule.forwardMessagePrefix}")`;
            }
            forwardSpan.textContent = forwardText;
            detailsDiv.appendChild(forwardSpan);
        }

        li.appendChild(detailsDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'rule-actions';

        const editBtn = document.createElement('button');
        editBtn.innerHTML = '✏️';
        editBtn.className = 'btn-icon rule-edit-button';
        editBtn.title = 'Editar Regra';
        editBtn.onclick = (e) => {
            e.stopPropagation();
            showEditForm(rule, index);
            document.querySelectorAll('.rule-item.editing').forEach(el => el.classList.remove('editing'));
            li.classList.add('editing');
        };
        actionsDiv.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.innerHTML = '❌';
        deleteBtn.className = 'btn-icon rule-delete-button';
        deleteBtn.title = 'Excluir Regra';
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm(`Tem certeza que deseja excluir esta regra?\n\nGatilhos: ${rule.triggers.join(', ')}\nResposta: ${rule.response}`)) {
                addLog(`Solicitando exclusão da regra índice ${index}...`, 'warn');
                window.electronAPI.send('delete-rule', index);
            }
        };
        actionsDiv.appendChild(deleteBtn);

        li.appendChild(actionsDiv);
        rulesListElement.appendChild(li);
    });
}

// Mostra o formulário para adicionar ou editar regra (código anterior correto)
function showEditForm(rule = null, index = -1) {
    // Certifique-se que os elementos existem
     if (!editRuleForm || !addNewRuleButton || !formRuleIndexInput || !formRuleTitle ||
        !formRuleTriggersInput || !formRuleResponseInput || !formRuleIsLeadInput ||
        !formRuleForwardToInput || !formRuleForwardPrefixInput || !formForwardingOptions || !formRuleStatus) {
         console.error("Um ou mais elementos do formulário não foram encontrados!");
         addLog("Erro: Não foi possível abrir o formulário de regras.", "error");
         return; // Impede a execução se elementos cruciais faltam
     }

    hideEditForm(); // Fecha qualquer outro form aberto
    formRuleIndexInput.value = index;

    if (rule) { // Editando
        formRuleTitle.textContent = 'Editar Regra';
        formRuleTriggersInput.value = (rule.triggers || []).join(', ');
        formRuleResponseInput.value = rule.response || '';
        formRuleIsLeadInput.checked = !!rule.isLeadQualifier;
        formRuleForwardToInput.value = rule.forwardTo || '';
        formRuleForwardPrefixInput.value = rule.forwardMessagePrefix || '';
         const listItem = rulesListElement.querySelector(`.rule-item[data-index="${index}"]`);
        if (listItem) listItem.classList.add('editing');
    } else { // Adicionando
        formRuleTitle.textContent = 'Adicionar Nova Regra';
        formRuleTriggersInput.value = '';
        formRuleResponseInput.value = '';
        formRuleIsLeadInput.checked = false;
        formRuleForwardToInput.value = '';
        formRuleForwardPrefixInput.value = '';
    }

    formForwardingOptions.style.display = formRuleIsLeadInput.checked ? 'block' : 'none';
    editRuleForm.style.display = 'block';
    addNewRuleButton.style.display = 'none';
    formRuleTriggersInput.focus();
    formRuleStatus.textContent = '';
    formRuleStatus.className = 'form-status'; // Reset class
}


// Esconde o formulário de edição (código anterior correto)
function hideEditForm() {
    if(editRuleForm) editRuleForm.style.display = 'none';
    if(addNewRuleButton) addNewRuleButton.style.display = 'block';
    if(formRuleStatus) formRuleStatus.textContent = '';
    document.querySelectorAll('.rule-item.editing').forEach(el => el.classList.remove('editing'));
}

// --- Funções de Controle do Bot ---
function startBot() {
    console.log("UI: Start Button Clicked");
    addLog("Solicitando inicialização do bot...", "info");
    displayQrCode(null); // Limpa QR anterior
    qrPlaceholder.textContent = 'Inicializando...'; // Define placeholder inicial
    setUIState('initializing');
    window.electronAPI.send('start-bot');
}

function stopBot() {
     if (confirm("Tem certeza que deseja parar o bot e desconectar do WhatsApp?")) {
        console.log("UI: Stop Button Clicked");
        addLog("Solicitando parada do bot...", "warn");
        // Mudar estado imediatamente, mas aguardar confirmação do main se necessário
        setUIState('disconnected');
        window.electronAPI.send('stop-bot'); // Precisa implementar isso no main.js
     }
}

function togglePause() {
     const wantsToPause = !isBotPaused; // Verifica o estado atual
    console.log(`UI: Toggle Pause Clicked (Current: ${isBotPaused}, Wants to ${wantsToPause ? 'Pause' : 'Continue'})`);
    addLog(`Solicitando ${wantsToPause ? 'pausar' : 'continuar'} o bot...`, "info");
     window.electronAPI.send('toggle-pause-bot');
     // A atualização visual final virá do evento 'pause-state-changed'
}

function clearSession() {
    console.log("UI: Clear Session Clicked");
    if (confirm("ATENÇÃO:\nIsso limpará os dados de sessão salvos e exigirá um novo scan do QR Code na próxima vez que iniciar.\n\nTem certeza que deseja continuar?")) {
        addLog("Solicitando limpeza da sessão salva...", "warn");
        window.electronAPI.send('clear-session-request');
        // UI deve ser atualizada pela resposta do main, idealmente para 'disconnected'
    }
}


// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM carregado. Verificando elementos e adicionando listeners...");

    // Verifica a existência de CADA elemento antes de adicionar listener
    if (startButton) startButton.onclick = startBot;
    else console.error("! startButton não encontrado no DOM");

    if (pauseButton) pauseButton.addEventListener('click', togglePause);
    else console.error("! pauseButton não encontrado no DOM");

    if (checkUpdateButton) checkUpdateButton.addEventListener('click', () => {
        if (isUpdating) return;
        isUpdating = true;
        checkUpdateButton.disabled = true;
        checkUpdateButton.textContent = 'Verificando...';
        addLog("Verificando atualizações...", "info");
        if (updateProgressContainer && updateProgressLabel && updateProgressBar) {
            updateProgressLabel.textContent = 'Verificando...';
            updateProgressBar.removeAttribute('value'); // Indeterminate
            updateProgressContainer.style.display = 'block';
        } else { console.error("! Elementos de progresso da atualização não encontrados"); }
        window.electronAPI.send('check-for-update-request');
    });
    else console.error("! checkUpdateButton não encontrado no DOM");

    if (clearSessionButton) clearSessionButton.addEventListener('click', clearSession);
    else console.error("! clearSessionButton não encontrado no DOM");

    if (addNewRuleButton) addNewRuleButton.addEventListener('click', () => showEditForm());
    else console.error("! addNewRuleButton não encontrado no DOM");

    if (cancelRuleEditButton) cancelRuleEditButton.addEventListener('click', hideEditForm);
    else console.error("! cancelRuleEditButton não encontrado no DOM");

    if (formRuleIsLeadInput) formRuleIsLeadInput.addEventListener('change', () => {
        if(formForwardingOptions) formForwardingOptions.style.display = formRuleIsLeadInput.checked ? 'block' : 'none';
        else console.error("! formForwardingOptions não encontrado no DOM");
    });
    else console.error("! formRuleIsLeadInput não encontrado no DOM");

    if (saveRuleFormButton) saveRuleFormButton.addEventListener('click', () => {
        if (!formRuleStatus || !formRuleTriggersInput || !formRuleResponseInput || !formRuleIsLeadInput || !formRuleForwardToInput || !formRuleForwardPrefixInput || !formRuleIndexInput) {
             console.error("! Campos do formulário de regra não encontrados ao tentar salvar.");
             addLog("Erro crítico: Campos do formulário ausentes.", "error");
             return;
        }

        formRuleStatus.textContent = '';
        formRuleStatus.className = 'form-status'; // Reset class

        const triggers = formRuleTriggersInput.value.split(',').map(t => t.trim()).filter(t => t);
        const response = formRuleResponseInput.value.trim();
        const isLead = formRuleIsLeadInput.checked;
        const forwardTo = formRuleForwardToInput.value.trim();
        const prefix = formRuleForwardPrefixInput.value.trim();
        const index = parseInt(formRuleIndexInput.value, 10);

        let errors = [];
        if (triggers.length === 0) errors.push("Pelo menos um gatilho é necessário.");
        // Só exige resposta se NÃO for marcado como lead OU se for lead mas NÃO tiver número de encaminhamento
        if (!response && (!isLead || !forwardTo)) errors.push("É necessário uma Resposta OU marcar como Lead com um número para encaminhar.");
        if (isLead && (!forwardTo || !/^\d{10,}@c\.us$/.test(forwardTo))) errors.push("Número de WhatsApp para encaminhar inválido (Formato: 55119XXXXXXXX@c.us).");
        // Adicionado: Validação para não salvar regra completamente vazia
        if(triggers.length === 0 && !response && !isLead) errors.push("A regra está completamente vazia.");


        if (errors.length > 0) {
            formRuleStatus.textContent = errors.join(' ');
            formRuleStatus.classList.add('error'); // Adiciona classe de erro para estilo CSS
            addLog(`Falha ao salvar regra: ${errors.join(' ')}`, "warn");
            return;
        }

        // Se passou na validação
        formRuleStatus.textContent = '';
        const ruleData = {
            triggers,
            response,
            isLeadQualifier: isLead,
            // Só salva forwardTo e prefix se for lead E tiver um número válido
            forwardTo: isLead && forwardTo ? forwardTo : null,
            forwardMessagePrefix: isLead && forwardTo ? prefix : null
        };

        addLog(`Salvando Regra (Índice: ${index})...`, "info");
        saveRuleFormButton.textContent = 'Salvando...';
        saveRuleFormButton.disabled = true;
        window.electronAPI.send('save-rule', { index: index, rule: ruleData });

    }); else { console.error("! saveRuleFormButton não encontrado no DOM");}


    // --- Inicialização e Listeners do Processo Principal (Electron API) ---
    if (window.electronAPI) {
        addLog("Renderer: Configurando listeners da electronAPI...", "info");

        window.electronAPI.on('log-message', (message, level = 'info') => addLog(message, level));

        window.electronAPI.on('update-status', (newState, details = '') => {
             console.log(`Received 'update-status': ${newState}`, details);
             setUIState(newState, details); // Centraliza a atualização da UI
         });


        window.electronAPI.on('display-qr', (qrDataUrl) => {
            addLog("QR Code recebido. Exibindo.", "info");
            setUIState('scanning'); // Garante estado de scanning
            displayQrCode(qrDataUrl);
        });

        window.electronAPI.on('clear-qr', () => { // Ocorre logo após 'authenticated' ou em 'ready'
             addLog("Autenticado ou Conectado. Limpando QR.", "success");
             // O status 'connected' será enviado separadamente pelo 'update-status' vindo do 'ready'
             // Aqui apenas garantimos que o painel de QR seja removido
              if (!isBotConnected) { // Evita trocar painel se já estiver 'connected'
                 showConnectionPanel('connected'); // Mostra painel conectado
                 displayQrCode(null); // Limpa QR
              }
         });


        window.electronAPI.on('rules-loaded', (rules) => {
            addLog(`Regras carregadas (${rules?.length || 0}). Renderizando.`, "info");
            renderRules(rules);
        });

        window.electronAPI.on('update-download-progress', (progressPercent) => {
            if (updateProgressContainer && updateProgressBar && updateProgressLabel && checkUpdateButton) {
                 if (progressPercent < 0 || progressPercent >= 100) { // Concluído ou erro
                    updateProgressContainer.style.display = 'none';
                     checkUpdateButton.disabled = false; // Reabilita botão
                     checkUpdateButton.textContent = '🔄 Verificar Atualizações';
                    isUpdating = false;
                     if(progressPercent === -1) { addLog("Erro ao baixar atualização.", "error");}
                     // Se 100, o main process deve reiniciar ou pedir confirmação
                 } else {
                     isUpdating = true; // Garante que está em modo de atualização
                     updateProgressContainer.style.display = 'block';
                     updateProgressBar.value = progressPercent;
                     updateProgressBar.hasAttribute('value') ? null : updateProgressBar.setAttribute('value', progressPercent); // Garante que valor é setado
                     updateProgressLabel.textContent = `Baixando atualização... ${progressPercent.toFixed(0)}%`;
                     checkUpdateButton.disabled = true; // Mantém desabilitado durante download
                     checkUpdateButton.textContent = 'Baixando...';
                 }
             } else {
                console.error("Elementos de progresso da atualização ausentes ao receber progresso.");
            }
        });

        window.electronAPI.on('pause-state-changed', (isPausedNow) => {
            addLog(`Estado de pausa atualizado para: ${isPausedNow ? 'Pausado' : 'Ativo'}`, "info");
             updatePauseButtonVisualState(isPausedNow);
             // O estado geral da UI (se status principal deve mudar) é gerenciado pelo setUIState chamado via 'update-status'
        });

        window.electronAPI.on('rule-save-status', ({ success, message, updatedRules }) => {
            if(saveRuleFormButton && formRuleStatus) {
                saveRuleFormButton.textContent = 'Salvar Regra';
                saveRuleFormButton.disabled = false;
                formRuleStatus.textContent = message;
                formRuleStatus.className = `form-status ${success ? 'success' : 'error'}`;
                addLog(`Salvar regra: ${message}`, success ? 'success' : 'error');
                if (success) {
                    renderRules(updatedRules); // Atualiza lista com novas regras
                    hideEditForm(); // Fecha o formulário
                    // Limpa mensagem de status após alguns segundos
                    setTimeout(() => { if(formRuleStatus) formRuleStatus.textContent = ''; }, 4000);
                }
            } else {
                 console.error("Elementos do formulário (save button/status) não encontrados ao receber save status.");
                 addLog("Erro interno: Não foi possível atualizar o formulário após salvar.", "error");
             }
        });

        window.electronAPI.on('rule-delete-status', ({ success, message, updatedRules }) => {
             addLog(`Excluir regra: ${message}`, success ? 'info' : 'error');
             if (success) {
                 renderRules(updatedRules); // Re-renderiza a lista sem a regra excluída
             } else {
                 alert("Erro ao excluir regra:\n" + message); // Mostra alerta se falhou
             }
         });

        // Solicita regras iniciais e define estado inicial
        addLog("Interface pronta. Solicitando estado e regras iniciais.", "info");
         if (window.electronAPI) {
            window.electronAPI.send('get-initial-state'); // Novo evento para o main.js responder
            window.electronAPI.send('load-rules-request');
         } else {
            addLog("ERRO: API Indisponível na inicialização.", "error");
            setUIState('error', 'Falha na comunicação com o processo principal.');
         }

         // Define o estado inicial padrão como desconectado
         // O evento 'get-initial-state' vindo do main.js deve corrigir isso se o bot já estiver rodando
         if(!isBotRunning) {
            setUIState('disconnected');
         }

         console.log("Renderer: Listeners da electronAPI configurados e estado inicial solicitado.");


    } else {
        console.error("Renderer ERRO FATAL: window.electronAPI não está definida! Preload falhou.");
        addLog("ERRO FATAL: Comunicação com processo principal falhou.", "error");
        setUIState('error', 'Comunicação interna falhou.'); // Atualiza UI para erro
        alert('ERRO GRAVE: A comunicação interna falhou. O aplicativo pode não funcionar.');
    }

    console.log("Renderer: Inicialização completa do DOMContentLoaded.");
}); // Fim do DOMContentLoaded

console.log("Renderer script carregado e processado completamente.");