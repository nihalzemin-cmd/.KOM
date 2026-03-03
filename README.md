# Private Messaging Website

A fully working private messaging demo with a Node.js backend and browser frontend.

## What it supports

- Unique account creation (`username` + password)
- Login/logout with session tokens
- Search other accounts by username
- Send/accept/reject connection requests
- Private 1:1 chats only between connected users
- Persisted users, relationships, and messages in `data/store.json`

## Run locally

```bash
node server.js
```

Then open:

- `http://127.0.0.1:4173`
- `http://127.0.0.1:4173/about.html`

## Notes

- This is a demo implementation (no HTTPS/cookies/rate-limiting yet).
- Passwords are hashed server-side using PBKDF2.
