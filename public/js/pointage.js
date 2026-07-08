let companies = [];
let timer = null;
let clockedSince = null;

const todayStr = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD local

function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const sec = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${sec}`;
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  const sel = document.getElementById('company-select');
  sel.innerHTML = companies.length
    ? companies.map(c => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">— Aucune société —</option>';
}

function startTimer() {
  stopTimer();
  const tick = () => {
    document.getElementById('live-timer').textContent = fmtDuration(Date.now() - new Date(clockedSince).getTime());
  };
  tick();
  timer = setInterval(tick, 1000);
}
function stopTimer() {
  if (timer) clearInterval(timer);
  timer = null;
  document.getElementById('live-timer').textContent = '00:00:00';
}

async function refreshStatus() {
  const st = await api('/api/pointages/status');
  const btnIn = document.getElementById('btn-in');
  const btnOut = document.getElementById('btn-out');
  const label = document.getElementById('status-label');
  const sel = document.getElementById('company-select');
  if (st.clockedIn) {
    clockedSince = st.since;
    label.innerHTML = `<span class="text-success"><i class="bi bi-record-circle me-1"></i>Pointé depuis ${fmtTime(st.since)}</span>`;
    btnIn.classList.add('d-none');
    btnOut.classList.remove('d-none');
    sel.disabled = true;
    if (st.companyId) sel.value = st.companyId;
    startTimer();
  } else {
    clockedSince = null;
    label.innerHTML = `<span class="text-muted"><i class="bi bi-pause-circle me-1"></i>Non pointé</span>`;
    btnIn.classList.remove('d-none');
    btnOut.classList.add('d-none');
    sel.disabled = false;
    stopTimer();
  }
}

async function loadToday() {
  const all = await api('/api/pointages');
  const today = todayStr();
  const mine = all.filter(p => new Date(p.clockIn).toLocaleDateString('sv-SE') === today);
  const ul = document.getElementById('segments');
  let total = 0;
  if (!mine.length) {
    ul.innerHTML = `<li class="list-group-item text-muted text-center py-3"><i class="bi bi-inbox me-1"></i>Aucun pointage aujourd'hui.</li>`;
  } else {
    ul.innerHTML = mine.map(p => {
      const done = !!p.clockOut;
      if (done) total += p.hours;
      const dur = done ? `${Math.round(p.hours * 100) / 100}h` : '<span class="text-success">en cours…</span>';
      return `<li class="list-group-item d-flex justify-content-between align-items-center">
        <span><i class="bi bi-arrow-right-short text-success"></i>${escapeHtml(fmtTime(p.clockIn))}
          <i class="bi bi-arrow-right-short text-danger ms-2"></i>${done ? escapeHtml(fmtTime(p.clockOut)) : '—'}
          <small class="text-muted ms-2">${escapeHtml(p.companyName || '')}</small></span>
        <span class="d-flex align-items-center gap-2"><span class="fw-semibold">${dur}</span>
          <button class="btn btn-sm btn-outline-danger" data-del="${escapeHtml(p.id)}" title="Supprimer"><i class="bi bi-trash"></i></button></span>
      </li>`;
    }).join('');
  }
  document.getElementById('today-total').textContent = `${Math.round(total * 100) / 100}h`;
}

async function refreshAll() { await refreshStatus(); await loadToday(); }

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'pointage');
  await loadCompanies();
  await refreshAll();

  document.getElementById('btn-in').onclick = async () => {
    try {
      await api('/api/pointages/clock-in', 'POST', { companyId: document.getElementById('company-select').value || null });
      await refreshAll();
    } catch (e) { showAlert(e.message); }
  };
  document.getElementById('btn-out').onclick = async () => {
    try { await api('/api/pointages/clock-out', 'POST'); await refreshAll(); }
    catch (e) { showAlert(e.message); }
  };
  document.getElementById('btn-add-company').onclick = async () => {
    const name = prompt('Nom de la nouvelle société :');
    if (!name || !name.trim()) return;
    try {
      const c = await api('/api/companies', 'POST', { name: name.trim() });
      await loadCompanies(c.id);
    } catch (e) { showAlert(e.message); }
  };
  document.getElementById('segments').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-del]');
    if (!btn || !confirm('Supprimer ce pointage ?')) return;
    try { await api('/api/pointages/' + btn.dataset.del, 'DELETE'); await refreshAll(); }
    catch (e) { showAlert(e.message); }
  });
})();
