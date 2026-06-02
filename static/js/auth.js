if (token) {
  window.location.href = '/app';
}

const authMessage = document.getElementById('authMessage');

function showAuthMessage(message = '', type = 'hint') {
  authMessage.className = type;
  authMessage.textContent = message;
}

function showAuthForm(name) {
  ['loginForm', 'registerForm', 'forgotForm', 'resetForm'].forEach(id => {
    document.getElementById(id).classList.toggle('hidden', id !== name + 'Form');
  });

  document.getElementById('showLoginBtn').classList.toggle('active', name === 'login');
  document.getElementById('showRegisterBtn').classList.toggle('active', name === 'register');
  showAuthMessage();
}

async function register(event) {
  event.preventDefault();
  showAuthMessage();

  const email = document.getElementById('registerEmail').value.trim();
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;

  try {
    await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, username, password }),
    });

    document.getElementById('loginEmail').value = email;
    showAuthForm('login');
    showAuthMessage('Аккаунт создан. Теперь можно войти.', 'success');
  } catch (error) {
    showAuthMessage(explainError(error), 'error');
  }
}

async function login(event) {
  event.preventDefault();
  showAuthMessage();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    token = data.access_token;
    localStorage.setItem(TOKEN_KEY, token);
    window.location.href = '/app';
  } catch (error) {
    showAuthMessage(explainError(error), 'error');
  }
}

async function requestResetCode(event) {
  event.preventDefault();
  showAuthMessage();

  const email = document.getElementById('forgotEmail').value.trim();

  try {
    const data = await api('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });

    document.getElementById('resetEmail').value = email;
    document.getElementById('resetCode').value = '';
    showAuthForm('reset');
    showAuthMessage(data.dev_reset_token
      ? `SMTP не настроен. Учебный код восстановления: ${data.dev_reset_token}`
      : data.message, 'success');
  } catch (error) {
    showAuthForm('forgot');
    document.getElementById('forgotEmail').value = email;
    showAuthMessage(explainError(error) || 'Такая почта не зарегистрирована', 'error');
  }
}

async function resetPassword(event) {
  event.preventDefault();
  showAuthMessage();

  const email = document.getElementById('resetEmail').value.trim();
  const reset_token = document.getElementById('resetCode').value.trim();
  const new_password = document.getElementById('resetPassword').value;

  try {
    const data = await api('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ email, reset_token, new_password }),
    });

    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = '';
    showAuthForm('login');
    showAuthMessage(data.message, 'success');
  } catch (error) {
    showAuthMessage(explainError(error), 'error');
  }
}

document.getElementById('showLoginBtn').addEventListener('click', () => showAuthForm('login'));
document.getElementById('showRegisterBtn').addEventListener('click', () => showAuthForm('register'));
document.getElementById('forgotBtn').addEventListener('click', () => showAuthForm('forgot'));
document.querySelectorAll('[data-screen="login"]').forEach(button => {
  button.addEventListener('click', () => showAuthForm('login'));
});

document.getElementById('registerForm').addEventListener('submit', register);
document.getElementById('loginForm').addEventListener('submit', login);
document.getElementById('forgotForm').addEventListener('submit', requestResetCode);
document.getElementById('resetForm').addEventListener('submit', resetPassword);

if (location.protocol === 'file:') {
  document.getElementById('fileWarning').classList.remove('hidden');
}

