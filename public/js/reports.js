let dayChart = null;
let companyChart = null;
// Palette catégorielle (bleus de marque + accents) pour les répartitions.
const CATEGORICAL = ['#2f6bff', '#00c6ff', '#ff8a5c', '#2fd98a', '#ffc857', '#a68bff', '#ff6b9d', '#4dd0e1'];

// Assemble la query string à partir des filtres actifs.
function currentQuery() {
  const p = new URLSearchParams();
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  const company = document.getElementById('f-company').value;
  const userSel = document.getElementById('f-user');
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (company) p.set('companyId', company);
  if (userSel && userSel.value) p.set('userId', userSel.value);
  return p.toString();
}

function renderList(el, rows) {
  if (!rows || !rows.length) {
    el.innerHTML = `<li class="list-group-item text-muted"><i class="bi bi-inbox me-1"></i>Aucune donnée.</li>`;
    return;
  }
  el.innerHTML = rows.map(r => `
    <li class="list-group-item d-flex justify-content-between">
      <span>${escapeHtml(r.label)}</span>
      <span class="fw-semibold">${escapeHtml(Math.round(r.hours * 100) / 100)}h</span>
    </li>`).join('');
}

function renderChart(byDay) {
  const ctx = document.getElementById('chart-day');
  const labels = byDay.map(d => d.label);
  const data = byDay.map(d => d.hours);
  if (dayChart) dayChart.destroy();

  const grad = ctx.getContext('2d').createLinearGradient(0, 0, 0, 220);
  grad.addColorStop(0, 'rgba(0, 198, 255, 0.9)');
  grad.addColorStop(1, 'rgba(47, 107, 255, 0.25)');

  dayChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Heures', data, backgroundColor: grad, borderRadius: 6, maxBarThickness: 42 }] },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(120,160,255,.08)' }, ticks: { color: '#93a2c6' } },
        y: { grid: { color: 'rgba(120,160,255,.08)' }, ticks: { color: '#93a2c6' }, beginAtZero: true },
      },
    },
  });
}

function renderCompanyDonut(rows) {
  const ctx = document.getElementById('chart-company');
  if (!ctx) return;
  if (companyChart) companyChart.destroy();
  if (!rows.length) return;
  const muted = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#93a2c6';
  companyChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.label),
      datasets: [{ data: rows.map(r => r.hours), backgroundColor: CATEGORICAL, borderWidth: 0 }],
    },
    options: {
      cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { color: muted, boxWidth: 12, padding: 10 } } },
    },
  });
}

async function refresh() {
  const qs = currentQuery();
  document.getElementById('btn-export').href = '/api/reports/export.csv' + (qs ? '?' + qs : '');
  const data = await api('/api/reports' + (qs ? '?' + qs : ''));
  document.getElementById('t-hours').textContent = (Math.round(data.totalHours * 100) / 100) + 'h';
  document.getElementById('t-count').textContent = data.count;
  renderChart(data.byDay || []);
  renderCompanyDonut(data.byCompany || []);
  renderList(document.getElementById('by-company'), data.byCompany);
  if (data.byUser) renderList(document.getElementById('by-user'), data.byUser);

  await renderReconciliation();
}

// Comparaison prévu (planning) / réel (pointage). Filtres période + utilisateur.
async function renderReconciliation() {
  const p = new URLSearchParams();
  const from = document.getElementById('f-from').value;
  const to = document.getElementById('f-to').value;
  const userSel = document.getElementById('f-user');
  const company = document.getElementById('f-company').value;
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (userSel && userSel.value) p.set('userId', userSel.value);
  if (company) p.set('companyId', company); // le prévu/réel devient propre à l'entreprise
  const qs = p.toString();
  const rec = await api('/api/reconciliation' + (qs ? '?' + qs : ''));

  const h = (n) => (Math.round((n || 0) * 100) / 100) + 'h';
  const signed = (n) => (n > 0 ? '+' : '') + h(n);
  document.getElementById('rec-planned').textContent = h(rec.totals.planned);
  document.getElementById('rec-real').textContent = h(rec.totals.real);
  document.getElementById('rec-ecart').textContent = signed(rec.totals.ecart);
  document.getElementById('rec-ecart-badge').className =
    'badge fs-6 ' + (rec.totals.ecart < 0 ? 'bg-warning text-dark' : 'bg-success');

  const tbody = document.getElementById('rec-rows');
  if (!rec.days.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-3"><i class="bi bi-inbox me-1"></i>Aucune donnée sur la période.</td></tr>`;
    return;
  }
  tbody.innerHTML = rec.days.map(d => {
    const color = d.ecart < 0 ? 'text-warning' : (d.ecart > 0 ? 'text-success' : 'text-muted');
    const day = new Date(d.day + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: '2-digit' });
    return `<tr>
      <td>${escapeHtml(day)}</td>
      <td class="text-end">${escapeHtml(h(d.planned))}</td>
      <td class="text-end">${escapeHtml(h(d.real))}</td>
      <td class="text-end fw-semibold ${color}">${escapeHtml(signed(d.ecart))}</td>
    </tr>`;
  }).join('');
}

(async () => {
  const me = await requireAuth();
  if (!me) return;
  renderNav(me, 'reports');

  // Filtre entreprise (commun à tous)
  const companies = await api('/api/companies');
  const compSel = document.getElementById('f-company');
  compSel.innerHTML += companies
    .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');

  // Filtre utilisateur (admin uniquement)
  if (me.role === 'admin') {
    document.getElementById('f-user-wrap').style.display = '';
    document.getElementById('by-user-card').style.display = '';
    const users = await api('/api/admin/users');
    document.getElementById('f-user').innerHTML += users
      .map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.username)}</option>`).join('');
  }

  document.getElementById('filter-form').onsubmit = (e) => { e.preventDefault(); refresh(); };
  document.getElementById('btn-reset').onclick = () => {
    document.getElementById('filter-form').reset();
    refresh();
  };

  await refresh();
})();
