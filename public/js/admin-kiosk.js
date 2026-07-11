// Temps relatif lisible (« il y a 2 h », « hier »…) ; 'jamais' si non utilisé.
function relTime(iso) {
  if (!iso) return 'jamais utilisé';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'hier' : `il y a ${d} j`;
}

async function loadKiosks() {
  const list = await api('/api/admin/kiosks');
  const ul = document.getElementById('kiosk-list');
  if (!list.length) {
    ul.innerHTML = `<li class="list-group-item text-muted text-center py-3"><i class="bi bi-inbox me-1"></i>Aucun kiosque.</li>`;
    return;
  }
  ul.innerHTML = list.map(k => {
    // Actif si utilisé dans les dernières 24 h.
    const recent = k.last_used && (Date.now() - new Date(k.last_used).getTime()) < 86400000;
    const dot = recent
      ? '<span class="badge bg-success"><i class="bi bi-broadcast me-1"></i>actif</span>'
      : '<span class="badge bg-secondary"><i class="bi bi-pause-circle me-1"></i>inactif</span>';
    return `<li class="list-group-item d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span><i class="bi bi-shop me-2"></i>${escapeHtml(k.label)}
        <small class="text-muted ms-2">dernier badge : ${escapeHtml(relTime(k.last_used))}</small></span>
      <span class="d-flex align-items-center gap-2">${dot}
        <button class="btn btn-sm btn-outline-danger" data-revoke="${escapeHtml(k.id)}" title="Révoquer"><i class="bi bi-trash"></i> Révoquer</button></span>
    </li>`;
  }).join('');
}

function reveal(k) {
  document.getElementById('reveal-qr').innerHTML = k.qr || '';       // SVG généré par le serveur
  document.getElementById('reveal-url').value = k.url || '';
  document.getElementById('reveal-token').value = k.token || '';
  document.getElementById('reveal').classList.remove('d-none');
}

(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;
  renderAdminNav('kiosk');
  await loadKiosks();

  document.getElementById('kiosk-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const k = await api('/api/admin/kiosks', 'POST', { label: document.getElementById('kiosk-label').value });
      document.getElementById('kiosk-form').reset();
      reveal(k);
      await loadKiosks();
    } catch (err) { showAlert(err.message); }
  };

  document.getElementById('kiosk-list').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-revoke]');
    if (!btn || !confirm('Révoquer ce kiosque ? La tablette devra être reconfigurée.')) return;
    try { await api('/api/admin/kiosks/' + btn.dataset.revoke, 'DELETE'); await loadKiosks(); }
    catch (err) { showAlert(err.message); }
  });
})();
