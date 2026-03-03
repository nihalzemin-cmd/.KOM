const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const initial = { users: [], sessions: {}, threads: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
  }
}

function readStore() {
  ensureDataStore();
  const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  store.users ??= [];
  store.sessions ??= {};
  store.threads ??= [];
  return store;
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Request body too large'));
      }
    });

    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function serveFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
  };

  res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain; charset=utf-8' });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function getToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.slice(7);
}

function getUserByToken(store, token) {
  const username = store.sessions[token];
  if (!username) {
    return null;
  }
  return store.users.find((u) => u.username === username) || null;
}

function getOrCreateThread(store, a, b) {
  const pair = [a, b].sort();
  let thread = store.threads.find((t) => t.participants[0] === pair[0] && t.participants[1] === pair[1]);
  if (!thread) {
    thread = {
      id: crypto.randomUUID(),
      participants: pair,
      messages: [],
      updatedAt: Date.now(),
    };
    store.threads.push(thread);
  }
  return thread;
}

function sanitizeForClient(store, user) {
  const contacts = [...(user.contacts || [])].sort((a, b) => a.localeCompare(b));
  const pendingIncoming = [...(user.incomingRequests || [])].sort((a, b) => a.localeCompare(b));
  const pendingOutgoing = [...(user.outgoingRequests || [])].sort((a, b) => a.localeCompare(b));

  const chats = contacts.map((contactUsername) => {
    const thread = getOrCreateThread(store, user.username, contactUsername);
    const last = thread.messages.at(-1);
    return {
      with: contactUsername,
      lastMessage: last ? last.text : 'Start a conversation',
      lastTimestamp: last ? last.timestamp : null,
      updatedAt: thread.updatedAt,
    };
  });

  chats.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  return {
    username: user.username,
    contacts,
    pendingIncoming,
    pendingOutgoing,
    chats,
  };
}

