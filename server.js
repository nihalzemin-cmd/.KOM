const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const defaultThreads = [
  {
    id: 1,
    name: 'Alex Johnson',
    status: 'Online',
    messages: [
      { from: 'incoming', text: 'Welcome to your private inbox.' },
      { from: 'incoming', text: 'This sample data is unique per account.' },
    ],
  },
  {
    id: 2,
    name: 'Design Team',
    status: '3 members online',
    messages: [{ from: 'incoming', text: 'New account setup complete.' }],
  },
];

function ensureDataStore() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [], sessions: {} }, null, 2));
  }
}

function readStore() {
  ensureDataStore();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
}

function writeStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function cloneDefaultThreads() {
  return JSON.parse(JSON.stringify(defaultThreads));
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
    '.json': 'application/json; charset=utf-8',
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

function sanitizeUser(user) {
  return {
    username: user.username,
    threads: user.threads,
  };
}

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  if ((method === 'GET' || method === 'HEAD') && (url === '/' || url === '/index.html')) {
    return serveFile(req, res, path.join(ROOT, 'index.html'));
  }

  if ((method === 'GET' || method === 'HEAD') && (url === '/app.js' || url === '/styles.css')) {
    return serveFile(req, res, path.join(ROOT, url.slice(1)));
  }

  if ((method === 'GET' || method === 'HEAD') && url === '/about.html') {
    return serveFile(req, res, path.join(ROOT, 'about.html'));
  }

  if (method === 'POST' && url === '/api/register') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');

      if (username.length < 3 || password.length < 4) {
        return sendJson(res, 400, { error: 'Username must be 3+ chars and password 4+ chars.' });
      }

      const store = readStore();
      if (store.users.some((u) => u.username === username)) {
        return sendJson(res, 409, { error: 'That username already exists.' });
      }

      const { salt, hash } = hashPassword(password);
      store.users.push({ username, salt, passwordHash: hash, threads: cloneDefaultThreads() });
      writeStore(store);
      return sendJson(res, 201, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (method === 'POST' && url === '/api/login') {
    try {
      const body = await parseBody(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const store = readStore();
      const user = store.users.find((u) => u.username === username);

      if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
        return sendJson(res, 401, { error: 'Invalid username or password.' });
      }

      const token = crypto.randomBytes(24).toString('hex');
      store.sessions[token] = username;
      writeStore(store);

      return sendJson(res, 200, { token, user: sanitizeUser(user) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  if (method === 'POST' && url === '/api/logout') {
    const token = getToken(req);
    if (!token) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const store = readStore();
    delete store.sessions[token];
    writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (method === 'GET' && url === '/api/me') {
    const token = getToken(req);
    if (!token) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const store = readStore();
    const user = getUserByToken(store, token);
    if (!user) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    return sendJson(res, 200, { user: sanitizeUser(user) });
  }

  if (method === 'POST' && /^\/api\/threads\/\d+\/messages$/.test(url)) {
    const token = getToken(req);
    if (!token) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const store = readStore();
    const user = getUserByToken(store, token);
    if (!user) {
      return sendJson(res, 401, { error: 'Unauthorized' });
    }

    try {
      const threadId = Number(url.split('/')[3]);
      const body = await parseBody(req);
      const text = String(body.text || '').trim();

      if (!text) {
        return sendJson(res, 400, { error: 'Message is required.' });
      }

      const thread = user.threads.find((t) => t.id === threadId);
      if (!thread) {
        return sendJson(res, 404, { error: 'Thread not found.' });
      }

      thread.messages.push({ from: 'outgoing', text });
      writeStore(store);

      return sendJson(res, 200, { user: sanitizeUser(user) });
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
