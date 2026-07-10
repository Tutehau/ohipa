let companies = [];
let segById = {};
let modal = null;

const roundH = (n) => Math.round((n || 0) * 100) / 100;
const localDate = () => new Date().toLocaleDateString('sv-SE');
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const timeInput = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
// Heure locale saisie -> ISO UTC (cohérent avec la logique de fuseau).
const toIso = (date, time) => new Date(`${date}T${time}`).toISOString();
const fmtDay = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  document.getElementById('seg-company').innerHTML = ['<option value="">— Aucune —</option>']
    .concat(companies.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`))
    .join('');
}

async function load() {
  const all = await api('/api/pointages');
  segById = {};
  const box = document.getElementById('history');
  if (!all.length) {
    box.innerHTML = `<div class="card p-5 shadow-sm text-center text-muted"><i class="bi bi-inbox fs-1 mb-2"></i><div>Aucun pointage. Clique sur « Ajouter » pour en saisir un.</div></div>`;
    return;
  }
  const groups = {};
  for (const p of all) { segById[p.id] = p; (groups[p.workDate] ||= []).push(p); }
  const days = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  box.innerHTML = days.map((day) => {
    const segs = groups[day].slice().sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
    const total = segs.reduce((s, p) => s + (p.clockOut ? p.hours : 0), 0);
    const rows = segs.map((p) => {
      const done = !!p.clockOut;
      const tag = p.endReason === 'pause' ? '<span class="badge bg-warning ms-2"><i class="bi bi-cup-hot"></i> pause</span>'
        : p.endReason === 'oubli' ? '<span class="badge bg-danger ms-2"><i class="bi bi-exclamation-triangle"></i> à corriger</span>'
        : p.endReason === 'depart' ? '<span class="badge bg-secondary ms-2">départ</span>' : '';
      return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2" role="button" data-edit="${escapeHtml(p.id)}">
        <span><i class="bi bi-arrow-right-short text-success"></i>${escapeHtml(fmtTime(p.clockIn))}
          <i class="bi bi-arrow-right-short text-danger ms-2"></i>${done ? escapeHtml(fmtTime(p.clockOut)) : '<span class="text-success">en cours…</span>'}
          <small class="text-muted ms-2">${escapeHtml(p.companyName || '')}</small>${tag}</span>
        <span class="d-flex align-items-center gap-2"><span class="fw-semibold">${done ? roundH(p.hours) + 'h' : '—'}</span>
          <i class="bi bi-pencil text-muted"></i></span>
      </li>`;
    }).join('');
    return `<div class="card shadow-sm mb-3">
      <div class="card-header d-flex justify-content-between align-items-center bg-transparent border-0 pt-3">
        <h6 class="mb-0 text-capitalize"><i class="bi bi-calendar3 me-2"></i>${escapeHtml(fmtDay(day))}</h6>
        <span class="badge bg-primary fs-6">${roundH(total)}h</span>
      </div>
      <ul class="list-group list-group-flush">${rows}</ul>
    </div>`;
  }).join('');
}

function openNew() {
  document.getElementById('seg-title').innerHTML = '<i class="bi bi-plus-circle me-2"></i>Ajouter un pointage';
  document.getElementById('seg-form').reset();
  document.getElementById('seg-id').value = '';
  document.getElementById('seg-date').value = localDate();
  document.getElementById('seg-start').value = '08:00';
  document.getElementById('seg-end').value = '17:00';
  loadCompanies();
  document.getElementById('seg-delete').classList.add('d-none');
  modal.show();
}

function openEdit(p) {
  document.getElementById('seg-title').innerHTML = '<i class="bi bi-pencil me-2"></i>Corriger le pointage';
  document.getElementById('seg-id').value = p.id;
  document.getElementById('seg-date').value = p.workDate;
  document.getElementById('seg-start').value = timeInput(p.clockIn);
  document.getElementById('seg-end').value = p.clockOut ? timeInput(p.clockOut) : '';
  loadCompanies(p.companyId);
  document.getElementById('seg-delete').classList.remove('d-none');
  modal.show();
}

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'history');
  modal = new bootstrap.Modal(document.getElementById('seg-modal'));
  await loadCompanies();
  await load();

  document.getElementById('btn-add').onclick = openNew;

  document.getElementById('history').addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-edit]');
    if (li) { const p = segById[li.dataset.edit]; if (p) openEdit(p); }
  });

  document.getElementById('seg-form').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('seg-id').value;
    const date = document.getElementById('seg-date').value;
    const payload = {
      companyId: document.getElementById('seg-company').value || null,
      date,
      clockIn: toIso(date, document.getElementById('seg-start').value),
      clockOut: toIso(date, document.getElementById('seg-end').value),
    };
    try {
      if (id) await api('/api/pointages/' + id, 'PUT', payload);
      else await api('/api/pointages/manual', 'POST', payload);
      modal.hide(); showAlert(id ? 'Pointage corrigé.' : 'Pointage ajouté.', 'success');
      await load();
    } catch (err) { showAlert(err.message); }
  };

  document.getElementById('seg-delete').onclick = async () => {
    const id = document.getElementById('seg-id').value;
    if (!id || !confirm('Supprimer ce pointage ?')) return;
    try { await api('/api/pointages/' + id, 'DELETE'); modal.hide(); await load(); }
    catch (err) { showAlert(err.message); }
  };
})();
