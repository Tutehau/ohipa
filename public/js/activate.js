const token = new URLSearchParams(window.location.search).get('token');
const msg = document.getElementById('activation-msg');
const icon = document.getElementById('activation-icon');

const setState = (text, iconClass, color) => {
  msg.textContent = text;
  icon.innerHTML = `<i class="bi ${iconClass} ${color}" style="font-size:2.5rem"></i>`;
};

(async () => {
  if (!token) return setState('Token manquant dans le lien.', 'bi-x-circle', 'text-danger');
  try {
    await api('/api/activate?token=' + encodeURIComponent(token));
    setState('Compte activé ! Vous pouvez vous connecter.', 'bi-check-circle', 'text-success');
  } catch (err) {
    setState(err.message || "Échec de l'activation.", 'bi-x-circle', 'text-danger');
  }
})();
