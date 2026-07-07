(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'dashboard');

  const entries = await api('/api/entries');
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  document.getElementById('stat-hours').textContent = totalHours + 'h';
  document.getElementById('stat-entries').textContent = entries.length;

  if (entries.length) {
    // Les entrées arrivent déjà triées par date décroissante côté serveur.
    const last = new Date(entries[0].date).toLocaleDateString();
    document.getElementById('stat-last').textContent = last;
  }
})();
