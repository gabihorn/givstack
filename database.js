const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'givstack.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS amount_buttons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      amount INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price INTEGER DEFAULT 0,
      quantity_total INTEGER DEFAULT 1,
      quantity_remaining INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ambassadors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      goal INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT DEFAULT 'nedarim',
      payment_method TEXT,
      donor_name TEXT,
      amount INTEGER NOT NULL,
      currency INTEGER DEFAULT 1,
      comment TEXT,
      item_id INTEGER,
      ambassador_id INTEGER,
      transaction_id TEXT,
      param2 TEXT,
      show_in_wall INTEGER DEFAULT 1,
      donation_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      raw_webhook TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id),
      FOREIGN KEY (ambassador_id) REFERENCES ambassadors(id)
    );

    CREATE TABLE IF NOT EXISTS updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  seedData(db);
}

function seedData(db) {
  // Default settings — all configurable via admin panel after setup
  const defaultSettings = {
    campaign_name: 'My Campaign',
    subtitle: '',
    banner_text: '',
    goal: '10000',
    contact_phone: '',
    contact_email: '',
    is_active: '1',
    show_progress: '1',
    show_wall: '1',
    start_date: '',
    end_date: '',
    video_url: '',
    matching_text: '',
    admin_phone: '',
    notify_donor: '0',
  };

  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaultSettings)) {
    insertSetting.run(key, value);
  }

  // Default donation amount buttons
  const buttonCount = db.prepare('SELECT COUNT(*) as cnt FROM amount_buttons').get();
  if (buttonCount.cnt === 0) {
    const insertButton = db.prepare('INSERT INTO amount_buttons (label, amount, sort_order, active) VALUES (?, ?, ?, 1)');
    const buttons = [
      ['$18', 18, 1],
      ['$36', 36, 2],
      ['$54', 54, 3],
      ['$100', 100, 4],
      ['Custom', 0, 5],
    ];
    for (const [label, amount, sort_order] of buttons) {
      insertButton.run(label, amount, sort_order);
    }
  }

  // No default items — add your own via admin panel
}

// ===== SETTINGS =====
function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

