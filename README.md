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

4. Health check

```bash
GET http://localhost:5000/api/health
```

## Core endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/emailjs-login`
- `GET /api/auth/me` (Bearer token required)
- `POST /api/auth/logout` (Bearer token required)
- `GET /api/restaurants`
- `GET /api/restaurants/:restaurantId`
- `GET /api/restaurants/:restaurantId/menu`
- `GET /api/menu/items/:itemId`
- `GET /api/cart/:userId` (Bearer token required)
- `POST /api/cart/:userId/items` (Bearer token required)
- `PATCH /api/cart/:userId/items/:menuItemId` (Bearer token required)
- `DELETE /api/cart/:userId/items/:menuItemId` (Bearer token required)
- `DELETE /api/cart/:userId` (Bearer token required)
- `POST /api/orders` (Bearer token required)
- `GET /api/orders/user/:userId` (Bearer token required)
- `GET /api/orders/:orderId` (Bearer token required)
- `PATCH /api/orders/:orderId/status`
- `GET /api/delivery/:orderId/tracking` (Bearer token required)

## Notes

- This backend now uses Neon PostgreSQL as the data source.
- Passwords are not hashed yet.
- Data persists across server restarts.

## EmailJS auth bridge

If your frontend verifies users with EmailJS OTP flow, call `POST /api/auth/emailjs-login` with:

```json
{
  "email": "user@example.com",
  "name": "User Name",
  "phone": "+2609..."
}
```

The backend will create or update the user in Neon and return a bearer token to use on protected endpoints.
