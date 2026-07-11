let currentUsername = '';
let allUsers = [];      // liste brute des utilisateurs
let hoursById = {};     // userId -> { worked, present, lastActivity }

const ymd = (d) => d.toLocaleDateString('sv-SE');
function last30() {
  const to = new Date(), from = new Date();
  from.setDate(to.getDate() - 29);
  return { from: ymd(from), to: ymd(to) };
}
const relDay = (iso) => {
  if (!iso) return 'jamais';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
};

function userRow(u) {
  const isSelf = u.username === currentUsername;
  const h = hoursById[u.id] || {};
  const roleBadge = u.role === 'admin'
    ? '<span class="badge bg-primary"><i class="bi bi-shield-fill me-1"></i>admin</span>'
    : '<span class="badge bg-secondary">user</span>';
  const statusBadge = u.active
    ? '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>actif</span>'
    : '<span class="badge bg-warning"><i class="bi bi-hourglass me-1"></i>inactif</span>';
  const presentBadge = h.present
    ? '<span class="badge bg-success" title="En poste actuellement"><i class="bi bi-broadcast me-1"></i>en poste</span>'
    : '';
  const pinBadge = u.hasPin
    ? '<span class="badge bg-info text-dark" title="Un PIN de badgeuse est défini"><i class="bi bi-qr-code me-1"></i>PIN</span>'
    : '';
  // Heures travaillées sur 30 j + dernière activité.
  const hoursInfo = `<small class="text-muted ms-2" title="Dernière activité : ${escapeHtml(relDay(h.lastActivity))}">
    <i class="bi bi-clock-history me-1"></i>${(h.worked || 0)} h</small>`;

  const pinBtns = `
    <button class="btn btn-sm btn-outline-info" data-action="pin" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.username)}" title="${u.hasPin ? 'Régénérer le PIN' : 'Générer un PIN de badgeuse'}">
      <i class="bi bi-qr-code"></i></button>
    ${u.hasPin ? `<button class="btn btn-sm btn-outline-light" data-action="pin-del" data-id="${escapeHtml(u.id)}" title="Retirer le PIN"><i class="bi bi-x-circle"></i></button>` : ''}`;

  // Reset mot de passe : disponible pour tous (y compris soi-même).
  const resetBtn = `<button class="btn btn-sm btn-outline-warning" data-action="reset" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.username)}" title="Réinitialiser le mot de passe">
      <i class="bi bi-key"></i></button>`;

  const roleActions = isSelf ? '<span class="text-muted small ms-1">vous</span>' : `
    <button class="btn btn-sm btn-outline-light" data-action="role" data-id="${escapeHtml(u.id)}" data-role="${u.role === 'admin' ? 'user' : 'admin'}" title="Changer le rôle">
      <i class="bi bi-arrow-repeat"></i></button>
    <button class="btn btn-sm btn-outline-light" data-action="active" data-id="${escapeHtml(u.id)}" data-active="${u.active ? 0 : 1}" title="${u.active ? 'Désactiver' : 'Activer'}">
      <i class="bi bi-${u.active ? 'pause' : 'play'}-circle"></i></button>
    <button class="btn btn-sm btn-outline-danger" data-action="delete" data-id="${escapeHtml(u.id)}" data-name="${escapeHtml(u.username)}" title="Supprimer">
      <i class="bi bi-trash"></i></button>`;

  return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
    <span><i class="bi bi-person me-2"></i>${escapeHtml(u.username)}
      <small class="text-muted">${escapeHtml(u.email || '')}</small>${hoursInfo}</span>
    <span class="d-flex align-items-center gap-2">${presentBadge}${pinBadge}${statusBadge}${roleBadge}
      <span class="d-flex gap-1 ms-2">${pinBtns}${resetBtn}${roleActions}</span></span>
  </li>`;
}

function render() {
  const q = (document.getElementById('user-search').value || '').toLowerCase().trim();
  const rows = allUsers.filter((u) =>
    !q || u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  const list = document.getElementById('user-list');
  if (!rows.length) {
    list.innerHTML = `<li class="list-group-item text-muted text-center py-3"><i class="bi bi-search me-1"></i>Aucun utilisateur.</li>`;
    return;
  }
  list.innerHTML = rows.map(userRow).join('');
}

async function loadUsers() {
  const { from, to } = last30();
  const [users, hours] = await Promise.all([
    api('/api/admin/users'),
    api(`/api/admin/hours?from=${from}&to=${to}`),
  ]);
  allUsers = users;
  hoursById = {};
  for (const r of hours.rows) hoursById[r.userId] = r;
  render();
}

(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;
  renderAdminNav('users');
  currentUsername = me.username;
  await loadUsers();

  document.getElementById('user-search').oninput = render;

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
      } else if (btn.dataset.action === 'reset') {
        if (!confirm(`Réinitialiser le mot de passe de ${btn.dataset.name} ?`)) return;
        const { password } = await api(`/api/admin/users/${id}/reset-password`, 'POST');
        showAlert(`Nouveau mot de passe de ${btn.dataset.name} : ${password} — communiquez-le au salarié (non réaffiché).`, 'success');
        return; // pas besoin de recharger la liste
      } else if (btn.dataset.action === 'pin') {
        const { pin } = await api(`/api/admin/users/${id}/pin`, 'POST');
        showAlert(`PIN de badgeuse de ${btn.dataset.name} : ${pin} — communiquez-le au salarié (non réaffiché).`, 'success');
      } else if (btn.dataset.action === 'pin-del') {
        await api(`/api/admin/users/${id}/pin`, 'DELETE');
      }
      await loadUsers();
    } catch (err) { showAlert(err.message); }
  });
})();
