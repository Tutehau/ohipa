let companies = [];
let timer = null;

const roundH = (n) => Math.round((n || 0) * 100) / 100;
const localDate = () => new Date().toLocaleDateString('sv-SE');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  const sel = document.getElementById('company-select');
  sel.innerHTML = companies.length
    ? companies.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`).join('')
    : '<option value="">— Aucune société —</option>';
}

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

async function refreshToday() {
  const today = localDate();
  const [pointages, plannings] = await Promise.all([api('/api/pointages'), api('/api/plannings')]);
  const segs = pointages.filter((p) => p.workDate === today).sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));

  let worked = 0, breakMs = 0;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i].clockOut) worked += segs[i].hours;
    if (segs[i].endReason === 'pause' && segs[i].clockOut && segs[i + 1]) breakMs += new Date(segs[i + 1].clockIn) - new Date(segs[i].clockOut);
  }
  const planned = plannings.filter((s) => s.date === today).reduce((sum, s) => sum + s.hours, 0);

  const breakH = breakMs / 3600000;
  const presence = worked + breakH; // présence = travail + pause (comparée au prévu)
  document.getElementById('today-presence').textContent = roundH(presence) + 'h';
  document.getElementById('today-worked').textContent = roundH(worked) + 'h';
  document.getElementById('today-planned').textContent = roundH(planned) + 'h';
  document.getElementById('today-break').textContent = roundH(breakH) + 'h';
  document.getElementById('today-segments').textContent = segs.length;
  const pct = planned > 0 ? Math.min(100, Math.round((presence / planned) * 100)) : 0;
  const bar = document.getElementById('today-progress');
  bar.style.width = pct + '%';
  bar.className = 'progress-bar ' + (presence >= planned && planned > 0 ? 'bg-success' : '');

  renderTimeline(segs);
}

function renderTimeline(segs) {
  const ul = document.getElementById('segments');
  if (!segs.length) {
    ul.innerHTML = `<li class="text-muted text-center py-3"><i class="bi bi-inbox me-1"></i>Aucun pointage aujourd'hui.</li>`;
    return;
  }
  ul.innerHTML = segs.map((p) => {
    const done = !!p.clockOut;
    const tag = p.endReason === 'pause' ? '<span class="badge bg-warning ms-2"><i class="bi bi-cup-hot"></i> pause</span>'
      : p.endReason === 'oubli' ? '<span class="badge bg-danger ms-2"><i class="bi bi-exclamation-triangle"></i> oubli</span>'
      : p.endReason === 'depart' ? '<span class="badge bg-secondary ms-2">départ</span>' : '';
    const dotColor = !done ? 'var(--success)' : (p.endReason === 'oubli' ? 'var(--danger)' : 'var(--blue)');
    return `<li class="timeline-item">
      <span class="tl-dot" style="background:${dotColor}"></span>
      <div class="tl-body">
        <div><b>${escapeHtml(fmtTime(p.clockIn))}</b> <i class="bi bi-arrow-right text-muted mx-1"></i>${done ? '<b>' + escapeHtml(fmtTime(p.clockOut)) + '</b>' : '<span class="text-success">en cours…</span>'}${tag}</div>
        <small class="text-muted">${escapeHtml(p.companyName || 'Sans société')}${done ? ' · ' + roundH(p.hours) + 'h' : ''}</small>
      </div>
      <button class="btn btn-sm btn-outline-danger" data-del="${escapeHtml(p.id)}" title="Supprimer"><i class="bi bi-trash"></i></button>
    </li>`;
  }).join('');
}

async function refreshAll() { await Promise.all([refreshStatus(), refreshToday()]); }

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'pointage');
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
  document.getElementById('segments').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-del]');
    if (!btn || !confirm('Supprimer ce pointage ?')) return;
    try { await api('/api/pointages/' + btn.dataset.del, 'DELETE'); await refreshAll(); }
    catch (e) { showAlert(e.message); }
  });
})();
