const ymd = (d) => d.toLocaleDateString('sv-SE');
function last30() {
  const to = new Date(), from = new Date();
  from.setDate(to.getDate() - 29);
  return { from: ymd(from), to: ymd(to) };
}

async function loadCompanies() {
  // companies-stats renvoie id + name + employés + heures (30 j) : source unique.
  const { from, to } = last30();
  const companies = await api(`/api/admin/companies-stats?from=${from}&to=${to}`);
  const list = document.getElementById('company-list');
  if (!companies.length) {
    list.innerHTML = `<li class="list-group-item text-muted text-center py-3">
      <i class="bi bi-inbox me-1"></i>Aucune entreprise.</li>`;
    return;
  }
  list.innerHTML = companies.map(c => `
    <li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span><i class="bi bi-building me-2"></i>${escapeHtml(c.name)}
        <small class="text-muted ms-2">
          <i class="bi bi-people me-1"></i>${c.employees} employé${c.employees > 1 ? 's' : ''}
          <i class="bi bi-clock-history ms-2 me-1"></i>${c.hours} h <span class="opacity-75">/ 30 j</span>
        </small></span>
      <span class="d-flex gap-1">
        <button class="btn btn-sm btn-outline-light" data-action="rename" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" title="Renommer">
          <i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${escapeHtml(c.id)}" data-name="${escapeHtml(c.name)}" title="Supprimer">
          <i class="bi bi-trash"></i></button>
      </span>
    </li>`).join('');
}

(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;
  renderAdminNav('companies');
  await loadCompanies();

  document.getElementById('company-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/companies', 'POST', { name: document.getElementById('comp-name').value });
      showAlert('Entreprise ajoutée.', 'success');
      document.getElementById('company-form').reset();
      await loadCompanies();
    } catch (err) { showAlert(err.message); }
  };

  document.getElementById('company-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      if (btn.dataset.action === 'rename') {
        const name = prompt("Nouveau nom de l'entreprise :", btn.dataset.name);
        if (!name || !name.trim()) return;
        await api('/api/companies/' + id, 'PUT', { name: name.trim() });
        showAlert('Entreprise renommée.', 'success');
      } else if (btn.dataset.action === 'delete') {
        if (!confirm(`Supprimer l'entreprise ${btn.dataset.name} ?`)) return;
        await api('/api/companies/' + id, 'DELETE');
        showAlert('Entreprise supprimée.', 'success');
      }
      await loadCompanies();
    } catch (err) { showAlert(err.message); }
  });
})();
