const express = require('express');
const db = require('../db');
const { isAuth } = require('../middleware/auth');

const router = express.Router();

// Construit la clause WHERE paramétrée à partir des filtres de la requête.
// Les non-admins sont contraints à leurs propres données (portée forcée serveur).
function buildFilter(req) {
  const clauses = [];
  const params = {};

  if (req.session.role === 'admin') {
    if (req.query.userId) { clauses.push('e.user_id = @userId'); params.userId = req.query.userId; }
  } else {
    clauses.push('e.user_id = @userId');
    params.userId = req.session.userId;
  }
  if (req.query.companyId) { clauses.push('e.company_id = @companyId'); params.companyId = req.query.companyId; }
  if (req.query.from) { clauses.push('substr(e.date, 1, 10) >= @from'); params.from = req.query.from; }
  if (req.query.to) { clauses.push('substr(e.date, 1, 10) <= @to'); params.to = req.query.to; }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return { where, params };
}

router.get('/reports', isAuth, (req, res) => {
  const { where, params } = buildFilter(req);

  const totals = db.prepare(`
    SELECT COALESCE(SUM(e.hours), 0) AS totalHours, COUNT(*) AS count
    FROM time_entries e ${where}`).get(params);

  const byCompany = db.prepare(`
    SELECT COALESCE(c.name, 'Sans entreprise') AS label, SUM(e.hours) AS hours
    FROM time_entries e LEFT JOIN companies c ON c.id = e.company_id
    ${where} GROUP BY e.company_id ORDER BY hours DESC`).all(params);

  const byDay = db.prepare(`
    SELECT substr(e.date, 1, 10) AS label, SUM(e.hours) AS hours
    FROM time_entries e ${where} GROUP BY label ORDER BY label`).all(params);

  const byUser = req.session.role === 'admin' ? db.prepare(`
    SELECT COALESCE(u.username, 'Inconnu') AS label, SUM(e.hours) AS hours
    FROM time_entries e LEFT JOIN users u ON u.id = e.user_id
    ${where} GROUP BY e.user_id ORDER BY hours DESC`).all(params) : null;

  res.json({ ...totals, byCompany, byDay, byUser });
});

// Export CSV des entrées filtrées.
router.get('/reports/export.csv', isAuth, (req, res) => {
  const { where, params } = buildFilter(req);
  const rows = db.prepare(`
    SELECT substr(e.date, 1, 10) AS date, u.username AS user,
           COALESCE(c.name, '') AS company, e.hours, e.description
    FROM time_entries e
    LEFT JOIN users u ON u.id = e.user_id
    LEFT JOIN companies c ON c.id = e.company_id
    ${where} ORDER BY e.date DESC`).all(params);

  // Échappement CSV : guillemets doublés, champ encadré si nécessaire.
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const header = ['Date', 'Utilisateur', 'Entreprise', 'Heures', 'Description'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([r.date, r.user, r.company, r.hours, r.description].map(esc).join(';'));
  }
  const csv = '﻿' + lines.join('\r\n'); // BOM pour Excel

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ohipa-rapport.csv"');
  res.send(csv);
});

module.exports = router;
