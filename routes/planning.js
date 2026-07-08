const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { isAuth } = require('../middleware/auth');

const router = express.Router();

// Convertit "HH:MM" en minutes ; renvoie null si invalide.
function toMinutes(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Durée en heures, gère le passage de minuit (fin < début => +24h).
const SELECT = `
  SELECT p.id, p.date, p.start_time AS startTime, p.end_time AS endTime, p.note,
         p.user_id AS userId, p.company_id AS companyId,
         u.username AS username, c.name AS companyName,
         (((CAST(substr(p.end_time,1,2) AS INTEGER)*60 + CAST(substr(p.end_time,4,2) AS INTEGER)
          - CAST(substr(p.start_time,1,2) AS INTEGER)*60 - CAST(substr(p.start_time,4,2) AS INTEGER)) + 1440) % 1440) / 60.0 AS hours
  FROM plannings p
  LEFT JOIN users u ON u.id = p.user_id
  LEFT JOIN companies c ON c.id = p.company_id
`;

const companyExists = (id) => !id || !!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(id);

// Liste : ses propres créneaux (ou tous si admin), filtrable par période.
router.get('/plannings', isAuth, (req, res) => {
  const clauses = [];
  const params = {};
  if (req.session.role !== 'admin') { clauses.push('p.user_id = @uid'); params.uid = req.session.userId; }
  else if (req.query.userId) { clauses.push('p.user_id = @uid'); params.uid = req.query.userId; }
  if (req.query.from) { clauses.push('p.date >= @from'); params.from = req.query.from; }
  if (req.query.to) { clauses.push('p.date <= @to'); params.to = req.query.to; }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  res.json(db.prepare(`${SELECT} ${where} ORDER BY p.date DESC, p.start_time`).all(params));
});

router.post('/plannings', isAuth, (req, res) => {
  const { companyId, date, startTime, endTime, note } = req.body;
  const s = toMinutes(startTime), e = toMinutes(endTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ message: 'Date invalide' });
  if (s === null || e === null) return res.status(400).json({ message: 'Horaires invalides (HH:MM)' });
  if (e === s) return res.status(400).json({ message: 'La fin doit différer du début' });
  if (!companyExists(companyId)) return res.status(400).json({ message: 'Société inconnue' });

  const row = {
    id: crypto.randomUUID(), user_id: req.session.userId, company_id: companyId || null,
    date, start_time: startTime, end_time: endTime,
    note: (note || '').slice(0, 300), created_at: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO plannings (id, user_id, company_id, date, start_time, end_time, note, created_at)
              VALUES (@id, @user_id, @company_id, @date, @start_time, @end_time, @note, @created_at)`).run(row);
  res.json({ id: row.id });
});

// Vérifie la propriété (créateur ou admin).
function owned(req, res) {
  const p = db.prepare('SELECT * FROM plannings WHERE id = ?').get(req.params.id);
  if (!p) { res.status(404).json({ message: 'Créneau introuvable' }); return null; }
  if (p.user_id !== req.session.userId && req.session.role !== 'admin') {
    res.status(403).json({ message: 'Action non autorisée' }); return null;
  }
  return p;
}

router.put('/plannings/:id', isAuth, (req, res) => {
  if (!owned(req, res)) return;
  const { companyId, date, startTime, endTime, note } = req.body;
  const s = toMinutes(startTime), e = toMinutes(endTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ message: 'Date invalide' });
  if (s === null || e === null || e === s) return res.status(400).json({ message: 'Horaires invalides' });
  if (!companyExists(companyId)) return res.status(400).json({ message: 'Société inconnue' });
  db.prepare(`UPDATE plannings SET company_id=?, date=?, start_time=?, end_time=?, note=? WHERE id=?`)
    .run(companyId || null, date, startTime, endTime, (note || '').slice(0, 300), req.params.id);
  res.json({ message: 'Créneau mis à jour' });
});

router.delete('/plannings/:id', isAuth, (req, res) => {
  if (!owned(req, res)) return;
  db.prepare('DELETE FROM plannings WHERE id = ?').run(req.params.id);
  res.json({ message: 'Créneau supprimé' });
});

module.exports = router;
