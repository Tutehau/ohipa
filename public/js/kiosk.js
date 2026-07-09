// Badgeuse Ohipa — autonome, authentifiée par un jeton d'appareil (pas de session).
// PWA : la badgeuse peut aussi s'installer en plein écran sur la tablette.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
const TOKEN_KEY = 'ohipa_kiosk_token';
let token = localStorage.getItem(TOKEN_KEY) || '';
let pin = '';
let clockTimer = null;
let fbTimer = null;

const $ = (id) => document.getElementById(id);
const localDate = () => new Date().toLocaleDateString('sv-SE');

function kioskFetch(path, opts = {}) {
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-Kiosk-Token': token, ...(opts.headers || {}) },
  });
}

function show(section) {
  $('setup').classList.toggle('d-none', section !== 'setup');
  $('pad').classList.toggle('d-none', section !== 'pad');
}

// --- Horloge ---
function startClock() {
  const tick = () => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  tick();
  if (!clockTimer) clockTimer = setInterval(tick, 1000);
}

// --- Saisie du PIN ---
const PIN_MAX = 8;
function renderDots() {
  const dots = [];
  for (let i = 0; i < PIN_MAX; i++) dots.push(i < pin.length ? '●' : '○');
  $('pin-dots').textContent = dots.join(' ');
}
function setPin(v) { pin = v.slice(0, PIN_MAX); renderDots(); }

// --- Retour visuel ---
function feedback(kind, title, sub) {
  const fb = $('feedback'), icon = $('fb-icon');
  const map = {
    in: ['bi-box-arrow-in-right', '#2fd98a'],
    out: ['bi-box-arrow-right', '#ff5c72'],
    error: ['bi-x-circle', '#ffc857'],
  };
  const [cls, color] = map[kind] || map.error;
  icon.className = 'bi ' + cls;
  fb.style.color = color;
  $('fb-title').textContent = title;
  $('fb-sub').textContent = sub || '';
  fb.classList.remove('d-none');
  clearTimeout(fbTimer);
  fbTimer = setTimeout(() => fb.classList.add('d-none'), 2600);
}

async function punch() {
  if (pin.length < 4) { feedback('error', 'PIN trop court', 'Saisissez 4 à 6 chiffres'); return; }
  const current = pin;
  setPin('');
  try {
    const res = await kioskFetch('/api/kiosk/punch', { method: 'POST', body: JSON.stringify({ pin: current, date: localDate() }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const t = new Date(data.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (data.action === 'in') feedback('in', `Bonjour ${data.username}`, `Arrivée enregistrée · ${t}`);
      else feedback('out', `Au revoir ${data.username}`, `Départ enregistré · ${t}`);
    } else if (res.status === 429) {
      feedback('error', 'Trop de tentatives', 'Patientez un instant');
    } else {
      feedback('error', 'PIN inconnu', data.message || '');
    }
  } catch {
    feedback('error', 'Hors ligne', 'Vérifiez la connexion');
  }
}

// --- Configuration du jeton ---
async function validateToken(tok) {
  const res = await fetch('/api/kiosk/ping', { headers: { 'X-Kiosk-Token': tok } });
  if (!res.ok) return null;
  return res.json();
}

function activate(info) {
  localStorage.setItem(TOKEN_KEY, token);
  const lbl = $('kiosk-label');
  lbl.textContent = '';
  const icon = document.createElement('i');
  icon.className = 'bi bi-shop me-1';
  lbl.append(icon, ' ' + (info.label || '')); // label en nœud texte => pas d'injection
  startClock();
  setPin('');
  show('pad');
}

(async () => {
  // Jeton passé dans le FRAGMENT (#token=), via le QR : jamais envoyé au serveur
  // ni au CDN (Referer). On l'adopte puis on nettoie l'URL immédiatement.
  const urlToken = new URLSearchParams(location.hash.slice(1)).get('token');
  if (urlToken) {
    token = urlToken;
    history.replaceState(null, '', location.pathname);
    const info = await validateToken(token);
    if (info) return activate(info);
    token = '';
  } else if (token) {
    const info = await validateToken(token);
    if (info) return activate(info);
    token = '';
    localStorage.removeItem(TOKEN_KEY);
  }
  show('setup');
})();

// --- Événements ---
$('setup-btn').onclick = async () => {
  const tok = $('setup-token').value.trim();
  if (!tok) return;
  const info = await validateToken(tok);
  if (info) { token = tok; activate(info); }
  else {
    const a = $('setup-alert');
    a.className = 'alert alert-danger py-2';
    a.textContent = 'Jeton invalide.';
    a.classList.remove('d-none');
  }
};

document.querySelector('.keypad').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.k) setPin(pin + btn.dataset.k);
  else if (btn.dataset.act === 'clear') setPin('');
  else if (btn.dataset.act === 'punch') punch();
});

// Clavier physique (pour tests / bornes avec clavier).
document.addEventListener('keydown', (e) => {
  if ($('pad').classList.contains('d-none')) return;
  if (/^[0-9]$/.test(e.key)) setPin(pin + e.key);
  else if (e.key === 'Backspace') setPin(pin.slice(0, -1));
  else if (e.key === 'Enter') punch();
});
