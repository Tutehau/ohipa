// Navigation des pages utilisateur.
// - Desktop (>=992px) : barre supérieure avec tous les liens.
// - Mobile (<992px)   : barre supérieure réduite (logo + déconnexion) +
//                       bottom navbar fixe (4 onglets + action centrale « Pointer »).
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
        <li class="nav-item ms-lg-3 d-flex align-items-center gap-2">
          <span class="navbar-text me-1">
            <i class="bi bi-person-circle me-1"></i>${escapeHtml(me.username)}
          </span>
          ${themeToggleHtml()}
          <button class="btn btn-outline-light btn-sm" onclick="logout()">
            <i class="bi bi-box-arrow-right me-1"></i>Déconnexion
          </button>
        </li>
      </ul>
      <span class="ms-auto d-lg-none d-flex gap-2">
        ${themeToggleHtml()}
        <button class="btn btn-outline-light btn-sm" onclick="logout()" title="Déconnexion">
          <i class="bi bi-box-arrow-right"></i>
        </button>
      </span>
    </div>`;

  // --- Bottom navbar (mobile uniquement) ---
  // 4 onglets répartis autour d'une action centrale surélevée (Pointer).
  const bnLeft = [
    { key: 'dashboard', href: 'dashboard.html', icon: 'bi-house-door', short: 'Accueil' },
    { key: 'planning', href: 'planning.html', icon: 'bi-calendar-week', short: 'Planning' },
  ];
  const bnRight = [
    { key: 'history', href: 'history.html', icon: 'bi-list-ul', short: 'Historique' },
    { key: 'reports', href: 'reports.html', icon: 'bi-bar-chart-line', short: 'Rapports' },
  ];
  const bnTab = (l) => `
    <a class="bn-item ${l.key === active ? 'active' : ''}" href="${l.href}">
      <i class="bi ${l.icon}"></i><span>${l.short}</span>
    </a>`;
  const bnCenter = `
    <a class="bn-item bn-primary ${active === 'pointage' ? 'active' : ''}" href="pointage.html" aria-label="Pointer">
      <span class="bn-fab"><i class="bi bi-fingerprint"></i></span><span>Pointer</span>
    </a>`;
  const bnAdmin = me.role === 'admin' ? `
    <a class="bn-item admin ${active === 'admin' ? 'active' : ''}" href="admin-dashboard.html">
      <i class="bi bi-shield-lock"></i><span>Admin</span>
    </a>` : '';

  document.getElementById('bottom-nav')?.remove();          // évite les doublons
  const nav = document.createElement('nav');
  nav.id = 'bottom-nav';
  nav.className = 'bottom-nav d-lg-none';
  nav.innerHTML = bnLeft.map(bnTab).join('') + bnCenter + bnRight.map(bnTab).join('') + bnAdmin;
  document.body.appendChild(nav);
  document.body.classList.add('has-bottom-nav');
}
