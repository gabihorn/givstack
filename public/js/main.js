'use strict';

// ===== STATE =====
const state = {
  settings: {},
  items: [],
  selectedAmount: 0,
  selectedItemId: null,
  selectedItemName: '',
  ambassadorCode: '',
  donorsOffset: 0,
  donorsLimit: 20,
  videoUrl: '',
  lastDonationId: null,
};

const AVATAR_COLORS = ['#6B2FA0','#C9A84C','#10B981','#EF4444','#3B82F6','#F59E0B','#8B5CF6','#EC4899'];

// ===== INIT =====
document.addEventListener('DOMContentLoaded', async () => {
  // קריאת ref מ-URL
  const params = new URLSearchParams(window.location.search);
  state.ambassadorCode = params.get('ref') || '';

  await Promise.all([loadSettings(), loadStats(), loadItems(), loadDonors(), loadWall()]);
  await checkLiveDonation();
  startAutoRefresh();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePopup(); closeVideo(); }
  });

  // Hide floating CTA when hero donate button is visible
  const heroCta = document.querySelector('.hero-cta');
  const floatBtn = document.getElementById('mobile-float-cta');
  if (floatBtn && heroCta) {
    const obs = new IntersectionObserver(([e]) => {
      floatBtn.classList.toggle('hidden', e.isIntersecting);
    }, { threshold: 0.1 });
    obs.observe(heroCta);
  }
});

// ===== SETTINGS & STATS =====
async function loadSettings() {
  try {
    const res = await fetch('/api/settings/public');
    const s = await res.json();
    state.settings = s;
    applySettings(s);
  } catch (e) { console.error(e); }
}

function applySettings(s) {
  setText('campaign-name', s.campaign_name);
  setText('nav-campaign-name', s.campaign_name);
  setText('campaign-subtitle', s.subtitle);
  setText('campaign-banner', s.banner_text);
  document.title = s.campaign_name || 'GivStack';

  // Popup header
  setText('popup-campaign-name', s.campaign_name);
  setText('popup-campaign-subtitle', s.subtitle);

  // Footer
  const contact = [];
  if (s.contact_phone) contact.push(`Tel: ${s.contact_phone}`);
  if (s.contact_email) contact.push(s.contact_email);
  setHTML('footer-contact', contact.join(' | '));
  const orgEl = document.getElementById('footer-org');
  if (orgEl) orgEl.textContent = s.campaign_name ? `© ${s.campaign_name}` : '';

  // Payment note (hide if no payment provider configured)
  const payNote = document.getElementById('footer-payment-note');
  if (payNote) payNote.style.display = (s.mosad_id) ? '' : 'none';

  if (s.amount_buttons && s.amount_buttons.length) renderAmountButtons(s.amount_buttons);

  const wall = document.getElementById('wall-section');
  if (wall) wall.style.display = s.show_wall ? '' : 'none';
  const prog = document.getElementById('progress-section');
  if (prog) prog.style.display = s.show_progress ? '' : 'none';

  if (s.end_date) startCountdown(s.end_date);

  const videoBtn = document.getElementById('hero-video-btn');
  if (videoBtn) videoBtn.style.display = s.video_url ? 'inline-flex' : 'none';
  if (s.video_url) state.videoUrl = s.video_url;

  const matchingBadge = document.getElementById('matching-badge');
  const matchingText = document.getElementById('matching-text');
  if (matchingBadge && s.matching_text) {
    matchingText.textContent = s.matching_text;
    matchingBadge.style.display = 'inline-flex';
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    updateStats(data);
  } catch (e) { console.error(e); }
}

const _milestonesFired = new Set();

