(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;

  const { users, companies, hours, recent } = await api('/api/admin/stats');
  document.getElementById('stat-users').textContent = users;
  document.getElementById('stat-companies').textContent = companies;
  document.getElementById('stat-hours').textContent = hours + 'h';

  const tbody = document.getElementById('recent-activity');
  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3">
      <i class="bi bi-inbox me-1"></i>Aucune activité.</td></tr>`;
    return;
  }
  tbody.innerHTML = recent.map(e => `
    <tr>
      <td>${escapeHtml(new Date(e.date).toLocaleDateString())}</td>
      <td>${escapeHtml(e.username || 'N/A')}</td>
      <td>${escapeHtml(e.companyName || 'N/A')}</td>
      <td>${escapeHtml(e.hours)}h</td>
    </tr>`).join('');
})();
