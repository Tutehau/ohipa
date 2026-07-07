const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { isAuth } = require('../middleware/auth');

const router = express.Router();

// Jointure : chaque entrée est enrichie du nom d'utilisateur et d'entreprise.
const SELECT_BASE = `
  SELECT e.id, e.hours, e.description, e.date,
         e.user_id    AS userId,
         e.company_id AS companyId,
         u.username   AS username,
         c.name       AS companyName
  FROM time_entries e
  LEFT JOIN users u     ON u.id = e.user_id
  LEFT JOIN companies c ON c.id = e.company_id
`;

const selectAll = db.prepare(SELECT_BASE + ' ORDER BY e.date DESC');
const selectMine = db.prepare(SELECT_BASE + ' WHERE e.user_id = ? ORDER BY e.date DESC');

// L'admin voit toutes les entrées ; un utilisateur ne voit que les siennes.
router.get('/entries', isAuth, (req, res) => {
  const rows = req.session.role === 'admin'
    ? selectAll.all()
    : selectMine.all(req.session.userId);
  res.json(rows);
});

router.post('/entries', isAuth, (req, res) => {
  const { companyId, hours, description } = req.body;
  const h = parseFloat(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 24) {
    return res.status(400).json({ message: 'Nombre d\'heures invalide (entre 0 et 24)' });
  }
  const entry = {
    id: crypto.randomUUID(),
    user_id: req.session.userId,
    company_id: companyId || null,
    hours: h,
    description: (description || '').slice(0, 500),
    date: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO time_entries (id, user_id, company_id, hours, description, date)
              VALUES (@id, @user_id, @company_id, @hours, @description, @date)`).run(entry);
  res.json(entry);
});

// Récupère une entrée et vérifie que l'appelant a le droit d'agir dessus.
function ownedEntry(req, res) {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(req.params.id);
  if (!entry) { res.status(404).json({ message: 'Entrée introuvable' }); return null; }
  if (entry.user_id !== req.session.userId && req.session.role !== 'admin') {
    res.status(403).json({ message: 'Action non autorisée' }); return null;
  }
  return entry;
}

router.put('/entries/:id', isAuth, (req, res) => {
  const entry = ownedEntry(req, res);
  if (!entry) return;
  const { companyId, hours, description } = req.body;
  const h = parseFloat(hours);
  if (!Number.isFinite(h) || h <= 0 || h > 24) {
    return res.status(400).json({ message: "Nombre d'heures invalide (entre 0 et 24)" });
  }
  db.prepare(`UPDATE time_entries SET company_id = ?, hours = ?, description = ? WHERE id = ?`)
    .run(companyId || null, h, (description || '').slice(0, 500), entry.id);
  res.json({ message: 'Entrée mise à jour' });
});

router.delete('/entries/:id', isAuth, (req, res) => {
  const entry = ownedEntry(req, res);
  if (!entry) return;
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(entry.id);
  res.json({ message: 'Entrée supprimée' });
});

module.exports = router;
