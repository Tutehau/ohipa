const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const qrcode = require('qrcode');
const db = require('../db');
const email = require('../lib/email');
const { isAuth, isAdmin } = require('../middleware/auth');
const { hashPin, hashToken } = require('./kiosk');

const router = express.Router();

// Durée d'un segment terminé (heures) et jour local de rattachement : mêmes
// règles que côté pointage, réutilisées pour tous les agrégats admin afin que
// l'admin calcule les heures exactement comme l'écran utilisateur.
const DURATION = "CASE WHEN clock_out IS NULL THEN 0 ELSE (julianday(clock_out) - julianday(clock_in)) * 24 END";
const DAY = "COALESCE(work_date, substr(clock_in, 1, 10))";
const round = (n) => Math.round((n || 0) * 100) / 100;
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Période demandée (défaut : 7 derniers jours), bornes en date locale YYYY-MM-DD.
function range(q) {
  const to = isYmd(q.to) ? q.to : new Date().toISOString().slice(0, 10);
  let from = isYmd(q.from) ? q.from : null;
  if (!from) { const d = new Date(to + 'T00:00:00'); d.setDate(d.getDate() - 6); from = d.toISOString().slice(0, 10); }
  return { from, to };
}

// Heures travaillées (réel) + prévu (planning) + écart, par utilisateur actif,
// sur une période. Source unique partagée par /admin/hours et /admin/anomalies.
function perUserHours({ from, to, companyId }) {
  const p = { from, to };
  const cc = companyId ? 'AND p.company_id = @companyId' : '';
  const ccPlan = companyId ? 'AND company_id = @companyId' : '';
  if (companyId) p.companyId = companyId;

  const worked = db.prepare(`
    SELECT u.id AS userId, u.username,
           COALESCE(SUM(${DURATION}), 0) AS worked,
           MAX(p.clock_in) AS lastActivity,
           SUM(CASE WHEN p.clock_out IS NULL THEN 1 ELSE 0 END) AS openNow
    FROM users u
    LEFT JOIN pointages p ON p.user_id = u.id AND ${DAY} BETWEEN @from AND @to ${cc}
    WHERE u.active = 1
    GROUP BY u.id ORDER BY u.username`).all(p);

  const plannedRows = db.prepare(`
    SELECT user_id AS userId,
      SUM(((CAST(substr(end_time,1,2) AS INTEGER)*60 + CAST(substr(end_time,4,2) AS INTEGER)
          - CAST(substr(start_time,1,2) AS INTEGER)*60 - CAST(substr(start_time,4,2) AS INTEGER)
          + 1440) % 1440) / 60.0) AS planned
    FROM plannings WHERE date BETWEEN @from AND @to ${ccPlan}
    GROUP BY user_id`).all(p);
  const planned = {};
  for (const r of plannedRows) planned[r.userId] = r.planned;

  return worked.map((w) => {
    const pl = round(planned[w.userId] || 0);
    return {
      userId: w.userId, username: w.username,
      worked: round(w.worked), planned: pl, ecart: round((w.worked || 0) - pl),
      lastActivity: w.lastActivity, present: w.openNow > 0,
    };
  });
}

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

// --- Tableau de bord admin : KPI sur les VRAIES données (pointages/plannings) ---
router.get('/admin/stats', isAuth, isAdmin, (req, res) => {
  const { from, to } = range(req.query);
  const p = { from, to };
  const cc = req.query.companyId ? 'AND p.company_id = @companyId' : '';
  if (req.query.companyId) p.companyId = req.query.companyId;

  const usersActive = db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;
  const companies = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n;
  const hours = round(db.prepare(`
    SELECT COALESCE(SUM(${DURATION}), 0) AS h FROM pointages p
    WHERE clock_out IS NOT NULL AND ${DAY} BETWEEN @from AND @to ${cc}`).get(p).h);
  const present = db.prepare(`SELECT COUNT(*) AS n FROM pointages p WHERE clock_out IS NULL ${cc}`).get(p).n;

  const oublis = db.prepare(`
    SELECT COUNT(*) AS n FROM pointages p
    WHERE end_reason = 'oubli' AND ${DAY} BETWEEN @from AND @to ${cc}`).get(p).n;
  const longOpen = db.prepare(`
    SELECT COUNT(*) AS n FROM pointages p
    WHERE clock_out IS NULL AND (julianday('now') - julianday(clock_in)) * 24 > 16 ${cc}`).get(p).n;

  res.json({ from, to, usersActive, companies, hours, present, anomalies: oublis + longOpen });
});

// Présence en direct : segments encore ouverts (clock_out IS NULL).
router.get('/admin/presence', isAuth, isAdmin, (req, res) => {
  const p = {};
  const cc = req.query.companyId ? 'AND p.company_id = @companyId' : '';
  if (req.query.companyId) p.companyId = req.query.companyId;
  res.json(db.prepare(`
    SELECT p.id, p.clock_in AS since, u.username, c.name AS companyName,
           (julianday('now') - julianday(p.clock_in)) * 24 AS hoursOpen
    FROM pointages p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN companies c ON c.id = p.company_id
    WHERE p.clock_out IS NULL ${cc}
    ORDER BY p.clock_in`).all(p));
});

// Heures par employé (réel/prévu/écart + présence + dernière activité) sur la période.
router.get('/admin/hours', isAuth, isAdmin, (req, res) => {
  const { from, to } = range(req.query);
  res.json({ from, to, rows: perUserHours({ from, to, companyId: req.query.companyId }) });
});

