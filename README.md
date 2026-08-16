# QR Code Temporary WiFi Access System

A full-stack demo for generating temporary guest WiFi QR codes, validating access, and tracking access logs.

## Features

- Admin login using JWT and bcrypt-hashed passwords
- QR generation for one-time or time-based guest access
- Public guest access page that verifies the QR token
- Expiry countdown and simulated access lifecycle
- Access logs and dashboard stats
- MySQL-backed data model

## Project structure

- `server/` — Express.js API and MySQL integration
- `client/` — React + Vite front-end
- `database/` — schema for the MySQL database

## Prerequisites

- Node.js 18+
- MySQL 8+
- npm

## 1) Set up MySQL

Create a MySQL database and user, then import the schema:

```bash
mysql -u root -p < database/schema.sql
```

If you want to use a specific database name, update the value in the `.env` file before running the schema.

## 2) Configure environment variables

Copy the env example files and update the values:

```bash
cp .env.example server/.env
cp .env.example .env
```

Or manually create `.env` files from the examples in the root and `server/` folder.

Example values:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=password
DB_NAME=wifi_access_demo
JWT_SECRET=replace_with_a_long_random_secret
APP_PUBLIC_URL=http://localhost:5173
PORT=5000
```

## 3) Install dependencies

```bash
cd server && npm install
cd ../client && npm install
```

## 4) Seed the default admin account

```bash
cd server
node scripts/seedAdmin.js
```

Default login credentials:

- Email: `admin@wifi.local`
- Password: `admin123`

## 5) Run the app

### Backend

```bash
cd server
npm run dev
```

### Frontend

```bash
cd client
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api/*` requests to the backend on `http://localhost:5000`.

## API overview

### Admin routes

- `POST /api/admin/login`
- `POST /api/admin/qr/generate`
- `GET /api/admin/qr`
- `POST /api/admin/qr/:id/revoke`
- `GET /api/admin/logs`
- `GET /api/admin/dashboard`

### Guest routes

- `GET /api/access/validate?token=...&guest_id=...`
- `GET /api/access/status?token=...`

## Notes

This is a simulated access control system. It does not connect to real routers, RADIUS services, or actual network hardware.

## Out of scope

- Real VPN or router control
- RADIUS or hostapd integration
- Mobile app development
- Billing or payment functions
