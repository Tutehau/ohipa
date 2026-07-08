(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'dashboard');

  // Statistiques basées sur le pointage (le réel).
  const rep = await api('/api/reports');
  document.getElementById('stat-hours').textContent = rep.totalHours + 'h';
  document.getElementById('stat-entries').textContent = rep.count;

  const pointages = await api('/api/pointages');
  if (pointages.length) {
    // Les pointages arrivent triés par date décroissante côté serveur.
    document.getElementById('stat-last').textContent = new Date(pointages[0].clockIn).toLocaleDateString();
  }
})();
