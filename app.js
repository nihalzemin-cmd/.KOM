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
const searchInput = document.querySelector('#user-search-input');
const searchButton = document.querySelector('#user-search-button');
const searchResults = document.querySelector('#search-results');
const incomingRequests = document.querySelector('#incoming-requests');
const contactsList = document.querySelector('#contacts-list');

const activeChatName = document.querySelector('#active-chat-name');
const activeChatStatus = document.querySelector('#active-chat-status');
const messageList = document.querySelector('#message-list');
const composer = document.querySelector('#composer');
const messageInput = document.querySelector('#message-input');

let authMode = 'login';
let token = localStorage.getItem(TOKEN_KEY);
let currentUser = null;
let activeContact = null;

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

function clearMessages(text = 'Select a connection') {
  activeChatName.textContent = text;
  activeChatStatus.textContent = 'Private chat';
  messageList.innerHTML = '';
}

function showAuth() {
  authCard.classList.remove('hidden');
  app.classList.add('hidden');
  authForm.reset();
  currentUser = null;
  activeContact = null;
  clearMessages();
  setMode('login');
}

function renderContacts() {
  contactsList.innerHTML = '';

  if (!currentUser.contacts.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'No connections yet.';
    contactsList.appendChild(empty);
    return;
  }

  currentUser.chats.forEach((chat) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.className = chat.with === activeContact ? 'active' : '';
    button.innerHTML = `
      <span class="thread-name">@${chat.with}</span>
      <span class="thread-preview">${chat.lastMessage}</span>
    `;

    button.addEventListener('click', () => {
      activeContact = chat.with;
      loadChat(activeContact);
      renderContacts();
    });

    item.appendChild(button);
    contactsList.appendChild(item);
  });
}

function renderIncomingRequests() {
  incomingRequests.innerHTML = '';

  if (!currentUser.pendingIncoming.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'No pending requests.';
    incomingRequests.appendChild(empty);
    return;
  }

  currentUser.pendingIncoming.forEach((username) => {
    const item = document.createElement('li');
    item.className = 'request-row';

    const name = document.createElement('span');
    name.textContent = `@${username}`;

    const actions = document.createElement('div');
    actions.className = 'request-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', async () => {
      await respondRequest(username, 'accept');
    });

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'ghost';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', async () => {
      await respondRequest(username, 'reject');
    });

    actions.append(acceptBtn, rejectBtn);
    item.append(name, actions);
    incomingRequests.appendChild(item);
  });
}

function renderSearchResults(results = []) {
  searchResults.innerHTML = '';

  results.forEach((user) => {
    const item = document.createElement('li');
    item.className = 'request-row';

    const name = document.createElement('span');
    name.textContent = `@${user.username}`;

    const button = document.createElement('button');
    button.type = 'button';

    if (user.relationship === 'connected') {
      button.textContent = 'Connected';
      button.disabled = true;
    } else if (user.relationship === 'incoming') {
      button.textContent = 'Wants to connect';
      button.disabled = true;
    } else if (user.relationship === 'outgoing') {
      button.textContent = 'Requested';
      button.disabled = true;
    } else {
      button.textContent = 'Connect';
      button.addEventListener('click', async () => {
        await sendRequest(user.username);
      });
    }

    item.append(name, button);
    searchResults.appendChild(item);
  });

  if (!results.length && searchInput.value.trim().length >= 2) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'No users found.';
    searchResults.appendChild(empty);
  }
}

function renderDashboard() {
  accountName.textContent = `@${currentUser.username}`;
  renderIncomingRequests();
  renderContacts();
}

async function refreshMe() {
  const data = await api('/api/me');
  currentUser = data.user;
  renderDashboard();
}

async function loadChat(contactUsername) {
  if (!contactUsername) {
    clearMessages();
    return;
  }

  try {
    const data = await api(`/api/chats/${contactUsername}`);
    activeChatName.textContent = `@${data.with}`;
    activeChatStatus.textContent = 'Connected · Private chat';
    messageList.innerHTML = '';

    data.messages.forEach((msg) => {
      const bubble = document.createElement('div');
      bubble.className = `message ${msg.from === 'me' ? 'outgoing' : 'incoming'}`;
      bubble.textContent = msg.text;
      messageList.appendChild(bubble);
    });

    messageList.scrollTop = messageList.scrollHeight;
  } catch (error) {
    authFeedback.textContent = error.message;
  }
}

async function sendRequest(username) {
  try {
    await api('/api/requests', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });

    await refreshMe();
    await searchUsers();
  } catch (error) {
    authFeedback.textContent = error.message;
  }
}

async function respondRequest(username, action) {
  try {
    const data = await api(`/api/requests/${username}/${action}`, { method: 'POST' });
    currentUser = data.user;
    renderDashboard();

    if (action === 'accept') {
      activeContact = username;
      await loadChat(username);
    }
  } catch (error) {
    authFeedback.textContent = error.message;
  }
}

async function searchUsers() {
  const query = searchInput.value.trim();
  if (query.length < 2) {
    renderSearchResults([]);
    return;
  }

  try {
    const data = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
    renderSearchResults(data.results);
  } catch (error) {
    authFeedback.textContent = error.message;
  }
}

function showApp() {
  authCard.classList.add('hidden');
  app.classList.remove('hidden');
  authFeedback.textContent = '';

  activeContact = currentUser.contacts[0] || null;
  renderDashboard();

  if (activeContact) {
    loadChat(activeContact);
  } else {
    clearMessages('No active chat');
  }
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
searchButton.addEventListener('click', searchUsers);
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    searchUsers();
  }
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = authUsername.value.trim().toLowerCase();
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

  if (!activeContact || !text) {
    return;
  }

  try {
    const data = await api(`/api/chats/${activeContact}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });

    currentUser = data.user;
    renderDashboard();
    messageInput.value = '';
    await loadChat(activeContact);
  } catch (error) {
    authFeedback.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // ignore logout errors
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