// Anomalies : oublis, pointages ouverts trop longtemps, absences (jour planifié
// sans pointage) et gros écarts prévu/réel.
router.get('/admin/anomalies', isAuth, isAdmin, (req, res) => {
  const { from, to } = range(req.query);
  const p = { from, to };
  const cc = req.query.companyId ? 'AND p.company_id = @companyId' : '';
  const ccPlan = req.query.companyId ? 'AND pl.company_id = @companyId' : '';
  if (req.query.companyId) p.companyId = req.query.companyId;

  const oublis = db.prepare(`
    SELECT ${DAY} AS day, p.clock_in AS clockIn, u.username
    FROM pointages p LEFT JOIN users u ON u.id = p.user_id
    WHERE p.end_reason = 'oubli' AND ${DAY} BETWEEN @from AND @to ${cc}
    ORDER BY day DESC LIMIT 50`).all(p);

  const longOpen = db.prepare(`
    SELECT p.clock_in AS since, u.username, c.name AS companyName,
           (julianday('now') - julianday(p.clock_in)) * 24 AS hoursOpen
    FROM pointages p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN companies c ON c.id = p.company_id
    WHERE p.clock_out IS NULL AND (julianday('now') - julianday(p.clock_in)) * 24 > 16 ${cc}
    ORDER BY since`).all(p);

  const absences = db.prepare(`
    SELECT pl.date AS day, u.username
    FROM plannings pl JOIN users u ON u.id = pl.user_id
    WHERE pl.date BETWEEN @from AND @to AND pl.date <= date('now') ${ccPlan}
      AND NOT EXISTS (
        SELECT 1 FROM pointages p
        WHERE p.user_id = pl.user_id AND ${DAY} = pl.date ${cc})
    GROUP BY pl.user_id, pl.date
    ORDER BY day DESC LIMIT 50`).all(p);

  const bigGaps = perUserHours({ from, to, companyId: req.query.companyId })
    .filter((r) => Math.abs(r.ecart) >= 3)
    .map((r) => ({ username: r.username, worked: r.worked, planned: r.planned, ecart: r.ecart }));

  res.json({ from, to, oublis, longOpen, absences, bigGaps });
});

// Stats par entreprise (nb d'employés distincts + heures) sur la période.
router.get('/admin/companies-stats', isAuth, isAdmin, (req, res) => {
  const { from, to } = range(req.query);
  res.json(db.prepare(`
    SELECT c.id, c.name,
      (SELECT COUNT(DISTINCT p.user_id) FROM pointages p
         WHERE p.company_id = c.id AND ${DAY} BETWEEN @from AND @to) AS employees,
      (SELECT COALESCE(SUM(${DURATION}), 0) FROM pointages p
         WHERE p.company_id = c.id AND clock_out IS NOT NULL AND ${DAY} BETWEEN @from AND @to) AS hours
    FROM companies c ORDER BY c.name`).all({ from, to })
    .map((r) => ({ ...r, hours: round(r.hours) })));
});

// Export CSV des pointages sur la période (séparateur ';' + BOM : ouvre direct dans Excel FR).
router.get('/admin/export.csv', isAuth, isAdmin, (req, res) => {
  const { from, to } = range(req.query);
  const p = { from, to };
  const cc = req.query.companyId ? 'AND p.company_id = @companyId' : '';
  if (req.query.companyId) p.companyId = req.query.companyId;
  const rows = db.prepare(`
    SELECT ${DAY} AS day, u.username, c.name AS companyName,
           p.clock_in AS clockIn, p.clock_out AS clockOut, p.end_reason AS reason,
           ${DURATION} AS hours
    FROM pointages p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN companies c ON c.id = p.company_id
    WHERE ${DAY} BETWEEN @from AND @to ${cc}
    ORDER BY day, u.username`).all(p);

  const esc = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const hhmm = (iso) => (iso || '').substr(11, 5); // portion HH:MM de l'ISO
  const header = ['Date', 'Employé', 'Société', 'Arrivée', 'Départ', 'Heures', 'Fin'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([
      r.day, r.username || '', r.companyName || '', hhmm(r.clockIn), hhmm(r.clockOut),
      round(r.hours).toString().replace('.', ','), r.reason || '',
    ].map(esc).join(';'));
  }
  const csv = '﻿' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="heures_${from}_${to}.csv"`);
  res.send(csv);
});

// Réinitialise le mot de passe d'un utilisateur : génère un mot de passe
// aléatoire, le renvoie une seule fois (à transmettre à l'employé).
router.post('/admin/users/:id/reset-password', isAuth, isAdmin, async (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ message: 'Utilisateur introuvable' });
  const pwd = crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  const hashed = await bcrypt.hash(pwd, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, user.id);
  res.json({ password: pwd });
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

  // Génère un PIN à 8 chiffres unique (10^8 => brute-force impraticable).
  for (let i = 0; i < 20; i++) {
    const pin = String(crypto.randomInt(0, 100000000)).padStart(8, '0');
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

  // URL d'ouverture + QR. Le jeton est mis dans le FRAGMENT (#token=) : un
  // fragment n'est jamais envoyé au serveur (absent des logs) ni dans le Referer.
  const base = process.env.BASE_URL || '';
  const url = `${base}/kiosk.html#token=${token}`;
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
