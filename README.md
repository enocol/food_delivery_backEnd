# Mbole Eats Backend

Node/Express backend scaffold for a food delivery app.

## Quick start

1. Install dependencies

```bash
npm install
```

2. Copy env file

```bash
copy .env.example .env
```

3. Run in development mode

```bash
npm run dev
```

If your existing Neon schema still uses `users.id` as the canonical user key, run:

```bash
npm run db:migrate:firebase-uid
```

4. Health check

```bash
GET http://localhost:5000/api/health
```

## Core endpoints

- `POST /api/auth/sync` (Bearer Firebase ID token required)
- `GET /api/auth/me` (Bearer Firebase ID token required)
- `POST /api/auth/logout` (Bearer Firebase ID token required)
- `GET /api/restaurants`
- `GET /api/restaurants/:restaurantId`
- `GET /api/restaurants/:restaurantId/menu`
- `GET /api/menu/items/:itemId`
- `GET /api/cart/:userId` (Bearer Firebase ID token required)
- `POST /api/cart/:userId/items` (Bearer Firebase ID token required)
- `PATCH /api/cart/:userId/items/:menuItemId` (Bearer Firebase ID token required)
- `DELETE /api/cart/:userId/items/:menuItemId` (Bearer Firebase ID token required)
- `DELETE /api/cart/:userId` (Bearer Firebase ID token required)
- `POST /api/orders` (Bearer Firebase ID token required)
- `GET /api/orders/user/:userId` (Bearer Firebase ID token required)
- `GET /api/orders/:orderId` (Bearer Firebase ID token required)
- `PATCH /api/orders/:orderId/status`
- `GET /api/delivery/:orderId/tracking` (Bearer Firebase ID token required)

## Notes

- This backend now uses Neon PostgreSQL as the data source.
- Canonical user key is `firebase_uid` (returned as `id` in API responses).
- Auth is Firebase-first: send a Firebase ID token in `Authorization: Bearer <idToken>` for protected endpoints.
- Passwords are not hashed yet.
- Data persists across server restarts.

## Firebase auth contract

1. Frontend signs users in with Firebase Authentication.
2. Frontend obtains Firebase ID token and sends it as Bearer token.
3. Backend verifies token and upserts `users(firebase_uid, email, name, phone, auth_provider)`.
4. Backend uses `firebase_uid` for all user-scoped reads/writes.

`/api/auth/register`, `/api/auth/login`, and `/api/auth/emailjs-login` are deprecated and return HTTP 410.
