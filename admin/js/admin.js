'use strict';

let adminToken = sessionStorage.getItem('admin_token') || '';

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  if (adminToken) {
    showApp();
  } else {
    document.getElementById('login-screen').style.display = 'flex';
  }

  // Set today as default date for manual donation
  const dateInput = document.getElementById('m-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

  // Set current datetime for update
  const updDate = document.getElementById('upd-date');
  if (updDate) updDate.value = new Date().toISOString().slice(0, 16);

  // Add sidebar overlay for mobile
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  overlay.id = 'sidebar-overlay';
  overlay.onclick = closeSidebar;
  document.body.appendChild(overlay);
});

// ===== AUTH =====
async function doLogin(e) {
  e.preventDefault();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';

  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();

    if (res.ok && data.token) {
      adminToken = data.token;
      sessionStorage.setItem('admin_token', adminToken);
      document.getElementById('login-screen').style.display = 'none';
      showApp();
    } else {
      errEl.textContent = data.error || 'שגיאת כניסה';
    }
  } catch (e) {
    errEl.textContent = 'שגיאת תקשורת';
  }
}

function doLogout() {
  adminToken = '';
  sessionStorage.removeItem('admin_token');
  location.reload();
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-app').style.display = 'flex';
  showPage('dashboard');
}

// ===== NAVIGATION =====
function showPage(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageName}`);
  if (page) page.classList.add('active');

  const navBtn = document.querySelector(`[data-page="${pageName}"]`);
  if (navBtn) navBtn.classList.add('active');

  closeSidebar();

  // טען נתונים לפי עמוד
  switch (pageName) {
    case 'dashboard': loadDashboard(); break;
    case 'settings': loadSettingsPage(); break;
    case 'buttons': loadButtonsPage(); break;
    case 'items': loadItemsPage(); break;
    case 'ambassadors': loadAmbassadorsPage(); break;
    case 'manual': loadManualPage(); break;
    case 'updates': loadUpdatesPage(); break;
    case 'donations': loadDonationsPage(); break;
    case 'reports': loadReportsPage(); break;
  }
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('show');
}

function closeSidebar() {
  document.querySelector('.sidebar').classList.remove('open');
  const ov = document.getElementById('sidebar-overlay');
  if (ov) ov.classList.remove('show');
}

// ===== API HELPER =====
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Token': adminToken,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(path, opts);
  if (res.status === 401) { doLogout(); return null; }
  return res.json();
}

// ===== DASHBOARD =====
async function loadDashboard() {
  try {
    const [stats, donors] = await Promise.all([
      fetch('/api/stats').then(r => r.json()),
      fetch('/api/donors?limit=10').then(r => r.json()),
    ]);

    document.getElementById('stat-raised').textContent = formatMoney(stats.total_raised);
    document.getElementById('stat-donors').textContent = stats.donor_count;
    document.getElementById('stat-pct').textContent = `${stats.percentage}%`;
    document.getElementById('stat-goal').textContent = formatMoney(stats.goal);

    renderRecentDonations(donors);
  } catch (e) { showToast('שגיאה בטעינת נתונים', 'error'); }
}

function renderRecentDonations(donors) {
  const list = document.getElementById('recent-donations');
  if (!donors.length) {
    list.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px">אין תרומות עדיין</p>';
    return;
  }
  list.innerHTML = donors.map(d => `
    <div class="recent-item">
      <div class="recent-source ${d.source === 'manual' ? 'source-manual' : 'source-nedarim'}">
        ${d.source === 'manual' ? '✏️' : '💳'}
      </div>
      <div class="recent-info">
        <div class="recent-name">${esc(d.donor_name || 'אנונימי')}</div>
        <div class="recent-meta">${d.payment_method || ''} · ${d.time_ago || ''} ${d.item_name ? '· ' + esc(d.item_name) : ''}</div>
      </div>
      <div class="recent-amount">${formatMoney(d.amount)}</div>
    </div>
  `).join('');
}

// ===== SETTINGS PAGE =====
async function loadSettingsPage() {
  const data = await api('GET', '/api/admin/settings');
  if (!data) return;

  const form = document.getElementById('settings-form');
  for (const [key, value] of Object.entries(data)) {
    const el = form.querySelector(`[name="${key}"]`);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = value === '1';
    else el.value = value || '';
  }
}

async function saveSettings(e) {
  e.preventDefault();
  const form = document.getElementById('settings-form');
  const data = {};

  form.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') data[el.name] = el.checked ? '1' : '0';
    else data[el.name] = el.value;
  });

  const res = await api('PUT', '/api/admin/settings', data);
  if (res?.ok) showToast('הגדרות נשמרו בהצלחה', 'success');
  else showToast('שגיאה בשמירה', 'error');
}

// ===== BUTTONS PAGE =====
let buttonsData = [];

async function loadButtonsPage() {
  buttonsData = await api('GET', '/api/admin/buttons') || [];
  renderButtonsTable();
}

function renderButtonsTable() {
  const tbody = document.getElementById('buttons-body');
  tbody.innerHTML = buttonsData.map((btn, i) => `
    <tr data-id="${btn.id}">
      <td><input type="text" value="${esc(btn.label)}" data-field="label" /></td>
      <td><input type="number" value="${btn.amount}" data-field="amount" style="max-width:100px" /></td>
      <td><input type="number" value="${btn.sort_order}" data-field="sort_order" style="max-width:70px" /></td>
      <td>
        <label class="toggle-label" style="justify-content:center">
          <input type="checkbox" class="toggle-input" data-field="active" ${btn.active ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td><button class="btn-danger" onclick="deleteButton(${btn.id}, this)">מחק</button></td>
    </tr>
  `).join('');
}

function addButtonRow() {
  buttonsData.push({ id: null, label: '', amount: '', sort_order: buttonsData.length + 1, active: 1 });
  renderButtonsTable();
  // Focus the new label input
  const rows = document.querySelectorAll('#buttons-body tr');
  const lastRow = rows[rows.length - 1];
  if (lastRow) lastRow.querySelector('[data-field="label"]').focus();
}

async function saveAllButtons() {
  const rows = document.querySelectorAll('#buttons-body tr');
  const promises = [];

  rows.forEach((row, i) => {
    const id = parseInt(row.dataset.id) || null;
    const label = row.querySelector('[data-field="label"]').value.trim();
    const rawAmount = row.querySelector('[data-field="amount"]').value;
    // Parse amount; if empty/invalid and label contains a number, extract it
    let amount = parseInt(rawAmount);
    if (isNaN(amount) || (amount === 0 && rawAmount === '')) {
      const extracted = label.replace(/[^\d]/g, '');
      amount = extracted ? parseInt(extracted) : 0;
    }
    const sort_order = parseInt(row.querySelector('[data-field="sort_order"]').value) || i;
    const active = row.querySelector('[data-field="active"]').checked ? 1 : 0;

    const data = { label, amount, sort_order, active };
    if (id) {
      promises.push(api('PUT', `/api/admin/buttons/${id}`, data));
    } else {
      promises.push(api('POST', '/api/admin/buttons', data));
    }
  });

  await Promise.all(promises);
  showToast('כפתורים נשמרו', 'success');
  loadButtonsPage();
}

async function deleteButton(id, btn) {
  if (!confirm('למחוק את הכפתור?')) return;
  await api('DELETE', `/api/admin/buttons/${id}`);
  showToast('נמחק', 'success');
  loadButtonsPage();
}

// ===== ITEMS PAGE =====
let itemsData = [];

async function loadItemsPage() {
  itemsData = await api('GET', '/api/admin/items') || [];
  renderItemsTable();
}

function renderItemsTable() {
  const tbody = document.getElementById('items-body');
  tbody.innerHTML = itemsData.map(item => `
    <tr data-id="${item.id}">
      <td><input type="text" value="${esc(item.name)}" data-field="name" /></td>
      <td><input type="number" value="${item.price}" data-field="price" style="max-width:100px" /></td>
      <td><input type="number" value="${item.quantity_total}" data-field="quantity_total" style="max-width:80px" /></td>
      <td>${item.quantity_remaining}</td>
      <td><input type="number" value="${item.sort_order}" data-field="sort_order" style="max-width:70px" /></td>
      <td>
        <label class="toggle-label" style="justify-content:center">
          <input type="checkbox" class="toggle-input" data-field="active" ${item.active ? 'checked' : ''} />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <button class="btn-secondary" onclick="saveItem(${item.id}, this.closest('tr'))">שמור</button>
        <button class="btn-danger" onclick="hideItem(${item.id})" style="margin-top:4px">הסתר</button>
      </td>
    </tr>
  `).join('');
}

function addItemRow() {
  const tbody = document.getElementById('items-body');
  const tr = document.createElement('tr');
  tr.dataset.id = '';
  tr.innerHTML = `
    <td><input type="text" data-field="name" placeholder="שם הפריט" /></td>
    <td><input type="number" data-field="price" value="0" style="max-width:100px" /></td>
    <td><input type="number" data-field="quantity_total" value="1" style="max-width:80px" /></td>
    <td>1</td>
    <td><input type="number" data-field="sort_order" value="${itemsData.length + 1}" style="max-width:70px" /></td>
    <td>
      <label class="toggle-label" style="justify-content:center">
        <input type="checkbox" class="toggle-input" data-field="active" checked />
        <span class="toggle-slider"></span>
      </label>
    </td>
    <td><button class="btn-secondary" onclick="saveItem(null, this.closest('tr'))">שמור</button></td>
  `;
  tbody.prepend(tr);
}

async function saveItem(id, row) {
  const data = {
    name: row.querySelector('[data-field="name"]').value,
    price: parseInt(row.querySelector('[data-field="price"]').value) || 0,
    quantity_total: parseInt(row.querySelector('[data-field="quantity_total"]').value) || 1,
    quantity_remaining: parseInt(row.querySelector('[data-field="quantity_total"]').value) || 1,
    sort_order: parseInt(row.querySelector('[data-field="sort_order"]').value) || 0,
    active: row.querySelector('[data-field="active"]').checked ? 1 : 0,
  };

  if (!data.name) { showToast('נדרש שם לפריט', 'error'); return; }

  let res;
  if (id) {
    res = await api('PUT', `/api/admin/items/${id}`, data);
  } else {
    res = await api('POST', '/api/admin/items', data);
  }

  if (res?.ok) { showToast('פריט נשמר', 'success'); loadItemsPage(); }
  else showToast('שגיאה בשמירה', 'error');
}

async function hideItem(id) {
  if (!confirm('להסתיר את הפריט?')) return;
  await api('DELETE', `/api/admin/items/${id}`);
  showToast('פריט הוסתר', 'success');
  loadItemsPage();
}

// ===== AMBASSADORS PAGE =====
async function loadAmbassadorsPage() {
  const ambs = await api('GET', '/api/admin/ambassadors') || [];
  const tbody = document.getElementById('ambassadors-body');
  const baseUrl = window.location.origin;

  tbody.innerHTML = ambs.map(a => `
    <tr>
      <td><strong>${esc(a.name)}</strong></td>
      <td><code>${esc(a.code)}</code></td>
      <td>${formatMoney(a.goal)}</td>
      <td>${formatMoney(a.raised)}</td>
      <td>${a.donor_count}</td>
      <td><span class="badge ${a.active ? 'badge-green' : 'badge-gray'}">${a.active ? 'פעיל' : 'לא פעיל'}</span></td>
      <td>
        <button class="btn-secondary" onclick="copyLink('${baseUrl}/?ref=${esc(a.code)}')">העתק לינק</button>
      </td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-secondary" onclick="openAmbEdit(${a.id},'${esc(a.name)}',${a.goal},${a.active})">עריכה</button>
        <button class="btn-danger" onclick="deleteAmbassador(${a.id})">מחק</button>
      </td>
    </tr>
  `).join('');
}

async function addAmbassador(e) {
  e.preventDefault();
  const name = document.getElementById('amb-name').value;
  const goal = parseInt(document.getElementById('amb-goal').value) || 0;
  const code = document.getElementById('amb-code').value || '';

  const data = { name, goal, code: code || undefined, active: 1 };
  const res = await api('POST', '/api/admin/ambassadors', data);

  if (res?.ok) {
    showToast('שגריר נוסף!', 'success');
    document.getElementById('ambassador-form').reset();
    loadAmbassadorsPage();
  } else {
    showToast('שגיאה - ייתכן שהקוד כבר קיים', 'error');
  }
}

async function deleteAmbassador(id) {
  if (!confirm('למחוק את השגריר?')) return;
  await api('DELETE', `/api/admin/ambassadors/${id}`);
  showToast('נמחק', 'success');
  loadAmbassadorsPage();
}

function openAmbEdit(id, name, goal, active) {
  document.getElementById('amb-edit-id').value = id;
  document.getElementById('amb-edit-name').value = name;
  document.getElementById('amb-edit-goal').value = goal;
  document.getElementById('amb-edit-active').checked = !!active;
  document.getElementById('amb-edit-overlay').style.display = 'flex';
}

function closeAmbEdit() {
  document.getElementById('amb-edit-overlay').style.display = 'none';
}

async function saveAmbEdit() {
  const id = parseInt(document.getElementById('amb-edit-id').value);
  const name = document.getElementById('amb-edit-name').value.trim();
  const goal = parseInt(document.getElementById('amb-edit-goal').value) || 0;
  const active = document.getElementById('amb-edit-active').checked ? 1 : 0;
  if (!name) { showToast('שם חובה', 'error'); return; }
  const res = await api('PUT', `/api/admin/ambassadors/${id}`, { name, goal, active });
  if (res?.ok) {
    showToast('נשמר בהצלחה', 'success');
    closeAmbEdit();
    loadAmbassadorsPage();
  } else {
    showToast('שגיאה בשמירה', 'error');
  }
}

function copyLink(url) {
  navigator.clipboard.writeText(url).then(() => showToast('הלינק הועתק!', 'success'));
}

// ===== LOGO UPLOAD =====
function previewLogo(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('logo-preview');
    preview.src = e.target.result;
    preview.style.display = 'block';
    document.getElementById('logo-upload-btn').style.display = 'inline-block';
  };
  reader.readAsDataURL(file);
}

async function uploadLogo() {
  const input = document.getElementById('logo-file-input');
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const res = await api('POST', '/api/admin/logo', { imageBase64: e.target.result });
    if (res?.ok) {
      showToast('הלוגו עודכן בהצלחה!', 'success');
      document.getElementById('logo-upload-btn').style.display = 'none';
    } else {
      showToast('שגיאה בהעלאת הלוגו', 'error');
    }
  };
  reader.readAsDataURL(file);
}

// ===== MANUAL DONATION =====
async function loadManualPage() {
  const [items, ambs] = await Promise.all([
    fetch('/api/items').then(r => r.json()),
    fetch('/api/ambassadors').then(r => r.json()),
  ]);

  const itemSel = document.getElementById('m-item');
  itemSel.innerHTML = '<option value="">-- ללא הנצחה --</option>' +
    items.map(i => `<option value="${i.id}">${esc(i.name)} (${formatMoney(i.price)})</option>`).join('');

  const ambSel = document.getElementById('m-ambassador');
  ambSel.innerHTML = '<option value="">-- ללא --</option>' +
    ambs.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
}

async function saveManualDonation(e) {
  e.preventDefault();

  const data = {
    donor_name: document.getElementById('m-donor-name').value,
    amount: document.getElementById('m-amount').value,
    payment_method: document.getElementById('m-payment').value,
    item_id: document.getElementById('m-item').value || null,
    comment: document.getElementById('m-comment').value,
    donation_date: document.getElementById('m-date').value,
    ambassador_id: document.getElementById('m-ambassador').value || null,
    show_in_wall: document.getElementById('m-show-wall').checked ? 1 : 0,
  };

  const res = await api('POST', '/api/admin/donations/manual', data);

  if (res?.ok) {
    showToast('תרומה נשמרה בהצלחה!', 'success');
    document.getElementById('manual-form').reset();
    document.getElementById('m-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('m-show-wall').checked = true;
  } else {
    showToast(res?.error || 'שגיאה בשמירה', 'error');
  }
}

// ===== UPDATES PAGE =====
async function loadUpdatesPage() {
  const updates = await api('GET', '/api/admin/updates') || [];
  const list = document.getElementById('updates-admin-list');

  list.innerHTML = updates.map(u => `
    <div class="update-admin-card">
      <div class="update-admin-body">
        <div class="update-admin-date">${formatDate(u.created_at)}</div>
        ${u.title ? `<div class="update-admin-title">${esc(u.title)}</div>` : ''}
        <div class="update-admin-content">${esc(u.content)}</div>
      </div>
      <div class="update-admin-actions">
        <button class="btn-danger" onclick="deleteUpdate(${u.id})">מחק</button>
      </div>
    </div>
  `).join('') || '<p style="color:var(--text-muted);text-align:center;padding:20px">אין עדכונות</p>';
}

async function addUpdate(e) {
  e.preventDefault();
  const data = {
    title: document.getElementById('upd-title').value,
    content: document.getElementById('upd-content').value,
    created_at: document.getElementById('upd-date').value || new Date().toISOString(),
  };

  const res = await api('POST', '/api/admin/updates', data);
  if (res?.ok) {
    showToast('עדכון פורסם!', 'success');
    document.getElementById('update-form').reset();
    document.getElementById('upd-date').value = new Date().toISOString().slice(0, 16);
    loadUpdatesPage();
  } else {
    showToast('שגיאה בפרסום', 'error');
  }
}

async function deleteUpdate(id) {
  if (!confirm('למחוק את העדכון?')) return;
  await api('DELETE', `/api/admin/updates/${id}`);
  showToast('נמחק', 'success');
  loadUpdatesPage();
}

// ===== DONATIONS PAGE =====
let _donationsOffset = 0;
const _donationsLimit = 50;

async function loadDonationsPage(reset = true) {
  if (reset) {
    _donationsOffset = 0;
    document.getElementById('donations-body').innerHTML = '';
  }
  const data = await api('GET', `/api/admin/donations?limit=${_donationsLimit}&offset=${_donationsOffset}`) || [];
  renderDonationsTable(data, reset);
  _donationsOffset += data.length;
  const btn = document.getElementById('donations-load-more');
  if (btn) btn.style.display = data.length < _donationsLimit ? 'none' : 'block';
}

function loadMoreDonationsAdmin() { loadDonationsPage(false); }

function renderDonationsTable(donations, reset) {
  const tbody = document.getElementById('donations-body');
  if (reset && !donations.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#888;padding:30px">אין תרומות עדיין</td></tr>';
    return;
  }
  const rows = donations.map(d => `
    <tr>
      <td><strong>${esc(d.donor_name || 'אנונימי')}</strong></td>
      <td>${formatMoney(d.amount)}</td>
      <td style="font-size:13px;color:#888">${esc(d.item_name || '—')}</td>
      <td style="font-size:13px;color:#888">${esc(d.ambassador_name || '—')}</td>
      <td style="font-size:13px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.comment || '')}</td>
      <td style="font-size:12px;color:#888;white-space:nowrap">${formatDate(d.donation_date)}</td>
      <td>
        <label class="toggle-label" style="justify-content:center">
          <input type="checkbox" class="toggle-input" ${d.show_in_wall ? 'checked' : ''}
            onchange="toggleDonationWall(${d.id}, this.checked)" />
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <button class="btn-secondary" onclick="openDonEdit(${d.id},'${esc(d.donor_name||'')}',${d.amount},'${esc(d.comment||'')}',${d.show_in_wall})">עריכה</button>
      </td>
    </tr>
  `).join('');
  tbody.insertAdjacentHTML('beforeend', rows);
}

function openDonEdit(id, name, amount, comment, wall) {
  document.getElementById('don-edit-id').value = id;
  document.getElementById('don-edit-name').value = name;
  document.getElementById('don-edit-amount').value = amount;
  document.getElementById('don-edit-comment').value = comment;
  document.getElementById('don-edit-wall').checked = !!wall;
  document.getElementById('don-edit-overlay').style.display = 'flex';
}

function closeDonEdit() {
  document.getElementById('don-edit-overlay').style.display = 'none';
}

async function saveDonEdit() {
  const id = parseInt(document.getElementById('don-edit-id').value);
  const donor_name = document.getElementById('don-edit-name').value.trim();
  const amount = parseInt(document.getElementById('don-edit-amount').value) || 0;
  const comment = document.getElementById('don-edit-comment').value.trim();
  const show_in_wall = document.getElementById('don-edit-wall').checked ? 1 : 0;
  if (!amount) { showToast('סכום חובה', 'error'); return; }
  const res = await api('PUT', `/api/admin/donations/${id}`, { donor_name, amount, comment, show_in_wall });
  if (res?.ok) {
    showToast('תרומה עודכנה', 'success');
    closeDonEdit();
    loadDonationsPage();
  } else {
    showToast('שגיאה בשמירה', 'error');
  }
}

async function toggleDonationWall(id, show) {
  await api('PUT', `/api/admin/donations/${id}`, { show_in_wall: show ? 1 : 0 });
  showToast(show ? 'מוצג בקיר' : 'הוסתר מהקיר', 'success');
}

// ===== REPORTS PAGE =====
async function loadReportsPage() {
  try {
    const stats = await fetch('/api/stats').then(r => r.json());
    const ambs = await fetch('/api/ambassadors').then(r => r.json());

    document.getElementById('rep-total').textContent = formatMoney(stats.total_raised);
    document.getElementById('rep-ambs').textContent = ambs.length;

    // לצורך דוח מפורט יותר - נשתמש בנתוני stats
    document.getElementById('rep-nedarim').textContent = '—';
    document.getElementById('rep-manual').textContent = '—';

    // הוסף X-Admin-Token לקישורי ייצוא
    document.querySelectorAll('.btn-export').forEach(link => {
      const url = new URL(link.href);
      url.searchParams.set('token', adminToken);
      link.href = url.toString();
    });
  } catch (e) { showToast('שגיאה בטעינת דוחות', 'error'); }
}

// ===== UTILS =====
function formatMoney(n) {
  if (!n && n !== 0) return '₪0';
  return '₪' + Number(n).toLocaleString('he-IL');
}

function formatDate(str) {
  if (!str) return '';
  return new Date(str).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(msg, type = '') {
  const toast = document.getElementById('admin-toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ` ${type}` : '');
  setTimeout(() => { toast.className = 'toast'; }, 3200);
}