function updateStats({ total_raised = 0, donor_count = 0, goal = 120750, percentage = 0 }) {
  setText('total-raised', formatMoney(total_raised));
  setText('total-goal', formatMoney(goal));
  setText('progress-pct', `${percentage}%`);
  setText('donor-count', `${donor_count} תורמים`);

  setTimeout(() => {
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = `${Math.min(100, percentage)}%`;
  }, 200);

  for (const milestone of [25, 50, 75, 100]) {
    if (percentage >= milestone && !_milestonesFired.has(milestone)) {
      _milestonesFired.add(milestone);
      setTimeout(() => launchConfetti(milestone === 100), 600);
      if (milestone === 100) showToast('🎉 הגענו ליעד! תודה לכל התורמים!', 'success');
    }
  }
}

function startAutoRefresh() {
  setInterval(async () => {
    await loadStats();
    checkLiveDonation();
  }, 45000);
}

// ===== AMOUNT BUTTONS =====
function renderAmountButtons(buttons) {
  const wrap = document.getElementById('amount-buttons');
  if (!wrap) return;
  wrap.innerHTML = '';

  buttons.forEach(btn => {
    const el = document.createElement('button');
    el.className = 'btn-amount' + (btn.amount === 0 ? ' custom-btn' : '');
    el.textContent = btn.label;
    el.onclick = () => {
      document.querySelectorAll('.btn-amount').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      if (btn.amount === 0) {
        const wrap2 = document.getElementById('custom-amount-wrap');
        wrap2.style.display = wrap2.style.display === 'none' ? 'block' : 'none';
        if (wrap2.style.display !== 'none') document.getElementById('custom-amount-input').focus();
      } else {
        document.getElementById('custom-amount-wrap').style.display = 'none';
        openDonationPopup(btn.amount);
      }
    };
    wrap.appendChild(el);
  });
}

function submitCustomAmount() {
  const input = document.getElementById('custom-amount-input');
  const amount = parseInt(input.value, 10);
  if (!amount || amount < 1) {
    showToast('אנא הכנס סכום תקין');
    return;
  }
  openDonationPopup(amount);
}

