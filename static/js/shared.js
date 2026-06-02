const TOKEN_KEY = 'messenger_token';
const THEME_KEY = 'messenger_theme';

let token = localStorage.getItem(TOKEN_KEY);
let themeFlowTimer = null;

function runAuthThemeFlow() {
  const authScreen = document.getElementById('authScreen');
  if (!authScreen || authScreen.classList.contains('hidden')) return;

  document.body.classList.remove('auth-theme-flow');
  void document.body.offsetWidth;
  document.body.style.setProperty('--flow-x', Math.round(18 + Math.random() * 68) + '%');
  document.body.style.setProperty('--flow-y', Math.round(10 + Math.random() * 58) + '%');
  document.body.classList.add('auth-theme-flow');

  clearTimeout(themeFlowTimer);
  themeFlowTimer = setTimeout(() => {
    document.body.classList.remove('auth-theme-flow');
  }, 900);
}

function setTheme(theme, animate = true) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.textContent = theme === 'light' ? 'Темная тема' : 'Светлая тема';
  }

  if (animate) runAuthThemeFlow();
}

function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

function authHeaders(hasJsonBody = false) {
  const headers = hasJsonBody ? { 'Content-Type': 'application/json' } : {};
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

async function api(path, options = {}) {
  const headers = authHeaders(Boolean(options.body));
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(readApiError(data, response.statusText));
  return data;
}

async function uploadApi(path, formData) {
  const response = await fetch(path, {
    method: 'POST',
    body: formData,
    headers: authHeaders(false),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(readApiError(data, response.statusText));
  return data;
}

function readApiError(data, fallback) {
  if (typeof data.detail === 'string') return data.detail;
  if (Array.isArray(data.detail)) return data.detail.map(item => item.msg || JSON.stringify(item)).join('; ');
  return fallback || 'Ошибка запроса';
}

function explainError(error) {
  if (error && error.message === 'Failed to fetch') {
    return 'Сервер не отвечает. Запустите uvicorn и откройте http://127.0.0.1:8000';
  }
  return error && error.message ? error.message : 'Неизвестная ошибка';
}

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
setTheme(localStorage.getItem(THEME_KEY) || 'dark', false);
