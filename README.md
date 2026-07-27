# Avonix Social

**Enterprise SEO & Social Publishing Automation Platform**

Avonix Social scans XML sitemaps, extracts homepage focus keywords, generates unique zero-emoji social content with keyword-overlay graphics, and automates Google Business Profile post and review management — with a credit-based billing engine, mandatory account verification, and a secure Super Admin control panel.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Account Verification](#account-verification)
- [Super Admin Panel](#super-admin-panel)
- [Dashboard Modules](#dashboard-modules)
- [API Overview](#api-overview)
- [Production Deployment (VPS)](#production-deployment-vps)
- [Project Structure](#project-structure)
- [Scripts Reference](#scripts-reference)
- [Design System](#design-system)
- [License](#license)

---

## Features

### Public Website
- Marketing pages: Home, Features, How It Works, GBP Automation, Pricing, API Integrations, About, Contact
- Live sitemap scraper demo on the homepage
- Lead capture via contact form (stored in admin CRM)

### User Platform
- **Mandatory verification gate** — email OTP, phone OTP, and valid payment card required before dashboard access
- **Credit system** — OpenRouter USD cost converted to credits with configurable margin
- **Wallet** — USD top-up, auto-debit on usage, account freeze on insufficient balance
- **Notifications** — email, WhatsApp, and Telegram alerts for missed posts and pending reviews
- **9 dashboard modules** — sitemap parsing, social posts, GBP posts, review replies, analytics, billing, and more

### Super Admin
- CLI-only admin registration (max 2 admins, VPS terminal)
- Mandatory TOTP 2FA on login
- 30-minute idle session timeout
- User CRUD, unlimited credits flag, plan management, leads, revenue, subscriptions

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Next.js 14 (Port 3000)                      │
│   Public site · /register · /dashboard · /admin                   │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API
┌────────────────────────────▼────────────────────────────────────┐
│                  Express + Prisma (Port 4000)                   │
│   Auth · Credits · Wallet · Notifications · Admin · OpenRouter  │
└────────────────────────────┬────────────────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         SQLite DB    OpenRouter API   SMTP / Twilio / Telegram
```

Optional Python AI microservice (`ai-engine/`) on port **8001** for future Gemini/FastAPI workloads.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14 (App Router), React 18, Tailwind CSS, TypeScript |
| Backend API | Node.js, Express, Prisma ORM |
| Database | SQLite (dev/VPS); PostgreSQL-ready schema migration path |
| AI | OpenRouter (multi-model routing) |
| Admin Auth | JWT + bcrypt + TOTP (otplib) |
| AI Engine (optional) | Python FastAPI |

---

## Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.10+ (optional, for `ai-engine/`)
- **OpenRouter API key** (for AI generation)
- **SMTP / Twilio / Telegram** credentials (required in production for OTP and alerts)

---

## Quick Start

### 1. Clone & install

```bash
git clone https://github.com/zalalbd2008/avonix-social.git
cd avonix-social

npm install
cd backend && npm install && cd ..
```

### 2. Configure environment

```bash
cp .env.example .env
cp backend/.env.example backend/.env
# Edit both files with your keys (see Environment Variables below)
```

### 3. Initialize database

```bash
cd backend
npm run db:setup
cd ..
```

### 4. Create Super Admin (terminal only)

```bash
cd backend
npm run admin:create
```

### 5. Run development servers

**Terminal 1 — Backend API**
```bash
cd backend && npm run dev
```

**Terminal 2 — Frontend**
```bash
npm run dev
```

| Service | URL |
|---------|-----|
| Website | http://localhost:3000 |
| Registration | http://localhost:3000/register |
| Dashboard | http://localhost:3000/dashboard |
| Admin Panel | http://localhost:3000/admin/login |
| API Health | http://localhost:4000/api/health |

**Optional — AI Engine**
```bash
cd ai-engine
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

---

## Environment Variables

### Frontend (`.env`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL (e.g. `http://localhost:4000/api`) |
| `API_SERVER_URL` | Server-side API URL for Next.js proxies |
| `AI_ENGINE_URL` | Python AI engine URL (optional) |

### Backend (`backend/.env`)

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Prisma SQLite path (`file:./dev.db`) |
| `PORT` | API port (default `4000`) |
| `OPENROUTER_API_KEY` | OpenRouter API key for AI generation |
| `ADMIN_JWT_SECRET` | Min 32 chars — admin session signing |
| `CREDITS_PER_DOLLAR` | Credit conversion rate (default `100`) |
| `MARGIN_MULTIPLIER` | Markup on API cost (default `1.3`) |
| `SMTP_URL` / `SMTP_FROM` | Email delivery for OTP and alerts |
| `TWILIO_*` | SMS/WhatsApp OTP and notifications |
| `TELEGRAM_BOT_TOKEN` | Telegram notification channel |
| `STRIPE_SECRET_KEY` | Stripe payments (production) |

> **Never commit `.env` files.** Use `.env.example` as templates only.

---

## Account Verification

Dashboard access is **blocked** until all three steps are complete:

1. **Register** — name, email, phone at `/register`
2. **Verify** — 6-digit OTP codes sent to email and SMS
3. **Card** — valid payment card on file (Luhn-validated; test cards rejected in production)

There are **no demo login bypasses**. Unverified users are redirected to `/register`.

---

## Super Admin Panel

| Route | Purpose |
|-------|---------|
| `/admin/login` | Password + TOTP 2FA |
| `/admin` | Dashboard stats |
| `/admin/users` | User management |
| `/admin/leads` | Contact form leads |
| `/admin/subscriptions` | Active subscriptions |
| `/admin/revenue` | Payment logs |
| `/admin/settings` | System settings |

**Admin CLI commands** (run on VPS only):

```bash
npm run admin:create   # Register a new super admin (max 2)
npm run admin:list     # List admins
npm run admin:delete   # Remove an admin by email
```

---

## Dashboard Modules

| Module | Path | Description |
|--------|------|-------------|
| Overview | `/dashboard` | Executive stats & credit usage |
| Analytics | `/dashboard/analytics` | Keyword & GBP metrics |
| Sitemap & Keywords | `/dashboard/sitemap` | XML parser + location editor |
| Social Post | `/dashboard/social-post` | Facebook post generator (5 intent modes) |
| GBP Post | `/dashboard/gbp-post` | Google Business Profile posts |
| Review Reply | `/dashboard/review-reply` | AI review reply hub |
| Notification | `/dashboard/notification` | Alert preferences & log |
| Report | `/dashboard/report` | White-label PDF export |
| Plan & Price | `/dashboard/billing` | Plans, wallet top-up, credits |

---

## API Overview

Base URL: `{API_HOST}/api`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/auth/register` | Start registration (email + phone OTP) |
| `POST` | `/auth/verify` | Verify email & phone codes |
| `POST` | `/auth/card` | Attach payment card, activate trial |
| `POST` | `/auth/login` | Sign in (fully verified users only) |
| `GET` | `/auth/status/:email` | Verification status |
| `GET` | `/users/:email/credits` | User state & credits |
| `POST` | `/generate` | AI content generation |
| `POST` | `/wallet/topup` | Wallet top-up |
| `POST` | `/leads` | Public contact form |
| `GET` | `/health` | Service health check |

Admin routes are under `/api/admin/*` (JWT + 2FA protected).

---

## Production Deployment (VPS)

```bash
# 1. Set production environment
export NODE_ENV=production

# 2. Backend
cd backend
npm install --production
npm run db:setup
npm run admin:create
npm run start          # or use PM2: pm2 start server.js --name avonix-api

# 3. Frontend
cd ..
npm install
npm run build
npm run start          # or PM2: pm2 start npm --name avonix-web -- start
```

**Production checklist:**
- [ ] `NODE_ENV=production` on backend
- [ ] `NEXT_PUBLIC_API_URL` points to your VPS API domain
- [ ] `ADMIN_JWT_SECRET` set to a strong random string (32+ chars)
- [ ] SMTP, Twilio, and Telegram configured for real OTP delivery
- [ ] OpenRouter API key configured
- [ ] Super Admin created via `npm run admin:create` on VPS terminal
- [ ] HTTPS enabled (Nginx/Caddy reverse proxy recommended)
- [ ] SQLite file backed up regularly (`backend/prisma/dev.db`)

---

## Project Structure

```
avonix-social/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # Home
│   │   ├── register/           # Mandatory verification flow
│   │   ├── dashboard/          # Protected user dashboard
│   │   ├── admin/              # Super Admin panel
│   │   ├── pricing/            # Plans & pricing
│   │   └── contact/            # Contact form
│   ├── components/             # UI components
│   │   ├── auth/               # RegisterFlow
│   │   ├── dashboard/          # DashboardShell, AuthGuard
│   │   ├── admin/              # Admin UI
│   │   └── public/             # Marketing layout
│   ├── context/                # WorkspaceContext (session state)
│   └── lib/                    # API client, credits, types
├── backend/
│   ├── src/
│   │   ├── routes/             # api.js, admin.js
│   │   └── services/           # verify, wallet, notify, admin
│   ├── prisma/                 # Schema, migrations, seed
│   └── scripts/                # Admin CLI
├── ai-engine/                  # Python FastAPI (optional)
├── .env.example
└── package.json
```

---

## Scripts Reference

### Root

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run dev:clean` | Clear `.next` cache and restart |
| `npm run build` | Production build |
| `npm run dev:api` | Start backend in dev mode |

### Backend

| Command | Description |
|---------|-------------|
| `npm run dev` | API with hot reload |
| `npm run start` | Production API server |
| `npm run db:setup` | Push schema + seed plans |
| `npm run admin:create` | Create super admin (CLI) |

---

## Design System

| Token | Value |
|-------|-------|
| Primary | Orange `#ff6600` |
| Background | Dark Navy `#070d1d` |
| Font | Plus Jakarta Sans |
| Style | Glass panels, dark theme, mobile-first responsive layout |

---

## License

Copyright © 2026 Avonix Social. All rights reserved.

---

## Support

For enterprise onboarding, API access, or custom deployment assistance, use the contact form at `/contact` or email **support@avonixsocial.com**.