// ===== ITEMS =====
const ITEM_SVGS = {
  שולחן: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="22" width="48" height="7" rx="3" fill="#6B2FA0"/>
    <rect x="12" y="29" width="5" height="20" rx="2.5" fill="#C9A84C"/>
    <rect x="47" y="29" width="5" height="20" rx="2.5" fill="#C9A84C"/>
    <rect x="22" y="29" width="4" height="14" rx="2" fill="#C9A84C"/>
    <rect x="38" y="29" width="4" height="14" rx="2" fill="#C9A84C"/>
    <rect x="10" y="18" width="44" height="5" rx="2.5" fill="#9B59B6"/>
  </svg>`,

  ספסל: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="26" width="48" height="7" rx="3" fill="#6B2FA0"/>
    <rect x="12" y="33" width="5" height="16" rx="2.5" fill="#C9A84C"/>
    <rect x="47" y="33" width="5" height="16" rx="2.5" fill="#C9A84C"/>
    <rect x="10" y="20" width="44" height="7" rx="2" fill="#9B59B6"/>
    <rect x="10" y="20" width="3" height="14" rx="1.5" fill="#C9A84C"/>
    <rect x="51" y="20" width="3" height="14" rx="1.5" fill="#C9A84C"/>
  </svg>`,

  ארון: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="10" y="10" width="44" height="44" rx="4" fill="#6B2FA0"/>
    <rect x="10" y="30" width="44" height="3" fill="#9B59B6"/>
    <rect x="30" y="10" width="3" height="44" fill="#9B59B6"/>
    <circle cx="25" cy="21" r="3" fill="#C9A84C"/>
    <circle cx="39" cy="42" r="3" fill="#C9A84C"/>
    <rect x="14" y="14" width="12" height="13" rx="2" fill="#9B59B6" opacity=".4"/>
    <rect x="37" y="14" width="12" height="13" rx="2" fill="#9B59B6" opacity=".4"/>
    <rect x="14" y="34" width="12" height="16" rx="2" fill="#9B59B6" opacity=".4"/>
    <rect x="37" y="34" width="12" height="16" rx="2" fill="#9B59B6" opacity=".4"/>
    <rect x="10" y="52" width="44" height="4" rx="2" fill="#3D1660"/>
  </svg>`,

  בימה: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="46" width="52" height="8" rx="3" fill="#3D1660"/>
    <rect x="14" y="34" width="36" height="13" rx="2" fill="#6B2FA0"/>
    <rect x="20" y="22" width="24" height="13" rx="2" fill="#9B59B6"/>
    <rect x="27" y="12" width="10" height="11" rx="2" fill="#C9A84C"/>
    <rect x="17" y="34" width="30" height="3" fill="#9B59B6" opacity=".5"/>
    <rect x="23" y="22" width="18" height="2.5" fill="#C9A84C" opacity=".4"/>
  </svg>`,

  פרוכת: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="10" y="8" width="44" height="4" rx="2" fill="#3D1660"/>
    <rect x="14" y="8" width="3" height="48" rx="1.5" fill="#3D1660"/>
    <rect x="47" y="8" width="3" height="48" rx="1.5" fill="#3D1660"/>
    <path d="M14 12 Q20 28 17 56 H14 V12Z" fill="#6B2FA0"/>
    <path d="M50 12 Q44 28 47 56 H50 V12Z" fill="#6B2FA0"/>
    <path d="M17 12 Q24 22 32 18 Q40 22 47 12 Q40 30 32 26 Q24 30 17 12Z" fill="#C9A84C" opacity=".7"/>
    <circle cx="32" cy="19" r="3" fill="#C9A84C"/>
  </svg>`,

  default: `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="32" cy="32" r="22" fill="#6B2FA0" opacity=".15"/>
    <circle cx="32" cy="32" r="14" fill="#6B2FA0" opacity=".3"/>
    <circle cx="32" cy="32" r="6" fill="#C9A84C"/>
  </svg>`,
};

function getItemIcon(name) {
  const keys = ['שולחן', 'ספסל', 'ארון', 'בימה', 'פרוכת'];
  for (const key of keys) {
    if (name.includes(key)) return ITEM_SVGS[key];
  }
  return ITEM_SVGS.default;
}

async function loadItems() {
  try {
    const res = await fetch('/api/items');
    state.items = await res.json();
    renderItems();
  } catch (e) { console.error(e); }
}

const RING_R = 40;
const RING_C = 2 * Math.PI * RING_R; // ≈ 251.2

function renderItems() {
  const grid = document.getElementById('items-grid');
  if (!grid) return;

  if (!state.items.length) {
    grid.innerHTML = '<p style="text-align:center;color:var(--text-muted);width:100%">אין פריטים להצגה כרגע</p>';
    return;
  }

  grid.innerHTML = state.items.map((item, i) => {
    const sold = item.quantity_remaining <= 0;
    const icon = getItemIcon(item.name);
    const delay = i * 0.08;
    const funded = item.quantity_total - item.quantity_remaining;
    const pct = item.quantity_total > 0 ? Math.round((funded / item.quantity_total) * 100) : 0;
    const offset = RING_C * (1 - pct / 100);

    return `
      <div class="item-card" style="animation-delay:${delay}s">
        <div class="item-ring-wrap">
          <svg class="item-ring" viewBox="0 0 100 100">
            <circle class="ring-bg" cx="50" cy="50" r="${RING_R}"/>
            <circle class="ring-fill" cx="50" cy="50" r="${RING_R}"
              style="stroke-dasharray:${RING_C.toFixed(1)};stroke-dashoffset:${offset.toFixed(1)}"/>
          </svg>
          <div class="item-icon-inner">${icon}</div>
          ${pct > 0 ? `<span class="item-ring-pct">${pct}%</span>` : ''}
        </div>
        <div class="item-name">${esc(item.name)}</div>
        <div class="item-price">${formatMoney(item.price)}</div>
        <div class="item-remaining">נותרו ${item.quantity_remaining} מתוך ${item.quantity_total}</div>
        ${!sold
          ? `<button class="btn-item-donate" onclick="openItemDonation(${item.id}, '${esc(item.name)}', ${item.price})">הנצח</button>`
          : ''
        }
        ${sold
          ? `<div class="item-sold-overlay">
               <span class="item-sold-text">הונצח במלואו ✓</span>
             </div>`
          : ''
        }
      </div>
    `;
  }).join('');
}

function openItemDonation(itemId, itemName, price) {
  state.selectedItemId = itemId;
  state.selectedItemName = itemName;
  openDonationPopup(price || 0, itemName);
}

// ===== DONORS WALL =====
async function loadDonors(reset = true) {
  if (reset) { state.donorsOffset = 0; document.getElementById('donors-list').innerHTML = ''; }
  try {
    const res = await fetch(`/api/donors?limit=${state.donorsLimit}&offset=${state.donorsOffset}`);
    const donors = await res.json();
    renderDonors(donors, reset);
    state.donorsOffset += donors.length;
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (loadMoreBtn) loadMoreBtn.style.display = donors.length < state.donorsLimit ? 'none' : 'block';
  } catch (e) { console.error(e); }
}

function loadMoreDonors() {
  loadDonors(false);
}

function renderDonors(donors, reset) {
  const list = document.getElementById('donors-list');
  if (!list) return;

  if (reset && !donors.length) {
    list.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px">אין תורמים עדיין - היה הראשון!</p>';
    return;
  }

  donors.forEach((d, i) => {
    const name = d.donor_name || 'תורם אנונימי';
    const letter = name.charAt(0);
    const color = AVATAR_COLORS[letter.charCodeAt(0) % AVATAR_COLORS.length];
    const delay = (i % 20) * 0.04;

    const card = document.createElement('div');
    card.className = 'donor-card';
    card.style.animationDelay = `${delay}s`;
    card.innerHTML = `
      <div class="donor-avatar" style="background:${color}">${letter}</div>
      <div class="donor-info">
        <div class="donor-name">${esc(name)}</div>
        <div class="donor-amount">${formatMoney(d.amount)}</div>
        ${d.comment ? `<div class="donor-comment">${esc(d.comment)}</div>` : ''}
      </div>
      <div class="donor-time">${d.time_ago || ''}</div>
    `;
    list.appendChild(card);
  });
}

async function loadWall() {
  await Promise.all([loadAmbassadors(), loadUpdates()]);
}

async function loadAmbassadors() {
  try {
    const res = await fetch('/api/ambassadors');
    const ambs = await res.json();
    renderAmbassadors(ambs);
  } catch (e) { console.error(e); }
}

function renderAmbassadors(ambs) {
  const list = document.getElementById('ambassadors-list');
  if (!list) return;

  if (!ambs.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px">אין שגרירים פעילים</p>';
    return;
  }

  list.innerHTML = ambs.map((a, i) => {
    const pct = a.goal > 0 ? Math.min(100, Math.round((a.raised / a.goal) * 100)) : 0;
    const delay = i * 0.08;
    return `
      <div class="ambassador-card" style="animation-delay:${delay}s">
        <div class="ambassador-header">
          <div>
            <div class="ambassador-name">${esc(a.name)}</div>
            <div class="ambassador-stats">גייס ${formatMoney(a.raised)} מתוך ${formatMoney(a.goal)} · ${a.donor_count} תורמים</div>
          </div>
          <button class="btn-donate-amb" onclick="openDonationPopup(0,'','${esc(a.code)}')">תרום בשם ${esc(a.name)}</button>
        </div>
        <div class="ambassador-bar-wrap">
          <div class="ambassador-bar" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

async function loadUpdates() {
  try {
    const res = await fetch('/api/updates');
    const updates = await res.json();
    renderUpdates(updates);
  } catch (e) { console.error(e); }
}

function renderUpdates(updates) {
  const list = document.getElementById('updates-list');
  if (!list) return;

  if (!updates.length) {
    list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px">אין עדכונות עדיין</p>';
    return;
  }

  list.innerHTML = updates.map((u, i) => `
    <div class="update-card" style="animation-delay:${i * 0.08}s">
      <div class="update-date">${formatDate(u.created_at)}</div>
      ${u.title ? `<div class="update-title">${esc(u.title)}</div>` : ''}
      <div class="update-content">${esc(u.content)}</div>
    </div>
  `).join('');
}

// ===== TABS =====
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.toggle('active', c.id === `tab-${tabName}`);
  });
}

