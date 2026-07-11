// Rapports d'équipe (admin) : heures réelles vs prévues par employé et par
// société, sur une période. Réutilise /admin/hours et /admin/companies-stats.
const ymd = (d) => d.toLocaleDateString('sv-SE');
const round = (n) => Math.round((n || 0) * 100) / 100;
const h = (n) => round(n) + ' h';
const signed = (n) => (n > 0 ? '+' : '') + h(n);
const fmtDay = (ymdStr) => new Date(ymdStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });

const relDay = (iso) => {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return 'hier';
  return `il y a ${days} j`;
};

function periodRange(key) {
  const to = new Date(), from = new Date();
  if (key === 'week') { const dow = (to.getDay() + 6) % 7; from.setDate(to.getDate() - dow); }
  else if (key === '7') { from.setDate(to.getDate() - 6); }
  else if (key === 'month') { from.setDate(1); }
  else { from.setDate(to.getDate() - 29); } // 30 j par défaut
  return { from: ymd(from), to: ymd(to) };
}

function currentQuery() {
  const { from, to } = periodRange(document.getElementById('f-period').value);
  const company = document.getElementById('f-company').value;
  const qs = new URLSearchParams({ from, to });
  if (company) qs.set('companyId', company);
  return { from, to, qs: qs.toString() };
}

function renderUsers(rows) {
  const tbody = document.getElementById('by-user');
  document.getElementById('emp-count').textContent = rows.length ? `${rows.length} employé${rows.length > 1 ? 's' : ''}` : '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-3"><i class="bi bi-inbox me-1"></i>Aucune donnée.</td></tr>`;
    return;
  }
  // Trie par heures réelles décroissantes (les plus actifs en tête).
  const sorted = rows.slice().sort((a, b) => b.worked - a.worked);
  tbody.innerHTML = sorted.map((r) => {
    const color = r.ecart < 0 ? 'text-warning' : (r.ecart > 0 ? 'text-success' : 'text-muted');
    const present = r.present ? ' <span class="badge bg-success ms-1"><i class="bi bi-broadcast"></i></span>' : '';
    return `<tr>
      <td>${escapeHtml(r.username)}${present}</td>
      <td class="text-end fw-semibold">${escapeHtml(h(r.worked))}</td>
      <td class="text-end">${escapeHtml(h(r.planned))}</td>
      <td class="text-end fw-semibold ${color}">${escapeHtml(signed(r.ecart))}</td>
      <td class="text-end d-none d-md-table-cell text-muted">${escapeHtml(relDay(r.lastActivity))}</td>
    </tr>`;
  }).join('');
}

function renderCompanies(rows) {
  const tbody = document.getElementById('by-company');
  document.getElementById('comp-count').textContent = rows.length ? `${rows.length} société${rows.length > 1 ? 's' : ''}` : '';
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted py-3"><i class="bi bi-inbox me-1"></i>Aucune donnée.</td></tr>`;
    return;
  }
  const sorted = rows.slice().sort((a, b) => b.hours - a.hours);
  tbody.innerHTML = sorted.map((c) => `
    <tr>
      <td><i class="bi bi-building me-2 text-muted"></i>${escapeHtml(c.name)}</td>
      <td class="text-end">${c.employees}</td>
      <td class="text-end fw-semibold">${escapeHtml(h(c.hours))}</td>
    </tr>`).join('');
}

async function refresh() {
  const { from, to, qs } = currentQuery();
  try {
    const [hours, companies] = await Promise.all([
      api('/api/admin/hours?' + qs),
      api('/api/admin/companies-stats?' + qs),
    ]);
    const rows = hours.rows || [];
    const totReal = round(rows.reduce((s, r) => s + r.worked, 0));
    const totPlan = round(rows.reduce((s, r) => s + r.planned, 0));
    const ecart = round(totReal - totPlan);
    document.getElementById('kpi-real').textContent = h(totReal);
    document.getElementById('kpi-planned').textContent = h(totPlan);
    document.getElementById('kpi-ecart').textContent = signed(ecart);
    document.getElementById('kpi-period').textContent = `du ${fmtDay(from)} au ${fmtDay(to)}`;
    renderUsers(rows);
    renderCompanies(companies);
  } catch (e) { showAlert(e.message); }
}

(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;
  renderAdminNav('reports');

  const companies = await api('/api/companies');
  document.getElementById('f-company').innerHTML = '<option value="">Toutes les entreprises</option>' +
    companies.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');

  document.getElementById('f-period').onchange = refresh;
  document.getElementById('f-company').onchange = refresh;
  document.getElementById('btn-export').onclick = () => {
    const { qs } = currentQuery();
    window.location = '/api/admin/export.csv?' + qs;
  };

  await refresh();
})();
