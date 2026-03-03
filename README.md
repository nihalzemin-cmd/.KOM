# Clean Messaging App

A simple messaging UI with a lightweight Node.js backend.

## Features

- Account system with register/login/logout
- Password hashing on the server (PBKDF2)
- Session tokens stored in browser `localStorage`
- Per-account message history persisted server-side
- Conversation list with previews
- Switch between threads and send messages
- Responsive layout for mobile and desktop

## Run locally

```bash
node server.js
```

Then open:

- `http://127.0.0.1:4173`
- `http://127.0.0.1:4173/about.html`

## Data storage

- Data is stored in `data/store.json`.
- This is still a demo app and not production hardened.
