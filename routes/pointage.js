const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { isAuth } = require('../middleware/auth');

const router = express.Router();

// Durée d'un segment terminé, en heures (0 si en cours).
const DURATION = "CASE WHEN clock_out IS NULL THEN 0 ELSE (julianday(clock_out) - julianday(clock_in)) * 24 END";
// Jour de rattachement : date locale de travail (retombe sur la date UTC pour les anciens enregistrements).
const DAY = "COALESCE(work_date, substr(clock_in, 1, 10))";

const openSegment = db.prepare('SELECT * FROM pointages WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1');
const lastSegment = db.prepare('SELECT * FROM pointages WHERE user_id = ? ORDER BY clock_in DESC LIMIT 1');
const companyExists = (id) => !id || !!db.prepare('SELECT 1 FROM companies WHERE id = ?').get(id);

// Date locale envoyée par le client (fuseau de l'utilisateur) ; sinon date UTC.
function resolveWorkDate(body) {
  const d = body && body.date;
  return /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : new Date().toISOString().slice(0, 10);
}

// Statut courant : working (en poste) | on_break (en pause) | off (hors service).
router.get('/pointages/status', isAuth, (req, res) => {
  const open = openSegment.get(req.session.userId);
  if (open) {
    return res.json({ state: 'working', clockedIn: true, since: open.clock_in, companyId: open.company_id, id: open.id });
  }
  const last = lastSegment.get(req.session.userId);
  if (last && last.end_reason === 'pause') {
    return res.json({ state: 'on_break', clockedIn: false, since: last.clock_out, companyId: last.company_id });
  }
  res.json({ state: 'off', clockedIn: false });
});

// Pointer l'arrivée (ou reprise) : ouvre un segment daté du jour local.
router.post('/pointages/clock-in', isAuth, (req, res) => {
  const workDate = resolveWorkDate(req.body);
  const open = openSegment.get(req.session.userId);
  if (open) {
    if (open.work_date === workDate || (!open.work_date && open.clock_in.slice(0, 10) === workDate)) {
      return res.status(400).json({ message: 'Un pointage est déjà en cours' });
    }
    // Segment oublié d'un autre jour : on le clôture sans inventer d'heures.
    db.prepare("UPDATE pointages SET clock_out = clock_in, end_reason = 'oubli' WHERE id = ?").run(open.id);
  }
  if (!companyExists(req.body.companyId)) {
    return res.status(400).json({ message: 'Société inconnue' });
  }
  const row = {
    id: crypto.randomUUID(), user_id: req.session.userId,
    company_id: req.body.companyId || null, work_date: workDate,
    clock_in: new Date().toISOString(), created_at: new Date().toISOString(),
  };
  db.prepare(`INSERT INTO pointages (id, user_id, company_id, work_date, clock_in, created_at)
              VALUES (@id, @user_id, @company_id, @work_date, @clock_in, @created_at)`).run(row);
  res.json({ id: row.id, since: row.clock_in });
});

// Prendre une pause : ferme le segment en cours (raison = pause).
router.post('/pointages/pause', isAuth, (req, res) => {
  const open = openSegment.get(req.session.userId);
  if (!open) return res.status(400).json({ message: 'Aucun pointage en cours' });
  db.prepare("UPDATE pointages SET clock_out = ?, end_reason = 'pause' WHERE id = ?").run(new Date().toISOString(), open.id);
  res.json({ message: 'Pause enregistrée' });
});

// Pointer le départ : ferme le segment ouvert (raison = départ).
router.post('/pointages/clock-out', isAuth, (req, res) => {
  const open = openSegment.get(req.session.userId);
  if (!open) return res.status(400).json({ message: 'Aucun pointage en cours' });
  db.prepare("UPDATE pointages SET clock_out = ?, end_reason = 'depart' WHERE id = ?").run(new Date().toISOString(), open.id);
  res.json({ message: 'Départ enregistré' });
});

// Historique des pointages (les siens ; tous si admin), filtrable par jour local.
router.get('/pointages', isAuth, (req, res) => {
  const clauses = [];
  const params = {};
  if (req.session.role !== 'admin') { clauses.push('p.user_id = @uid'); params.uid = req.session.userId; }
  else if (req.query.userId) { clauses.push('p.user_id = @uid'); params.uid = req.query.userId; }
  if (req.query.from) { clauses.push(`${DAY} >= @from`); params.from = req.query.from; }
  if (req.query.to) { clauses.push(`${DAY} <= @to`); params.to = req.query.to; }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  res.json(db.prepare(`
    SELECT p.id, p.clock_in AS clockIn, p.clock_out AS clockOut, p.end_reason AS endReason,
           ${DAY} AS workDate,
           p.user_id AS userId, p.company_id AS companyId,
           u.username AS username, c.name AS companyName,
           ${DURATION} AS hours
    FROM pointages p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN companies c ON c.id = p.company_id
    ${where} ORDER BY p.clock_in DESC`).all(params));
});

// Valide un couple arrivée/départ (ISO) : présents, ordonnés, même journée raisonnable.
function validSegment(clockIn, clockOut) {
  const a = Date.parse(clockIn), b = Date.parse(clockOut);
  if (isNaN(a) || isNaN(b)) return 'Horaires invalides';
  if (b <= a) return 'Le départ doit être après l\'arrivée';
  if (b - a > 24 * 3600 * 1000) return 'Segment trop long (> 24h)';
  return null;
}

