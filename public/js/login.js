// Installation : si aucun administrateur n'existe, on redirige vers la
// page dédiée de création du super-administrateur.
(async () => {
  try {
    const { exists } = await api('/api/admin-exists');
    if (!exists) window.location.replace('setup.html');
  } catch { /* API indisponible : on laisse le formulaire de connexion */ }
})();

document.getElementById('login-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/login', 'POST', {
      username: document.getElementById('login-user').value,
      password: document.getElementById('login-pass').value,
    });
    window.location.href = 'dashboard.html';
  } catch (err) {
    showAlert(err.message);
  }
};
