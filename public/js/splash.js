// Animation d'ouverture Ohipa : logo lumineux puis fondu. Injecté sur chaque
// page pour rester DRY. Pose aussi le favicon.
(function () {
  // Favicon (une seule fois)
  if (!document.querySelector('link[rel="icon"]')) {
    const fav = document.createElement('link');
    fav.rel = 'icon';
    fav.href = 'logo.png';
    document.head.appendChild(fav);
  }

  // On ne rejoue pas le splash lors des navigations internes rapprochées
  // (il reste une expérience d'« ouverture », pas un flash à chaque clic).
  try {
    const last = parseFloat(sessionStorage.getItem('ohipa_splash') || '0');
    const now = Number(performance.now()) + performance.timeOrigin;
    if (now - last < 60000) return;                 // < 1 min => on saute
    sessionStorage.setItem('ohipa_splash', String(now));
  } catch { /* sessionStorage indispo : on affiche quand même */ }

  const inject = () => {
    if (document.getElementById('ohipa-splash')) return;
    const splash = document.createElement('div');
    splash.id = 'ohipa-splash';
    splash.innerHTML =
      '<img src="logo.png" alt="Ohipa">' +
      '<div class="splash-bar"></div>';
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
