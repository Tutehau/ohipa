(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'entry');

  const select = document.getElementById('company-select');
  const companies = await api('/api/companies');
  if (!companies.length) {
    select.innerHTML = '<option value="">Aucune entreprise disponible</option>';
  } else {
    // escapeHtml : les noms d'entreprise sont des données à échapper.
    select.innerHTML = companies
      .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
      .join('');
  }

  document.getElementById('entry-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/entries', 'POST', {
        companyId: select.value,
        hours: document.getElementById('hours-input').value,
        description: document.getElementById('desc-input').value,
      });
      showAlert('Saisie enregistrée.', 'success');
      document.getElementById('entry-form').reset();
    } catch (err) {
      showAlert(err.message);
    }
  };
})();
