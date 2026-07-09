// Thème + animation d'ouverture Ohipa. Chargé sur chaque page.
(function () {
  // --- Thème (appliqué au plus tôt pour éviter le flash) ---
  if (localStorage.getItem('ohipa_theme') === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  }
  window.isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
  window.themeIcon = () => (window.isLight() ? 'bi-moon-stars' : 'bi-sun-fill');
  window.toggleTheme = function () {
    const next = window.isLight() ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('ohipa_theme', next);
    document.querySelectorAll('.theme-toggle i').forEach((i) => { i.className = 'bi ' + window.themeIcon(); });
  };
  // Bouton réutilisable pour les barres de navigation.
  window.themeToggleHtml = () =>
    `<button class="theme-toggle" onclick="toggleTheme()" title="Basculer le thème" aria-label="Basculer le thème"><i class="bi ${window.themeIcon()}"></i></button>`;

  // --- Favicon ---
  if (!document.querySelector('link[rel="icon"]')) {
    const fav = document.createElement('link');
    fav.rel = 'icon';
    fav.href = 'logo.png';
    document.head.appendChild(fav);
  }

  // --- Splash : une seule fois par session (plus une "ouverture" qu'un flash récurrent) ---
  try {
    if (sessionStorage.getItem('ohipa_splash_seen')) return;
    sessionStorage.setItem('ohipa_splash_seen', '1');
  } catch { /* sessionStorage indispo : on affiche quand même */ }

  const inject = () => {
    if (document.getElementById('ohipa-splash')) return;
    const splash = document.createElement('div');
    splash.id = 'ohipa-splash';
    splash.innerHTML = '<img src="logo.png" alt="Ohipa"><div class="splash-bar"></div>';
    document.body.prepend(splash);
    splash.addEventListener('animationend', (e) => {
      if (e.animationName === 'splash-out') {
        document.body.classList.add('splash-done');
        splash.remove();
      }
    });
  };

  if (document.body) inject();
  else document.addEventListener('DOMContentLoaded', inject);
})();
