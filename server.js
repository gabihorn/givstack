require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const NEDARIM_IP = process.env.NEDARIM_WEBHOOK_IP || '18.194.219.73';

// ===== MIDDLEWARE =====
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      frameSrc: ["'self'", 'https://www.matara.pro'],
      imgSrc: ["'self'", 'data:', 'https:', 'http:'],
      connectSrc: ["'self'"],
    },
  },
  strictTransportSecurity: false,
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Dynamic index.html with OG tags
app.get('/', (req, res) => {
  try {
    const s = db.getAllSettings();
    const title = s.campaign_name || 'GivStack';
    const desc = s.subtitle || s.banner_text || 'קמפיין גיוס תרומות';
    const siteUrl = process.env.SITE_URL || `http://${req.headers.host}`;
    const imgUrl = `${siteUrl}/images/logo.png`;
    let html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    html = html.replace('{{OG_TITLE}}', title)
               .replace('{{OG_DESC}}', desc)
               .replace('{{OG_IMAGE}}', imgUrl)
               .replace('{{OG_URL}}', siteUrl);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', express.static(path.join(__dirname, 'admin')));

// ===== RATE LIMITING =====
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
});

app.use('/api/', apiLimiter);
app.use('/api/webhook', webhookLimiter);

// ===== ADMIN AUTH =====
const adminTokens = new Set();

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ===== PUBLIC API =====

app.get('/api/stats', (req, res) => {
  try {
    res.json(db.getStats());
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

app.get('/api/donors', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const donors = db.getDonations({ limit, offset, wallOnly: true });
    const formatted = donors.map(d => ({
      ...d,
      time_ago: timeAgo(d.donation_date),
    }));
    res.json(formatted);
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

app.get('/api/ambassadors', (req, res) => {
  try {
    res.json(db.getAmbassadors(true));
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

app.get('/api/items', (req, res) => {
  try {
    res.json(db.getItems(true));
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

app.get('/api/updates', (req, res) => {
  try {
    res.json(db.getUpdates());
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

app.get('/api/settings/public', (req, res) => {
  try {
    const s = db.getAllSettings();
    const buttons = db.getButtons(true);
    res.json({
      campaign_name: s.campaign_name || 'GivStack',
      subtitle: s.subtitle || '',
      banner_text: s.banner_text || '',
      goal: parseInt(s.goal || '120750', 10),
      contact_phone: s.contact_phone || '',
      contact_email: s.contact_email || '',
      is_active: s.is_active === '1',
      show_progress: s.show_progress === '1',
      show_wall: s.show_wall === '1',
      amount_buttons: buttons,
      mosad_id: process.env.MOSAD_ID || s.mosad_id || '',
      api_valid: process.env.API_VALID || s.api_valid || '',
      end_date: s.end_date || '',
      video_url: s.video_url || '',
      matching_text: s.matching_text || '',
    });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

// ===== WHATSAPP NOTIFICATIONS =====
const WA_BRIDGE_URL = 'http://localhost:3000/api/send';
const WA_BRIDGE_KEY = 'WhatsappBridge_SecretKey_2026';

async function sendWhatsApp(phone, message) {
  if (!phone) return;
  try {
    const cleaned = phone.replace(/\D/g, '');
    const to = cleaned.startsWith('972') ? `${cleaned}@s.whatsapp.net` : `972${cleaned.replace(/^0/, '')}@s.whatsapp.net`;
    await fetch(WA_BRIDGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': WA_BRIDGE_KEY },
      body: JSON.stringify({ to, text: message }),
    });
  } catch (e) {
    console.error('WA send error:', e.message);
  }
}

// ===== WEBHOOK =====
app.post('/api/webhook', (req, res) => {
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;

  // אימות IP
  if (clientIp !== NEDARIM_IP && process.env.NODE_ENV !== 'development') {
    console.warn(`Webhook from unauthorized IP: ${clientIp}`);
    return res.status(403).json({ error: 'Forbidden' });
  }

  const raw = JSON.stringify(req.body);
  console.log('Webhook received:', raw);

  try {
    const data = req.body;
    const param2 = data.Param2 || data.param2;
    const amount = parseInt(data.Amount || data.amount || '0', 10);

    if (!amount) {
      return res.json({ status: 'ok', message: 'zero amount ignored' });
    }

    // מניעת כפילות
    if (param2 && db.isDuplicateWebhook(param2)) {
      console.log('Duplicate webhook ignored:', param2);
      return res.json({ status: 'ok', message: 'duplicate' });
    }

    // חיפוש פריט לפי Comment
    let itemId = null;
    const comment = data.Comment || data.comment || '';
    if (comment) {
      const items = db.getItems();
      const matched = items.find(i => i.name && comment.includes(i.name));
      if (matched) {
        itemId = matched.id;
        db.decrementItem(itemId);
      }
    }

    // חיפוש שגריר לפי Param1
    let ambassadorId = null;
    const param1 = data.Param1 || data.param1 || '';
    if (param1) {
      const amb = db.getAmbassadorByCode(param1);
      if (amb) ambassadorId = amb.id;
    }

    // קביעת שיטת תשלום
    let paymentMethod = 'credit';
    const payType = (data.PaymentType || data.paymentType || '').toLowerCase();
    if (payType.includes('bit')) paymentMethod = 'bit';
    else if (payType.includes('hok') || payType.includes('חוק')) paymentMethod = 'hok';

    const donorName = data.FullName || data.fullName || 'אנונימי';
    const donorPhone = data.Phone || data.phone || data.MobilePhone || '';

    db.insertDonation({
      source: 'nedarim',
      payment_method: paymentMethod,
      donor_name: donorName !== 'אנונימי' ? donorName : null,
      amount,
      currency: parseInt(data.Currency || '1', 10),
      comment: comment || null,
      item_id: itemId,
      ambassador_id: ambassadorId,
      transaction_id: data.TransactionId || data.transactionId || null,
      param2: param2 || null,
      show_in_wall: 1,
      raw_webhook: raw,
    });

    // WhatsApp notifications (non-blocking)
    const s = db.getAllSettings();
    const adminPhone = s.admin_phone || '';
    const campaignName = s.campaign_name || 'GivStack';
    const formattedAmount = `₪${Number(amount).toLocaleString('he-IL')}`;

    if (adminPhone) {
      const adminMsg = `💰 תרומה חדשה!\n👤 ${donorName}\n💵 ${formattedAmount}\n📌 ${comment || 'ללא פריט'}\n🏁 קמפיין: ${campaignName}`;
      sendWhatsApp(adminPhone, adminMsg);
    }
    if (s.notify_donor === '1' && donorPhone) {
      const donorMsg = `שלום ${donorName} 🙏\nתרומתך בסך ${formattedAmount} לקמפיין "${campaignName}" התקבלה בהצלחה!\nתודה רבה על תמיכתך!`;
      sendWhatsApp(donorPhone, donorMsg);
    }

    res.json({ status: 'ok' });
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).json({ status: 'error' });
  }
});

// ===== ADMIN AUTH =====
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = uuidv4();
    adminTokens.add(token);
    setTimeout(() => adminTokens.delete(token), 24 * 60 * 60 * 1000); // פג תוקף 24 שעות
    return res.json({ token });
  }
  res.status(401).json({ error: 'סיסמה שגויה' });
});

// ===== ADMIN SETTINGS =====
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const s = db.getAllSettings();
  // Env values take priority — show them in admin so the user can see what's active
  if (!s.mosad_id && process.env.MOSAD_ID) s.mosad_id = process.env.MOSAD_ID;
  if (!s.api_valid && process.env.API_VALID) s.api_valid = process.env.API_VALID;
  res.json(s);
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    db.setSettings(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

// ===== ADMIN DONATIONS =====
app.get('/api/admin/donations', requireAdmin, (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    res.json(db.getAdminDonations({ limit, offset }));
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשרת' });
  }
});

app.put('/api/admin/donations/:id', requireAdmin, (req, res) => {
  try {
    db.updateDonation(parseInt(req.params.id), req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

// ===== LOGO UPLOAD =====
app.post('/api/admin/logo', requireAdmin, (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'חסרה תמונה' });
    const match = imageBase64.match(/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,(.+)$/);
    if (!match) return res.status(400).json({ error: 'פורמט לא תקין' });
    const imgBuffer = Buffer.from(match[2], 'base64');
    const logoPath = path.join(__dirname, 'public', 'images', 'logo.png');
    fs.writeFileSync(logoPath, imgBuffer);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירת הלוגו' });
  }
});

// ===== ADMIN BUTTONS =====
app.get('/api/admin/buttons', requireAdmin, (req, res) => {
  res.json(db.getButtons());
});

app.post('/api/admin/buttons', requireAdmin, (req, res) => {
  try {
    const id = db.upsertButton(req.body);
    res.json({ id, ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.put('/api/admin/buttons/:id', requireAdmin, (req, res) => {
  try {
    db.upsertButton({ ...req.body, id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.delete('/api/admin/buttons/:id', requireAdmin, (req, res) => {
  db.deleteButton(parseInt(req.params.id));
  res.json({ ok: true });
});

// ===== ADMIN ITEMS =====
app.get('/api/admin/items', requireAdmin, (req, res) => {
  res.json(db.getItems());
});

app.post('/api/admin/items', requireAdmin, (req, res) => {
  try {
    const id = db.upsertItem(req.body);
    res.json({ id, ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.put('/api/admin/items/:id', requireAdmin, (req, res) => {
  try {
    db.upsertItem({ ...req.body, id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.delete('/api/admin/items/:id', requireAdmin, (req, res) => {
  try {
    const item = db.getItem(parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: 'לא נמצא' });
    db.upsertItem({ ...item, active: 0 });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

// ===== ADMIN AMBASSADORS =====
app.get('/api/admin/ambassadors', requireAdmin, (req, res) => {
  res.json(db.getAmbassadors());
});

app.post('/api/admin/ambassadors', requireAdmin, (req, res) => {
  try {
    if (!req.body.code) req.body.code = generateCode(req.body.name);
    const id = db.upsertAmbassador(req.body);
    res.json({ id, ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.put('/api/admin/ambassadors/:id', requireAdmin, (req, res) => {
  try {
    db.upsertAmbassador({ ...req.body, id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.delete('/api/admin/ambassadors/:id', requireAdmin, (req, res) => {
  db.deleteAmbassador(parseInt(req.params.id));
  res.json({ ok: true });
});

// ===== ADMIN UPDATES =====
app.get('/api/admin/updates', requireAdmin, (req, res) => {
  res.json(db.getUpdates());
});

app.post('/api/admin/updates', requireAdmin, (req, res) => {
  try {
    const id = db.upsertUpdate(req.body);
    res.json({ id, ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.put('/api/admin/updates/:id', requireAdmin, (req, res) => {
  try {
    db.upsertUpdate({ ...req.body, id: parseInt(req.params.id) });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

app.delete('/api/admin/updates/:id', requireAdmin, (req, res) => {
  db.deleteUpdate(parseInt(req.params.id));
  res.json({ ok: true });
});

// ===== MANUAL DONATION =====
app.post('/api/admin/donations/manual', requireAdmin, (req, res) => {
  try {
    const { donor_name, amount, payment_method, item_id, comment, donation_date, ambassador_id, show_in_wall } = req.body;
    if (!amount || isNaN(parseInt(amount))) return res.status(400).json({ error: 'סכום חסר' });
    if (!donor_name) return res.status(400).json({ error: 'שם תורם חסר' });

    if (item_id) db.decrementItem(parseInt(item_id));

    const id = db.insertDonation({
      source: 'manual',
      payment_method: payment_method || 'cash',
      donor_name,
      amount: parseInt(amount),
      comment: comment || null,
      item_id: item_id ? parseInt(item_id) : null,
      ambassador_id: ambassador_id ? parseInt(ambassador_id) : null,
      show_in_wall: show_in_wall ? 1 : 0,
      donation_date: donation_date || new Date().toISOString(),
      param2: uuidv4(),
    });
    res.json({ id, ok: true });
  } catch (e) {
    res.status(500).json({ error: 'שגיאה בשמירה' });
  }
});

// ===== EXPORT CSV =====
app.get('/api/export/donations', requireAdmin, (req, res) => {
  const donations = db.getAllDonationsForExport();
  const headers = ['ID', 'שם תורם', 'סכום', 'מקור', 'אמצעי תשלום', 'פריט הנצחה', 'שגריר', 'הערה', 'תאריך'];
  const rows = donations.map(d => [
    d.id, d.donor_name || '', d.amount, d.source, d.payment_method || '',
    d.item_name || '', d.ambassador_name || '', d.comment || '',
    d.donation_date,
  ]);
  sendCsv(res, 'donations.csv', headers, rows);
});

app.get('/api/export/items', requireAdmin, (req, res) => {
  const items = db.getItems();
  const headers = ['ID', 'שם פריט', 'מחיר', 'כמות כוללת', 'כמות נותרת', 'פעיל'];
  const rows = items.map(i => [i.id, i.name, i.price, i.quantity_total, i.quantity_remaining, i.active ? 'כן' : 'לא']);
  sendCsv(res, 'items.csv', headers, rows);
});

app.get('/api/export/ambassadors', requireAdmin, (req, res) => {
  const ambs = db.getAmbassadors();
  const headers = ['ID', 'שם', 'קוד', 'יעד', 'גויס', 'תורמים', 'פעיל'];
  const rows = ambs.map(a => [a.id, a.name, a.code, a.goal, a.raised, a.donor_count, a.active ? 'כן' : 'לא']);
  sendCsv(res, 'ambassadors.csv', headers, rows);
});

// ===== HELPERS =====
function sendCsv(res, filename, headers, rows) {
  const bom = '﻿';
  const lines = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(bom + lines.join('\r\n'));
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'עכשיו';
  if (diff < 3600) return `לפני ${Math.floor(diff / 60)} דקות`;
  if (diff < 86400) return `לפני ${Math.floor(diff / 3600)} שעות`;
  return `לפני ${Math.floor(diff / 86400)} ימים`;
}

function generateCode(name) {
  const base = (name || 'amb').replace(/\s+/g, '').toLowerCase().slice(0, 6);
  return base + Math.floor(1000 + Math.random() * 9000);
}

// ===== START =====
db.initDb();
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin`);
});
