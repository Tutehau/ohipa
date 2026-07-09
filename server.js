require('dotenv').config();

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const SqliteStore = require('better-sqlite3-session-store')(session);

// La couche DB s'initialise (schéma + migration) au premier require.
const db = require('./db');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const reportsRoutes = require('./routes/reports');
const planningRoutes = require('./routes/planning');
const pointageRoutes = require('./routes/pointage');
const { router: kioskRoutes } = require('./routes/kiosk');

const PORT = process.env.PORT || 3000;

// Validation de l'environnement : fail-fast plutôt que faille silencieuse.
function validateEnv() {
  const required = ['SESSION_SECRET', 'SETUP_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('FATAL : variables manquantes dans .env : ' + missing.join(', '));
    process.exit(1);
  }
  if (process.env.NODE_ENV === 'production' && process.env.SETUP_KEY === 'change-me-setup-key') {
    console.error('FATAL : SETUP_KEY par défaut interdite en production.');
    process.exit(1);
  }
}

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Journalisation des requêtes (silencieuse pendant les tests).
  if (process.env.NODE_ENV !== 'test') {
    app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  // Derrière un reverse-proxy TLS, permet à express de connaître le schéma réel.
  app.set('trust proxy', 1);

  const sessionOptions = {
    secret: process.env.SESSION_SECRET || 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,                                  // inaccessible au JS => anti-vol de cookie
      sameSite: 'lax',                                 // atténue le CSRF
      // Cookie sécurisé piloté explicitement : true seulement derrière HTTPS,
      // sinon le navigateur ne renverrait pas le cookie sur http (login cassé).
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 24 * 60 * 60 * 1000,
    },
  };
  // Sessions persistées en SQLite hors test (survit aux redémarrages, pas de
  // fuite mémoire). En test on garde le MemoryStore : pas de timer qui empêche
  // le process de se terminer.
  if (process.env.NODE_ENV !== 'test') {
    sessionOptions.store = new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    });
  }
  app.use(session(sessionOptions));

  // Limite les tentatives sur les routes sensibles (anti brute-force).
  // Désactivé en test pour ne pas fausser les scénarios multi-login.
  if (process.env.NODE_ENV !== 'test') {
    const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
    app.use(['/api/login', '/api/setup-admin', '/api/register', '/api/reset-password'], authLimiter);
  }

  // Routes API
  app.use('/api', authRoutes);
  app.use('/api', adminRoutes);
  app.use('/api', reportsRoutes);
  app.use('/api', planningRoutes);
  app.use('/api', pointageRoutes);
  app.use('/api', kioskRoutes);

  // Fichiers statiques (front)
  app.use(express.static(path.join(__dirname, 'public')));

  return app;
}

// Démarrage direct (node server.js) ; exporté tel quel pour les tests.
if (require.main === module) {
  validateEnv();
  createApp().listen(PORT, () => console.log(`Ohipa sur http://localhost:${PORT}`));
}

module.exports = { createApp, validateEnv };
