document.getElementById('forgot-form').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const { message } = await api('/api/reset-password', 'POST', {
      email: document.getElementById('forgot-email').value,
    });
    showAlert(message, 'success');
    document.getElementById('forgot-form').reset();
  } catch (err) {
    showAlert(err.message);
  }
};