function setSetting(key, value) {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function setSettings(obj) {
  const stmt = getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const tx = getDb().transaction((entries) => {
    for (const [k, v] of entries) stmt.run(k, String(v));
  });
  tx(Object.entries(obj));
}

// ===== BUTTONS =====
function getButtons(activeOnly = false) {
  const sql = activeOnly
    ? 'SELECT * FROM amount_buttons WHERE active = 1 ORDER BY sort_order'
    : 'SELECT * FROM amount_buttons ORDER BY sort_order';
  return getDb().prepare(sql).all();
}

function upsertButton(data) {
  if (data.id) {
    getDb().prepare(`
      UPDATE amount_buttons SET label=?, amount=?, sort_order=?, active=? WHERE id=?
    `).run(data.label, data.amount, data.sort_order ?? 0, data.active ?? 1, data.id);
    return data.id;
  } else {
    const info = getDb().prepare(`
      INSERT INTO amount_buttons (label, amount, sort_order, active) VALUES (?, ?, ?, ?)
    `).run(data.label, data.amount, data.sort_order ?? 0, data.active ?? 1);
    return info.lastInsertRowid;
  }
}

function deleteButton(id) {
  getDb().prepare('DELETE FROM amount_buttons WHERE id = ?').run(id);
}

// ===== ITEMS =====
function getItems(activeOnly = false) {
  const sql = activeOnly
    ? 'SELECT * FROM items WHERE active = 1 AND price > 0 ORDER BY sort_order'
    : 'SELECT * FROM items ORDER BY sort_order';
  return getDb().prepare(sql).all();
}

function getItem(id) {
  return getDb().prepare('SELECT * FROM items WHERE id = ?').get(id);
}

function upsertItem(data) {
  if (data.id) {
    getDb().prepare(`
      UPDATE items SET name=?, price=?, quantity_total=?, quantity_remaining=?, active=?, sort_order=? WHERE id=?
    `).run(data.name, data.price ?? 0, data.quantity_total ?? 1, data.quantity_remaining ?? 1, data.active ?? 1, data.sort_order ?? 0, data.id);
    return data.id;
  } else {
    const qty = data.quantity_total ?? 1;
    const info = getDb().prepare(`
      INSERT INTO items (name, price, quantity_total, quantity_remaining, active, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.name, data.price ?? 0, qty, qty, data.active ?? 1, data.sort_order ?? 0);
    return info.lastInsertRowid;
  }
}

function decrementItem(itemId) {
  getDb().prepare(`
    UPDATE items SET quantity_remaining = MAX(0, quantity_remaining - 1) WHERE id = ?
  `).run(itemId);
}

// ===== AMBASSADORS =====
function getAmbassadors(activeOnly = false) {
  const sql = `
    SELECT a.*,
      COALESCE(SUM(d.amount), 0) as raised,
      COUNT(d.id) as donor_count
    FROM ambassadors a
    LEFT JOIN donations d ON d.ambassador_id = a.id
    ${activeOnly ? 'WHERE a.active = 1' : ''}
    GROUP BY a.id
    ORDER BY raised DESC
  `;
  return getDb().prepare(sql).all();
}

function getAmbassadorByCode(code) {
  return getDb().prepare('SELECT * FROM ambassadors WHERE code = ?').get(code);
}

function upsertAmbassador(data) {
  if (data.id) {
    getDb().prepare(`
      UPDATE ambassadors SET name=?, code=?, goal=?, active=? WHERE id=?
    `).run(data.name, data.code, data.goal ?? 0, data.active ?? 1, data.id);
    return data.id;
  } else {
    const info = getDb().prepare(`
      INSERT INTO ambassadors (name, code, goal, active) VALUES (?, ?, ?, ?)
    `).run(data.name, data.code, data.goal ?? 0, data.active ?? 1);
    return info.lastInsertRowid;
  }
}

function deleteAmbassador(id) {
  getDb().prepare('DELETE FROM ambassadors WHERE id = ?').run(id);
}

// ===== DONATIONS =====
function getDonations({ limit = 20, offset = 0, wallOnly = true } = {}) {
  const sql = `
    SELECT d.*, i.name as item_name
    FROM donations d
    LEFT JOIN items i ON i.id = d.item_id
    ${wallOnly ? 'WHERE d.show_in_wall = 1' : ''}
    ORDER BY d.donation_date DESC
    LIMIT ? OFFSET ?
  `;
  return getDb().prepare(sql).all(limit, offset);
}

function getAllDonationsForExport() {
  return getDb().prepare(`
    SELECT d.*, i.name as item_name, a.name as ambassador_name
    FROM donations d
    LEFT JOIN items i ON i.id = d.item_id
    LEFT JOIN ambassadors a ON a.id = d.ambassador_id
    ORDER BY d.donation_date DESC
  `).all();
}

function getAdminDonations({ limit = 50, offset = 0 } = {}) {
  return getDb().prepare(`
    SELECT d.*, i.name as item_name, a.name as ambassador_name
    FROM donations d
    LEFT JOIN items i ON i.id = d.item_id
    LEFT JOIN ambassadors a ON a.id = d.ambassador_id
    ORDER BY d.donation_date DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);
}

function updateDonation(id, data) {
  getDb().prepare(`
    UPDATE donations SET donor_name=?, amount=?, comment=?, show_in_wall=? WHERE id=?
  `).run(data.donor_name ?? null, data.amount, data.comment ?? null, data.show_in_wall ?? 1, id);
}

function getStats() {
  const db = getDb();
  const totals = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total_raised, COUNT(*) as donor_count,
           MAX(donation_date) as last_donation_at
    FROM donations
  `).get();
  const goal = parseInt(getSetting('goal') || '120750', 10);
  const percentage = goal > 0 ? Math.min(100, Math.round((totals.total_raised / goal) * 100)) : 0;
  return { ...totals, goal, percentage };
}

function isDuplicateWebhook(param2) {
  const row = getDb().prepare('SELECT id FROM donations WHERE param2 = ?').get(param2);
  return !!row;
}

function insertDonation(data) {
  const info = getDb().prepare(`
    INSERT INTO donations
      (source, payment_method, donor_name, amount, currency, comment,
       item_id, ambassador_id, transaction_id, param2, show_in_wall,
       donation_date, raw_webhook)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.source ?? 'nedarim',
    data.payment_method ?? null,
    data.donor_name ?? null,
    data.amount,
    data.currency ?? 1,
    data.comment ?? null,
    data.item_id ?? null,
    data.ambassador_id ?? null,
    data.transaction_id ?? null,
    data.param2 ?? null,
    data.show_in_wall ?? 1,
    data.donation_date ?? new Date().toISOString(),
    data.raw_webhook ?? null
  );
  return info.lastInsertRowid;
}

// ===== UPDATES =====
function getUpdates() {
  return getDb().prepare('SELECT * FROM updates ORDER BY created_at DESC').all();
}

function upsertUpdate(data) {
  if (data.id) {
    getDb().prepare('UPDATE updates SET title=?, content=?, created_at=? WHERE id=?')
      .run(data.title ?? null, data.content, data.created_at ?? new Date().toISOString(), data.id);
    return data.id;
  } else {
    const info = getDb().prepare('INSERT INTO updates (title, content, created_at) VALUES (?, ?, ?)')
      .run(data.title ?? null, data.content, data.created_at ?? new Date().toISOString());
    return info.lastInsertRowid;
  }
}

function deleteUpdate(id) {
  getDb().prepare('DELETE FROM updates WHERE id = ?').run(id);
}

module.exports = {
  initDb,
  getSetting, getAllSettings, setSetting, setSettings,
  getButtons, upsertButton, deleteButton,
  getItems, getItem, upsertItem, decrementItem,
  getAmbassadors, getAmbassadorByCode, upsertAmbassador, deleteAmbassador,
  getDonations, getAdminDonations, getAllDonationsForExport, getStats, isDuplicateWebhook, insertDonation, updateDonation,
  getUpdates, upsertUpdate, deleteUpdate,
};
