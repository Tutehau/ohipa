let currentUsername = '';

async function loadUsers() {
  const users = await api('/api/admin/users');
  const list = document.getElementById('user-list');
  list.innerHTML = users.map(u => {
    const isSelf = u.username === currentUsername;
    const roleBadge = u.role === 'admin'
      ? '<span class="badge bg-primary"><i class="bi bi-shield-fill me-1"></i>admin</span>'
      : '<span class="badge bg-secondary">user</span>';
    const statusBadge = u.active
      ? '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>actif</span>'
      : '<span class="badge bg-warning"><i class="bi bi-hourglass me-1"></i>inactif</span>';

    // Pas d'actions sur soi-même (protégé aussi côté serveur).
    const actions = isSelf ? '<span class="text-muted small">vous</span>' : `
      <button class="btn btn-sm btn-outline-light" data-action="role" data-id="${escapeHtml(u.id)}" data-role="${u.role === 'admin' ? 'user' : 'admin'}" title="Changer le rôle">
        <i class="bi bi-arrow-repeat"></i></button>
      <button class="btn btn-sm btn-outline-light" data-action="active" data-id="${escapeHtml(u.id)}" data-active="${u.active ? 0 : 1}" title="${u.active ? 'Désactiver' : 'Activer'}">
        <i class="bi bi-${u.active ? 'pause' : 'play'}-circle"></i></button>
      <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.username)}" title="Supprimer">
        <i class="bi bi-trash"></i></button>`;

    return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span><i class="bi bi-person me-2"></i>${escapeHtml(u.username)}
        <small class="text-muted">${escapeHtml(u.email || '')}</small></span>
      <span class="d-flex align-items-center gap-2">${statusBadge}${roleBadge}
        <span class="d-flex gap-1 ms-2">${actions}</span></span>
    </li>`;
  }).join('');
}

(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;
  currentUsername = me.username;
  await loadUsers();

  document.getElementById('invite-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { message } = await api('/api/admin/invite', 'POST', {
        username: document.getElementById('inv-user').value,
        email: document.getElementById('inv-email').value,
        password: document.getElementById('inv-pass').value,
      });
      showAlert(message, 'success');
      document.getElementById('invite-form').reset();
      await loadUsers();
    } catch (err) { showAlert(err.message); }
  };

  document.getElementById('user-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    try {
      if (btn.dataset.action === 'role') {
        await api(`/api/admin/users/${id}/role`, 'PATCH', { role: btn.dataset.role });
      } else if (btn.dataset.action === 'active') {
        await api(`/api/admin/users/${id}/active`, 'PATCH', { active: btn.dataset.active === '1' });
      } else if (btn.dataset.action === 'delete') {
        if (!confirm(`Supprimer l'utilisateur ${btn.dataset.name} et ses saisies ?`)) return;
        await api(`/api/admin/users/${id}`, 'DELETE');
      }
      await loadUsers();
    } catch (err) { showAlert(err.message); }
  });
})();