// Ajout MANUEL d'un pointage terminé (rattraper un jour oublié).
router.post('/pointages/manual', isAuth, (req, res) => {
  const { companyId, date, clockIn, clockOut } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ message: 'Date invalide' });
  const err = validSegment(clockIn, clockOut);
  if (err) return res.status(400).json({ message: err });
  if (!companyExists(companyId)) return res.status(400).json({ message: 'Société inconnue' });
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO pointages (id, user_id, company_id, work_date, clock_in, clock_out, end_reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 'depart', ?)`)
    .run(id, req.session.userId, companyId || null, date, clockIn, clockOut, new Date().toISOString());
  res.json({ id });
});

// Édition (correction) d'un pointage : arrivée / départ / société / jour.
router.put('/pointages/:id', isAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM pointages WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ message: 'Pointage introuvable' });
  if (p.user_id !== req.session.userId && req.session.role !== 'admin') {
    return res.status(403).json({ message: 'Action non autorisée' });
  }
  const { companyId, date, clockIn, clockOut } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ message: 'Date invalide' });
  const err = validSegment(clockIn, clockOut);
  if (err) return res.status(400).json({ message: err });
  if (!companyExists(companyId)) return res.status(400).json({ message: 'Société inconnue' });
  // Un segment édité est considéré terminé ; on conserve la raison de fin si présente.
  db.prepare(`UPDATE pointages SET company_id = ?, work_date = ?, clock_in = ?, clock_out = ?,
              end_reason = COALESCE(end_reason, 'depart') WHERE id = ?`)
    .run(companyId || null, date, clockIn, clockOut, req.params.id);
  res.json({ message: 'Pointage mis à jour' });
});

router.delete('/pointages/:id', isAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM pointages WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ message: 'Pointage introuvable' });
  if (p.user_id !== req.session.userId && req.session.role !== 'admin') {
    return res.status(403).json({ message: 'Action non autorisée' });
  }
  db.prepare('DELETE FROM pointages WHERE id = ?').run(req.params.id);
  res.json({ message: 'Pointage supprimé' });
});

// --- Réconciliation prévu (planning) vs réel (pointage), par jour local -----
router.get('/reconciliation', isAuth, (req, res) => {
  const uid = req.session.role === 'admin' && req.query.userId ? req.query.userId : req.session.userId;
  const p = { uid };
  if (req.query.from) p.from = req.query.from;
  if (req.query.to) p.to = req.query.to;
  // Filtre par entreprise : tout est alors calculé pour cette entreprise SEULE
  // (aucun mélange entre entreprises dans les totaux / prévu / réel).
  if (req.query.companyId) p.companyId = req.query.companyId;
  const compClause = req.query.companyId ? 'AND company_id = @companyId' : '';

  const planned = db.prepare(`
    SELECT date AS day,
      SUM((CAST(substr(end_time,1,2) AS INTEGER)*60 + CAST(substr(end_time,4,2) AS INTEGER)
         - CAST(substr(start_time,1,2) AS INTEGER)*60 - CAST(substr(start_time,4,2) AS INTEGER)
         + 1440) % 1440 / 60.0) AS planned
    FROM plannings
    WHERE user_id = @uid ${compClause}
      ${req.query.from ? 'AND date >= @from' : ''}
      ${req.query.to ? 'AND date <= @to' : ''}
    GROUP BY date`).all(p);

  // « Réel » = temps de PRÉSENCE (travail + pauses). Le planning inclut la
  // pause : celle-ci compte comme présence et ne crée donc pas d'écart négatif.
  const segs = db.prepare(`
    SELECT ${DAY} AS day, clock_in AS ci, clock_out AS co, end_reason AS reason
    FROM pointages
    WHERE user_id = @uid AND clock_out IS NOT NULL ${compClause}
      ${req.query.from ? `AND ${DAY} >= @from` : ''}
      ${req.query.to ? `AND ${DAY} <= @to` : ''}
    ORDER BY clock_in`).all(p);
  const daySegs = {};
  for (const s of segs) (daySegs[s.day] ||= []).push(s);
  const real = Object.entries(daySegs).map(([day, arr]) => {
    let h = 0;
    for (let i = 0; i < arr.length; i++) {
      h += (new Date(arr[i].co) - new Date(arr[i].ci)) / 3600000;                                  // travail
      if (arr[i].reason === 'pause' && arr[i + 1]) h += (new Date(arr[i + 1].ci) - new Date(arr[i].co)) / 3600000; // pause = présence
    }
    return { day, real: h };
  });

  const byDay = {};
  const round = (n) => Math.round((n || 0) * 100) / 100;
  for (const r of planned) byDay[r.day] = { day: r.day, planned: round(r.planned), real: 0 };
  for (const r of real) (byDay[r.day] ||= { day: r.day, planned: 0, real: 0 }).real = round(r.real);
  const days = Object.values(byDay)
    .map((d) => ({ ...d, ecart: round(d.real - d.planned) }))
    .sort((a, b) => (a.day < b.day ? 1 : -1));

  const totals = days.reduce((t, d) => ({
    planned: round(t.planned + d.planned), real: round(t.real + d.real), ecart: round(t.ecart + d.ecart),
  }), { planned: 0, real: 0, ecart: 0 });

  res.json({ days, totals });
});

module.exports = router;
