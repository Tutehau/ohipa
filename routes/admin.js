const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const qrcode = require('qrcode');
const db = require('../db');
const email = require('../lib/email');
const { isAuth, isAdmin } = require('../middleware/auth');
const { hashPin, hashToken } = require('./kiosk');

const router = express.Router();

// --- Entreprises -----------------------------------------------------------
// Lecture accessible à tout utilisateur connecté (pour le menu déroulant de saisie).
router.get('/companies', isAuth, (req, res) => {
  res.json(db.prepare('SELECT id, name FROM companies ORDER BY name').all());
});

// Création de société ouverte à tout utilisateur connecté (self-service).
router.post('/companies', isAuth, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Nom requis' });
  const company = {
    id: crypto.randomUUID(), name,
    created_by: req.session.userId, created_at: new Date().toISOString(),
  };
  db.prepare('INSERT INTO companies (id, name, created_by, created_at) VALUES (@id, @name, @created_by, @created_at)').run(company);
  res.json({ id: company.id, name: company.name });
});

// Renommage/suppression : autorisé au créateur de la société ou à un admin.
function canManageCompany(req, res) {
  const c = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!c) { res.status(404).json({ message: 'Entreprise introuvable' }); return null; }
  if (req.session.role !== 'admin' && c.created_by !== req.session.userId) {
    res.status(403).json({ message: 'Action réservée au créateur' }); return null;
  }
  return c;
}

// --- Utilisateurs (admin) --------------------------------------------------
router.get('/admin/users', isAuth, isAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, email, role, active, (pin_hash IS NOT NULL) AS hasPin FROM users ORDER BY username').all());
});

// L'admin crée directement un utilisateur actif et lui envoie ses identifiants.
router.post('/admin/invite', isAuth, isAdmin, async (req, res) => {
  const { username, email: userEmail, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Nom et mot de passe requis' });
  }
  const exists = db.prepare('SELECT 1 FROM users WHERE username = ? OR email = ?').get(username, userEmail || '');
  if (exists) return res.status(409).json({ message: 'Utilisateur ou email déjà pris' });

  const hashed = await bcrypt.hash(password, 10);
  db.prepare(`INSERT INTO users (id, username, email, password, role, active, created_at)
              VALUES (?, ?, ?, ?, 'user', 1, ?)`)
    .run(crypto.randomUUID(), username, userEmail || null, hashed, new Date().toISOString());

  // Réponse immédiate ; l'email d'invitation part en tâche de fond.
  res.json({ message: 'Utilisateur créé' + (userEmail ? ", email d'invitation en cours d'envoi" : '') });
  if (userEmail) {
    email.sendInviteEmail(username, userEmail, password)
      .catch((e) => console.error('Erreur envoi email invitation :', e.message));
  }
});

// --- Statistiques du tableau de bord admin ---------------------------------
router.get('/admin/stats', isAuth, isAdmin, (req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const companies = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n;
  const hours = db.prepare('SELECT COALESCE(SUM(hours), 0) AS h FROM time_entries').get().h;
  const recent = db.prepare(`
    SELECT e.date, e.hours, u.username, c.name AS companyName
    FROM time_entries e
    LEFT JOIN users u     ON u.id = e.user_id
    LEFT JOIN companies c ON c.id = e.company_id
    ORDER BY e.date DESC LIMIT 10
  `).all();
  res.json({ users, companies, hours, recent });
});

// --- Modification / suppression d'entreprise -------------------------------
router.put('/companies/:id', isAuth, (req, res) => {
  if (!canManageCompany(req, res)) return;
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ message: 'Nom requis' });
  db.prepare('UPDATE companies SET name = ? WHERE id = ?').run(name, req.params.id);
  res.json({ message: 'Entreprise renommée' });
});

router.delete('/companies/:id', isAuth, (req, res) => {
  if (!canManageCompany(req, res)) return;
  // Refuse la suppression si la société est encore utilisée (par n'importe quel
  // utilisateur), pour ne pas casser silencieusement les données d'autrui.
  const used = db.prepare('SELECT COUNT(*) AS n FROM plannings WHERE company_id = ?').get(req.params.id).n
    + db.prepare('SELECT COUNT(*) AS n FROM pointages WHERE company_id = ?').get(req.params.id).n;
  if (used > 0) {
    return res.status(400).json({ message: `Impossible : société utilisée par ${used} créneau(x)/pointage(s).` });
  }
  db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);
  res.json({ message: 'Entreprise supprimée' });
});

