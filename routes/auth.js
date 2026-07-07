const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../db');
const email = require('../lib/email');

const router = express.Router();

const findByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');

// Le front affiche l'assistant d'installation tant qu'aucun compte n'existe.
router.get('/admin-exists', (req, res) => {
  res.json({ exists: countUsers.get().n > 0 });
});

// Création du tout premier compte (super admin), protégée par une clé.
router.post('/setup-admin', async (req, res) => {
  const { username, password, setupKey } = req.body;
  if (!setupKey || setupKey !== process.env.SETUP_KEY) {
    return res.status(403).json({ message: "Clé d'installation invalide" });
  }
  if (countUsers.get().n > 0) {
    return res.status(403).json({ message: 'Système déjà initialisé' });
  }
  if (!username || !password) {
    return res.status(400).json({ message: 'Champs manquants' });
  }
  const hashed = await bcrypt.hash(password, 10);
  db.prepare(`INSERT INTO users (id, username, password, role, active, created_at)
              VALUES (?, ?, ?, 'admin', 1, ?)`)
    .run(crypto.randomUUID(), username, hashed, new Date().toISOString());
  res.json({ message: 'Super administrateur créé' });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const user = findByUsername.get(username);
  if (!user || !(await bcrypt.compare(password || '', user.password))) {
    return res.status(401).json({ message: 'Identifiants invalides' });
  }
  if (!user.active) {
    return res.status(403).json({ message: "Compte non activé. Vérifiez vos emails." });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  res.json({ username: user.username, role: user.role });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: 'Déconnecté' }));
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ loggedIn: false });
  res.json({ username: req.session.username, role: req.session.role, loggedIn: true });
});

// Inscription publique : crée un compte inactif + envoie le lien d'activation.
router.post('/register', async (req, res) => {
  const { username, email: userEmail, password } = req.body;
  if (!username || !userEmail || !password) {
    return res.status(400).json({ message: 'Champs manquants' });
  }
  if (findByUsername.get(username) || findByEmail.get(userEmail)) {
    return res.status(409).json({ message: 'Utilisateur ou email déjà pris' });
  }
  const hashed = await bcrypt.hash(password, 10);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO users
    (id, username, email, password, role, active, activation_token, created_at)
    VALUES (?, ?, ?, ?, 'user', 0, ?, ?)`)
    .run(crypto.randomUUID(), username, userEmail, hashed, token, new Date().toISOString());

  // Réponse immédiate ; l'email part en tâche de fond (ne bloque pas la requête).
  res.json({ message: 'Inscription réussie. Vérifiez vos emails pour activer le compte.' });
  email.sendActivationEmail(username, userEmail, token)
    .catch((e) => console.error("Erreur envoi email d'activation :", e.message));
});

// Activation via le token reçu par email.
router.get('/activate', (req, res) => {
  const { token } = req.query;
  const user = token && db.prepare('SELECT * FROM users WHERE activation_token = ?').get(token);
  if (!user) return res.status(400).json({ message: 'Token invalide ou déjà utilisé' });
  db.prepare('UPDATE users SET active = 1, activation_token = NULL WHERE id = ?').run(user.id);
  res.json({ message: 'Compte activé' });
});

// Demande de réinitialisation : réponse identique quoi qu'il arrive (anti-énumération).
router.post('/reset-password', async (req, res) => {
  const { email: userEmail } = req.body;
  const generic = { message: 'Si un compte existe, un email a été envoyé.' };
  const user = userEmail && findByEmail.get(userEmail);
  if (!user) return res.json(generic);

  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + 60 * 60 * 1000; // 1 heure
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?')
    .run(token, expires, user.id);
  res.json(generic);
  email.sendResetEmail(user.username, user.email, token)
    .catch((e) => console.error('Erreur envoi email de reset :', e.message));
});

// Application du nouveau mot de passe via token valide et non expiré.
router.post('/new-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ message: 'Champs manquants' });
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expires || user.reset_expires < Date.now()) {
    return res.status(400).json({ message: 'Lien invalide ou expiré' });
  }
  const hashed = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
    .run(hashed, user.id);
  res.json({ message: 'Mot de passe mis à jour' });
});

module.exports = router;
