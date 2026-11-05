# Thin-client shared backend

Electron and browser UIs talk to this Hono API over HTTP. Postgres is the only system of record.

## Run

```bash
# Terminal 1 — API + Postgres
npm run server:dev

# Terminal 2 — Vite UI (uses .env.development VITE_API_BASE_URL)
npm run dev:react

# Optional Electron shell (native print/dialogs only; no SQLite)
npm run dev:electron
```

Or API + UI together: `npm run dev:thin` from the repo root.

Open `http://localhost:5173` (Vite) or the API host after `npm run build` (serves `dist-react`).

## Auth

`POST /api/auth/login` with `{ username, password }` against Postgres `users`.
Session Bearer token for `POST /api/app/:namespace/:method`.

## Migrate

```bash
npm --prefix server run db:migrate
```

Creates `auth_sessions` (and other schema) on the configured `DB_TARGET` database.
