// Navigation mobile de l'espace admin (<992px) : barre du haut compacte +
// bottom-nav, en réutilisant le système de l'espace utilisateur. Sur desktop,
// la barre latérale reste affichée et ceci n'apparaît pas.
function renderAdminNav(active) {
  // Barre supérieure mobile : logo + retour espace utilisateur + déconnexion.
  if (!document.getElementById('admin-topbar')) {
    const top = document.createElement('nav');
    top.id = 'admin-topbar';
    top.className = 'navbar navbar-dark bg-dark d-lg-none px-3 mb-3';
    top.innerHTML = `
      <a class="navbar-brand d-flex align-items-center gap-2" href="admin-dashboard.html"><img src="logo.png" alt=""> Ohipa</a>
      <span class="d-flex gap-2 align-items-center">
        ${themeToggleHtml()}
        <a class="btn btn-outline-light btn-sm" href="dashboard.html" title="Espace utilisateur"><i class="bi bi-person"></i></a>
        <button class="btn btn-outline-light btn-sm" onclick="logout()" title="Déconnexion"><i class="bi bi-box-arrow-right"></i></button>
      </span>`;
    document.body.prepend(top);
  }

  // Bascule de thème dans la barre latérale (desktop).
  const sideNav = document.querySelector('.sidebar .nav');
  if (sideNav && !sideNav.querySelector('.theme-toggle')) {
    const li = document.createElement('li');
    li.className = 'nav-item mt-2 px-2';
    li.innerHTML = themeToggleHtml() + '<span class="ms-2 small text-white-50">Thème</span>';
    sideNav.appendChild(li);
  }

  // Bottom-nav mobile : 5 sections admin.
  const items = [
    { key: 'dashboard', href: 'admin-dashboard.html', icon: 'bi-graph-up', short: 'Bord' },
    { key: 'users', href: 'admin-users.html', icon: 'bi-people', short: 'Équipe' },
    { key: 'companies', href: 'admin-companies.html', icon: 'bi-building', short: 'Sociétés' },
    { key: 'kiosk', href: 'admin-kiosk.html', icon: 'bi-qr-code', short: 'Kiosques' },
    { key: 'reports', href: 'reports.html', icon: 'bi-bar-chart-line', short: 'Rapports' },
  ];
  document.getElementById('bottom-nav')?.remove();
  const nav = document.createElement('nav');
  nav.id = 'bottom-nav';
  nav.className = 'bottom-nav d-lg-none';
  nav.innerHTML = items.map(l => `
    <a class="bn-item ${l.key === active ? 'active' : ''}" href="${l.href}">
      <i class="bi ${l.icon}"></i><span>${l.short}</span>
    </a>`).join('');
  document.body.appendChild(nav);
  document.body.classList.add('has-bottom-nav');
}
