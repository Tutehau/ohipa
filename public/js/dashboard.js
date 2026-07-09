let companies = [];
let weekChart = null;
let timer = null;

const roundH = (n) => Math.round((n || 0) * 100) / 100;
const localDate = () => new Date().toLocaleDateString('sv-SE');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

// Bornes de la semaine courante (lundi -> dimanche), en date locale.
function weekBounds() {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // lundi = 0
  const mon = new Date(now); mon.setHours(0, 0, 0, 0); mon.setDate(now.getDate() - dow);
  const iso = (d) => d.toLocaleDateString('sv-SE');
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    days.push({ iso: iso(d), label: d.toLocaleDateString('fr-FR', { weekday: 'short' }) });
  }
  return { from: days[0].iso, to: days[6].iso, days };
}

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  const sel = document.getElementById('company-select');
  sel.innerHTML = companies.length
    ? companies.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">— Aucune société —</option>';
}

// --- Chrono live ---
function stopTimer() { if (timer) clearInterval(timer); timer = null; document.getElementById('hero-timer').textContent = '00:00:00'; }
function startTimer(sinceIso) {
  stopTimer();
  const tick = () => { document.getElementById('hero-timer').textContent = fmtDuration(Date.now() - new Date(sinceIso).getTime()); };
  tick(); timer = setInterval(tick, 1000);
}
const show = (id, on) => document.getElementById(id).classList.toggle('d-none', !on);

async function refreshStatus() {
  const st = await api('/api/pointages/status');
  const label = document.getElementById('hero-status');
  const timerEl = document.getElementById('hero-timer');
  const sel = document.getElementById('company-select');
  if (st.state === 'working') {
    label.innerHTML = `<span class="text-success"><i class="bi bi-record-circle me-1"></i>En poste depuis ${fmtTime(st.since)}</span>`;
    timerEl.className = 'hero-timer text-success';
    sel.disabled = true; if (st.companyId) sel.value = st.companyId;
    show('btn-in', false); show('btn-resume', false); show('btn-pause', true); show('btn-out', true);
    startTimer(st.since);
  } else if (st.state === 'on_break') {
    label.innerHTML = `<span class="text-warning"><i class="bi bi-cup-hot me-1"></i>En pause depuis ${fmtTime(st.since)}</span>`;
    timerEl.className = 'hero-timer text-warning';
    sel.disabled = true; if (st.companyId) sel.value = st.companyId;
    show('btn-in', false); show('btn-resume', true); show('btn-pause', false); show('btn-out', true);
    startTimer(st.since);
  } else {
    label.innerHTML = `<span class="text-muted"><i class="bi bi-pause-circle me-1"></i>Non pointé</span>`;
    timerEl.className = 'hero-timer';
    sel.disabled = false;
    show('btn-in', true); show('btn-resume', false); show('btn-pause', false); show('btn-out', false);
    stopTimer();
  }
}

// --- Semaine + aujourd'hui + graphique ---
async function refreshWeek() {
  const wk = weekBounds();
  const [rec, pointages] = await Promise.all([
    api(`/api/reconciliation?from=${wk.from}&to=${wk.to}`),
    api('/api/pointages'),
  ]);
  const byDay = {};
  for (const d of rec.days) byDay[d.day] = d;

  // Graphique prévu vs réel par jour
  const planned = wk.days.map((d) => (byDay[d.iso] ? byDay[d.iso].planned : 0));
  const real = wk.days.map((d) => (byDay[d.iso] ? byDay[d.iso].real : 0));
  renderWeekChart(wk.days.map((d) => d.label), planned, real);

  // Totaux semaine
  document.getElementById('week-real').textContent = roundH(rec.totals.real) + 'h';
  document.getElementById('week-planned').textContent = roundH(rec.totals.planned) + 'h';
  const pct = rec.totals.planned > 0 ? Math.min(100, Math.round((rec.totals.real / rec.totals.planned) * 100)) : 0;
  const bar = document.getElementById('week-progress');
  bar.style.width = pct + '%';
  bar.className = 'progress-bar ' + (rec.totals.real >= rec.totals.planned && rec.totals.planned > 0 ? 'bg-success' : '');
  const ecart = roundH(rec.totals.ecart);
  const eb = document.getElementById('week-ecart-badge');
  eb.textContent = (ecart > 0 ? '+' : '') + ecart + 'h';
  eb.className = 'badge ' + (ecart < 0 ? 'bg-warning' : 'bg-success');
  document.getElementById('week-hint').textContent = rec.totals.planned > 0 ? `${pct}% du prévu` : 'Aucun planning cette semaine';

  // Aujourd'hui (réel + pause) et nombre de segments de la semaine
  const today = localDate();
  const weekSet = new Set(wk.days.map((d) => d.iso));
  let weekCount = 0, todayWorked = 0, breakMs = 0;
  const todaySegs = pointages.filter((p) => p.workDate === today).sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
  for (const p of pointages) if (weekSet.has(p.workDate) && p.clockOut) weekCount++;
  for (let i = 0; i < todaySegs.length; i++) {
    const p = todaySegs[i];
    if (p.clockOut) todayWorked += p.hours;
    if (p.endReason === 'pause' && p.clockOut && todaySegs[i + 1]) breakMs += new Date(todaySegs[i + 1].clockIn) - new Date(p.clockOut);
  }
  document.getElementById('today-real').textContent = roundH(todayWorked) + 'h';
  document.getElementById('today-break').textContent = 'Pause ' + roundH(breakMs / 3600000) + 'h';
  document.getElementById('week-count').textContent = weekCount;
}