// ===== DONATION POPUP =====
function openDonationPopup(amount, itemName = '', ambassadorCode = '') {
  state.selectedAmount = amount;
  if (!itemName) itemName = state.selectedItemName || '';
  const ambCode = ambassadorCode || state.ambassadorCode || '';

  setText('popup-item-name', itemName ? `פריט להנצחה: ${itemName}` : '');
  const badge = document.getElementById('popup-amount-badge');
  if (badge && amount) {
    badge.textContent = formatMoney(amount);
    badge.style.display = 'inline-block';
  } else if (badge) {
    badge.style.display = 'none';
  }

  const iframe = document.getElementById('nedarim-iframe');
  const mosadId = state.settings?.mosad_id || '';
  const apiValid = state.settings?.api_valid || '';
  const callbackUrl = window.location.origin + '/api/webhook';
  const param2 = generateUUID();
  const comment = itemName || '';

  // בניית URL לנדרים פלוס
  const params = new URLSearchParams({
    Mosad: mosadId,
    ApiValid: apiValid,
    Amount: amount || '',
    Groupe: state.settings?.campaign_name || 'GivStack',
    Comment: comment,
    Param1: ambCode,
    Param2: param2,
    Currency: '1',
    PaymentType: 'Ragil',
    CallBack: callbackUrl,
    SiteTitle: state.settings?.campaign_name || 'GivStack',
    SiteColor: '3D1660',
  });

  iframe.src = `https://www.matara.pro/nedarimplus/iframe/?${params.toString()}`;

  document.getElementById('overlay').classList.add('active');
  document.getElementById('donation-popup').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closePopup() {
  document.getElementById('overlay').classList.remove('active');
  document.getElementById('donation-popup').classList.remove('active');
  document.body.style.overflow = '';
  state.selectedItemId = null;
  state.selectedItemName = '';

  const iframe = document.getElementById('nedarim-iframe');
  iframe.src = 'about:blank';

  document.querySelectorAll('.btn-amount').forEach(b => b.classList.remove('active'));
  document.getElementById('custom-amount-wrap').style.display = 'none';
}

// ===== UTILS =====
function formatMoney(n) {
  if (!n && n !== 0) return '₪0';
  return '₪' + Number(n).toLocaleString('he-IL');
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str);
  return d.toLocaleDateString('he-IL', { year: 'numeric', month: 'long', day: 'numeric' });
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

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text || '';
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html || '';
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ` ${type}` : '');
  setTimeout(() => { toast.className = 'toast'; }, 3000);
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Listen for postMessage מנדרים (אישור תשלום)
window.addEventListener('message', (e) => {
  if (e.origin.includes('matara.pro') || e.origin.includes('nedarimplus')) {
    if (e.data && (e.data.Status === 'OK' || e.data.status === 'OK')) {
      closePopup();
      showToast('תודה רבה! תרומתך התקבלה בהצלחה 🙏', 'success');
      setTimeout(() => { loadStats(); loadDonors(); }, 2000);
    }
  }
});