// --- Gestion des utilisateurs ---------------------------------------------
const countAdmins = () =>
  db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n;

router.patch('/admin/users/:id/role', isAuth, isAdmin, (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Rôle invalide' });
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ message: 'Vous ne pouvez pas changer votre propre rôle' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  if (user.role === 'admin' && role === 'user' && countAdmins() <= 1) {
    return res.status(400).json({ message: 'Impossible : dernier administrateur' });
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, user.id);
  res.json({ message: 'Rôle mis à jour' });
});

router.patch('/admin/users/:id/active', isAuth, isAdmin, (req, res) => {
  const active = req.body.active ? 1 : 0;
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ message: 'Vous ne pouvez pas vous désactiver vous-même' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  if (user.role === 'admin' && !active && countAdmins() <= 1) {
    return res.status(400).json({ message: 'Impossible : dernier administrateur' });
  }
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, user.id);
  res.json({ message: active ? 'Utilisateur activé' : 'Utilisateur désactivé' });
});

router.delete('/admin/users/:id', isAuth, isAdmin, (req, res) => {
  if (req.params.id === req.session.userId) {
    return res.status(400).json({ message: 'Vous ne pouvez pas vous supprimer vous-même' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  if (user.role === 'admin' && countAdmins() <= 1) {
    return res.status(400).json({ message: 'Impossible : dernier administrateur' });
  }
  // Les entrées de l'utilisateur sont supprimées en cascade (cf. FK).
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  res.json({ message: 'Utilisateur supprimé' });
});

// --- PIN de badgeuse par utilisateur --------------------------------------
router.post('/admin/users/:id/pin', isAuth, isAdmin, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });

  // Génère un PIN à 6 chiffres unique (quelques essais en cas de collision).
  for (let i = 0; i < 20; i++) {
    const pin = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const taken = db.prepare('SELECT 1 FROM users WHERE pin_hash = ?').get(hashPin(pin));
    if (taken) continue;
    db.prepare('UPDATE users SET pin_hash = ? WHERE id = ?').run(hashPin(pin), user.id);
    return res.json({ pin });
  }
  res.status(500).json({ message: 'Impossible de générer un PIN unique, réessayez' });
});

router.delete('/admin/users/:id/pin', isAuth, isAdmin, (req, res) => {
  db.prepare('UPDATE users SET pin_hash = NULL WHERE id = ?').run(req.params.id);
  res.json({ message: 'PIN supprimé' });
});

// --- Kiosques (appareils badgeuse) ----------------------------------------
router.get('/admin/kiosks', isAuth, isAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, label, created_at, last_used FROM kiosks ORDER BY created_at DESC').all());
});

router.post('/admin/kiosks', isAuth, isAdmin, async (req, res) => {
  const label = (req.body.label || '').trim();
  if (!label) return res.status(400).json({ message: 'Nom du kiosque requis' });
  const token = crypto.randomBytes(24).toString('hex');
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO kiosks (id, label, token_hash, created_by, created_at)
              VALUES (?, ?, ?, ?, ?)`).run(id, label, hashToken(token), req.session.userId, new Date().toISOString());

  // URL d'ouverture du kiosque + QR (généré ici car le jeton n'est connu qu'ici).
  const base = process.env.BASE_URL || '';
  const url = `${base}/kiosk.html?token=${token}`;
  let qr = null;
  try { qr = await qrcode.toString(url, { type: 'svg', margin: 1 }); } catch { /* QR optionnel */ }
  // Jeton et URL montrés une seule fois.
  res.json({ id, label, token, url, qr });
});

router.delete('/admin/kiosks/:id', isAuth, isAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM kiosks WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ message: 'Kiosque introuvable' });
  res.json({ message: 'Kiosque révoqué' });
});

module.exports = router;
