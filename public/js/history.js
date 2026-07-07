let companies = [];
let entriesById = {};
let editModal = null;

function companyOptions(selectedId) {
  const opts = ['<option value="">— Aucune —</option>'].concat(
    companies.map(c =>
      `<option value="${escapeHtml(c.id)}"${c.id === selectedId ? ' selected' : ''}>${escapeHtml(c.name)}</option>`)
  );
  return opts.join('');
}

function renderRows(entries) {
  const table = document.getElementById('entries-table');
  entriesById = {};
  if (!entries.length) {
    table.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">
      <i class="bi bi-inbox me-1"></i>Aucune saisie pour le moment.</td></tr>`;
    return;
  }
  table.innerHTML = entries.map(e => {
    entriesById[e.id] = e;
    return `<tr>
      <td>${escapeHtml(new Date(e.date).toLocaleDateString())}</td>
      <td>${escapeHtml(e.companyName || 'N/A')}</td>
      <td>${escapeHtml(e.hours)}h</td>
      <td>${escapeHtml(e.description || '')}</td>
      <td class="text-end text-nowrap">
        <button class="btn btn-sm btn-outline-light" data-action="edit" data-id="${escapeHtml(e.id)}" title="Modifier">
          <i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${escapeHtml(e.id)}" title="Supprimer">
          <i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

async function reload() {
  const entries = await api('/api/entries');
  renderRows(entries);
}

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'history');
  editModal = new bootstrap.Modal(document.getElementById('edit-modal'));

  companies = await api('/api/companies');
  await reload();

  // Délégation d'événements sur les boutons d'action.
  document.getElementById('entries-table').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    const entry = entriesById[id];

    if (btn.dataset.action === 'edit') {
      document.getElementById('edit-id').value = id;
      document.getElementById('edit-company').innerHTML = companyOptions(entry.companyId);
      document.getElementById('edit-hours').value = entry.hours;
      document.getElementById('edit-desc').value = entry.description || '';
      editModal.show();
    } else if (btn.dataset.action === 'delete') {
      if (!confirm('Supprimer cette saisie ?')) return;
      try {
        await api('/api/entries/' + id, 'DELETE');
        showAlert('Saisie supprimée.', 'success');
        await reload();
      } catch (err) { showAlert(err.message); }
    }
  });

  document.getElementById('edit-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const id = document.getElementById('edit-id').value;
    try {
      await api('/api/entries/' + id, 'PUT', {
        companyId: document.getElementById('edit-company').value,
        hours: document.getElementById('edit-hours').value,
        description: document.getElementById('edit-desc').value,
      });
      editModal.hide();
      showAlert('Saisie mise à jour.', 'success');
      await reload();
    } catch (err) { showAlert(err.message); }
  };
})();
