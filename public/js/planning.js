let companies = [];
let editingId = null;

async function loadCompanies(selectedId) {
  companies = await api('/api/companies');
  const sel = document.getElementById('company-select');
  sel.innerHTML = ['<option value="">— Aucune —</option>']
    .concat(companies.map(c => `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`))
    .join('');
}

function resetForm() {
  editingId = null;
  document.getElementById('slot-form').reset();
  document.getElementById('slot-id').value = '';
  document.getElementById('form-title').innerHTML = '<i class="bi bi-plus-circle me-2"></i>Nouveau créneau';
  document.getElementById('submit-label').textContent = 'Ajouter';
  document.getElementById('btn-cancel').classList.add('d-none');
}

async function loadSlots() {
  const slots = await api('/api/plannings');
  const ul = document.getElementById('slots');
  let total = 0;
  if (!slots.length) {
    ul.innerHTML = `<li class="list-group-item text-muted text-center py-3"><i class="bi bi-inbox me-1"></i>Aucun créneau planifié.</li>`;
    document.getElementById('total-planned').textContent = '0h';
    return;
  }
  ul.innerHTML = slots.map(s => {
    total += s.hours;
    const d = new Date(s.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span><i class="bi bi-calendar3 me-1"></i><b>${escapeHtml(d)}</b>
        <span class="ms-2">${escapeHtml(s.startTime)}–${escapeHtml(s.endTime)}</span>
        <small class="text-muted ms-2">${escapeHtml(s.companyName || '')}${s.note ? ' · ' + escapeHtml(s.note) : ''}</small></span>
      <span class="d-flex align-items-center gap-2"><span class="badge bg-secondary">${Math.round(s.hours * 100) / 100}h</span>
        <button class="btn btn-sm btn-outline-light" data-edit="${escapeHtml(s.id)}"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-del="${escapeHtml(s.id)}"><i class="bi bi-trash"></i></button></span>
    </li>`;
  }).join('');
  document.getElementById('total-planned').textContent = `${Math.round(total * 100) / 100}h`;
  window._slots = slots; // pour préremplissage à l'édition
}

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'planning');
  await loadCompanies();
  await loadSlots();

  document.getElementById('slot-form').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      companyId: document.getElementById('company-select').value || null,
      date: document.getElementById('slot-date').value,
      startTime: document.getElementById('slot-start').value,
      endTime: document.getElementById('slot-end').value,
      note: document.getElementById('slot-note').value,
    };
    try {
      if (editingId) await api('/api/plannings/' + editingId, 'PUT', payload);
      else await api('/api/plannings', 'POST', payload);
      showAlert(editingId ? 'Créneau mis à jour.' : 'Créneau ajouté.', 'success');
      resetForm();
      await loadSlots();
    } catch (err) { showAlert(err.message); }
  };

  document.getElementById('btn-cancel').onclick = resetForm;

  document.getElementById('btn-add-company').onclick = async () => {
    const name = prompt('Nom de la nouvelle société :');
    if (!name || !name.trim()) return;
    try { const c = await api('/api/companies', 'POST', { name: name.trim() }); await loadCompanies(c.id); }
    catch (e) { showAlert(e.message); }
  };

  document.getElementById('slots').addEventListener('click', async (ev) => {
    const edit = ev.target.closest('button[data-edit]');
    const del = ev.target.closest('button[data-del]');
    if (edit) {
      const s = (window._slots || []).find(x => x.id === edit.dataset.edit);
      if (!s) return;
      editingId = s.id;
      document.getElementById('slot-id').value = s.id;
      await loadCompanies(s.companyId);
      document.getElementById('slot-date').value = s.date;
      document.getElementById('slot-start').value = s.startTime;
      document.getElementById('slot-end').value = s.endTime;
      document.getElementById('slot-note').value = s.note || '';
      document.getElementById('form-title').innerHTML = '<i class="bi bi-pencil me-2"></i>Modifier le créneau';
      document.getElementById('submit-label').textContent = 'Enregistrer';
      document.getElementById('btn-cancel').classList.remove('d-none');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (del) {
      if (!confirm('Supprimer ce créneau ?')) return;
      try { await api('/api/plannings/' + del.dataset.del, 'DELETE'); await loadSlots(); }
      catch (e) { showAlert(e.message); }
    }
  });
})();