function requireAuth(req, res) {
  const token = getToken(req);
  if (!token) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }

  const store = readStore();
  const user = getUserByToken(store, token);
  if (!user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }

  return { store, user, token };
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if ((method === 'GET' || method === 'HEAD') && (url === '/' || url === '/index.html')) {
    return serveFile(req, res, path.join(ROOT, 'index.html'));
  }

  if ((method === 'GET' || method === 'HEAD') && ['/app.js', '/styles.css'].includes(url)) {
    return serveFile(req, res, path.join(ROOT, url.slice(1)));
  }

  if ((method === 'GET' || method === 'HEAD') && url === '/about.html') {
    return serveFile(req, res, path.join(ROOT, 'about.html'));
  }

  if (method === 'POST' && url === '/api/register') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        return sendJson(res, 400, {
          error: 'Username must be 3-24 chars, lowercase letters, numbers, or underscore.',
        });
      }

      if (password.length < 6) {
        return sendJson(res, 400, { error: 'Password must be at least 6 characters.' });
      }

      const store = readStore();
      if (store.users.some((u) => u.username === username)) {
        return sendJson(res, 409, { error: 'Username already exists.' });
      }

      const { salt, hash } = hashPassword(password);
      store.users.push({
        username,
        salt,
        passwordHash: hash,
        contacts: [],
        incomingRequests: [],
        outgoingRequests: [],
      });
      writeStore(store);
      return sendJson(res, 201, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (method === 'POST' && url === '/api/login') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim().toLowerCase();
      const password = String(body.password || '');

      const store = readStore();
      const user = store.users.find((u) => u.username === username);

      if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
        return sendJson(res, 401, { error: 'Invalid username or password.' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      store.sessions[token] = user.username;
      writeStore(store);
      return sendJson(res, 200, { token, user: sanitizeForClient(store, user) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (method === 'POST' && url === '/api/logout') {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    delete auth.store.sessions[auth.token];
    writeStore(auth.store);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && url === '/api/me') {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    return sendJson(res, 200, { user: sanitizeForClient(auth.store, auth.user) });
  }

  if (method === 'GET' && url.startsWith('/api/users/search')) {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    const query = new URL(url, 'http://localhost').searchParams.get('q')?.trim().toLowerCase() || '';
    if (query.length < 2) {
      return sendJson(res, 200, { results: [] });
    }

    const results = auth.store.users
      .filter((u) => u.username !== auth.user.username && u.username.includes(query))
      .slice(0, 12)
      .map((u) => {
        const isContact = auth.user.contacts.includes(u.username);
        const incoming = auth.user.incomingRequests.includes(u.username);
        const outgoing = auth.user.outgoingRequests.includes(u.username);
        return {
          username: u.username,
          relationship: isContact ? 'connected' : incoming ? 'incoming' : outgoing ? 'outgoing' : 'none',
        };
      });

    return sendJson(res, 200, { results });
  }

  if (method === 'POST' && url === '/api/requests') {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    try {
      const body = await parseBody(req);
      const targetUsername = String(body.username || '').trim().toLowerCase();

      if (!targetUsername || targetUsername === auth.user.username) {
        return sendJson(res, 400, { error: 'Invalid target user.' });
      }

      const target = auth.store.users.find((u) => u.username === targetUsername);
      if (!target) {
        return sendJson(res, 404, { error: 'User not found.' });
      }

      if (auth.user.contacts.includes(targetUsername)) {
        return sendJson(res, 400, { error: 'You are already connected.' });
      }

      if (auth.user.outgoingRequests.includes(targetUsername)) {
        return sendJson(res, 400, { error: 'Connection request already sent.' });
      }

      auth.user.outgoingRequests.push(targetUsername);
      target.incomingRequests.push(auth.user.username);
      writeStore(auth.store);

      return sendJson(res, 200, { user: sanitizeForClient(auth.store, auth.user) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  const requestAction = url.match(/^\/api\/requests\/([a-z0-9_]{3,24})\/(accept|reject)$/);
  if (method === 'POST' && requestAction) {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    const targetUsername = requestAction[1];
    const action = requestAction[2];

    if (!auth.user.incomingRequests.includes(targetUsername)) {
      return sendJson(res, 404, { error: 'No incoming request from that user.' });
    }

    const target = auth.store.users.find((u) => u.username === targetUsername);
    if (!target) {
      return sendJson(res, 404, { error: 'User not found.' });
    }

    auth.user.incomingRequests = auth.user.incomingRequests.filter((u) => u !== targetUsername);
    target.outgoingRequests = target.outgoingRequests.filter((u) => u !== auth.user.username);

    if (action === 'accept') {
      if (!auth.user.contacts.includes(targetUsername)) {
        auth.user.contacts.push(targetUsername);
      }
      if (!target.contacts.includes(auth.user.username)) {
        target.contacts.push(auth.user.username);
      }
      getOrCreateThread(auth.store, auth.user.username, targetUsername);
    }

    writeStore(auth.store);
    return sendJson(res, 200, { user: sanitizeForClient(auth.store, auth.user) });
  }

  const chatGet = url.match(/^\/api\/chats\/([a-z0-9_]{3,24})$/);
  if (method === 'GET' && chatGet) {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    const contact = chatGet[1];
    if (!auth.user.contacts.includes(contact)) {
      return sendJson(res, 403, { error: 'You can only chat with connected accounts.' });
    }

    const thread = getOrCreateThread(auth.store, auth.user.username, contact);
    const messages = thread.messages.map((m) => ({
      from: m.from === auth.user.username ? 'me' : 'them',
      text: m.text,
      timestamp: m.timestamp,
      sender: m.from,
    }));

    return sendJson(res, 200, { with: contact, messages });
  }

  const chatPost = url.match(/^\/api\/chats\/([a-z0-9_]{3,24})\/messages$/);
  if (method === 'POST' && chatPost) {
    const auth = requireAuth(req, res);
    if (!auth) {
      return;
    }

    const contact = chatPost[1];
    if (!auth.user.contacts.includes(contact)) {
      return sendJson(res, 403, { error: 'You can only chat with connected accounts.' });
    }

    try {
      const body = await parseBody(req);
      const text = String(body.text || '').trim();
      if (!text) {
        return sendJson(res, 400, { error: 'Message cannot be empty.' });
      }

      const thread = getOrCreateThread(auth.store, auth.user.username, contact);
      thread.messages.push({ from: auth.user.username, text, timestamp: Date.now() });
      thread.updatedAt = Date.now();
      writeStore(auth.store);

      return sendJson(res, 200, {
        ok: true,
        user: sanitizeForClient(auth.store, auth.user),
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  ensureDataStore();
  console.log(`Messaging app listening on http://0.0.0.0:${PORT}`);
});
