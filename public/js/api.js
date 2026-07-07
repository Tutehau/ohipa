// Helper d'appel API commun à toutes les pages.
async function api(path, method = 'GET', body = null) {
  const options = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || 'Erreur serveur');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Échappe toute donnée utilisateur avant insertion dans le DOM (anti-XSS).
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Garde d'accès : redirige vers login si non connecté (ou non admin).
async function requireAuth({ adminOnly = false } = {}) {
  try {
    const me = await api('/api/me');
    if (adminOnly && me.role !== 'admin') {
      window.location.href = 'dashboard.html';
      return null;
    }
    return me;
  } catch {
    window.location.href = 'login.html';
    return null;
  }
}

async function logout() {
  try { await api('/api/logout', 'POST'); } catch {}
  window.location.href = 'login.html';
}

// Affiche un message d'alerte Bootstrap dans un conteneur #alert.
function showAlert(message, type = 'danger') {
  const box = document.getElementById('alert');
  if (!box) return;
  box.className = `alert alert-${type}`;
  box.textContent = message;
  box.classList.remove('d-none');
}