function renderWeekChart(labels, planned, real) {
  const ctx = document.getElementById('week-chart');
  if (weekChart) weekChart.destroy();
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#93a2c6';
  const grid = 'rgba(120,160,255,.10)';
  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 200);
  grad.addColorStop(0, 'rgba(0,198,255,.95)'); grad.addColorStop(1, 'rgba(47,107,255,.35)');
  weekChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Prévu', data: planned, backgroundColor: 'rgba(120,160,255,.22)', borderRadius: 5, maxBarThickness: 26 },
        { label: 'Réel', data: real, backgroundColor: grad, borderRadius: 5, maxBarThickness: 26 },
      ],
    },
    options: {
      plugins: { legend: { labels: { color: muted, boxWidth: 12 } } },
      scales: {
        x: { grid: { color: grid }, ticks: { color: muted } },
        y: { grid: { color: grid }, ticks: { color: muted }, beginAtZero: true },
      },
    },
  });
}

async function refreshNextSlot() {
  const today = localDate();
  const slots = await api('/api/plannings');
  const upcoming = slots.filter((s) => s.date >= today).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0];
  const el = document.getElementById('next-slot');
  const sub = document.getElementById('next-slot-sub');
  if (!upcoming) { el.textContent = '—'; sub.textContent = 'Aucun créneau à venir'; return; }
  const d = new Date(upcoming.date + 'T00:00:00');
  const rel = upcoming.date === today ? "Aujourd'hui" : d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  el.textContent = `${upcoming.startTime}–${upcoming.endTime}`;
  sub.textContent = `${rel}${upcoming.companyName ? ' · ' + upcoming.companyName : ''}`;
}

async function refreshAll() { await Promise.all([refreshStatus(), refreshWeek(), refreshNextSlot()]); }

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'dashboard');

  const h = new Date().getHours();
  document.getElementById('greeting').textContent = `${h < 6 || h >= 18 ? 'Bonsoir' : 'Bonjour'} ${me.username}`;
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  await loadCompanies();
  await refreshAll();

  const post = async (url, body) => { await api(url, 'POST', body); await refreshAll(); };
  const companyId = () => document.getElementById('company-select').value || null;
  const clockIn = () => post('/api/pointages/clock-in', { companyId: companyId(), date: localDate() }).catch((e) => showAlert(e.message));

  document.getElementById('btn-in').onclick = clockIn;
  document.getElementById('btn-resume').onclick = clockIn;
  document.getElementById('btn-pause').onclick = () => post('/api/pointages/pause').catch((e) => showAlert(e.message));
  document.getElementById('btn-out').onclick = () => post('/api/pointages/clock-out').catch((e) => showAlert(e.message));
  document.getElementById('btn-add-company').onclick = async () => {
    const name = prompt('Nom de la nouvelle société :');
    if (!name || !name.trim()) return;
    try { const c = await api('/api/companies', 'POST', { name: name.trim() }); await loadCompanies(c.id); }
    catch (e) { showAlert(e.message); }
  };
})();
