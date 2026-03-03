const TOKEN_KEY = 'messaging_api_token';

const authCard = document.querySelector('#auth-card');
const app = document.querySelector('#app');
const loginTab = document.querySelector('#login-tab');
const registerTab = document.querySelector('#register-tab');
const authForm = document.querySelector('#auth-form');
const authUsername = document.querySelector('#auth-username');
const authPassword = document.querySelector('#auth-password');
const authSubmit = document.querySelector('#auth-submit');
const authFeedback = document.querySelector('#auth-feedback');
const accountName = document.querySelector('#account-name');
const logoutButton = document.querySelector('#logout-button');

const threadList = document.querySelector('#thread-list');
const activeThreadName = document.querySelector('#active-thread-name');
const activeThreadStatus = document.querySelector('#active-thread-status');
const messageList = document.querySelector('#message-list');
const composer = document.querySelector('#composer');
const messageInput = document.querySelector('#message-input');

let authMode = 'login';
let token = localStorage.getItem(TOKEN_KEY);
let currentUser = null;
let activeThreadId = null;

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

function setMode(mode) {
  authMode = mode;
  loginTab.classList.toggle('active', mode === 'login');
  registerTab.classList.toggle('active', mode === 'register');
  authSubmit.textContent = mode === 'login' ? 'Login' : 'Create account';
  authPassword.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  authFeedback.textContent = '';
}

function getActiveThread() {
  return currentUser?.threads?.find((thread) => thread.id === activeThreadId) || null;
}

function renderHeader(thread) {
  activeThreadName.textContent = thread?.name ?? 'No conversation';
  activeThreadStatus.textContent = thread?.status ?? 'Offline';
}

function renderMessages(thread) {
  messageList.innerHTML = '';
  if (!thread) {
    return;
  }

  thread.messages.forEach((message) => {
    const bubble = document.createElement('div');
    bubble.className = `message ${message.from}`;
    bubble.textContent = message.text;
    messageList.appendChild(bubble);
  });

  messageList.scrollTop = messageList.scrollHeight;
}

function renderThreads() {
  threadList.innerHTML = '';

  currentUser.threads.forEach((thread) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    const preview = thread.messages.at(-1)?.text ?? 'No messages yet';

    button.className = thread.id === activeThreadId ? 'active' : '';
    button.innerHTML = `
      <span class="thread-name">${thread.name}</span>
      <span class="thread-preview">${preview}</span>
    `;

    button.addEventListener('click', () => {
      activeThreadId = thread.id;
      renderThreads();
      renderHeader(getActiveThread());
      renderMessages(getActiveThread());
    });

    item.appendChild(button);
    threadList.appendChild(item);
  });
}

function showAuth() {
  authCard.classList.remove('hidden');
  app.classList.add('hidden');
  authForm.reset();
  currentUser = null;
  activeThreadId = null;
  setMode('login');
}

function showApp() {
  authCard.classList.add('hidden');
  app.classList.remove('hidden');
  accountName.textContent = `@${currentUser.username}`;
  activeThreadId = currentUser.threads[0]?.id ?? null;
  renderThreads();
  renderHeader(getActiveThread());
  renderMessages(getActiveThread());
}

async function login(username, password) {
  const data = await api('/api/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });

  token = data.token;
  localStorage.setItem(TOKEN_KEY, token);
  currentUser = data.user;
  showApp();
}

loginTab.addEventListener('click', () => setMode('login'));
registerTab.addEventListener('click', () => setMode('register'));

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = authUsername.value.trim();
  const password = authPassword.value;

  if (!username || !password) {
    authFeedback.textContent = 'Username and password are required.';
    return;
  }

  try {
    if (authMode === 'register') {
      await api('/api/register', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    }

    await login(username, password);
  } catch (error) {
    authFeedback.textContent = error.message;
  }
});

composer.addEventListener('submit', async (event) => {
  event.preventDefault();

  const text = messageInput.value.trim();
  if (!text) {
    return;
  }

  const thread = getActiveThread();
  if (!thread) {
    return;
  }

  try {
    const data = await api(`/api/threads/${thread.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    currentUser = data.user;
    messageInput.value = '';
    renderThreads();
    renderHeader(getActiveThread());
    renderMessages(getActiveThread());
  } catch (error) {
    authFeedback.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // ignore logout API errors
  }

  token = null;
  localStorage.removeItem(TOKEN_KEY);
  showAuth();
});

(async function bootstrap() {
  if (!token) {
    showAuth();
    return;
  }

  try {
    const data = await api('/api/me');
    currentUser = data.user;
    showApp();
  } catch {
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    showAuth();
  }
})();
