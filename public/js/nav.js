// Navigation des pages utilisateur.
// - Desktop (>=992px) : barre supérieure avec tous les liens.
// - Mobile (<992px)   : barre supérieure réduite (logo + déconnexion) +
//                       bottom navbar fixe (5 essentiels).
// `active` = identifiant de la page courante pour surligner le bon lien.
function renderNav(me, active) {
  // Liens complets (barre supérieure desktop).
  const links = [
    { key: 'dashboard', href: 'dashboard.html', icon: 'bi-speedometer2', label: 'Tableau de bord' },
    { key: 'pointage', href: 'pointage.html', icon: 'bi-fingerprint', label: 'Pointage' },
    { key: 'planning', href: 'planning.html', icon: 'bi-calendar-week', label: 'Planning' },
    { key: 'history', href: 'history.html', icon: 'bi-list-ul', label: 'Historique' },
    { key: 'reports', href: 'reports.html', icon: 'bi-bar-chart-line', label: 'Rapports' },
  ];
  // Sous-ensemble affiché dans la bottom navbar mobile (labels courts).
  const bottomKeys = [
    { key: 'dashboard', href: 'dashboard.html', icon: 'bi-speedometer2', short: 'Accueil' },
    { key: 'pointage', href: 'pointage.html', icon: 'bi-fingerprint', short: 'Pointage' },
    { key: 'planning', href: 'planning.html', icon: 'bi-calendar-week', short: 'Planning' },
    { key: 'reports', href: 'reports.html', icon: 'bi-bar-chart-line', short: 'Rapports' },
  ];

  // --- Barre supérieure (liens complets, visibles à partir de lg) ---
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
      <ul class="navbar-nav ms-auto align-items-lg-center d-none d-lg-flex">
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
      <button class="btn btn-outline-light btn-sm ms-auto d-lg-none" onclick="logout()" title="Déconnexion">
        <i class="bi bi-box-arrow-right"></i>
      </button>
    </div>`;

  // --- Bottom navbar (mobile uniquement) ---
  const bnItems = bottomKeys.map(l => `
    <a class="bn-item ${l.key === active ? 'active' : ''}" href="${l.href}">
      <i class="bi ${l.icon}"></i><span>${l.short}</span>
    </a>`);
  if (me.role === 'admin') {
    bnItems.push(`
    <a class="bn-item admin ${active === 'admin' ? 'active' : ''}" href="admin-dashboard.html">
      <i class="bi bi-shield-lock"></i><span>Admin</span>
    </a>`);
  }

  document.getElementById('bottom-nav')?.remove();          // évite les doublons
  const nav = document.createElement('nav');
  nav.id = 'bottom-nav';
  nav.className = 'bottom-nav d-lg-none';
  nav.innerHTML = bnItems.join('');
  document.body.appendChild(nav);
  document.body.classList.add('has-bottom-nav');
}
