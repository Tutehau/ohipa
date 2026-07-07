document.getElementById('register-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/register', 'POST', {
      username: document.getElementById('reg-user').value,
      email: document.getElementById('reg-email').value,
      password: document.getElementById('reg-pass').value,
    });
    showAlert('Inscription réussie. Vérifiez vos emails pour activer le compte.', 'success');
    document.getElementById('register-form').reset();
  } catch (err) {
    showAlert(err.message);
  }
};
