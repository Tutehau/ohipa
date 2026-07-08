let companies = [];
let timer = null;
let tickFrom = null;

const todayStr = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const roundH = (n) => Math.round((n || 0) * 100) / 100;

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  const sel = document.getElementById('company-select');
  sel.innerHTML = companies.length
    ? companies.map(c => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">— Aucune société —</option>';
}

function startTimer(fromIso) {
  stopTimer();
  tickFrom = fromIso;
  const tick = () => {
    document.getElementById('live-timer').textContent = fmtDuration(Date.now() - new Date(tickFrom).getTime());
  };
  tick();
  timer = setInterval(tick, 1000);
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  document.getElementById('live-timer').textContent = '00:00:00';
}

const show = (id, on) => document.getElementById(id).classList.toggle('d-none', !on);

async function refreshStatus() {
  const st = await api('/api/pointages/status');
  const label = document.getElementById('status-label');
  const sel = document.getElementById('company-select');
  const timerEl = document.getElementById('live-timer');

  if (st.state === 'working') {
    label.innerHTML = `<span class="text-success"><i class="bi bi-record-circle me-1"></i>En poste depuis ${fmtTime(st.since)}</span>`;
    timerEl.className = 'display-6 fw-bold mb-3 text-success';
    sel.disabled = true;
    if (st.companyId) sel.value = st.companyId;
    show('btn-in', false); show('btn-resume', false); show('btn-pause', true); show('btn-out', true);
    startTimer(st.since);
  } else if (st.state === 'on_break') {
    label.innerHTML = `<span class="text-warning"><i class="bi bi-cup-hot me-1"></i>En pause depuis ${fmtTime(st.since)}</span>`;
    timerEl.className = 'display-6 fw-bold mb-3 text-warning';
    sel.disabled = true;
    if (st.companyId) sel.value = st.companyId;
    show('btn-in', false); show('btn-resume', true); show('btn-pause', false); show('btn-out', true);
    startTimer(st.since);
  } else {
    label.innerHTML = `<span class="text-muted"><i class="bi bi-pause-circle me-1"></i>Non pointé</span>`;
    timerEl.className = 'display-6 fw-bold mb-3';
    sel.disabled = false;
    show('btn-in', true); show('btn-resume', false); show('btn-pause', false); show('btn-out', false);
    stopTimer();
  }
}

async function loadToday() {
  const all = await api('/api/pointages');
  const today = todayStr();
  const mine = all
    .filter(p => new Date(p.clockIn).toLocaleDateString('sv-SE') === today)
    .sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn)); // ordre chronologique

  const ul = document.getElementById('segments');
  let worked = 0, breakMs = 0;

  for (let i = 0; i < mine.length; i++) {
    const p = mine[i];
    if (p.clockOut) worked += p.hours;
    // Temps de pause = écart entre une fin "pause" et la reprise suivante.
    if (p.endReason === 'pause' && p.clockOut && mine[i + 1]) {
      breakMs += new Date(mine[i + 1].clockIn) - new Date(p.clockOut);
    }
  }

  if (!mine.length) {
    ul.innerHTML = `<li class="list-group-item text-muted text-center py-3"><i class="bi bi-inbox me-1"></i>Aucun pointage aujourd'hui.</li>`;
  } else {
    ul.innerHTML = mine.map(p => {
      const done = !!p.clockOut;
      const dur = done ? `${roundH(p.hours)}h` : '<span class="text-success">en cours…</span>';
      const tag = p.endReason === 'pause'
        ? '<span class="badge bg-warning text-dark ms-2"><i class="bi bi-cup-hot"></i> pause</span>'
        : (p.endReason === 'depart' ? '<span class="badge bg-secondary ms-2">départ</span>' : '');
      return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
        <span><i class="bi bi-arrow-right-short text-success"></i>${escapeHtml(fmtTime(p.clockIn))}
          <i class="bi bi-arrow-right-short text-danger ms-2"></i>${done ? escapeHtml(fmtTime(p.clockOut)) : '—'}
          <small class="text-muted ms-2">${escapeHtml(p.companyName || '')}</small>${tag}</span>
        <span class="d-flex align-items-center gap-2"><span class="fw-semibold">${dur}</span>
          <button class="btn btn-sm btn-outline-danger" data-del="${escapeHtml(p.id)}" title="Supprimer"><i class="bi bi-trash"></i></button></span>
      </li>`;
    }).join('');
  }
  document.getElementById('today-total').textContent = `${roundH(worked)}h`;
  document.getElementById('today-break').textContent = `Pause ${roundH(breakMs / 3600000)}h`;
}

async function refreshAll() { await refreshStatus(); await loadToday(); }

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'pointage');
  await loadCompanies();
  await refreshAll();

  const post = async (url, body) => { await api(url, 'POST', body); await refreshAll(); };
  const companyId = () => document.getElementById('company-select').value || null;
  // On envoie la date locale du navigateur : le jour de travail est calculé
  // dans le fuseau de l'utilisateur, où qu'il soit dans le monde.
  const clockIn = () => post('/api/pointages/clock-in', { companyId: companyId(), date: todayStr() })
    .catch(e => showAlert(e.message));

  document.getElementById('btn-in').onclick = clockIn;
  document.getElementById('btn-resume').onclick = clockIn;
  document.getElementById('btn-pause').onclick = () =>
    post('/api/pointages/pause').catch(e => showAlert(e.message));
  document.getElementById('btn-out').onclick = () =>
    post('/api/pointages/clock-out').catch(e => showAlert(e.message));

  document.getElementById('btn-add-company').onclick = async () => {
    const name = prompt('Nom de la nouvelle société :');
    if (!name || !name.trim()) return;
    try { const c = await api('/api/companies', 'POST', { name: name.trim() }); await loadCompanies(c.id); }
    catch (e) { showAlert(e.message); }
  };
  document.getElementById('segments').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-del]');
    if (!btn || !confirm('Supprimer ce pointage ?')) return;
    try { await api('/api/pointages/' + btn.dataset.del, 'DELETE'); await refreshAll(); }
    catch (e) { showAlert(e.message); }
  });
})();
