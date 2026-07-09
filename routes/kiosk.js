const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const router = express.Router();

// PIN haché avec un pepper serveur (jamais en clair en base) ; jeton d'appareil
// haché simplement (haute entropie).
const hashPin = (pin) => crypto.createHash('sha256').update(pin + ':' + process.env.SESSION_SECRET).digest('hex');
const hashToken = (tok) => crypto.createHash('sha256').update(String(tok)).digest('hex');

// Authentifie l'appareil kiosque via l'en-tête X-Kiosk-Token.
function requireKiosk(req, res, next) {
  const token = req.get('X-Kiosk-Token') || '';
  const kiosk = token && db.prepare('SELECT * FROM kiosks WHERE token_hash = ?').get(hashToken(token));
  if (!kiosk) return res.status(401).json({ message: 'Kiosque non autorisé' });
  db.prepare('UPDATE kiosks SET last_used = ? WHERE id = ?').run(new Date().toISOString(), kiosk.id);
  req.kiosk = kiosk;
  next();
}

// Vérifie que le jeton d'appareil est valide (écran de configuration).
router.get('/kiosk/ping', requireKiosk, (req, res) => {
  res.json({ ok: true, label: req.kiosk.label });
});

// Limite les tentatives de PIN (anti brute-force) sur l'appareil.
const punchLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Badge : PIN -> bascule arrivée/départ pour l'utilisateur correspondant.
router.post('/kiosk/punch', requireKiosk, punchLimiter, (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ message: 'PIN invalide' });

  const user = db.prepare('SELECT id, username FROM users WHERE pin_hash = ? AND active = 1').get(hashPin(pin));
  if (!user) return res.status(404).json({ message: 'PIN inconnu' });

  const open = db.prepare('SELECT * FROM pointages WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1').get(user.id);
  const now = new Date().toISOString();

  if (open) {
    db.prepare("UPDATE pointages SET clock_out = ?, end_reason = 'depart' WHERE id = ?").run(now, open.id);
    return res.json({ username: user.username, action: 'out', time: now });
  }
  const workDate = /^\d{4}-\d{2}-\d{2}$/.test(req.body.date || '') ? req.body.date : now.slice(0, 10);
  db.prepare(`INSERT INTO pointages (id, user_id, work_date, clock_in, created_at)
              VALUES (?, ?, ?, ?, ?)`).run(crypto.randomUUID(), user.id, workDate, now, now);
  res.json({ username: user.username, action: 'in', time: now });
});

module.exports = { router, hashPin, hashToken };
