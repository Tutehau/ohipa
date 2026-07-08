const express = require('express');
const db = require('../db');
const { isAuth } = require('../middleware/auth');

const router = express.Router();

// Le « réel » provient désormais du pointage (segments terminés), regroupé par
// jour local de travail. Fini les saisies manuelles.
const DAY = "COALESCE(p.work_date, substr(p.clock_in, 1, 10))";
const HOURS = "(julianday(p.clock_out) - julianday(p.clock_in)) * 24";

// Filtre paramétré ; portée forcée au propre utilisateur si non-admin.
function buildFilter(req) {
  const clauses = ['p.clock_out IS NOT NULL'];
  const params = {};
  if (req.session.role === 'admin') {
    if (req.query.userId) { clauses.push('p.user_id = @userId'); params.userId = req.query.userId; }
  } else {
    clauses.push('p.user_id = @userId');
    params.userId = req.session.userId;
  }
  if (req.query.companyId) { clauses.push('p.company_id = @companyId'); params.companyId = req.query.companyId; }
  if (req.query.from) { clauses.push(`${DAY} >= @from`); params.from = req.query.from; }
  if (req.query.to) { clauses.push(`${DAY} <= @to`); params.to = req.query.to; }
  return { where: 'WHERE ' + clauses.join(' AND '), params };
}

router.get('/reports', isAuth, (req, res) => {
  const { where, params } = buildFilter(req);

  const totals = db.prepare(`
    SELECT COALESCE(SUM(${HOURS}), 0) AS totalHours, COUNT(*) AS count
    FROM pointages p ${where}`).get(params);

  const byCompany = db.prepare(`
    SELECT COALESCE(c.name, 'Sans société') AS label, SUM(${HOURS}) AS hours
    FROM pointages p LEFT JOIN companies c ON c.id = p.company_id
    ${where} GROUP BY p.company_id ORDER BY hours DESC`).all(params);

  const byDay = db.prepare(`
    SELECT ${DAY} AS label, SUM(${HOURS}) AS hours
    FROM pointages p ${where} GROUP BY label ORDER BY label`).all(params);

  const byUser = req.session.role === 'admin' ? db.prepare(`
    SELECT COALESCE(u.username, 'Inconnu') AS label, SUM(${HOURS}) AS hours
    FROM pointages p LEFT JOIN users u ON u.id = p.user_id
    ${where} GROUP BY p.user_id ORDER BY hours DESC`).all(params) : null;

  // Arrondi de présentation
  const r = (n) => Math.round((n || 0) * 100) / 100;
  res.json({
    totalHours: r(totals.totalHours), count: totals.count,
    byCompany: byCompany.map((x) => ({ ...x, hours: r(x.hours) })),
    byDay: byDay.map((x) => ({ ...x, hours: r(x.hours) })),
    byUser: byUser && byUser.map((x) => ({ ...x, hours: r(x.hours) })),
  });
});

// Export CSV des pointages filtrés.
router.get('/reports/export.csv', isAuth, (req, res) => {
  const { where, params } = buildFilter(req);
  const rows = db.prepare(`
    SELECT ${DAY} AS day, u.username AS user, COALESCE(c.name, '') AS company,
           p.clock_in AS clockIn, p.clock_out AS clockOut, ${HOURS} AS hours
    FROM pointages p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN companies c ON c.id = p.company_id
    ${where} ORDER BY p.clock_in DESC`).all(params);

  // Neutralise l'injection de formule (=, +, -, @, TAB, CR) puis échappe le CSV.
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n;]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const t = (iso) => new Date(iso).toISOString().slice(11, 16);
  const header = ['Jour', 'Utilisateur', 'Société', 'Arrivée', 'Départ', 'Heures'];
  const lines = [header.join(';')];
  for (const r of rows) {
    lines.push([r.day, r.user, r.company, t(r.clockIn), t(r.clockOut), Math.round(r.hours * 100) / 100].map(esc).join(';'));
  }
  const csv = '﻿' + lines.join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ohipa-pointages.csv"');
  res.send(csv);
});

module.exports = router;
