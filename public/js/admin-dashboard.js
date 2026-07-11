// Tableau de bord admin : KPI + présence en direct + anomalies, sur les vraies
// données (pointages/plannings). Période et entreprise pilotent tout (aucun mélange).
const ymd = (d) => d.toLocaleDateString('sv-SE'); // YYYY-MM-DD local
const round = (n) => Math.round((n || 0) * 100) / 100;

// Bornes d'une période préset, en date locale.
function periodRange(key) {
  const to = new Date();
  const from = new Date();
  if (key === 'week') { const dow = (to.getDay() + 6) % 7; from.setDate(to.getDate() - dow); }
  else if (key === '7') { from.setDate(to.getDate() - 6); }
  else if (key === 'month') { from.setDate(1); }
  else if (key === '30') { from.setDate(to.getDate() - 29); }
  return { from: ymd(from), to: ymd(to) };
}

// Durée écoulée depuis un ISO, format compact « 3 h 12 ».
function elapsed(iso) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDay = (ymdStr) => new Date(ymdStr + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });

function currentQuery() {
  const { from, to } = periodRange(document.getElementById('f-period').value);
  const company = document.getElementById('f-company').value;
  const qs = new URLSearchParams({ from, to });
  if (company) qs.set('companyId', company);
  return { from, to, qs: qs.toString() };
}

function renderPresence(list) {
  const box = document.getElementById('presence');
  document.getElementById('presence-count').textContent = list.length ? `${list.length} en poste` : '';
  if (!list.length) {
    box.innerHTML = `<div class="muted-empty"><i class="bi bi-moon-stars"></i>Personne n'est pointé actuellement.</div>`;
    return;
  }
  box.innerHTML = list.map((p) => {
    const warn = p.hoursOpen > 16; // ouvert anormalement longtemps
    return `<div class="presence-row ${warn ? 'warn' : ''}">
      <span class="live-dot"></span>
      <div>
        <div class="who">${escapeHtml(p.username || '—')}</div>
        <div class="meta">${escapeHtml(p.companyName || 'Sans société')} · depuis ${escapeHtml(fmtTime(p.since))}${warn ? ' · oubli probable' : ''}</div>
      </div>
      <span class="dur">${escapeHtml(elapsed(p.since))}</span>
    </div>`;
  }).join('');
}

function renderAnomalies(data) {
  const items = [];
  for (const o of data.oublis) items.push({ type: 'oubli', icon: 'bi-exclamation-octagon',
    title: `${o.username || '—'} — départ oublié`, meta: `${fmtDay(o.day)} · pointage clôturé automatiquement` });
  for (const l of data.longOpen) items.push({ type: 'open', icon: 'bi-hourglass-split',
    title: `${l.username || '—'} — pointage ouvert depuis ${round(l.hoursOpen)} h`, meta: `${escapeHtml(l.companyName || 'Sans société')} · depuis ${fmtTime(l.since)}` });
  for (const a of data.absences) items.push({ type: 'absence', icon: 'bi-person-x',
    title: `${a.username || '—'} — absence`, meta: `${fmtDay(a.day)} · jour planifié sans aucun pointage` });
  for (const g of data.bigGaps) items.push({ type: 'gap', icon: 'bi-graph-down-arrow',
    title: `${g.username || '—'} — écart de ${g.ecart > 0 ? '+' : ''}${g.ecart} h`, meta: `réel ${g.worked} h vs prévu ${g.planned} h` });

  document.getElementById('anomalies-count').textContent = items.length ? `${items.length} à vérifier` : '';
  const box = document.getElementById('anomalies');
  if (!items.length) {
    box.innerHTML = `<div class="anom-empty"><i class="bi bi-check-circle-fill"></i>Aucune anomalie sur la période. Tout est en ordre.</div>`;
    return;
  }
  box.innerHTML = items.map((a) => `
    <div class="anom type-${a.type}">
      <i class="bi ${a.icon}"></i>
      <div class="a-body"><div class="a-title">${escapeHtml(a.title)}</div><div class="a-meta">${escapeHtml(a.meta)}</div></div>
    </div>`).join('');
}

async function refresh() {
  const { from, to, qs } = currentQuery();
  try {
    const [stats, presence, anomalies] = await Promise.all([
      api('/api/admin/stats?' + qs),
      api('/api/admin/presence?' + qs),
      api('/api/admin/anomalies?' + qs),
    ]);
    document.getElementById('kpi-present').textContent = stats.present;
    document.getElementById('kpi-hours').textContent = round(stats.hours) + ' h';
    document.getElementById('kpi-hours-sub').textContent = `du ${fmtDay(from)} au ${fmtDay(to)}`;
    document.getElementById('kpi-users').textContent = stats.usersActive;
    document.getElementById('kpi-companies-sub').textContent = `${stats.companies} entreprise${stats.companies > 1 ? 's' : ''}`;
    document.getElementById('kpi-anomalies').textContent = stats.anomalies;
    renderPresence(presence);
    renderAnomalies(anomalies);
  } catch (e) { showAlert(e.message); }
}

(async () => {
  const me = await requireAuth({ adminOnly: true });
  if (!me) return;
  renderAdminNav('dashboard');

  // Remplit le filtre entreprise (scope global du tableau de bord).
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
  // Rafraîchit la présence en direct périodiquement.
  setInterval(refresh, 60000);
})();