// ===== SHARE =====
function shareWhatsApp() {
  const url = window.location.href.split('?')[0];
  const text = `${state.settings.campaign_name || 'GivStack'} - ${state.settings.subtitle || ''}\nDonate now: ${url}`;
  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

function shareFacebook() {
  const url = window.location.href.split('?')[0];
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, '_blank', 'width=600,height=400');
}

function copyShareLink() {
  const url = window.location.href.split('?')[0];
  navigator.clipboard.writeText(url).then(() => showToast('הלינק הועתק!', 'success'));
}

// ===== VIDEO =====
function getEmbedUrl(url) {
  if (!url) return '';
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}?autoplay=1`;
  return url;
}

function openVideo() {
  const embedUrl = getEmbedUrl(state.videoUrl);
  if (!embedUrl) return;
  document.getElementById('video-iframe').src = embedUrl;
  document.getElementById('video-overlay').classList.add('active');
  document.getElementById('video-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeVideo() {
  document.getElementById('video-overlay').classList.remove('active');
  document.getElementById('video-modal').classList.remove('active');
  document.getElementById('video-iframe').src = 'about:blank';
  document.body.style.overflow = '';
}

// ===== LIVE DONATION NOTIFICATION =====
let _liveNotifTimer = null;

async function checkLiveDonation() {
  try {
    const res = await fetch('/api/donors?limit=1');
    const donors = await res.json();
    if (!donors.length) return;
    const latest = donors[0];
    if (state.lastDonationId === null) { state.lastDonationId = latest.id; return; }
    if (latest.id !== state.lastDonationId) {
      state.lastDonationId = latest.id;
      showLiveNotif(latest);
      loadDonors();
    }
  } catch (e) {}
}

function showLiveNotif(d) {
  const name = d.donor_name || 'תורם אנונימי';
  const letter = name.charAt(0);
  const color = AVATAR_COLORS[letter.charCodeAt(0) % AVATAR_COLORS.length];
  const el = document.getElementById('live-notif');
  document.getElementById('live-notif-avatar').style.background = color;
  document.getElementById('live-notif-avatar').textContent = letter;
  document.getElementById('live-notif-name').textContent = name + ' תרם/ה';
  document.getElementById('live-notif-amount').textContent = formatMoney(d.amount);
  el.style.display = 'flex';
  if (_liveNotifTimer) clearTimeout(_liveNotifTimer);
  _liveNotifTimer = setTimeout(() => { el.style.display = 'none'; }, 5000);
}

// ===== COUNTDOWN TIMER =====
let _countdownInterval = null;

function startCountdown(endDateStr) {
  const wrap = document.getElementById('hero-countdown');
  if (!wrap) return;

  const endDate = new Date(endDateStr);
  if (isNaN(endDate.getTime())) return;

  function tick() {
    const now = new Date();
    const diff = endDate - now;

    if (diff <= 0) {
      clearInterval(_countdownInterval);
      wrap.style.display = 'none';
      return;
    }

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);

    const pad = n => String(n).padStart(2, '0');
    setText('cd-days', pad(days));
    setText('cd-hours', pad(hours));
    setText('cd-mins', pad(mins));
    setText('cd-secs', pad(secs));

    wrap.style.display = 'flex';
  }

  tick();
  if (_countdownInterval) clearInterval(_countdownInterval);
  _countdownInterval = setInterval(tick, 1000);
}

// ===== CONFETTI =====
function launchConfetti(big = false) {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;

  canvas.style.display = 'block';
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const colors = ['#C9A84C', '#E2C06A', '#5B2090', '#8B46C8', '#10B981', '#FFFFFF', '#F59E0B', '#EC4899'];
  const count = big ? 260 : 120;
  const totalFrames = big ? 320 : 220;
  const pieces = Array.from({ length: count }, () => ({
    x: Math.random() * canvas.width,
    y: -Math.random() * canvas.height * 0.5,
    w: 8 + Math.random() * 8,
    h: 4 + Math.random() * 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.15,
    vx: (Math.random() - 0.5) * 2.5,
    vy: 2.5 + Math.random() * 3.5,
    opacity: 1,
  }));

  let frame = 0;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame++;

    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotSpeed;
      p.vy += 0.04;
      if (frame > totalFrames * 0.7) p.opacity = Math.max(0, p.opacity - 0.015);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });

    if (frame < totalFrames) {
      requestAnimationFrame(draw);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.display = 'none';
    }
  }

  requestAnimationFrame(draw);
}
