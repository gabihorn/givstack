# GivStack

Open-source crowdfunding platform for communities, synagogues, and nonprofits.

Built with Node.js + SQLite. Self-hosted, fully configurable, no recurring SaaS fees.

**Live demo:** [Beit Shemesh campaign running on GivStack](http://91.99.98.13:3001)

---

## Features

- Campaign page with progress bar, donor wall, and countdown timer
- Dedication items (name items for donors)
- Ambassador pages with individual tracking links (`?ref=CODE`)
- Live donation notifications
- WhatsApp notifications (admin + donor)
- Campaign updates feed
- Video embed support (YouTube / Vimeo)
- Matching gift badge
- Mobile-first responsive design
- Admin panel — manage everything without touching code
- Manual donation entry (cash, check, bank transfer)
- CSV export (donations, items, ambassadors)
- Nedarim Plus payment integration (iframe + webhook)

---

## Quick Start

```bash
git clone https://github.com/givstack/givstack.git
cd givstack
cp .env.example .env
# Edit .env — set ADMIN_PASSWORD, MOSAD_ID, API_VALID, SITE_URL
npm install
npm start
```

- Campaign page: `http://localhost:3000`
- Admin panel: `http://localhost:3000/admin`

---

## Docker

```bash
cp .env.example .env
# Edit .env
docker-compose up -d
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `ADMIN_PASSWORD` | Yes | Admin panel password |
| `SESSION_SECRET` | Yes | Random secret string |
| `SITE_URL` | Yes | Your public URL (e.g. `https://campaign.example.com`) |
| `MOSAD_ID` | Yes | Nedarim Plus institution ID |
| `API_VALID` | Yes | Nedarim Plus API key |
| `NEDARIM_WEBHOOK_IP` | No | Nedarim Plus webhook IP (default: `18.194.219.73`) |

Generate a session secret:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Project Structure

```
givstack/
├── server.js          ← Express server + all API routes
├── database.js        ← SQLite operations
├── givstack.db        ← Created automatically on first run
├── public/            ← Public campaign page
│   ├── index.html
│   ├── css/style.css
│   ├── js/main.js
│   └── images/        ← Place your logo.png here
└── admin/             ← Admin panel (/admin)
    ├── index.html
    ├── css/admin.css
    └── js/admin.js
```

---

## Production Deployment (VPS + nginx)

```bash
# Install PM2
npm install -g pm2
pm2 start server.js --name givstack
pm2 save && pm2 startup
```

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
# SSL
certbot --nginx -d yourdomain.com
```

---

## Nedarim Plus Webhook

Set your callback URL in Nedarim Plus to:
```
https://yourdomain.com/api/webhook
```

The server only accepts calls from the official Nedarim Plus IP (`18.194.219.73`).

---

## Ambassador Links

```
https://yourdomain.com?ref=ambassador-code
```

Donations via this link are automatically attributed to the ambassador.

---

## Database Backup

```bash
# Manual
cp givstack.db backup/givstack_$(date +%Y%m%d).db

# Cron (daily at 2am)
0 2 * * * cp /var/www/givstack/givstack.db /backup/givstack_$(date +\%Y\%m\%d).db
```

---

## PM2 Commands

```bash
pm2 status
pm2 logs givstack
pm2 restart givstack
```

---

## License

MIT — free to use, modify, and deploy.
