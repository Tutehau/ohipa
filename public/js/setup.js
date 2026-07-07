// Page d'installation : si un admin existe déjà, on n'a rien à faire ici.
(async () => {
  try {
    const { exists } = await api('/api/admin-exists');
    if (exists) window.location.replace('login.html');
  } catch { /* en cas d'erreur, on laisse le formulaire accessible */ }
})();

document.getElementById('setup-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/setup-admin', 'POST', {
      username: document.getElementById('setup-user').value,
      password: document.getElementById('setup-pass').value,
      setupKey: document.getElementById('setup-key').value,
    });
    showAlert('Super-administrateur créé. Redirection vers la connexion...', 'success');
    setTimeout(() => window.location.replace('login.html'), 1200);
  } catch (err) {
    showAlert(err.message);
  }
};
