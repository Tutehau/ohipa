const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const roundH = (n) => Math.round((n || 0) * 100) / 100;

function fmtDay(ymd) {
  return new Date(ymd + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  });
}

async function load() {
  const all = await api('/api/pointages');
  const box = document.getElementById('history');

  if (!all.length) {
    box.innerHTML = `<div class="card p-5 shadow-sm text-center text-muted">
      <i class="bi bi-inbox fs-1 mb-2"></i><div>Aucun pointage pour le moment.</div></div>`;
    return;
  }

  // Regroupement par jour local de travail.
  const groups = {};
  for (const p of all) (groups[p.workDate] ||= []).push(p);
  const days = Object.keys(groups).sort((a, b) => (a < b ? 1 : -1));

  box.innerHTML = days.map(day => {
    const segs = groups[day].slice().sort((a, b) => new Date(a.clockIn) - new Date(b.clockIn));
    const total = segs.reduce((s, p) => s + (p.clockOut ? p.hours : 0), 0);
    const rows = segs.map(p => {
      const done = !!p.clockOut;
      const tag = p.endReason === 'pause' ? '<span class="badge bg-warning text-dark ms-2"><i class="bi bi-cup-hot"></i> pause</span>'
        : p.endReason === 'oubli' ? '<span class="badge bg-danger ms-2" title="Départ non pointé"><i class="bi bi-exclamation-triangle"></i> oubli</span>'
        : (p.endReason === 'depart' ? '<span class="badge bg-secondary ms-2">départ</span>' : '');
      return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
        <span><i class="bi bi-arrow-right-short text-success"></i>${escapeHtml(fmtTime(p.clockIn))}
          <i class="bi bi-arrow-right-short text-danger ms-2"></i>${done ? escapeHtml(fmtTime(p.clockOut)) : '<span class="text-success">en cours…</span>'}
          <small class="text-muted ms-2">${escapeHtml(p.companyName || '')}</small>${tag}</span>
        <span class="d-flex align-items-center gap-2"><span class="fw-semibold">${done ? roundH(p.hours) + 'h' : '—'}</span>
          <button class="btn btn-sm btn-outline-danger" data-del="${escapeHtml(p.id)}" title="Supprimer"><i class="bi bi-trash"></i></button></span>
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

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'history');
  await load();

  document.getElementById('history').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-del]');
    if (!btn || !confirm('Supprimer ce pointage ?')) return;
    try { await api('/api/pointages/' + btn.dataset.del, 'DELETE'); await load(); }
    catch (e) { showAlert(e.message); }
  });
})();
