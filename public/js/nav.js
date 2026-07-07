// Construit la barre de navigation supérieure des pages utilisateur.
// `active` = identifiant de la page courante pour surligner le bon lien.
function renderNav(me, active) {
  const links = [
    { key: 'dashboard', href: 'dashboard.html', icon: 'bi-speedometer2', label: 'Tableau de bord' },
    { key: 'entry', href: 'entry.html', icon: 'bi-clock-history', label: 'Saisir des heures' },
    { key: 'history', href: 'history.html', icon: 'bi-list-ul', label: 'Mon historique' },
    { key: 'reports', href: 'reports.html', icon: 'bi-bar-chart-line', label: 'Rapports' },
  ];

  const items = links.map(l => `
    <li class="nav-item">
      <a class="nav-link ${l.key === active ? 'active fw-semibold' : ''} text-white" href="${l.href}">
        <i class="bi ${l.icon} me-1"></i>${l.label}
      </a>
    </li>`).join('');

  const adminLink = me.role === 'admin' ? `
    <li class="nav-item">
      <a class="nav-link text-warning" href="admin-dashboard.html">
        <i class="bi bi-shield-lock me-1"></i>Administration
      </a>
    </li>` : '';

  document.getElementById('topnav').innerHTML = `
    <div class="container">
      <a class="navbar-brand d-flex align-items-center gap-2" href="dashboard.html">
        <img src="logo.png" alt=""> Ohipa
      </a>
      <ul class="navbar-nav ms-auto align-items-lg-center">
        ${items}
        ${adminLink}
        <li class="nav-item ms-lg-3">
          <span class="navbar-text text-white-50 me-2">
            <i class="bi bi-person-circle me-1"></i>${escapeHtml(me.username)}
          </span>
          <button class="btn btn-outline-light btn-sm" onclick="logout()">
            <i class="bi bi-box-arrow-right me-1"></i>Déconnexion
          </button>
        </li>
      </ul>
    </div>`;
}
