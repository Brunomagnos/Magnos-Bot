// ./loginRenderer.js
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const errorMessageDiv = document.getElementById('error-message');

loginForm.addEventListener('submit', (event) => {
    event.preventDefault(); // Impede recarregamento da página
    errorMessageDiv.textContent = ''; // Limpa erro anterior
    const username = usernameInput.value;
    const password = passwordInput.value;

    // Envia credenciais para o processo principal verificar
    window.electronAPI.send('login-attempt', { username, password });
});

// Ouve a resposta do processo principal
window.electronAPI.on('login-failed', (message) => {
    errorMessageDiv.textContent = message || 'Usuário ou senha inválidos.';
});

// 'login-success' não precisa de handler aqui, pois o main.js vai carregar o index.html