let dayChart = null;

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

async function refresh() {
  const qs = currentQuery();
  document.getElementById('btn-export').href = '/api/reports/export.csv' + (qs ? '?' + qs : '');
  const data = await api('/api/reports' + (qs ? '?' + qs : ''));
  document.getElementById('t-hours').textContent = (Math.round(data.totalHours * 100) / 100) + 'h';
  document.getElementById('t-count').textContent = data.count;
  renderChart(data.byDay || []);
  renderList(document.getElementById('by-company'), data.byCompany);
  if (data.byUser) renderList(document.getElementById('by-user'), data.byUser);
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
