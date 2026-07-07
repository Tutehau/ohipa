const token = new URLSearchParams(window.location.search).get('token');

if (!token) {
  showAlert('Lien invalide : token manquant.');
  document.getElementById('reset-form').classList.add('d-none');
}

document.getElementById('reset-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/new-password', 'POST', {
      token,
      password: document.getElementById('new-pass').value,
    });
    showAlert('Mot de passe mis à jour. Vous pouvez vous connecter.', 'success');
    document.getElementById('reset-form').classList.add('d-none');
  } catch (err) {
    showAlert(err.message);
  }
};
